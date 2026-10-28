import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npRequireAgentSiteBlueprintV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionVector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import { runSiteBuildSeedSourceV1 } from "./seed-command.js";

const hooks = vi.hoisted(() => ({ context: vi.fn(), native: vi.fn(), drafts: vi.fn() }));
vi.mock("./render-context.js", () => ({ observeSiteBuildRenderContextV1: hooks.context }));
vi.mock("./linux-sandbox.js", () => ({ runSiteBuildLinuxSandboxV1: hooks.native }));
vi.mock("./direction-render.js", () => ({ siteBuildDraftFromSealedDirectionsV1: hooks.drafts }));
const owned: string[] = [];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
async function put(root: string, path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const hook of Object.values(hooks)) hook.mockReset();
});

// Native execution/config loading is a transport double. Core parsers, source
// production and filesystem byte/identity/output checks remain real. This does
// not execute Linux, Next, a database, a seed or a comparison render.
async function fixture(
  configPath: "src/nexpress.config.ts" | "nexpress.config.ts" = "src/nexpress.config.ts",
) {
  const project = await realpath(await mkdtemp(join(tmpdir(), "np-seed-source-")));
  owned.push(project);
  const args = new Map([
    ["--brief", ".nexpress/site/brief.json"],
    ["--directions", ".nexpress/site/directions.json"],
    ["--blueprint", ".nexpress/site/blueprint.json"],
    ["--runtime", ".nexpress/site/runtime.json"],
    ["--out", ".nexpress/site/seed-source.json"],
  ]);
  const blueprint = npRequireAgentSiteBlueprintV1(JSON.parse(canonical.structured[1].canonical));
  blueprint.briefHash = await npBuildCanonicalDigest(
    "np.build-site-brief.v1",
    directionVector.brief,
  );
  blueprint.directionSetHash = await npBuildCanonicalDigest(
    "np.build-design-direction-set.v1",
    directionVector.set,
  );
  blueprint.selectedDirectionId = directionVector.set.directions[0].id;
  blueprint.selectedDirectionHash = await npBuildCanonicalDigest(
    "np.build-design-direction.v1",
    directionVector.set.directions[0],
  );
  blueprint.selectedDirectionProjectionDigest = directionVector.set.directions[0].projectionDigest;
  // Source discovery must work before the client can stage these exact files,
  // compose its final file plan and choose the final command inventory.
  blueprint.filePlan = [];
  blueprint.commands = [];
  blueprint.verification = [];
  await put(project, args.get("--brief")!, encode(directionVector.brief));
  await put(project, args.get("--directions")!, encode(directionVector.set));
  await put(project, args.get("--blueprint")!, encode(blueprint));
  await put(project, args.get("--runtime")!, "{}");
  await put(project, configPath, "export default {};\n");
  const lease = vi.fn(async () => {});
  const renderer = { scope: "native-transport-double" };
  const image = { scope: "native-image-double" };
  const context = {
    commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
    observed: { clock: { now: "2026-10-23T00:00:00.000Z", randomSeed: "a".repeat(64) } },
    context: {
      config: configPath,
      capsule: { project: "/synthetic-frozen-runtime", renderer, assertOriginalUnchanged: lease },
      image,
    },
  };
  hooks.context.mockResolvedValue(context);
  hooks.drafts.mockReturnValue(directionVector.draftSet);
  const seedArtifactBytes = encode({
    schemaVersion: "np.site-build-seed.v1",
    theme: { id: "default", ...blueprint.theme },
    seed: blueprint.seed,
    navigation: blueprint.navigation,
  });
  const native = {
    audit: { status: "passed" },
    artifacts: new Map<string, Uint8Array>([
      [
        "blueprint.json",
        npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint).canonicalJsonUtf8,
      ],
      ["repository-seed.json", seedArtifactBytes],
    ]),
  };
  hooks.native.mockResolvedValue(native);
  return {
    project,
    args,
    blueprint,
    configPath,
    context,
    lease,
    native,
    seedArtifactBytes,
    run: () => runSiteBuildSeedSourceV1(args, project),
  };
}

