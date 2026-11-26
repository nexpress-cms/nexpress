import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npRequireAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionVector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import {
  runSiteBuildCodegenSourceV1,
  NpSiteBuildCodegenSourceFailureV1,
} from "./codegen-command.js";
import { SiteBuildError } from "./artifact-io.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import type * as SandboxModule from "./linux-sandbox.js";
import type {
  NpSiteBuildLinuxWorkspaceInputV1,
  NpSiteBuildLinuxWorkspaceV1,
} from "./linux-workspace.js";

const hooks = vi.hoisted(() => ({
  context: vi.fn(),
  drafts: vi.fn(),
  native: vi.fn(),
  dirty: vi.fn(),
  plan: vi.fn(),
  dependencies: vi.fn(),
  workspace: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("./render-context.js", () => ({ observeSiteBuildRenderContextV1: hooks.context }));
vi.mock("./direction-render.js", () => ({ siteBuildDraftFromSealedDirectionsV1: hooks.drafts }));
vi.mock("./linux-sandbox.js", async (original) => ({
  ...(await original<typeof SandboxModule>()),
  runSiteBuildLinuxSandboxV1: hooks.native,
}));
vi.mock("./repository-status.js", () => ({ observeSiteBuildDirtyPathsV1: hooks.dirty }));
vi.mock("./repository-edit-plan.js", () => ({ prepareSiteBuildRepositoryEditPlanV1: hooks.plan }));
vi.mock("./candidate-dependencies.js", () => ({
  materializeSiteBuildCandidateDependenciesV1: hooks.dependencies,
}));
vi.mock("./linux-workspace.js", () => ({ withSiteBuildLinuxWorkspaceV1: hooks.workspace }));
vi.mock("./render-artifacts.js", () => ({ publishSiteBuildGeneratorAuditV1: hooks.publish }));
const roots: string[] = [];
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function put(root: string, path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const hook of Object.values(hooks)) hook.mockReset();
});

// Native App loading, private copy/dependencies, Linux and publication are
// transport doubles. Real Core contracts, source/file hashes, shared drivers,
// no-follow file reads, output bytes and failure audit selection are exercised.
// No actual generated SQL, Docker, schema generator, DB or executor equality is proved.
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-codegen-source-")));
  roots.push(root);
  const project = join(root, "original"),
    candidate = join(root, "candidate"),
    frozen = join(root, "frozen");
  const normal = {
    "package.json": '{"name":"synthetic-codegen","type":"module"}\n',
    "src/nexpress.config.ts": "export default {};\n",
    "drizzle.config.ts": "export default {};\n",
    "src/db/generated/collections.ts": "// old schema\n",
    "src/db/generated/documents.ts": "// old types\n",
    "src/dirty.ts": "operator-owned dirty fixture\n",
    "drizzle/0000_baseline.sql": "-- original migration must be preserved\n",
    "drizzle/meta/0000_snapshot.json": '{"baseline":true}\n',
    "drizzle/meta/_journal.json":
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1000, tag: "0000_baseline", breakpoints: true }],
      }) + "\n",
  };
  for (const [path, bytes] of Object.entries(normal)) await put(project, path, bytes);
  const args = new Map([
    ["--brief", ".nexpress/site/brief.json"],
    ["--directions", ".nexpress/site/directions.json"],
    ["--blueprint", ".nexpress/site/blueprint.json"],
    ["--runtime", ".nexpress/site/runtime.json"],
    ["--out", ".nexpress/site/codegen-source.json"],
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
  blueprint.commands = [
    {
      id: "schema",
      cwd: "project",
      template: "schema-generate",
      timeoutSeconds: 60,
      prerequisites: [],
    },
    {
      id: "migration",
      cwd: "project",
      template: "migration-generate",
      name: "editorial-reviewer-note",
      timeoutSeconds: 60,
      prerequisites: ["schema"],
    },
  ];
  blueprint.verification = blueprint.commands.flatMap((command) => [
    {
      id: `${command.id}-exit`,
      commandId: command.id,
      expected: "exit-zero" as const,
      required: true,
      artifactPath: null,
    },
    {
      id: `${command.id}-source`,
      commandId: command.id,
      expected: "no-diff" as const,
      required: true,
      artifactPath: null,
    },
  ]);
  const staged = "export const reviewed = true;\n";
  blueprint.filePlan[0].contentHash = await npBuildFileDigest(
    "np.build-source-file.v1",
    Buffer.from(staged),
  );
  const save = async () => {
    await put(project, args.get("--brief")!, encode(directionVector.brief));
    await put(project, args.get("--directions")!, encode(directionVector.set));
    await put(project, args.get("--blueprint")!, encode(blueprint));
    await put(project, args.get("--runtime")!, "{}");
  };
  await save();
  const lease = vi.fn(async () => {}),
    close = vi.fn(async () => {}),
    apply = vi.fn(async () => {
      await put(candidate, "src/home.ts", staged);
      return {};
    });
  hooks.dirty.mockResolvedValue(["src/dirty.ts"]);
  hooks.drafts.mockReturnValue(directionVector.draftSet);
  const context = {
    fingerprint: `nb1:sha256:${"A".repeat(43)}`,
    commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
    observed: { clock: { now: "2026-10-23T00:00:00.000Z", randomSeed: "a".repeat(64) } },
    context: {
      config: "src/nexpress.config.ts",
      capsule: {
        project: frozen,
        renderer: { scope: "native-transport-double" },
        assertOriginalUnchanged: lease,
      },
      image: { baseImageId: `sha256:${"a".repeat(64)}` },
    },
  };
  hooks.context.mockResolvedValue(context);
  hooks.native.mockImplementation(() =>
    Promise.resolve({
      audit: { status: "passed", scope: "native-transport-double" },
      artifacts: new Map([
        [
          "blueprint.json",
          npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint).canonicalJsonUtf8,
        ],
      ]),
    }),
  );
  hooks.plan.mockImplementation(async () => {
    for (const [path, bytes] of Object.entries(normal)) await put(candidate, path, bytes);
    return { project: candidate, apply, assertOriginalUnchanged: lease, close };
  });
  const dependencyLease = vi.fn(async () => {});
  hooks.dependencies.mockImplementation(async () => {
    const dependencies = join(candidate, "node_modules");
    for (const [name, entry] of [
      ["@nexpress/cli", "dist/site-build-loader.js"],
      ["@nexpress/app", "dist/scripts/generate-schema.js"],
      ["@nexpress/app", "dist/scripts/generate-migrations-core.js"],
      ["drizzle-kit", "bin.cjs"],
    ]) {
      await put(dependencies, `${name}/package.json`, encode({ name, version: "1.0.0" }));
      await put(dependencies, `${name}/${entry}`, "// fixed synthetic tool, never executed\n");
    }
    return { dependencies, assertUnchanged: dependencyLease };
  });
  const state = { mode: "normal", workspaceClosed: false, retentionAfterClose: false };
  const steps: Array<Parameters<NpSiteBuildLinuxWorkspaceV1["run"]>[0]> = [];
  hooks.workspace.mockImplementation(
    async (
      input: NpSiteBuildLinuxWorkspaceInputV1,
      run: (workspace: NpSiteBuildLinuxWorkspaceV1) => Promise<void>,
    ) => {
      let current = await readSiteSourceTreeV1(input.project);
      const workspace: NpSiteBuildLinuxWorkspaceV1 = {
        get source() {
          return structuredClone(current);
        },
        changedSources: [],
        finalizeNextAndExport: () => Promise.reject(new Error("Next must not run")),
        run: async (step) => {
          steps.push(step);
          const write = async (path: string, bytes: string | Uint8Array) =>
            put(input.project, path, bytes);
          if (step.id === "command-0") {
            await write(
              "src/db/generated/collections.ts",
              state.mode === "oversized"
                ? "x".repeat(4 * 1024 * 1024 + 1)
                : "// actual schema transport bytes\n",
            );
            await write("src/db/generated/documents.ts", "// actual type transport bytes\n");
            if (state.mode === "unlisted") await write("src/unlisted.ts", "unexpected\n");
            if (state.mode === "mode")
              await chmod(join(input.project, "src/db/generated/collections.ts"), 0o755);
            if (state.mode === "delete") await rm(join(input.project, "src/dirty.ts"));
          } else {
            await write(
              "drizzle/0001_editorial-reviewer-note.sql",
              "ALTER TABLE editorial_notes ADD COLUMN reviewer_note text;\n",
            );
            await write(
              "drizzle/meta/0001_snapshot.json",
              encode({ actual: "transport-owned-snapshot" }),
            );
            await write(
              "drizzle/meta/_journal.json",
              encode({ actual: "transport-owned-journal" }),
            );
            if (state.mode === "old-sql")
              await write("drizzle/0000_baseline.sql", "unexpected rewrite\n");
          }
          const stdout = Buffer.from("actual synthetic fixed child output\n"),
            stderr = Buffer.from(
              state.mode === "nonzero" ? "actual synthetic child failure\n" : "",
            );
          const result = {
            id: step.id,
            argv: [...step.argv],
            exitCode: state.mode === "nonzero" ? 1 : 0,
            startedAt: "2026-10-23T01:00:00.000Z",
            finishedAt: "2026-10-23T01:00:00.001Z",
            durationMs: 1,
            stdout: {
              path: `${input.auditPath}/${step.id}.stdout.log`,
              bytes: stdout.length,
              sha256: sha(stdout),
            },
            stderr: {
              path: `${input.auditPath}/${step.id}.stderr.log`,
              bytes: stderr.length,
              sha256: sha(stderr),
            },
          };
          await write(result.stdout.path, stdout);
          await write(result.stderr.path, stderr);
          await write(`${input.auditPath}/${step.id}.json`, encode(result));
          const after = await readSiteSourceTreeV1(input.project);
          await write(`${input.auditPath}/${step.id}.source-after.json`, encode(after));
          await step.validateSource?.(after, result.exitCode);
          if (result.exitCode !== 0) throw new SiteBuildError("input");
          current = after;
          return result;
        },
      };
      try {
        await run(workspace);
      } finally {
        state.workspaceClosed = true;
      }
    },
  );
  hooks.publish.mockImplementation(
    async (input: {
      project: string;
      artifacts: Array<{ path: string; bytes: Uint8Array }>;
      manifest: { path: string; bytes: Uint8Array };
    }) => {
      state.retentionAfterClose = state.workspaceClosed;
      for (const file of [...input.artifacts, input.manifest])
        await put(input.project, file.path, file.bytes);
      return {
        status: "written",
        paths: [...input.artifacts, input.manifest].map((file) => file.path),
      };
    },
  );
  return {
    root,
    project,
    candidate,
    frozen,
    args,
    blueprint,
    save,
    context,
    lease,
    close,
    apply,
    dependencyLease,
    state,
    steps,
    run: () => runSiteBuildCodegenSourceV1(args, project),
  };
}

