import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildFileDigest,
  type NpAgentBlueprintCommand,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  executeSiteBuildBlueprintCommandsV1,
  type NpSiteBuildCommandExecutorInputV1,
  type NpSiteBuildCommandObserverContextV1,
  type NpSiteBuildCommandObservedEvidenceV1,
} from "./command-executor.js";
import type * as WorkspaceModule from "./linux-workspace.js";
import type {
  NpSiteBuildLinuxWorkspaceInputV1,
  NpSiteBuildLinuxWorkspaceV1,
} from "./linux-workspace.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const hooks = vi.hoisted(() => ({
  workspace: vi.fn(),
  finalize: vi.fn(),
  runs: vi.fn(),
  prepareNext: vi.fn(),
}));
vi.mock("./next-build-command.js", () => ({
  prepareSiteBuildCommandNextV1: hooks.prepareNext,
}));
vi.mock("./linux-workspace.js", async (original) => ({
  ...(await original<typeof WorkspaceModule>()),
  withSiteBuildLinuxWorkspaceV1: hooks.workspace,
}));
const roots: string[] = [],
  execute = promisify(execFile);
let activeWorkspaces = 0;
let removedWorkspaces = 0;
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const fileHash = (value: string) =>
  npBuildFileDigest("np.build-source-file.v1", Buffer.from(value));
