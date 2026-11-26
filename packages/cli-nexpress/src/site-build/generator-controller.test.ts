import { createHash } from "node:crypto";
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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildFileDigest,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpSiteBuildCommandExecutorInputV1 } from "./command-executor.js";
import type * as Executor from "./command-executor.js";
import type * as Publication from "./repository-publication.js";
import {
  runSiteBuildGeneratorControllerV1,
  type NpSiteBuildGeneratorControllerInputV1,
  type NpSiteBuildGeneratorVerificationContextV1,
} from "./generator-controller.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const hooks = vi.hoisted(() => ({
  execute: vi.fn(),
  commandEffect: vi.fn(),
  publicationPrepared: false,
  publicationMode: "normal",
}));
vi.mock("./command-executor.js", async (original) => ({
  ...(await original<typeof Executor>()),
  executeSiteBuildBlueprintCommandsV1: hooks.execute,
}));
vi.mock("./repository-publication.js", async (original) => {
  const actual = await original<typeof Publication>();
  return {
    ...actual,
    prepareSiteBuildRepositoryPublicationV1: async (
      input: Publication.NpSiteBuildRepositoryPublicationInputV1,
    ) => {
      const handle = await actual.prepareSiteBuildRepositoryPublicationV1(input);
      hooks.publicationPrepared = true;
      if (hooks.publicationMode === "preflight")
        return {
          ...handle,
          publish: () =>
            Promise.reject(
              new actual.NpSiteBuildRepositoryPublicationErrorV1(
                "conflict",
                "preflight-rejected",
                [],
                [],
                [],
              ),
            ),
        };
      if (hooks.publicationMode !== "partial") return handle;
      return {
        ...handle,
        publish: async () => {
          // Orchestration failure injection: real FS bytes remain exactly as a partial
          // native publication would. Native adverse/CAS boundaries have their own tests.
          await writeFile(join(input.project, "src/home.ts"), home);
          throw new actual.NpSiteBuildRepositoryPublicationErrorV1(
            "conflict",
            "partial-changes-may-remain",
            ["src/home.ts"],
            [],
            ["src/db/generated/collections.ts"],
          );
        },
      };
    },
  };
});
const roots: string[] = [],
  home = "export const page='reviewed';\n",
  generated = "// reviewed generated collection schema\n";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fileHash = (value: string) =>
  npBuildFileDigest("np.build-source-file.v1", Buffer.from(value));