describe("codegen source authoring probe (mocked Linux/native transport)", () => {
  it("returns observed source/type/migration bytes with genuine Core hashes, preserving original dirty/source files", async () => {
    const f = await fixture(),
      before = await readSiteSourceTreeV1(f.project),
      result = await f.run();
    expect(result).toMatchObject({
      operation: "codegen source",
      scope: "installed-codegen-source-only",
      sourceWrites: 0,
      executable: false,
      status: "written",
    });
    const envelope = JSON.parse(await readFile(join(f.project, f.args.get("--out")!), "utf8")) as {
      generationContext: { selectedDirectionHash: string };
      files: Array<{
        path: string;
        contentHash: string;
        expectedHash: string | null;
        bytes: number;
        base64url: string;
        generatedByCommandId: string;
      }>;
    };
    expect(envelope.generationContext.selectedDirectionHash).toBe(
      f.blueprint.selectedDirectionHash,
    );
    expect(envelope.files).toHaveLength(5);
    for (const file of envelope.files) {
      const bytes = Buffer.from(file.base64url, "base64url");
      expect(bytes.length).toBe(file.bytes);
      expect(file.contentHash).toBe(await npBuildFileDigest("np.build-source-file.v1", bytes));
      expect(file.generatedByCommandId).toBe(file.path.startsWith("src/") ? "schema" : "migration");
      expect(bytes).toEqual(await readFile(join(f.candidate, file.path)));
    }
    expect(
      envelope.files.find((file) => file.path === "drizzle/0001_editorial-reviewer-note.sql")
        ?.expectedHash,
    ).toBeNull();
    expect(
      envelope.files.find((file) => file.path === "src/db/generated/documents.ts")?.expectedHash,
    ).toBe(
      before.manifest.files.find((file) => file.path === "src/db/generated/documents.ts")?.digest,
    );
    expect(
      (await readSiteSourceTreeV1(f.project)).manifest.files.filter(
        (file) => file.path !== f.args.get("--out"),
      ),
    ).toEqual(before.manifest.files);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.state.retentionAfterClose).toBe(true);
    expect(f.steps[0].argv).toContain("--loader");
    expect(f.steps[1].argv).not.toContain("--loader");
    expect(f.steps.map((step) => step.id)).toEqual(["command-0", "command-1"]);
    expect(hooks.publish.mock.invocationCallOrder[0]).toBeLessThan(
      f.close.mock.invocationCallOrder[0],
    );
  });
  it("requires fresh native baseline validation before applying any staged source", async () => {
    const f = await fixture();
    hooks.native.mockRejectedValue(new SiteBuildError("unavailable"));
    await expect(f.run()).rejects.toMatchObject({ stage: "baseline", sourceWrites: 0 });
    expect(f.apply).not.toHaveBeenCalled();
    expect(hooks.workspace).not.toHaveBeenCalled();
  });
  it("rejects native baseline blueprint drift", async () => {
    const f = await fixture();
    const changed = structuredClone(f.blueprint);
    changed.deployment.notes.push("changed");
    hooks.native.mockResolvedValue({
      audit: { status: "passed" },
      artifacts: new Map([
        [
          "blueprint.json",
          npBuildCanonicalBytes("np.build-site-blueprint.v1", changed).canonicalJsonUtf8,
        ],
      ]),
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict", stage: "baseline" });
    expect(hooks.plan).not.toHaveBeenCalled();
  });
  it.each([
    "../out.json",
    ".nexpress/site/review/out.json",
    ".nexpress/site/files/out.json",
    ".nexpress/site/sub/out.json",
    ".nexpress/site/brief.json",
  ])("rejects unsafe/aliased output %s before native", async (path) => {
    const f = await fixture();
    f.args.set("--out", path);
    await expect(f.run()).rejects.toMatchObject({ reason: "path" });
    expect(hooks.native).not.toHaveBeenCalled();
  });
  it("rejects unknown flags and missing codegen command ownership", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    await expect(f.run()).rejects.toMatchObject({ reason: "arguments" });
    f.args.delete("--execute");
    f.blueprint.commands.pop();
    f.blueprint.verification = f.blueprint.verification.filter(
      (row) => row.commandId !== "migration",
    );
    await f.save();
    await expect(f.run()).rejects.toMatchObject({ reason: "unavailable" });
    expect(hooks.native).not.toHaveBeenCalled();
  });
  it.each(["unlisted", "mode", "delete", "old-sql"])(
    "rejects %s source changes and retains actual failure logs before cleanup",
    async (mode) => {
      const f = await fixture();
      f.state.mode = mode;
      await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildCodegenSourceFailureV1);
      expect(f.close).toHaveBeenCalledOnce();
      const publications = hooks.publish.mock.calls;
      expect(publications).not.toHaveLength(0);
      const manifest = JSON.parse(Buffer.from(publications.at(-1)![0].manifest.bytes).toString());
      expect(manifest).toMatchObject({ status: "failed", sourceWrites: 0 });
      expect(
        manifest.files.some((file: { path: string }) => file.path.endsWith(".stdout.log")),
      ).toBe(true);
      await expect(readFile(join(f.project, f.args.get("--out")!))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it("never truncates an over-bound generated source", async () => {
    const f = await fixture();
    f.state.mode = "oversized";
    await expect(f.run()).rejects.toMatchObject({
      reason: "input",
      retention: "retained",
      privateCopy: "removed",
    });
    await expect(readFile(join(f.project, f.args.get("--out")!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("stops after nonzero command and preserves bounded actual stderr", async () => {
    const f = await fixture();
    f.state.mode = "nonzero";
    await expect(f.run()).rejects.toMatchObject({ reason: "input", retention: "retained" });
    expect(f.steps).toHaveLength(1);
    const artifact = hooks.publish.mock.calls
      .flatMap(([input]) => input.artifacts)
      .find((file: { path: string }) => file.path.endsWith("command-0.stderr.log"));
    expect(Buffer.from(artifact.bytes).toString()).toBe("actual synthetic child failure\n");
  });
  it("surfaces retention failure without skipping cleanup or changing the original failure", async () => {
    const f = await fixture();
    f.state.mode = "nonzero";
    hooks.publish.mockRejectedValue(new SiteBuildError("unavailable"));
    await expect(f.run()).rejects.toMatchObject({
      reason: "input",
      retention: "retention-failed",
      privateCopy: "removed",
    });
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("reports failed private cleanup despite otherwise complete observations", async () => {
    const f = await fixture();
    f.close.mockRejectedValue(new Error("synthetic cleanup failure"));
    await expect(f.run()).rejects.toMatchObject({
      stage: "cleanup",
      privateCopy: "cleanup-failed",
      retention: "retained",
      sourceWrites: 0,
    });
  });
  it("fails closed for changed runtime input bytes", async () => {
    const f = await fixture();
    hooks.native.mockImplementation(async () => {
      await put(f.project, f.args.get("--runtime")!, '{"changed":true}');
      return {
        audit: { status: "passed" },
        artifacts: new Map([
          [
            "blueprint.json",
            npBuildCanonicalBytes("np.build-site-blueprint.v1", f.blueprint).canonicalJsonUtf8,
          ],
        ]),
      };
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("requires real capsule, package and tool leases at execution boundaries", async () => {
    const f = await fixture();
    f.dependencyLease.mockRejectedValue(new SiteBuildError("conflict"));
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.workspace).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("rejects a package entry escaping the owned Linux dependency closure", async () => {
    const f = await fixture();
    const normal = hooks.dependencies.getMockImplementation()!;
    hooks.dependencies.mockImplementation(async (input) => {
      const result = await normal(input);
      const path = join(result.dependencies, "drizzle-kit/bin.cjs");
      await rm(path);
      await put(f.root, "outside.cjs", "outside tool bytes");
      await symlink(join(f.root, "outside.cjs"), path);
      return result;
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "path", privateCopy: "removed" });
    expect(hooks.workspace).not.toHaveBeenCalled();
  });
  it("preserves a conflicting existing output and reports retained completed probe", async () => {
    const f = await fixture();
    await put(f.project, f.args.get("--out")!, '{"operator":true}');
    await expect(f.run()).rejects.toMatchObject({
      reason: "conflict",
      stage: "output",
      retention: "retained",
      privateCopy: "removed",
    });
    expect(await readFile(join(f.project, f.args.get("--out")!), "utf8")).toBe('{"operator":true}');
  });
  it("does not stage or publish the observed generated files to the original", async () => {
    const f = await fixture();
    await f.run();
    expect(await readFile(join(f.project, "src/db/generated/collections.ts"), "utf8")).toBe(
      "// old schema\n",
    );
    await expect(
      lstat(join(f.project, "drizzle/0001_editorial-reviewer-note.sql")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects an unrelated source edit after emitting exactly its own output leaf", async () => {
    const f = await fixture();
    f.lease.mockImplementation(async () => {
      if (await lstat(join(f.project, f.args.get("--out")!)).catch(() => null))
        await put(f.project, "src/dirty.ts", "concurrent operator bytes\n");
    });
    await expect(f.run()).rejects.toMatchObject({
      reason: "conflict",
      stage: "output",
      sourceWrites: 0,
    });
    expect(await readFile(join(f.project, "src/dirty.ts"), "utf8")).toBe(
      "concurrent operator bytes\n",
    );
    expect(await lstat(join(f.project, f.args.get("--out")!))).toMatchObject({});
  });
});