const common = (id: string, prerequisites: string[] = []) => ({
  id,
  cwd: "project" as const,
  prerequisites,
  timeoutSeconds: 60,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  hooks.workspace.mockReset();
  hooks.finalize.mockReset();
  hooks.runs.mockReset();
  hooks.prepareNext.mockReset();
  activeWorkspaces = 0;
  removedWorkspaces = 0;
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function put(root: string, path: string, bytes: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
async function fixture(commands: NpAgentBlueprintCommand[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-command-executor-unit-")));
  roots.push(root);
  const project = join(root, "candidate"),
    dependencies = join(root, "dependencies");
  await mkdir(dependencies);
  await mkdir(project);
  await put(project, "package.json", '{"name":"raw-candidate","type":"module"}\n');
  await put(project, "pnpm-lock.yaml", "raw reviewed lock\n");
  await put(project, "src/nexpress.config.ts", "export default {collections:[]};\n");
  await put(project, "drizzle.config.ts", "export default {};\n");
  await put(project, "tsconfig.json", '{"compilerOptions":{"noEmit":true}}\n');
  const privateBaseline = (await readSiteSourceTreeV1(project)).manifest;
  const vectors = JSON.parse(
    await readFile(
      new URL("../../../core/src/build-contract/__fixtures__/canonical-v1.json", import.meta.url),
      "utf8",
    ),
  ) as { structured: Array<{ purpose: string; canonical: string }> };
  const blueprint = JSON.parse(
    vectors.structured.find((entry) => entry.purpose === "np.build-site-blueprint.v1")!.canonical,
  ) as NpAgentSiteBlueprintV1;
  blueprint.commands = commands;
  blueprint.filePlan = [];
  blueprint.verification = commands
    .flatMap((command) => [
      {
        id: `${command.id}-exit`,
        commandId: command.id,
        required: true,
        expected: "exit-zero" as const,
        artifactPath: null,
      },
      ...(["format", "schema-generate", "migration-generate"].includes(command.template)
        ? [
            {
              id: `${command.id}-source`,
              commandId: command.id,
              required: true,
              expected: "no-diff" as const,
              artifactPath: null,
            },
          ]
        : []),
    ])
    .sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  const input: NpSiteBuildCommandExecutorInputV1 = {
    project,
    dependencies,
    baseImageId: `sha256:${"a".repeat(64)}`,
    config: "src/nexpress.config.ts",
    blueprint,
    privateBaseline,
    registry: {
      fingerprint: blueprint.commandRegistryFingerprint,
      assertUnchanged: vi.fn(async () => {}),
    },
    assertDependenciesUnchanged: vi.fn(async () => {}),
    generationContext: {
      schemaVersion: "np.site-build-generation-context.v1",
      implementation: "np.site-build-generation.v1",
      selectedDirectionHash: blueprint.selectedDirectionHash,
      comparisonInputsDigest: blueprint.selectedDirectionHash,
      selectedRenderEnvironmentFingerprint: blueprint.selectedDirectionHash,
      clock: { now: "2026-01-01T00:00:00.000Z", randomSeed: "e".repeat(64) },
    },
  };
  const install = async (
    name: string,
    entry: string,
    code = "console.log(JSON.stringify({args:process.argv.slice(2),env:process.env.NODE_ENV}));\n",
  ) => {
    await put(
      dependencies,
      `${name}/package.json`,
      JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        exports: { "./scripts/*": "./dist/scripts/*.js" },
      }),
    );
    await put(dependencies, `${name}/${entry}`, code);
  };
  return { input, blueprint, install, root };
}

/** A mapping fixture only. Actual fixed owner drivers execute in Node against tiny
 * synthetic package owners; this does not prove Docker, Next, Doctor or tool acceptance. */
function mappedWorkspace() {
  hooks.workspace.mockImplementation(
    async (
      input: NpSiteBuildLinuxWorkspaceInputV1,
      run: (workspace: NpSiteBuildLinuxWorkspaceV1) => Promise<unknown>,
    ) => {
      await cp(input.dependencies, join(input.project, "node_modules"), {
        recursive: true,
        verbatimSymlinks: true,
      });
      let source = input.source;
      activeWorkspaces++;
      return run({
        get source() {
          return source;
        },
        changedSources: [],
        finalizeNextAndExport: () => {
          hooks.finalize();
          return Promise.resolve([]);
        },
        run: async (step) => {
          hooks.runs(step);
          const started = Date.now();
          const mapped = step.argv
            .slice(1)
            .map((argument) => argument.replaceAll("/np/project", input.project));
          const last = mapped.at(-1);
          if (
            last?.startsWith(join(input.project, input.controls.directory)) &&
            last.endsWith(".mjs")
          ) {
            const code = (await readFile(last, "utf8"))
              .replaceAll("/np/project", input.project)
              .replaceAll("/usr/local/bin/node", process.execPath);
            const driver = `${last}.unit.mjs`;
            await writeFile(driver, code);
            mapped[mapped.length - 1] = driver;
          }
          let result: { stdout: Buffer; stderr: Buffer; code: number };
          try {
            const observed = await execute(process.execPath, mapped, {
              cwd: input.project,
              env: {
                PATH: "/usr/bin:/bin",
                HOME: join(input.project, input.controls.directory),
                NP_TEST_TRACE: join(input.project, input.controls.directory, "migration-trace.txt"),
              },
              encoding: "buffer",
              timeout: 5000,
              maxBuffer: 1024 * 1024,
            });
            result = {
              stdout: Buffer.from(observed.stdout),
              stderr: Buffer.from(observed.stderr),
              code: 0,
            };
          } catch (error) {
            const failed = error as { stdout?: Buffer; stderr?: Buffer; code?: number };
            result = {
              stdout: failed.stdout ?? Buffer.alloc(0),
              stderr: failed.stderr ?? Buffer.alloc(0),
              code: typeof failed.code === "number" ? failed.code : 1,
            };
          }
          source = await readSiteSourceTreeV1(input.project);
          await step.validateSource?.(source, result.code);
          if (result.code !== 0) throw new SiteBuildError("input");
          const stdoutPath = `${input.auditPath}/${step.id}.stdout.log`,
            stderrPath = `${input.auditPath}/${step.id}.stderr.log`;
          await writeFile(join(input.project, stdoutPath), result.stdout);
          await writeFile(join(input.project, stderrPath), result.stderr);
          return {
            id: step.id,
            argv: [...step.argv],
            exitCode: result.code,
            startedAt: new Date(started).toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
            stdout: { path: stdoutPath, bytes: result.stdout.length, sha256: sha(result.stdout) },
            stderr: { path: stderrPath, bytes: result.stderr.length, sha256: sha(result.stderr) },
          };
        },
      }).finally(() => {
        activeWorkspaces--;
        removedWorkspaces++;
      });
    },
  );
}

describe("fixed private blueprint command executors", () => {
  it("uses fixed selected-comparison controls and waits for builder removal before deriving runtime", async () => {
    const { input, install } = await fixture([
      { ...common("build"), template: "build", workspaceFilter: null },
    ]);
    await install("next", "dist/bin/next");
    input.nextPreview = "deterministic-selected-comparison";
    const controls = { directory: ".nexpress/site/tmp/fixed-next", files: [] };
    const prepareLease = vi.fn(async () => {});
    const finalize = vi.fn(async () => {
      expect(activeWorkspaces).toBe(0);
      expect(removedWorkspaces).toBe(1);
      const observed = await readSiteSourceTreeV1(input.project);
      return { sourceBefore: observed, sourceAfter: observed };
    });
    // Transport/dispatch fixture only; no Next or runtime evidence is proved here.
    hooks.prepareNext.mockResolvedValue({
      controls,
      argv: ["/usr/local/bin/node", "/np/project/fixed-next-owner.mjs"],
      assertPreparedUnchanged: prepareLease,
      finalizeAfterBuilderRemoval: finalize,
    });
    mappedWorkspace();
    hooks.runs.mockImplementation((step: { argv: string[] }) => {
      expect(step.argv).toEqual(["/usr/local/bin/node", "/np/project/fixed-next-owner.mjs"]);
    });
    await put(input.project, "fixed-next-owner.mjs", "process.exitCode=0;\n");
    // This fixed fixture driver is authored input, not a generated change.
    input.privateBaseline = (await readSiteSourceTreeV1(input.project)).manifest;
    const current = await readSiteSourceTreeV1(input.project);
    await executeSiteBuildBlueprintCommandsV1(input);
    expect(hooks.prepareNext).toHaveBeenCalledWith(
      expect.objectContaining({ clock: input.generationContext!.clock, source: current }),
    );
    expect(hooks.workspace.mock.calls[0][0].controls).toEqual(controls);
    expect(prepareLease).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledWith([]);
  });

  it("aborts an expired observer, awaits its cleanup, and never starts the next command", async () => {
    const { input } = await fixture([
      { ...common("first"), template: "verify" },
      { ...common("second", ["first"]), template: "verify" },
    ]);
    const started = deferred<NpSiteBuildCommandObserverContextV1>();
    const cleanup = deferred<void>();
    const observed = vi.fn(async (context: NpSiteBuildCommandObserverContextV1) => {
      started.resolve(context);
      await new Promise<void>((resolve) =>
        context.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      await cleanup.promise;
      throw new SiteBuildError("unavailable");
    });
    input.observers = { verify: observed };
    mappedWorkspace();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let settled = false;
    const execution = executeSiteBuildBlueprintCommandsV1(input);
    const failed = execution.catch((error: unknown) => {
      settled = true;
      return error;
    });
    const context = await started.promise;
    expect(context.remainingMs()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.signal.aborted).toBe(true);
    expect(context.remainingMs()).toBe(0);
    expect(settled).toBe(false);
    cleanup.resolve();
    expect(await failed).toMatchObject({ reason: "unavailable", commandId: "first" });
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it("does not race an ignoring callback or accept its late result as successful", async () => {
    const { input } = await fixture([{ ...common("verify"), template: "verify" }]);
    const started = deferred<void>();
    const returned = deferred<NpSiteBuildCommandObservedEvidenceV1>();
    input.observers = {
      verify: async () => {
        started.resolve();
        return returned.promise;
      },
    };
    mappedWorkspace();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let settled = false;
    const failed = executeSiteBuildBlueprintCommandsV1(input).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    returned.resolve({
      commandId: "verify",
      exitCode: 0,
      sourceTreeDigest: "late-result-never-consumed",
      file: { path: "late.json", sha256: "a".repeat(64), bytes: 1 },
      output: { path: "late-output.json", sha256: "a".repeat(64), bytes: 1 },
      assertUnchanged: () => Promise.resolve(),
    });
    expect(await failed).toMatchObject({ reason: "unavailable" });
  });
  it("runs installed Node owners with closed argv and retains actual command-output bytes", async () => {
    const commands: NpAgentBlueprintCommand[] = [
      { ...common("a-format"), template: "format", files: ["src/home.ts"] },
      { ...common("b-types", ["a-format"]), template: "typecheck", workspaceFilter: null },
      { ...common("c-lint", ["b-types"]), template: "lint", workspaceFilter: null },
      {
        ...common("d-test", ["c-lint"]),
        template: "test",
        workspaceFilter: null,
        integration: false,
      },
      { ...common("e-build", ["d-test"]), template: "build", workspaceFilter: null },
    ];
    const { input, blueprint, install } = await fixture(commands);
    const contents = "export const home = true;\n";
    blueprint.filePlan = [
      {
        path: "src/home.ts",
        action: "create",
        owner: "page",
        expectedHash: null,
        contentHash: await fileHash(contents),
        rationale: "reviewed page",
        source: "staged",
        stagedArtifactPath: ".nexpress/site/files/home.ts",
        generatedByCommandId: null,
      },
    ];
    await put(input.project, "src/home.ts", contents);
    for (const [name, entry] of [
      ["prettier", "bin/prettier.cjs"],
      ["typescript", "bin/tsc"],
      ["eslint", "bin/eslint.js"],
      ["vitest", "dist/node.js"],
      ["next", "dist/bin/next"],
    ]) {
      // CJS entry uses console only; the other fixture package owners are ESM.
      await install(
        name,
        entry,
        name === "vitest"
          ? "export async function startVitest(mode,filters,options,viteOptions){console.log(JSON.stringify({mode,filters,options,viteOptions,env:process.env.NODE_ENV}));}\n"
          : undefined,
      );
    }
    mappedWorkspace();
    const receipt = await executeSiteBuildBlueprintCommandsV1(input);
    expect(receipt.commands.map((row) => row.template)).toEqual(
      commands.map((row) => row.template),
    );
    expect(receipt.sourceAfter.digest).toBe(receipt.sourceBefore.digest);
    expect(receipt.tools).toHaveLength(5);
    const rows = hooks.runs.mock.calls.map(
      ([row]) => row as Parameters<NpSiteBuildLinuxWorkspaceV1["run"]>[0],
    );
    const formatOutput = JSON.parse(
      await readFile(join(input.project, receipt.commands[0].outputArtifactPath), "utf8"),
    ) as { stdout: { base64url: string } };
    expect(
      JSON.parse(Buffer.from(formatOutput.stdout.base64url, "base64url").toString("utf8")),
    ).toMatchObject({ args: ["--write", "--", "./src/home.ts"] });
    expect(rows[1].argv).toEqual(
      expect.arrayContaining(["--noEmit", "--incremental", "--tsBuildInfoFile"]),
    );
    expect(rows[2].argv.slice(2)).toEqual([".", "--no-cache"]);
    expect(rows[4].argv.slice(-1)).toEqual(["build"]);
    expect(rows.every((row) => row.argv[0] === "/usr/local/bin/node")).toBe(true);
    expect(hooks.finalize).toHaveBeenCalledOnce();
    const testOutput = JSON.parse(
      await readFile(join(input.project, receipt.commands[3].outputArtifactPath), "utf8"),
    ) as { stdout: { base64url: string } };
    expect(
      JSON.parse(Buffer.from(testOutput.stdout.base64url, "base64url").toString("utf8")),
    ).toMatchObject({
      env: "test",
      mode: "test",
      filters: [],
      options: {
        run: true,
        watch: false,
        passWithNoTests: false,
        cache: false,
        configLoader: "runner",
        experimental: { fsModuleCache: false },
      },
    });
    const cacheSettings = JSON.parse(
      Buffer.from(testOutput.stdout.base64url, "base64url").toString("utf8"),
    ) as {
      options: { experimental: { fsModuleCachePath: string } };
      viteOptions: { cacheDir: string };
    };
    expect(cacheSettings.viteOptions.cacheDir).toMatch(
      /\/\.nexpress\/site\/tmp\/command-executor-[^/]+\/vitest-cache\/vite$/u,
    );
    expect(cacheSettings.options.experimental.fsModuleCachePath).toBe(
      cacheSettings.viteOptions.cacheDir.replace(/\/vite$/u, "/modules"),
    );
    expect(await readFile(join(input.project, "pnpm-lock.yaml"), "utf8")).toBe(
      "raw reviewed lock\n",
    );
  });

  it("supports the full 500-file formatter set through the fixed owner driver", async () => {
    const files = Array.from(
      { length: 500 },
      (_, index) => `src/page-${String(index).padStart(3, "0")}.ts`,
    );
    const { input, blueprint, install } = await fixture([
      { ...common("format"), template: "format", files },
    ]);
    const contents = "export const page = true;\n",
      digest = await fileHash(contents);
    blueprint.filePlan = files.map((path) => ({
      path,
      action: "create",
      owner: "page",
      expectedHash: null,
      contentHash: digest,
      rationale: "reviewed source",
      source: "staged",
      stagedArtifactPath: `.nexpress/site/files/${path}`,
      generatedByCommandId: null,
    }));
    await Promise.all(files.map((path) => put(input.project, path, contents)));
    await install("prettier", "bin/prettier.cjs");
    mappedWorkspace();
    const receipt = await executeSiteBuildBlueprintCommandsV1(input);
    expect(hooks.runs.mock.calls[0][0].argv).toHaveLength(2);
    const output = JSON.parse(
      await readFile(join(input.project, receipt.commands[0].outputArtifactPath), "utf8"),
    ) as { stdout: { base64url: string } };
    const observed = JSON.parse(Buffer.from(output.stdout.base64url, "base64url").toString()) as {
      args: string[];
    };
    expect(observed.args).toEqual(["--write", "--", ...files.map((path) => `./${path}`)]);
  });

  it.each(["exact", "wrong-hash"] as const)(
    "runs the fixed schema driver and validates %s generated bytes",
    async (kind) => {
      const { input, blueprint, install } = await fixture([
        { ...common("schema"), template: "schema-generate" },
      ]);
      const contents = "// exact generated schema\n";
      blueprint.filePlan = await Promise.all(
        ["collections", "documents"].map(async (name) => ({
          path: `src/db/generated/${name}.ts`,
          action: "create" as const,
          owner: "generated-schema" as const,
          expectedHash: null,
          contentHash: await fileHash(
            kind === "wrong-hash" ? "different expected bytes\n" : contents,
          ),
          rationale: "exact reviewed schema",
          source: "command" as const,
          stagedArtifactPath: null,
          generatedByCommandId: "schema",
        })),
      );
      await install("@nexpress/cli", "dist/site-build-loader.js", "export {};\n");
      await install(
        "@nexpress/app",
        "dist/scripts/generate-schema.js",
        `import * as fs from "node:fs";export function generateSchema({config,projectRoot}){if(config.collections.length!==0)throw new Error("wrong config");fs.mkdirSync(projectRoot+"/src/db/generated",{recursive:true});for(const n of ["collections","documents"])fs.writeFileSync(projectRoot+"/src/db/generated/"+n+".ts",${JSON.stringify(contents)});}`,
      );
      mappedWorkspace();
      if (kind === "wrong-hash")
        await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
          reason: "conflict",
          commandId: "schema",
        });
      else expect((await executeSiteBuildBlueprintCommandsV1(input)).commands[0].exitCode).toBe(0);
    },
  );

  it("requires a host generation context and rejects selected direction drift before dispatch", async () => {
    const { input } = await fixture([{ ...common("schema"), template: "schema-generate" }]);
    const context = input.generationContext!;
    delete input.generationContext;
    await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    input.generationContext = {
      ...context,
      selectedDirectionHash: `nb1:sha256:${"B".repeat(42)}A`,
    };
    await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(hooks.workspace).not.toHaveBeenCalled();
  });

  it("fails missing scaffold lint/test/format tools before opening a workspace", async () => {
    for (const command of [
      { ...common("format"), template: "format" as const, files: ["src/home.ts"] },
      { ...common("lint"), template: "lint" as const, workspaceFilter: null },
      { ...common("test"), template: "test" as const, workspaceFilter: null, integration: false },
    ]) {
      const { input, blueprint } = await fixture([command]);
      if (command.template === "format") {
        await put(input.project, "src/home.ts", "final\n");
        blueprint.filePlan = [
          {
            path: "src/home.ts",
            action: "create",
            owner: "page",
            expectedHash: null,
            contentHash: await fileHash("final\n"),
            rationale: "reviewed",
            source: "staged",
            stagedArtifactPath: ".nexpress/site/files/home.ts",
            generatedByCommandId: null,
          },
        ];
      }
      await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
        reason: "unavailable",
      });
    }
    expect(hooks.workspace).not.toHaveBeenCalled();
  });

  it.each(["filter", "integration", "production-doctor", "long-timeout", "missing-verify"])(
    "rejects unsupported %s rather than skipping to pass",
    async (kind) => {
      const command: NpAgentBlueprintCommand =
        kind === "production-doctor"
          ? { ...common("doctor"), template: "doctor", production: true, target: "docker" }
          : kind === "integration"
            ? { ...common("test"), template: "test", workspaceFilter: null, integration: true }
            : kind === "missing-verify"
              ? { ...common("verify"), template: "verify" }
              : {
                  ...common("types"),
                  template: "typecheck",
                  workspaceFilter: kind === "filter" ? "selected-package" : null,
                  timeoutSeconds: kind === "long-timeout" ? 901 : 60,
                };
      const { input, blueprint } = await fixture([command]);
      if (kind === "production-doctor") blueprint.deployment.target = "docker";
      await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
        reason: "unavailable",
      });
      expect(hooks.workspace).not.toHaveBeenCalled();
    },
  );

  it("honors the named Drizzle generate before the complete framework migration owner and exact planned bytes", async () => {
    const { input, blueprint, install } = await fixture([
      { ...common("migration"), template: "migration-generate", name: "reviewed-change" },
    ]);
    const named = "CREATE TABLE reviewed(id integer);\n",
      framework = "-- reviewed framework constraints\n";
    blueprint.filePlan = await Promise.all(
      [
        ["drizzle/0000_reviewed-change.sql", named],
        ["drizzle/0001_framework.sql", framework],
      ].map(async ([path, contents]) => ({
        path,
        action: "create" as const,
        owner: "migration" as const,
        expectedHash: null,
        contentHash: await fileHash(contents),
        rationale: "reviewed exact SQL",
        source: "command" as const,
        stagedArtifactPath: null,
        generatedByCommandId: "migration",
      })),
    );
    await install(
      "drizzle-kit",
      "bin.cjs",
      `const fs=require("node:fs");const a=process.argv.slice(2);if(JSON.stringify(a)!==JSON.stringify(["generate","--config","drizzle.config.ts","--name","reviewed-change"]))process.exit(2);fs.mkdirSync("drizzle",{recursive:true});fs.writeFileSync("drizzle/0000_"+a.at(-1)+".sql",${JSON.stringify(named)});fs.appendFileSync(process.env.NP_TEST_TRACE,"named\\n");\n`,
    );
    await install(
      "@nexpress/app",
      "dist/scripts/generate-migrations-core.js",
      `import * as fs from "node:fs/promises";export async function generateMigrations(){await fs.writeFile("drizzle/0001_framework.sql",${JSON.stringify(framework)});await fs.appendFile(process.env.NP_TEST_TRACE,"framework\\n");}\n`,
    );
    mappedWorkspace();
    const receipt = await executeSiteBuildBlueprintCommandsV1(input);
    expect(receipt.commands[0].exitCode).toBe(0);
    expect(receipt.generationContext).toEqual(input.generationContext);
    expect(receipt.generationContextFingerprint).toMatch(/^ngc1:sha256:/u);
    expect(receipt.drivers).toHaveLength(2);
    expect(await readFile(join(input.project, "drizzle/0000_reviewed-change.sql"), "utf8")).toBe(
      named,
    );
    const [workspaceInput] = hooks.workspace.mock.calls[0] as [NpSiteBuildLinuxWorkspaceInputV1];
    expect(
      await readFile(
        join(input.project, workspaceInput.controls.directory, "migration-trace.txt"),
        "utf8",
      ),
    ).toBe("named\nframework\n");
  });

  it("rejects source writes from a temporary-output tool", async () => {
    const { input, blueprint, install } = await fixture([
      { ...common("types"), template: "typecheck", workspaceFilter: null },
    ]);
    await install(
      "typescript",
      "bin/tsc",
      'import * as fs from "node:fs/promises";await fs.writeFile("tsconfig.json","unplanned tool rewrite\\n");\n',
    );
    mappedWorkspace();
    await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
      reason: "conflict",
      commandId: "types",
      privateCopyState: "discard-after-failure",
    });
    expect(blueprint.filePlan).toEqual([]);
  });

  it("calls the fixed Doctor functions without turning an unsuccessful report into pass", async () => {
    const { input, install } = await fixture([
      { ...common("doctor"), template: "doctor", production: false, target: null },
    ]);
    await install("@nexpress/cli", "dist/site-build-loader.js", "export {};\n");
    await install(
      "@nexpress/app",
      "dist/scripts/doctor-core.js",
      'export async function collectDoctorChecks(o){if(o.prodMode||o.target!==null||o.env.NODE_ENV!=="test")throw new Error("wrong doctor options");return [{id:"env.file",state:"error"}];}\n',
    );
    await put(
      input.dependencies,
      "@nexpress/app/dist/scripts/doctor-output.js",
      'export function buildDoctorJson({checks}){return {ok:checks.every(c=>c.state!=="error"),checks};}\n',
    );
    mappedWorkspace();
    await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
      reason: "input",
      commandId: "doctor",
    });
    expect(hooks.runs).toHaveBeenCalledOnce();
  });

  it.each([60, 901, 3600])(
    "requires closed observed verify artifacts and forwards the reviewed %i second observer budget",
    async (timeoutSeconds) => {
      const { input, install } = await fixture([
        { ...common("types"), template: "typecheck", workspaceFilter: null },
        { ...common("verify", ["types"]), timeoutSeconds, template: "verify" },
      ]);
      await install("typescript", "bin/tsc");
      const lease = vi.fn(async () => {});
      input.observers = {
        verify: async (context: NpSiteBuildCommandObserverContextV1) => {
          expect(context.timeoutMs).toBe(timeoutSeconds * 1000);
          expect(context.remainingMs()).toBeGreaterThan(timeoutSeconds * 1000 - 1000);
          expect(activeWorkspaces).toBe(0);
          expect(removedWorkspaces).toBe(1);
          expect(context.completedCommands.map((row) => row.commandId)).toEqual(["types"]);
          const reportPath = ".nexpress/site/audit/owned-verify/report.json",
            outputPath = ".nexpress/site/audit/owned-verify/output.json";
          const report = Buffer.from('{"actualFixtureReport":true}'),
            output = Buffer.from(
              JSON.stringify({
                schemaVersion: "np.agent-build-command-output.v1",
                stdout: {
                  base64url: Buffer.from("observed owner stdout\n").toString("base64url"),
                  truncated: false,
                },
                stderr: { base64url: "", truncated: false },
              }),
            );
          await put(input.project, reportPath, report.toString());
          await put(input.project, outputPath, output.toString());
          return {
            commandId: context.command.id,
            exitCode: 0,
            sourceTreeDigest: context.source.digest,
            file: { path: reportPath, sha256: sha(report), bytes: report.length },
            output: { path: outputPath, sha256: sha(output), bytes: output.length },
            assertUnchanged: lease,
          };
        },
      };
      mappedWorkspace();
      const receipt = await executeSiteBuildBlueprintCommandsV1(input);
      expect(receipt.commands[1].execution).toBeNull();
      expect(receipt.commands[1].evidence?.path).toContain("report.json");
      expect(lease).toHaveBeenCalled();
      expect(hooks.runs).toHaveBeenCalledOnce();
      const recorded = JSON.parse(
        await readFile(join(input.project, receipt.commands[1].outputArtifactPath), "utf8"),
      ) as { stdout: { base64url: string } };
      expect(Buffer.from(recorded.stdout.base64url, "base64url").toString()).toBe(
        "observed owner stdout\n",
      );
    },
  );

  it("rejects source precondition and command registry drift before dispatch", async () => {
    const { input } = await fixture([{ ...common("verify"), template: "verify" }]);
    input.registry.fingerprint = `nb1:sha256:${"B".repeat(43)}`;
    await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
    input.registry.fingerprint = (
      input.blueprint as NpAgentSiteBlueprintV1
    ).commandRegistryFingerprint;
    await put(input.project, "src/unplanned.ts", "unexpected\n");
    await expect(executeSiteBuildBlueprintCommandsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(hooks.workspace).not.toHaveBeenCalled();
  });
});