async function put(root: string, path: string, value: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), value);
}
async function absent(path: string) {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}
beforeEach(() => {
  hooks.publicationPrepared = false;
  hooks.publicationMode = "normal";
  hooks.execute.mockReset();
  hooks.commandEffect.mockReset();
  // Only command execution is mocked. Real edit-copy, dependency materialization,
  // source observation and native publication run on owned filesystem fixtures.
  // This is not actual Docker/tool/native-render acceptance.
  hooks.execute.mockImplementation(async (input: NpSiteBuildCommandExecutorInputV1) => {
    const blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    const before = await readSiteSourceTreeV1(input.project);
    await input.assertDependenciesUnchanged();
    for (const row of blueprint.filePlan)
      if (row.source === "command") await put(input.project, row.path, generated);
    await hooks.commandEffect(input);
    const after = await readSiteSourceTreeV1(input.project);
    return {
      schemaVersion: "np.site-build-command-execution.v1",
      scope: "private-build-copy",
      blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
      commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
      baselineTreeDigest: await npBuildCanonicalDigest(
        "np.build-source-tree.v1",
        input.privateBaseline,
      ),
      generationContext: input.generationContext ?? null,
      generationContextFingerprint: null,
      sourceBefore: before,
      sourceAfter: after,
      tools: [],
      drivers: [],
      auditPath: ".nexpress/site/audit/mock-command-owner",
      commands: blueprint.commands.map((command) => ({
        commandId: command.id,
        template: command.template,
        exitCode: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        execution: null,
        outputArtifactPath: `.nexpress/site/audit/mock-command-owner/${command.id}.json`,
        outputDigest: blueprint.selectedDirectionHash,
        evidence: null,
      })),
    };
  });
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(update = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-generator-controller-test-")));
  roots.push(root);
  const project = join(root, "original"),
    dependencies = join(root, "prepared/node_modules");
  await mkdir(project);
  await mkdir(dependencies, { recursive: true });
  await put(project, "package.json", '{"name":"ordinary-source","type":"module"}\n');
  await put(project, "pnpm-lock.yaml", "reviewed ordinary lock bytes\n");
  await put(project, "src/nexpress.config.ts", "export default {collections:[]};\n");
  await put(project, "src/dirty.ts", "operator-owned dirty source\n");
  await put(project, ".env", "NP_SECRET=synthetic-test-only-never-copied\n");
  await put(project, ".nexpress/site/files/home.ts", home);
  if (update) await put(project, "src/home.ts", "old page\n");
  await put(
    dependencies,
    ".pnpm/fixed@1/node_modules/fixed/package.json",
    '{"name":"fixed","version":"1.0.0"}\n',
  );
  await put(dependencies, ".pnpm/fixed@1/node_modules/fixed/index.js", "export const fixed=1;\n");
  await symlink(".pnpm/fixed@1/node_modules/fixed", join(dependencies, "fixed"));
  const vectors = JSON.parse(
    await readFile(
      new URL("../../../core/src/build-contract/__fixtures__/canonical-v1.json", import.meta.url),
      "utf8",
    ),
  ) as { structured: Array<{ purpose: string; canonical: string }> };
  const blueprint = JSON.parse(
    vectors.structured.find((v) => v.purpose === "np.build-site-blueprint.v1")!.canonical,
  ) as NpAgentSiteBlueprintV1;
  blueprint.filePlan[0] = {
    ...blueprint.filePlan[0],
    action: update ? "update" : "create",
    expectedHash: update ? await fileHash("old page\n") : null,
    contentHash: await fileHash(home),
  };
  blueprint.commands.push({
    id: "schema",
    cwd: "project",
    prerequisites: ["format"],
    template: "schema-generate",
    timeoutSeconds: 60,
  });
  blueprint.filePlan.push({
    path: "src/db/generated/collections.ts",
    action: "create",
    expectedHash: null,
    contentHash: await fileHash(generated),
    owner: "generated-schema",
    source: "command",
    stagedArtifactPath: null,
    generatedByCommandId: "schema",
    rationale: "reviewed exact generated bytes",
  });
  blueprint.filePlan.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  blueprint.verification.push(
    {
      id: "schema-exit",
      commandId: "schema",
      required: true,
      expected: "exit-zero",
      artifactPath: null,
    },
    {
      id: "schema-source",
      commandId: "schema",
      required: true,
      expected: "no-diff",
      artifactPath: null,
    },
  );
  const dirtyPaths = ["src/dirty.ts"],
    verify = vi.fn((context: NpSiteBuildGeneratorVerificationContextV1) =>
      Promise.resolve({
        blueprintHash: context.blueprintHash,
        originalTreeDigest: context.originalSource.digest,
        candidateTreeDigest: context.candidateSource.digest,
        assertUnchanged: vi.fn(async () => {}),
      }),
    );
  const repositoryLease = vi.fn(async () => {}),
    preparedLease = vi.fn(async () => {}),
    registryLease = vi.fn(async () => {});
  const input: NpSiteBuildGeneratorControllerInputV1 = {
    project,
    blueprint,
    config: "src/nexpress.config.ts",
    observeRepository: vi.fn(() =>
      Promise.resolve({ dirtyPaths, assertUnchanged: repositoryLease }),
    ),
    prepared: {
      dependencies,
      baseImageId: `sha256:${"a".repeat(64)}`,
      assertUnchanged: preparedLease,
    },
    registry: { fingerprint: blueprint.commandRegistryFingerprint, assertUnchanged: registryLease },
    generationContext: {
      schemaVersion: "np.site-build-generation-context.v1",
      implementation: "np.site-build-generation.v1",
      selectedDirectionHash: blueprint.selectedDirectionHash,
      comparisonInputsDigest: blueprint.selectedDirectionHash,
      selectedRenderEnvironmentFingerprint: blueprint.selectedDirectionHash,
      clock: { now: "2026-01-01T00:00:00.000Z", randomSeed: "e".repeat(64) },
    },
    verifyCandidate: verify,
  };
  return {
    input,
    root,
    blueprint,
    verify,
    dirtyPaths,
    repositoryLease,
    preparedLease,
    registryLease,
  };
}
async function acknowledge(input: NpSiteBuildGeneratorControllerInputV1) {
  input.runMode = "publish";
  input.acknowledgePlanHash = await npBuildCanonicalDigest(
    "np.build-site-blueprint.v1",
    input.blueprint,
  );
}
const candidate = () => (hooks.execute.mock.calls[0] as [NpSiteBuildCommandExecutorInputV1])[0];

describe("private candidate generation coordinator", () => {
  it("defaults to real private-copy dry-run, preserves raw credentials/dirty source, retains only verifier-owned excluded evidence and always cleans up", async () => {
    const { input, verify } = await fixture(),
      before = await readSiteSourceTreeV1(input.project);
    const artifact = ".nexpress/site/review/generation/result.json",
      bytes = '{"actualFixtureOnly":true}\n';
    input.verifyCandidate = async (context) => {
      await verify(context);
      expect(context.originalSource.manifest.files.some((f) => f.path === ".env")).toBe(true);
      expect(
        context.privateBaseline.manifest.files.some(
          (f) => f.path === ".env" || f.path === "src/home.ts" || f.path.startsWith(".nexpress/"),
        ),
      ).toBe(false);
      await absent(join(context.project, ".env"));
      expect(await readFile(join(context.dependencies, "fixed/index.js"), "utf8")).toContain(
        "fixed=1",
      );
      await put(input.project, artifact, bytes);
      return {
        blueprintHash: context.blueprintHash,
        originalTreeDigest: context.originalSource.digest,
        candidateTreeDigest: context.candidateSource.digest,
        retainedArtifacts: [
          { path: artifact, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) },
        ],
        assertUnchanged: async () => {
          expect(await readFile(join(input.project, artifact), "utf8")).toBe(bytes);
        },
      };
    };
    const result = await runSiteBuildGeneratorControllerV1(input);
    expect(result.runMode).toBe("dry-run");
    expect(result.publication).toBeNull();
    expect(result.originalSourceAfter).toEqual(before);
    expect(result.privateCopy).toBe("removed");
    expect(result.privateArtifactsRetained).toBe(false);
    expect(result.verification.retainedArtifactsReportedByVerifier).toEqual([
      { path: artifact, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) },
    ]);
    expect(result.originalSource.digest).not.toBe(result.privateBaseline.digest);
    expect(candidate().privateBaseline).toEqual(result.privateBaseline.manifest);
    expect(candidate().dependencies).toBe(join(candidate().project, "node_modules"));
    expect(await readFile(join(input.project, "src/dirty.ts"), "utf8")).toBe(
      "operator-owned dirty source\n",
    );
    await absent(join(input.project, "src/home.ts"));
    await absent(join(input.project, "src/db"));
    await absent(candidate().project);
    expect(verify).toHaveBeenCalledOnce();
    expect(hooks.publicationPrepared).toBe(false);
  });

  it("publishes only exact staged and command-owned rows after explicit acknowledgement and fresh verification", async () => {
    const { input } = await fixture(true);
    await chmod(join(input.project, "src/home.ts"), 0o755);
    await acknowledge(input);
    const result = await runSiteBuildGeneratorControllerV1(input);
    expect(result.publication?.result.status).toBe("written");
    expect(result.publication?.result.writtenPaths).toEqual([
      "src/db/generated/collections.ts",
      "src/home.ts",
    ]);
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(home);
    expect((await lstat(join(input.project, "src/home.ts"))).mode & 0o777).toBe(0o755);
    expect(await readFile(join(input.project, "src/db/generated/collections.ts"), "utf8")).toBe(
      generated,
    );
    expect(result.originalSourceAfter.manifest.files.find((f) => f.path === ".env")).toEqual(
      result.originalSource.manifest.files.find((f) => f.path === ".env"),
    );
    await absent(candidate().project);
  });

  it("rejects wrong acknowledgement and an already-published create before dispatch instead of skipping commands", async () => {
    const { input } = await fixture();
    input.runMode = "publish";
    input.acknowledgePlanHash = "not-the-plan";
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      reason: "arguments",
      sourcePublication: "not-started",
      privateCopy: "not-created",
    });
    input.runMode = "dry-run";
    delete input.acknowledgePlanHash;
    await put(input.project, "src/home.ts", home);
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      reason: "conflict",
      sourcePublication: "not-started",
    });
    expect(hooks.execute).not.toHaveBeenCalled();
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(home);
  });

  it("preserves dirty overlap and rejects dependency escapes before commands", async () => {
    const dirty = await fixture(true);
    dirty.dirtyPaths.push("src/home.ts");
    const before = await readSiteSourceTreeV1(dirty.input.project);
    await expect(runSiteBuildGeneratorControllerV1(dirty.input)).rejects.toMatchObject({
      reason: "conflict",
      sourcePublication: "not-started",
    });
    expect(await readSiteSourceTreeV1(dirty.input.project)).toEqual(before);
    const escape = await fixture();
    await symlink(
      "../../original/src/dirty.ts",
      join(escape.input.prepared.dependencies, "escape"),
    );
    await expect(runSiteBuildGeneratorControllerV1(escape.input)).rejects.toMatchObject({
      stage: "dependencies",
      privateCopy: "removed",
      sourcePublication: "not-started",
    });
    expect(hooks.execute).not.toHaveBeenCalled();
  });

  it.each(["command-failure", "unplanned-file", "wrong-generated-hash", "omitted-command"])(
    "rejects %s and discards the candidate with original source unchanged",
    async (kind) => {
      const { input, verify } = await fixture(),
        before = await readSiteSourceTreeV1(input.project);
      if (kind === "omitted-command")
        hooks.execute.mockImplementationOnce(async (inner: NpSiteBuildCommandExecutorInputV1) => {
          await put(inner.project, "src/db/generated/collections.ts", generated);
          const source = await readSiteSourceTreeV1(inner.project);
          return {
            blueprintHash: await npBuildCanonicalDigest(
              "np.build-site-blueprint.v1",
              input.blueprint,
            ),
            baselineTreeDigest: await npBuildCanonicalDigest(
              "np.build-source-tree.v1",
              inner.privateBaseline,
            ),
            commandRegistryFingerprint: input.registry.fingerprint,
            sourceBefore: source,
            sourceAfter: source,
            commands: [],
          };
        });
      else
        hooks.commandEffect.mockImplementation(async (inner: NpSiteBuildCommandExecutorInputV1) => {
          if (kind === "command-failure") throw new SiteBuildError("input");
          await put(
            inner.project,
            kind === "unplanned-file" ? "src/unplanned.ts" : "src/db/generated/collections.ts",
            "unexpected source bytes\n",
          );
        });
      await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
        stage: "commands",
        sourcePublication: "not-started",
        privateCopy: "removed",
      });
      expect(await readSiteSourceTreeV1(input.project)).toEqual(before);
      expect(verify).not.toHaveBeenCalled();
      await absent(candidate().project);
    },
  );

  it("detects credential drift in the original even though that path was never copied", async () => {
    const { input, verify } = await fixture();
    hooks.commandEffect.mockImplementation(async () => {
      await put(input.project, ".env", "external synthetic credential change\n");
    });
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      reason: "conflict",
      sourcePublication: "not-started",
      privateCopy: "removed",
    });
    expect(verify).not.toHaveBeenCalled();
    await absent(join(input.project, "src/home.ts"));
    await absent(candidate().project);
  });

  it.each([false, true])(
    "awaits failed-command retention before private cleanup (retention failure: %s)",
    async (retentionFails) => {
      const { input } = await fixture();
      const before = await readSiteSourceTreeV1(input.project);
      const failure = new SiteBuildError("input");
      hooks.commandEffect.mockImplementation(async (inner: NpSiteBuildCommandExecutorInputV1) => {
        await put(
          inner.project,
          ".nexpress/site/audit/failed-command/stderr.log",
          "actual owned failure bytes\n",
        );
        throw failure;
      });
      const retain = vi.fn(
        async (
          context: Parameters<
            NonNullable<NpSiteBuildGeneratorControllerInputV1["beforePrivateCleanup"]>
          >[0],
        ) => {
          expect(context.failure).toBe(failure);
          expect(context.execution).toBeUndefined();
          expect(context.blueprint).toEqual(input.blueprint);
          const bytes = await readFile(
            join(context.project, ".nexpress/site/audit/failed-command/stderr.log"),
          );
          expect(bytes.toString()).toBe("actual owned failure bytes\n");
          await put(input.project, ".nexpress/site/audit/retained-failure.log", bytes.toString());
          if (retentionFails) throw new Error("retention failed");
        },
      );
      input.beforePrivateCleanup = retain;
      await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
        reason: "input",
        stage: "commands",
        privateCopy: "removed",
        sourcePublication: "not-started",
        failureEvidence: retentionFails ? "retention-failed" : "retained",
      });
      expect(retain).toHaveBeenCalledOnce();
      await absent(candidate().project);
      expect(await readSiteSourceTreeV1(input.project)).toEqual(before);
      expect(
        await readFile(join(input.project, ".nexpress/site/audit/retained-failure.log"), "utf8"),
      ).toBe("actual owned failure bytes\n");
    },
  );

  it("passes completed execution to retention when final verification fails and does not call the failure hook on success", async () => {
    const { input } = await fixture();
    const retained = vi.fn(
      async (
        context: Parameters<
          NonNullable<NpSiteBuildGeneratorControllerInputV1["beforePrivateCleanup"]>
        >[0],
      ) => {
        expect(context.execution?.commands).toHaveLength(
          (input.blueprint as NpAgentSiteBlueprintV1).commands.length,
        );
        expect(await readFile(join(context.project, "src/home.ts"), "utf8")).toBe(home);
      },
    );
    input.beforePrivateCleanup = retained;
    input.verifyCandidate = () => Promise.reject(new SiteBuildError("conflict"));
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      stage: "verify",
      failureEvidence: "retained",
      privateCopy: "removed",
    });
    expect(retained).toHaveBeenCalledOnce();
    const normal = await fixture();
    normal.input.beforePrivateCleanup = retained;
    retained.mockClear();
    await runSiteBuildGeneratorControllerV1(normal.input);
    expect(retained).not.toHaveBeenCalled();
  });

  it.each(["wrong-binding", "revoked-after-capture"])(
    "rejects final verification %s before any source publication",
    async (kind) => {
      const { input } = await fixture();
      await acknowledge(input);
      const before = await readSiteSourceTreeV1(input.project);
      input.verifyCandidate = (context) =>
        Promise.resolve({
          blueprintHash: kind === "wrong-binding" ? "other-plan" : context.blueprintHash,
          originalTreeDigest: context.originalSource.digest,
          candidateTreeDigest: context.candidateSource.digest,
          assertUnchanged: () => {
            if (hooks.publicationPrepared) throw new SiteBuildError("conflict");
            return Promise.resolve();
          },
        });
      await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
        reason: "conflict",
        stage: kind === "wrong-binding" ? "verify" : "publish-preflight",
        sourcePublication: "not-started",
        privateCopy: "removed",
      });
      expect(await readSiteSourceTreeV1(input.project)).toEqual(before);
      await absent(candidate().project);
    },
  );

  it("preserves native partial failure details and never rolls back already written original bytes", async () => {
    const { input } = await fixture();
    await acknowledge(input);
    hooks.publicationMode = "partial";
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      stage: "publish",
      sourcePublication: "partial-changes-may-remain",
      privateCopy: "removed",
      publicationFailure: {
        publicationState: "partial-changes-may-remain",
        writtenPaths: ["src/home.ts"],
        unchangedPaths: [],
        uncertainPaths: ["src/db/generated/collections.ts"],
      },
    });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(home);
    await absent(join(input.project, "src/db/generated/collections.ts"));
    await absent(candidate().project);
  });

  it("reports a native all-row preflight rejection as no source publication", async () => {
    const { input } = await fixture();
    await acknowledge(input);
    hooks.publicationMode = "preflight";
    const before = await readSiteSourceTreeV1(input.project);
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      sourcePublication: "not-started",
      privateCopy: "removed",
      publicationFailure: {
        publicationState: "preflight-rejected",
        writtenPaths: [],
        uncertainPaths: [],
      },
    });
    expect(await readSiteSourceTreeV1(input.project)).toEqual(before);
    await absent(candidate().project);
  });

  it("requires live verification functions rather than a JSON descriptor and blocks accessor inputs", async () => {
    const { input } = await fixture();
    Object.defineProperty(input, "verifyCandidate", { value: undefined });
    await expect(runSiteBuildGeneratorControllerV1(input)).rejects.toMatchObject({
      reason: "unavailable",
      privateCopy: "not-created",
    });
    const getter = await fixture();
    let invoked = false;
    const blueprint = {};
    Object.defineProperty(blueprint, "schemaVersion", {
      enumerable: true,
      get() {
        invoked = true;
        return "np.agent-site-blueprint.v1";
      },
    });
    getter.input.blueprint = blueprint;
    await expect(runSiteBuildGeneratorControllerV1(getter.input)).rejects.toMatchObject({
      reason: "input",
      privateCopy: "not-created",
    });
    expect(invoked).toBe(false);
    expect(hooks.execute).not.toHaveBeenCalled();
  });
});
