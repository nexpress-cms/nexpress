import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishSiteBuildFinalArtifactsV1 } from "./render-artifacts.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const project = await realpath(await mkdtemp(join(tmpdir(), "np-final-artifacts-test-")));
  roots.push(project);
  return {
    project,
    artifacts: [
      { path: ".nexpress/site/review/final/home.png", bytes: Buffer.from("caller-verified-png") },
    ],
    manifest: {
      path: ".nexpress/site/review/final/result.json",
      bytes: Buffer.from('{"callerVerified":true}'),
    },
  };
}
describe("final artifact create-only publication", () => {
  it("publishes a full 200-route inventory and manifest last, with identical retry", async () => {
    const input = await fixture();
    input.artifacts = Array.from({ length: 400 }, (_, i) => ({
      path: `.nexpress/site/review/final/page-${i}.png`,
      bytes: Buffer.from(`verified ${i}`),
    }));
    input.artifacts.push({
      path: ".nexpress/site/review/final/report.json",
      bytes: Buffer.from("{}"),
    });
    const published = await publishSiteBuildFinalArtifactsV1(input);
    expect(published.paths).toHaveLength(402);
    expect(published.paths.at(-1)).toBe(input.manifest.path);
    expect(await readFile(join(input.project, input.manifest.path))).toEqual(input.manifest.bytes);
    expect((await publishSiteBuildFinalArtifactsV1(input)).status).toBe("unchanged");
  }, 30000);
  it("preflights a conflicting manifest before writing screenshots and preserves operator bytes", async () => {
    const input = await fixture();
    await mkdir(join(input.project, ".nexpress/site/review/final"), { recursive: true });
    await writeFile(join(input.project, input.manifest.path), "operator bytes");
    await expect(publishSiteBuildFinalArtifactsV1(input)).rejects.toMatchObject({
      reason: "conflict",
      manifestState: "unconfirmed",
    });
    await expect(readFile(join(input.project, input.artifacts[0].path))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(input.project, input.manifest.path), "utf8")).toBe("operator bytes");
  });
  it("rejects authoring paths, case aliases and case-aliased existing parents", async () => {
    const input = await fixture();
    await expect(
      publishSiteBuildFinalArtifactsV1({
        ...input,
        manifest: { ...input.manifest, path: "src/result.json" },
      }),
    ).rejects.toThrow();
    await expect(
      publishSiteBuildFinalArtifactsV1({
        ...input,
        artifacts: [
          { path: ".nexpress/site/review/final/A/x.png", bytes: Buffer.from("x") },
          { path: ".nexpress/site/review/final/a/y.png", bytes: Buffer.from("y") },
        ],
      }),
    ).rejects.toMatchObject({ reason: "path" });
    await mkdir(join(input.project, ".nexpress/site/review/Final"), { recursive: true });
    await expect(publishSiteBuildFinalArtifactsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
  });
});
