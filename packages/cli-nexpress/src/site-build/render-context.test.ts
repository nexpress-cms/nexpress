import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npRequireAgentDesignDirectionDraftSetV1,
  npRequireBuildReadyBriefV1,
} from "@nexpress/core/agent-contract";
import vector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { observeSiteBuildRenderContextV1 } from "./render-context.js";

const session = vi.hoisted(() => vi.fn());
vi.mock("./render-session.js", () => ({ reuseSiteBuildRenderSessionV1: session }));
const roots: string[] = [];
beforeEach(() => {
  session.mockReset().mockRejectedValue(new SiteBuildError("unavailable"));
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-render-context-test-")));
  roots.push(root);
  const original = join(root, "original"),
    project = join(root, "private");
  const fixturePath = ".nexpress/site/fixtures/home.json";
  const runtimePath = ".nexpress/site/audit/generator-runtime-fixture/runtime.json";
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "np.agent-build-render-fixture.v1",
      documents: [
        {
          documentId: "00000000-0000-4000-8000-000000000001",
          collection: "pages",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [],
          data: { title: "Synthetic", slug: "/" },
          provenance: "demo",
        },
      ],
      navigation: [],
    }),
  );
  await mkdir(dirname(join(original, fixturePath)), { recursive: true });
  await mkdir(dirname(join(project, runtimePath)), { recursive: true });
  await writeFile(join(original, fixturePath), bytes);
  await writeFile(join(project, runtimePath), '{"scope":"private-session-sentinel"}');
  const drafts = npRequireAgentDesignDirectionDraftSetV1(structuredClone(vector.draftSet));
  drafts.comparisonInputs.sampleContent[0].data = {
    schemaVersion: "np.agent-build-render-fixture-ref.v1",
    stagedArtifactPath: fixturePath,
    digest: await npBuildFileDigest("np.build-staged-artifact.v1", bytes),
    pageDocumentId: "00000000-0000-4000-8000-000000000001",
  };
  drafts.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    drafts.comparisonInputs,
  );
  for (const direction of drafts.directions)
    direction.comparisonInputsDigest = drafts.comparisonInputsDigest;
  return {
    root,
    original,
    project,
    bytes,
    fixturePath,
    input: {
      cwd: project,
      runtimePath,
      files: await SiteArtifactFiles.at(project),
      fixtureFiles: await SiteArtifactFiles.at(original),
      brief: npRequireBuildReadyBriefV1(vector.brief),
      drafts: npRequireAgentDesignDirectionDraftSetV1(drafts),
    },
  };
}

describe("render context fixture transport", () => {
  // The session sentinel stops before image/native work; artifact reads are actual.
  it("reads the bound original fixture while its private source has no fixture and keeps session reads private", async () => {
    const value = await fixture();
    await expect(readFile(join(value.project, value.fixturePath))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(observeSiteBuildRenderContextV1(value.input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(session).toHaveBeenCalledWith({
      session: { scope: "private-session-sentinel" },
      projectRoot: value.project,
      tarballProjectRoot: undefined,
    });
  });

  it("rejects different original fixture bytes before session or native work", async () => {
    const value = await fixture();
    await writeFile(join(value.original, value.fixturePath), "{}");
    await expect(observeSiteBuildRenderContextV1(value.input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(session).not.toHaveBeenCalled();
  });

  it("keeps the existing local reader when no separate fixture owner is supplied", async () => {
    const value = await fixture();
    await mkdir(dirname(join(value.project, value.fixturePath)), { recursive: true });
    await writeFile(join(value.project, value.fixturePath), value.bytes);
    const { fixtureFiles: _fixtureFiles, ...input } = value.input;
    await expect(observeSiteBuildRenderContextV1(input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(session).toHaveBeenCalledOnce();
  });
});
