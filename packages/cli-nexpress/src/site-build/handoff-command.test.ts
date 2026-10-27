import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npRequireAgentDesignDirectionSetV1,
  npRequireAgentSiteBlueprintV1,
  npRequireBuildReadyBriefV1,
  type NpAgentBuildVerificationResultBodyV1,
  type NpAgentBuildVerificationResultV1,
  type NpAgentBuildVerificationObservationV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionVectors from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import { SiteArtifactFiles } from "./artifact-io.js";
import { runSiteBuildHandoffExportV1 } from "./handoff-command.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const roots: string[] = [],
  digest: `nb1:sha256:${string}` = `nb1:sha256:${"A".repeat(43)}`;
// Real 1x1 PNG test bytes. Contract fixture records below are synthetic and do not
// claim a renderer, browser, current native success or human review took place.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1EAAAAASUVORK5CYII=",
  "base64",
);
const paths = {
  brief: ".nexpress/site/brief.json",
  directions: ".nexpress/site/directions.json",
  blueprint: ".nexpress/site/blueprint.json",
  verification: ".nexpress/site/review/final/result.json",
  observations: ".nexpress/site/audit/recorded/observations.json",
  out: ".nexpress/site/review/final/handoff.json",
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
async function put(project: string, path: string, bytes: Uint8Array | string) {
  await mkdir(dirname(join(project, path)), { recursive: true });
  await writeFile(join(project, path), bytes);
}
async function absent(project: string) {
  await expect(readFile(join(project, paths.out))).rejects.toMatchObject({ code: "ENOENT" });
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(
  options: { verified?: boolean; image?: Buffer; pages?: number; declaredImageBytes?: number } = {},
) {
  const project = await realpath(await mkdtemp(join(tmpdir(), "np-handoff-export-test-")));
  roots.push(project);
  const image = options.image ?? png,
    brief = npRequireBuildReadyBriefV1(structuredClone(directionVectors.brief));
  const briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", brief),
    directions = npRequireAgentDesignDirectionSetV1(structuredClone(directionVectors.set));
  directions.briefHash = briefHash;
  directions.comparisonInputs.briefHash = briefHash;
  directions.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    directions.comparisonInputs,
  );
  for (const direction of directions.directions) {
    direction.comparisonInputsDigest = directions.comparisonInputsDigest;
    direction.projectionDigest = await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      npBuildDirectionProjectionV1(direction),
    );
    for (const ref of [direction.previewArtifact.desktop, direction.previewArtifact.mobile]) {
      ref.comparisonInputsDigest = directions.comparisonInputsDigest;
      ref.directionProjectionDigest = direction.projectionDigest;
      ref.digest = await npBuildFileDigest("np.build-preview-artifact.v1", image);
      ref.bytes = image.length;
      await put(project, ref.relativePath, image);
    }
  }
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonical.structured.find((v) => v.purpose === "np.build-site-blueprint.v1")!.canonical,
    ),
  );
  blueprint.briefHash = briefHash;
  blueprint.directionSetHash = await npBuildCanonicalDigest(
    "np.build-design-direction-set.v1",
    directions,
  );
  blueprint.discoveryFingerprint = directions.discoveryFingerprint;
  blueprint.selectedDirectionId = directions.directions[0].id;
  blueprint.selectedDirectionHash = await npBuildCanonicalDigest(
    "np.build-design-direction.v1",
    directions.directions[0],
  );
  blueprint.selectedDirectionProjectionDigest = directions.directions[0].projectionDigest;
  blueprint.filePlan[0].contentHash = await npBuildFileDigest(
    "np.build-source-file.v1",
    Buffer.from("reviewed home source\n"),
  );
  await put(project, "src/home.ts", "reviewed home source\n");
  await put(project, ".env", "SYNTHETIC_SECRET=do-not-export-this-value\n");
  const page = blueprint.pages[0];
  blueprint.pages = Array.from({ length: options.pages ?? 1 }, (_, index) => ({
    ...structuredClone(page),
    id: index ? `page-${index}` : "home",
    route: index ? `/page-${index}` : "/",
  }));
  const artifacts: NpAgentBuildVerificationResultBodyV1["artifacts"] = blueprint.pages.flatMap(
    (page) =>
      ["desktop", "mobile"].map((viewport) => ({
        kind: "screenshot" as const,
        path: `.nexpress/site/review/final/${page.id}-${viewport}.png`,
        digest: "",
        bytes: options.declaredImageBytes ?? image.length,
        mime: "image/png" as const,
        pageId: page.id,
        viewport: viewport as "desktop" | "mobile",
      })),
  );
  artifacts.push({
    kind: "report",
    path: ".nexpress/site/review/final/report.json",
    digest: "",
    bytes: 1,
    mime: "application/json",
    pageId: null,
    viewport: null,
  });
  artifacts.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  blueprint.commands.push({
    id: "preview",
    cwd: "project",
    prerequisites: ["format"],
    timeoutSeconds: 60,
    template: "preview-render",
    comparisonInputsDigest: directions.comparisonInputsDigest,
    renderEnvironmentFingerprint: digest,
    routes: blueprint.pages.map((page) => ({
      pageId: page.id,
      route: page.route,
      locale: page.locale,
      audience: page.audience,
      fixtureIds: [],
    })),
    viewports: directions.comparisonInputs.viewports,
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: artifacts.map((artifact) =>
      artifact.kind === "screenshot"
        ? {
            kind: "screenshot",
            path: artifact.path,
            pageId: artifact.pageId,
            viewport: artifact.viewport,
          }
        : { kind: "report", path: artifact.path },
    ),
    verificationResultPath: paths.verification,
  });
  blueprint.verification.push(
    {
      id: "preview-exit",
      commandId: "preview",
      required: true,
      expected: "exit-zero",
      artifactPath: null,
    },
    {
      id: "preview-review",
      commandId: "preview",
      required: true,
      expected: "review-artifact",
      artifactPath: paths.verification,
    },
  );
  await put(project, paths.brief, encode(brief));
  await put(project, paths.directions, encode(directions));
  await put(project, paths.blueprint, encode(blueprint));
  const source = await readSiteSourceTreeV1(project),
    blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const report = {
    schemaVersion: "np.agent-build-preview-report.v1",
    blueprintHash,
    comparisonInputsDigest: directions.comparisonInputsDigest,
    renderEnvironmentFingerprint: digest,
    routes: blueprint.pages.map((page) => ({
      pageId: page.id,
      route: page.route,
      locale: page.locale,
      audience: page.audience,
      checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"].map((id) => ({
        id,
        status: "pass",
        issueIds: [],
      })),
    })),
    issues: [],
  };
  for (const artifact of artifacts) {
    const bytes = artifact.kind === "report" ? encode(report) : image;
    artifact.digest = await npBuildFileDigest("np.build-verification-artifact.v1", bytes);
    if (artifact.kind === "report") artifact.bytes = bytes.length;
    await put(project, artifact.path, bytes);
  }
  const body: NpAgentBuildVerificationResultBodyV1 = {
    schemaVersion: "np.agent-build-verification-result.v1",
    blueprintHash,
    commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
    renderEnvironmentFingerprint: digest,
    baselineTreeDigest: digest,
    finalSourceDigest: source.digest,
    commandResults: blueprint.commands.map((command) => ({ commandId: command.id, exitCode: 0 })),
    artifacts,
  };
  const result: NpAgentBuildVerificationResultV1 = {
    ...body,
    manifestDigest: await npBuildCanonicalDigest("np.build-verification-result.v1", body),
  };
  const output = {
    schemaVersion: "np.agent-build-command-output.v1",
    stdout: {
      base64url: Buffer.from("synthetic-private-log-do-not-export").toString("base64url"),
      truncated: false,
    },
    stderr: { base64url: "", truncated: false },
  };
  const outputDigest = await npBuildCanonicalDigest("np.build-command-output.v1", output);
  const observation: NpAgentBuildVerificationObservationV1 = {
    schemaVersion: "np.agent-build-verification-observation.v1",
    manifestDigest: result.manifestDigest,
    commandResults: body.commandResults.map((command) => ({
      ...command,
      outputDigest,
      durationMs: 10,
      outputArtifactPath: `.nexpress/site/audit/recorded/${command.commandId}.json`,
    })),
    startedAt: "2026-10-23T00:00:00.000Z",
    finishedAt: "2026-10-23T00:00:01.000Z",
  };
  for (const command of observation.commandResults)
    await put(project, command.outputArtifactPath, encode(output));
  await put(project, paths.verification, encode(result));
  await put(project, paths.observations, encode([observation]));
  const values = new Map([
    ["--brief", paths.brief],
    ["--directions", paths.directions],
    ["--blueprint", paths.blueprint],
    ["--out", paths.out],
  ]);
  if (options.verified) {
    values.set("--verification", paths.verification);
    values.set("--observations", paths.observations);
  }
  const rebind = async () => {
    const { manifestDigest: _digest, ...body } = result;
    result.manifestDigest = await npBuildCanonicalDigest("np.build-verification-result.v1", body);
    observation.manifestDigest = result.manifestDigest;
    await put(project, paths.verification, encode(result));
    await put(project, paths.observations, encode([observation]));
  };
  return { project, values, directions, blueprint, result, report, observation, output, rebind };
}