describe("installed seed source command (native transport mocked)", () => {
  it.each(["src/nexpress.config.ts", "nexpress.config.ts"] as const)(
    "returns exact fixed source bytes for %s without staging or requiring final plan rows",
    async (config) => {
      const f = await fixture(config),
        result = await f.run();
      expect(result).toMatchObject({
        operation: "seed source",
        scope: "installed-seed-source-only",
        status: "written",
        sourceWrites: 0,
        executable: false,
      });
      const envelope = JSON.parse(
        await readFile(join(f.project, f.args.get("--out")!), "utf8"),
      ) as {
        blueprintHash: string;
        files: Array<{
          path: string;
          base64url: string;
          contentHash: string;
          bytes: number;
          suggestedStagedArtifactPath: string;
        }>;
      };
      expect(envelope.blueprintHash).toBe(
        await npBuildCanonicalDigest("np.build-site-blueprint.v1", f.blueprint),
      );
      expect(envelope.files.map((file) => file.path)).toEqual([
        "site-build.seed.json",
        "scripts/seed-content.ts",
      ]);
      for (const file of envelope.files) {
        const bytes = Buffer.from(file.base64url, "base64url");
        expect(bytes.length).toBe(file.bytes);
        expect(await npBuildFileDigest("np.build-source-file.v1", bytes)).toBe(file.contentHash);
        await expect(readFile(join(f.project, file.path))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          readFile(join(f.project, file.suggestedStagedArtifactPath)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(Buffer.from(envelope.files[0].base64url, "base64url")).toEqual(f.seedArtifactBytes);
      const script = Buffer.from(envelope.files[1].base64url, "base64url").toString();
      expect(script).toContain(
        config === "src/nexpress.config.ts" ? "../src/nexpress.config.js" : "../nexpress.config.js",
      );
      expect(script).not.toContain(envelope.blueprintHash);
      expect(hooks.native).toHaveBeenCalledOnce();
      expect(f.lease.mock.calls.length).toBeGreaterThanOrEqual(4);
      const input = hooks.native.mock.calls[0][0];
      expect(JSON.parse(Buffer.from(input.inputBytes).toString())).toMatchObject({
        mode: "blueprint",
        config,
        blueprint: { commands: [], filePlan: [] },
      });
      expect(input.image).toBe(f.context.context.image);
      expect(input.project).toBe("/synthetic-frozen-runtime");
      expect(input.artifacts.map((file: { name: string }) => file.name)).toEqual([
        "blueprint.json",
        "repository-seed.json",
      ]);
    },
  );
  it("is byte-identical/idempotent while performing another actual native observation", async () => {
    const f = await fixture();
    await f.run();
    const before = await readFile(join(f.project, f.args.get("--out")!));
    expect(await f.run()).toMatchObject({ status: "unchanged" });
    expect(await readFile(join(f.project, f.args.get("--out")!))).toEqual(before);
    expect(hooks.native).toHaveBeenCalledTimes(2);
  });
  it.each([
    ".env",
    "../outside.json",
    ".nexpress/site/review/seed.json",
    ".nexpress/site/tmp/seed.json",
    ".nexpress/site/files/seed.json",
    ".nexpress/site/fixtures/seed.json",
    ".nexpress/site/sub/seed.json",
    ".nexpress/site/con.json",
  ])("rejects output profile %s before native execution", async (out) => {
    const f = await fixture();
    f.args.set("--out", out);
    await expect(f.run()).rejects.toMatchObject({ reason: "path" });
    expect(hooks.native).not.toHaveBeenCalled();
  });
  it.each(["--brief", "--directions", "--blueprint", "--runtime"])(
    "rejects %s input alias before native execution",
    async (key) => {
      const f = await fixture();
      f.args.set("--out", f.args.get(key)!);
      await expect(f.run()).rejects.toMatchObject({ reason: "path" });
      expect(hooks.native).not.toHaveBeenCalled();
    },
  );
  it("rejects absent/unknown/execution flags", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    await expect(f.run()).rejects.toMatchObject({ reason: "arguments" });
    f.args.delete("--execute");
    f.args.delete("--runtime");
    await expect(f.run()).rejects.toMatchObject({ reason: "arguments" });
    expect(hooks.context).not.toHaveBeenCalled();
  });
  it("rejects an existing output symlink before native execution", async () => {
    const f = await fixture();
    await put(f.project, "unrelated.json", "{}");
    await symlink(join(f.project, "unrelated.json"), join(f.project, f.args.get("--out")!));
    await expect(f.run()).rejects.toThrow();
    expect(hooks.native).not.toHaveBeenCalled();
    expect(await readFile(join(f.project, "unrelated.json"), "utf8")).toBe("{}");
  });
  it("preserves a conflicting pre-existing output", async () => {
    const f = await fixture();
    await put(f.project, f.args.get("--out")!, '{"operator":true}');
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(f.project, f.args.get("--out")!), "utf8")).toBe('{"operator":true}');
  });
  it("requires the actual command registry and supported normal config path", async () => {
    const f = await fixture();
    hooks.context.mockResolvedValue({
      ...f.context,
      commandRegistryFingerprint: `nb1:sha256:${"B".repeat(42)}A`,
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.native).not.toHaveBeenCalled();
    hooks.context.mockResolvedValue({
      ...f.context,
      context: { ...f.context.context, config: "custom.ts" },
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "unavailable" });
    expect(hooks.native).not.toHaveBeenCalled();
  });
  it("requires unchanged returned blueprint canonical bytes", async () => {
    const f = await fixture();
    const changed: NpAgentSiteBlueprintV1 = structuredClone(f.blueprint);
    changed.deployment.notes.push("changed after review");
    f.native.artifacts.set(
      "blueprint.json",
      npBuildCanonicalBytes("np.build-site-blueprint.v1", changed).canonicalJsonUtf8,
    );
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    await expect(readFile(join(f.project, f.args.get("--out")!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("accepts different JSON property presentation only through the owning canonicalizer", async () => {
    const f = await fixture();
    f.native.artifacts.set("blueprint.json", Buffer.from(JSON.stringify(f.blueprint, null, 2)));
    await expect(f.run()).resolves.toMatchObject({ status: "written" });
  });
  it("rejects duplicate-key native blueprint JSON", async () => {
    const f = await fixture();
    f.native.artifacts.set(
      "blueprint.json",
      Buffer.from(
        `{"schemaVersion":"np.agent-site-blueprint.v1",${JSON.stringify(f.blueprint).slice(1)}`,
      ),
    );
    await expect(f.run()).rejects.toThrow();
  });
  it.each(["blueprint.json", "repository-seed.json"])(
    "requires native artifact %s",
    async (name) => {
      const f = await fixture();
      f.native.artifacts.delete(name);
      await expect(f.run()).rejects.toThrow();
      await expect(readFile(join(f.project, f.args.get("--out")!))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it("rejects a failed native audit even if JSON artifacts look valid", async () => {
    const f = await fixture();
    f.native.audit.status = "failed";
    await expect(f.run()).rejects.toMatchObject({ reason: "unavailable" });
  });
  it("does not substitute declarative JSON when native execution is unavailable", async () => {
    const f = await fixture();
    hooks.native.mockRejectedValue(new SiteBuildError("unavailable"));
    await expect(f.run()).rejects.toMatchObject({ reason: "unavailable" });
    await expect(readFile(join(f.project, f.args.get("--out")!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects unsupported seed body through the existing fixed-source owner", async () => {
    const f = await fixture();
    f.native.artifacts.set(
      "repository-seed.json",
      encode({
        schemaVersion: "np.site-build-seed.v1",
        theme: {},
        seed: f.blueprint.seed,
        navigation: [],
      }),
    );
    await expect(f.run()).rejects.toMatchObject({ reason: "input" });
  });
  it("rechecks actual runtime input bytes after native execution", async () => {
    const f = await fixture();
    hooks.native.mockImplementation(async () => {
      await put(f.project, f.args.get("--runtime")!, '{"changed":true}');
      return f.native;
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    await expect(readFile(join(f.project, f.args.get("--out")!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects same-byte input inode replacement", async () => {
    const f = await fixture();
    hooks.native.mockImplementation(async () => {
      const path = f.args.get("--blueprint")!,
        bytes = await readFile(join(f.project, path));
      await put(f.project, "replacement.json", bytes);
      await rename(join(f.project, "replacement.json"), join(f.project, path));
      return f.native;
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
  });
  it("rejects a replaced input parent even when bytes remain identical", async () => {
    const f = await fixture();
    hooks.native.mockImplementation(async () => {
      const site = join(f.project, ".nexpress/site");
      await rename(site, `${site}-before`);
      await mkdir(site);
      for (const key of ["--brief", "--directions", "--blueprint", "--runtime"]) {
        const path = f.args.get(key)!;
        await put(
          f.project,
          path,
          await readFile(join(f.project, path.replace("site/", "site-before/"))),
        );
      }
      return f.native;
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
  });
  it("checks the live capsule before native and again afterward", async () => {
    const f = await fixture();
    f.lease.mockRejectedValueOnce(new SiteBuildError("conflict"));
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.native).not.toHaveBeenCalled();
    f.lease.mockReset();
    f.lease.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new SiteBuildError("conflict"));
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.native).toHaveBeenCalledOnce();
  });
});
