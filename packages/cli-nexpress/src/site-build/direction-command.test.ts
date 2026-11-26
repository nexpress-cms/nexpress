import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import vector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import { runSiteBuildRenderOperationV1 } from "./direction-command.js";
import type * as DirectionRenderModule from "./direction-render.js";

const hooks = vi.hoisted(() => ({
  context: vi.fn(),
  render: vi.fn(),
  validate: vi.fn(),
  native: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("./render-context.js", () => ({ observeSiteBuildRenderContextV1: hooks.context }));
vi.mock("./direction-render.js", async (original) => ({
  ...(await original<typeof DirectionRenderModule>()),
  renderPreparedSiteBuildDirectionsV1: hooks.render,
  validatePreparedSiteBuildDirectionsV1: hooks.validate,
}));
vi.mock("./linux-sandbox.js", () => ({ runSiteBuildLinuxSandboxV1: hooks.native }));
vi.mock("./render-artifacts.js", () => ({ publishSiteBuildDirectionArtifactsV1: hooks.publish }));

const roots: string[] = [];
afterEach(async () => {
  for (const hook of Object.values(hooks)) hook.mockReset();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// Real public artifact parsing and file I/O; native observations/rendering are
// doubles. This checks that a coding client can author a blueprint using the
// current registry identity without importing private CLI internals.
describe("public render result identities", () => {
  it.each(["direction render", "direction validate", "fixture inspect"])(
    "returns the freshly observed command registry with %s",
    async (operation) => {
      const root = await mkdtemp(join(tmpdir(), "np-render-command-test-"));
      roots.push(root);
      await mkdir(join(root, ".nexpress/site"), { recursive: true });
      await writeFile(join(root, "brief.json"), JSON.stringify(vector.brief));
      await writeFile(join(root, "drafts.json"), JSON.stringify(vector.draftSet));
      await writeFile(join(root, "directions.json"), JSON.stringify(vector.set));
      const registry = `nb1:sha256:${"A".repeat(43)}`;
      const unchanged = vi.fn(async () => {});
      hooks.context.mockResolvedValue({
        observed: { capsule: { assertOriginalUnchanged: unchanged }, clock: {} },
        context: {
          capsule: { assertOriginalUnchanged: unchanged },
          config: "src/nexpress.config.ts",
        },
        fingerprint: `nb1:sha256:${"B".repeat(42)}A`,
        rendererFingerprint: `nb1:sha256:${"C".repeat(42)}A`,
        commandRegistryFingerprint: registry,
      });
      const rendered = { set: vector.set, artifacts: [], audits: [{}, {}] };
      hooks.render.mockResolvedValue(rendered);
      hooks.validate.mockResolvedValue(rendered);
      hooks.publish.mockResolvedValue({ status: "written", paths: [] });
      hooks.native.mockResolvedValue({
        artifacts: new Map([
          [
            "fixture.json",
            Buffer.from(JSON.stringify({ schemaVersion: "np.configured-build-render-fixture.v1" })),
          ],
        ]),
      });
      const values = new Map([
        ["--brief", "brief.json"],
        [
          operation === "direction validate" ? "--file" : "--draft",
          operation === "direction validate" ? "directions.json" : "drafts.json",
        ],
        ["--runtime", "runtime.json"],
        ["--out", ".nexpress/site/result.json"],
        ["--direction", vector.draftSet.directions[0].id],
      ]);
      expect(await runSiteBuildRenderOperationV1(operation, values, root)).toMatchObject({
        commandRegistryFingerprint: registry,
      });
      expect(unchanged).toHaveBeenCalled();
    },
  );
});