describe("recorded local handoff export", () => {
  it("exports deterministic envelope without verification as unverified/open and preserves all raw source bytes", async () => {
    const { project, values } = await fixture(),
      before = await readSiteSourceTreeV1(project);
    const first = await runSiteBuildHandoffExportV1(values, project),
      bytes = await readFile(join(project, paths.out));
    const envelope = JSON.parse(bytes.toString()) as {
      handoff: {
        executable: boolean;
        verification: { state: string };
        authority: { deployment: boolean; providerCalls: boolean };
      };
      markdown: string;
    };
    expect(Object.keys(envelope).sort()).toEqual(["handoff", "markdown"]);
    expect(envelope.handoff.verification.state).toBe("unverified");
    expect(envelope.handoff.executable).toBe(false);
    expect(envelope.handoff.authority).toMatchObject({ deployment: false, providerCalls: false });
    expect(first).toMatchObject({
      status: "written",
      observationScope: "recorded-artifact-bytes-only",
      executedCommands: 0,
      sourceWrites: 0,
      observedFiles: 9,
    });
    expect((await runSiteBuildHandoffExportV1(values, project)).status).toBe("unchanged");
    expect(await readFile(join(project, paths.out))).toEqual(bytes);
    expect(await readSiteSourceTreeV1(project)).toEqual(before);
    expect(bytes.toString()).not.toContain("do-not-export-this-value");
  });

  it("rehashes supplied manifest/report/PNGs/command bodies as recorded-only evidence without exporting private logs", async () => {
    const { project, values } = await fixture({ verified: true }),
      before = await readSiteSourceTreeV1(project);
    const exported = await runSiteBuildHandoffExportV1(values, project),
      text = await readFile(join(project, paths.out), "utf8");
    expect(exported).toMatchObject({
      verificationState: "recorded-pass",
      executedCommands: 0,
      observedFiles: 16,
    });
    expect(text).toContain('"evidence":"observation-record"');
    expect(text).not.toContain("synthetic-private-log-do-not-export");
    expect(text).toContain('"liveDatabase":"unverified"');
    expect(text).toContain('"deployment":false');
    expect(await readSiteSourceTreeV1(project)).toEqual(before);
  });

  it("keeps a rehashed manifest without observation records unverified", async () => {
    const { project, values } = await fixture({ verified: true });
    values.delete("--observations");
    const result = await runSiteBuildHandoffExportV1(values, project);
    expect(result).toMatchObject({
      verificationState: "unverified",
      observedFiles: 13,
      executedCommands: 0,
    });
    const envelope = JSON.parse(await readFile(join(project, paths.out), "utf8")) as {
      handoff: { commandsNotObserved: string[] };
    };
    expect(envelope.handoff.commandsNotObserved).toEqual(["format", "preview"]);
  });

  it("consumes the single observation record emitted by site generate without rewriting it", async () => {
    const data = await fixture({ verified: true });
    const bytes = encode(data.observation);
    await put(data.project, paths.observations, bytes);
    const exported = await runSiteBuildHandoffExportV1(data.values, data.project);
    expect(exported).toMatchObject({ verificationState: "recorded-pass", executedCommands: 0 });
    expect(await readFile(join(data.project, paths.observations))).toEqual(bytes);
  });

  it("rejects an unbound single generator observation before publishing a handoff", async () => {
    const data = await fixture({ verified: true });
    await put(
      data.project,
      paths.observations,
      encode({ ...data.observation, manifestDigest: digest }),
    );
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toThrow();
    await absent(data.project);
  });

  it.each(["direction", "final-image", "command-output"])(
    "rejects changed %s bytes instead of trusting recorded digests",
    async (kind) => {
      const data = await fixture({ verified: true });
      const path =
        kind === "direction"
          ? data.directions.directions[0].previewArtifact.desktop.relativePath
          : kind === "final-image"
            ? data.result.artifacts.find((a) => a.kind === "screenshot")!.path
            : data.observation.commandResults[0].outputArtifactPath;
      await put(
        data.project,
        path,
        kind === "command-output"
          ? encode({ ...data.output, stderr: { base64url: "Y2hhbmdlZA", truncated: false } })
          : kind === "final-image"
            ? Buffer.from(png.map((byte, index) => (index === png.length - 1 ? byte ^ 1 : byte)))
            : Buffer.concat([png, Buffer.from("changed")]),
      );
      await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
        reason: "conflict",
      });
      await absent(data.project);
    },
  );

  it("parses the actual report against the exact blueprint even if its changed file digest and manifest are internally consistent", async () => {
    const data = await fixture({ verified: true });
    data.report.blueprintHash = digest;
    const artifact = data.result.artifacts.find((a) => a.kind === "report")!,
      bytes = encode(data.report);
    artifact.bytes = bytes.length;
    artifact.digest = await npBuildFileDigest("np.build-verification-artifact.v1", bytes);
    await put(data.project, artifact.path, bytes);
    await data.rebind();
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toThrow();
    await absent(data.project);
  });

  it("rejects forged MIME and no-follow screenshot aliases", async () => {
    const invalid = await fixture({ image: Buffer.from("not image bytes") });
    await expect(
      runSiteBuildHandoffExportV1(invalid.values, invalid.project),
    ).rejects.toMatchObject({ reason: "input" });
    await absent(invalid.project);
    const alias = await fixture({ verified: true }),
      path = alias.result.artifacts.find((a) => a.kind === "screenshot")!.path;
    await rm(join(alias.project, path));
    await put(alias.project, "outside-image.png", png);
    await symlink(join(alias.project, "outside-image.png"), join(alias.project, path));
    const reader = await SiteArtifactFiles.at(alias.project);
    await expect(reader.readFinalPreviewImage(path, png.length)).rejects.toThrow();
    await expect(runSiteBuildHandoffExportV1(alias.values, alias.project)).rejects.toThrow();
    await absent(alias.project);
  });

  it("rejects reference drift on reobservation before publication", async () => {
    const data = await fixture(),
      first = data.directions.directions[0].previewArtifact.desktop.relativePath;
    const reader = await SiteArtifactFiles.at(data.project),
      original = reader.readReviewPng.bind(reader);
    vi.spyOn(SiteArtifactFiles.prototype, "readReviewPng").mockImplementationOnce(async (path) => {
      const bytes = await original(path);
      await put(data.project, first, Buffer.concat([png, Buffer.from("late drift")]));
      return bytes;
    });
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
      reason: "conflict",
    });
    await absent(data.project);
  });

  it("rejects raw source drift without reverting the external source edit", async () => {
    const data = await fixture(),
      reader = await SiteArtifactFiles.at(data.project),
      original = reader.readReviewPng.bind(reader);
    vi.spyOn(SiteArtifactFiles.prototype, "readReviewPng").mockImplementationOnce(async (path) => {
      const bytes = await original(path);
      await put(data.project, "src/home.ts", "operator concurrent source\n");
      return bytes;
    });
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
      reason: "conflict",
    });
    await absent(data.project);
    expect(await readFile(join(data.project, "src/home.ts"), "utf8")).toBe(
      "operator concurrent source\n",
    );
  });

  it("rejects a >512MiB declared final artifact aggregate before reading screenshots", async () => {
    const data = await fixture({ verified: true, pages: 5, declaredImageBytes: 64 * 1024 * 1024 }),
      read = vi.spyOn(SiteArtifactFiles.prototype, "readFinalPreviewImage");
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
      reason: "input",
    });
    expect(read).not.toHaveBeenCalled();
    await absent(data.project);
  });

  it("preserves conflicting output and refuses source paths or observations without verification", async () => {
    const data = await fixture();
    await put(data.project, paths.out, "operator handoff bytes");
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
      reason: "conflict",
      manifestState: "unconfirmed",
    });
    expect(await readFile(join(data.project, paths.out), "utf8")).toBe("operator handoff bytes");
    data.values.set("--out", "src/handoff.json");
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
      reason: "path",
    });
    data.values.set("--out", paths.out);
    data.values.set("--observations", paths.observations);
    await expect(runSiteBuildHandoffExportV1(data.values, data.project)).rejects.toMatchObject({
      reason: "arguments",
    });
  });
});
