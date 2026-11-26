import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { types } from "node:util";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npRequireAgentBuildSourceTreeV1,
  npRequireAgentBuildCommandOutputV1,
  npRequireAgentSiteBlueprintV1,
  type NpAgentBlueprintCommand,
  type NpAgentBuildSourceTreeV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  withSiteBuildLinuxWorkspaceV1,
  type NpSiteBuildLinuxWorkspaceCommandV1,
  type NpSiteBuildLinuxWorkspaceSourceV1,
  type NpSiteBuildLinuxWorkspaceFileV1,
} from "./linux-workspace.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { createSiteBuildObservationDeadlineV1 } from "./observation-deadline.js";
import {
  prepareSiteBuildCommandNextV1,
  type NpSiteBuildCommandNextDerivationV1,
  type NpSiteBuildCommandNextSummaryV1,
} from "./next-build-command.js";
import {
  fingerprintSiteBuildGenerationContextV1,
  requireSiteBuildGenerationContextV1,
  type NpSiteBuildGenerationContextV1,
} from "./generation-context.js";
import { createSiteBuildCodegenDriverV1 } from "./codegen-driver.js";

interface ToolDescriptor {
  package: string;
  version: string;
  path: string;
  sha256: string;
  packageJsonSha256: string;
}
interface EvidenceFile {
  path: string;
  sha256: string;
  bytes: number;
}
export interface NpSiteBuildCommandObserverContextV1 {
  project: string;
  dependencies: string;
  blueprint: NpAgentSiteBlueprintV1;
  blueprintHash: string;
  command: NpAgentBlueprintCommand;
  source: NpSiteBuildLinuxWorkspaceSourceV1;
  baselineTreeDigest: string;
  timeoutMs: number;
  /** The owning observer must forward this to native jobs and await their cleanup. */
  signal: AbortSignal;
  /** Remaining total command time, not a fresh allowance for each route. */
  remainingMs: () => number;
  /** Prior completed command records, whose output bytes and leases this executor owns. */
  completedCommands: NpSiteBuildCommandExecutionReceiptV1["commands"];
  /** Actual build from this executor turn, not a persisted claim or run grant. */
  nextDerivation?: NpSiteBuildCommandNextSummaryV1;
  auditPath: string;
}
/** Only an actual bounded host observer may return this handle. JSON is not a lease. */
export interface NpSiteBuildCommandObservedEvidenceV1 {
  commandId: string;
  exitCode: number;
  sourceTreeDigest: string;
  /** A closed JSON manifest/report whose own owner verifies its referenced artifacts. */
  file: EvidenceFile;
  /** Actual captured output in the Core command-output schema, independently stored by its owner. */
  output: EvidenceFile;
  assertUnchanged(): Promise<void>;
}
type ObservedCommand = (
  context: NpSiteBuildCommandObserverContextV1,
) => Promise<NpSiteBuildCommandObservedEvidenceV1>;
export interface NpSiteBuildCommandExecutorInputV1 {
  /** Caller-owned raw private edit copy, never the ordinary repository. */
  project: string;
  /** Separately prepared Linux node_modules; no package installation occurs here. */
  dependencies: string;
  baseImageId: string;
  config: "nexpress.config.ts" | "src/nexpress.config.ts";
  blueprint: unknown;
  /** Actual private-copy manifest before staged apply, after credential omissions. */
  privateBaseline: NpAgentBuildSourceTreeV1;
  /** Trusted live observations, not cache/blueprint assertions or an execution grant. */
  registry: { fingerprint: string; assertUnchanged(): Promise<void> };
  assertDependenciesUnchanged(): Promise<void>;
  /** Cooperative owning callbacks: ignoring their signal cannot be forcibly interrupted here. */
  observers?: {
    doctor?: ObservedCommand;
    previewRender?: ObservedCommand;
    verify?: ObservedCommand;
  };
  /** Trusted selected comparison clock/seed; the root must bind it to observed render inputs. */
  generationContext?: NpSiteBuildGenerationContextV1;
  /** Fixed host preparation choice, bound to generationContext's observed clock. */
  nextPreview?: "deterministic-selected-comparison";
}
export interface NpSiteBuildCommandExecutionReceiptV1 {
  schemaVersion: "np.site-build-command-execution.v1";
  scope: "private-build-copy";
  blueprintHash: string;
  commandRegistryFingerprint: string;
  baselineTreeDigest: string;
  generationContext: NpSiteBuildGenerationContextV1 | null;
  generationContextFingerprint: string | null;
  nextDerivation?: NpSiteBuildCommandNextSummaryV1;
  sourceBefore: NpSiteBuildLinuxWorkspaceSourceV1;
  sourceAfter: NpSiteBuildLinuxWorkspaceSourceV1;
  tools: ToolDescriptor[];
  drivers: EvidenceFile[];
  auditPath: string;
  commands: Array<{
    commandId: string;
    template: NpAgentBlueprintCommand["template"];
    exitCode: 0;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    execution: NpSiteBuildLinuxWorkspaceCommandV1 | null;
    outputArtifactPath: string;
    outputDigest: string;
    evidence: EvidenceFile | null;
  }>;
}
/** No later command may run after failure; discard the owned private candidate. */
export class NpSiteBuildCommandExecutionErrorV1 extends SiteBuildError {
  readonly scope = "private-build-copy";
  readonly privateCopyState = "discard-after-failure";
  constructor(
    reason: SiteBuildError["reason"],
    readonly commandId: string | null,
    readonly auditPath: string | null,
  ) {
    super(reason);
  }
}
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const within = (root: string, path: string) => path.startsWith(`${root}/`);

/** O_NOFOLLOW, stable streamed bytes; no source or package module is imported. */
async function observeFile(path: string, limit: number, capture = 0) {
  const parent = await realpath(dirname(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(limit))
      throw new SiteBuildError("input");
    const hash = createHash("sha256"),
      prefix: Buffer[] = [],
      block = Buffer.alloc(64 * 1024);
    let count = 0,
      captured = 0;
    while (count < Number(before.size)) {
      const result = await file.read(
        block,
        0,
        Math.min(block.length, Number(before.size) - count),
        count,
      );
      if (!result.bytesRead) throw new SiteBuildError("conflict");
      const bytes = block.subarray(0, result.bytesRead);
      hash.update(bytes);
      if (captured < capture) {
        const part = bytes.subarray(0, capture - captured);
        prefix.push(Buffer.from(part));
        captured += part.length;
      }
      count += result.bytesRead;
    }
    if (
      (await file.read(block, 0, 1, count)).bytesRead ||
      !same(before, await file.stat({ bigint: true })) ||
      !same(before, await lstat(path, { bigint: true })) ||
      (await realpath(dirname(path))) !== parent
    )
      throw new SiteBuildError("conflict");
    return {
      sha256: hash.digest("hex"),
      bytes: count,
      prefix: Buffer.concat(prefix),
      assertUnchanged: async () => {
        if (
          !same(before, await lstat(path, { bigint: true })) ||
          (await realpath(dirname(path))) !== parent
        )
          throw new SiteBuildError("conflict");
      },
    };
  } finally {
    await file.close();
  }
}
function jsonData(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  budget = { nodes: 0, bytes: 0 },
): void {
  budget.nodes++;
  budget.bytes += typeof value === "string" ? Buffer.byteLength(value) : 8;
  if (budget.nodes > 100_000 || budget.bytes > 4 * 1024 * 1024) throw new SiteBuildError("input");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || types.isProxy(value) || depth > 20 || seen.has(value))
    throw new SiteBuildError("input");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
    throw new SiteBuildError("input");
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 20_000) throw new SiteBuildError("input");
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new SiteBuildError("input");
    const field = descriptors[key];
    if (!("value" in field)) throw new SiteBuildError("input");
    budget.bytes += Buffer.byteLength(key);
    jsonData(field.value, depth + 1, seen, budget);
  }
  seen.delete(value);
}
function assertPlannedTree(
  source: NpSiteBuildLinuxWorkspaceSourceV1,
  baseline: NpAgentBuildSourceTreeV1,
  blueprint: NpAgentSiteBlueprintV1,
  completed: ReadonlySet<string>,
): void {
  const initial = new Map(baseline.files.map((file) => [file.path, file]));
  const actual = new Map(source.manifest.files.map((file) => [file.path, file]));
  const planned = new Map(blueprint.filePlan.map((file) => [file.path, file]));
  for (const row of blueprint.filePlan) {
    const before = initial.get(row.path);
    if ((before?.digest ?? null) !== row.expectedHash || (row.action === "create") !== !before)
      throw new SiteBuildError("conflict");
  }
  for (const path of new Set([...initial.keys(), ...actual.keys(), ...planned.keys()])) {
    const before = initial.get(path),
      after = actual.get(path),
      row = planned.get(path);
    if (!row) {
      if (before?.digest !== after?.digest || before?.mode !== after?.mode)
        throw new SiteBuildError("conflict");
      continue;
    }
    const mode = before?.mode ?? "100644";
    const final = after?.digest === row.contentHash && after.mode === mode;
    if (row.source === "staged" || completed.has(row.generatedByCommandId)) {
      if (!final) throw new SiteBuildError("conflict");
    } else if (!final && (before?.digest !== after?.digest || before?.mode !== after?.mode)) {
      throw new SiteBuildError("conflict");
    }
  }
}

/**
 * Fixed private-copy command dispatcher. The caller owns authorization and the
 * dependency/image provenance. No caller-selected shell, package script, install, Git command,
 * production DB migration, deployment or Runtime/provider activation is invoked.
 * Host preview/verify callbacks must own their actual sandbox/timeout/artifact
 * proof; a missing callback or a JSON descriptor never substitutes for execution.
 * Expiry aborts their shared signal and awaits the callback's cleanup; callbacks
 * which ignore cancellation cannot be forcibly interrupted by this dispatcher.
 */
export async function executeSiteBuildBlueprintCommandsV1(
  input: NpSiteBuildCommandExecutorInputV1,
): Promise<NpSiteBuildCommandExecutionReceiptV1> {
  let ownedProject: string | null = null;
  let auditPath: string | null = null,
    commandId: string | null = null;
  const started = Date.now();
  try {
    jsonData(input.blueprint);
    jsonData(input.privateBaseline);
    const blueprint = npRequireAgentSiteBlueprintV1(input.blueprint);
    const baseline = npRequireAgentBuildSourceTreeV1(input.privateBaseline);
    const generates = blueprint.commands.some(
      (command) =>
        command.template === "schema-generate" || command.template === "migration-generate",
    );
    if (generates && input.generationContext === undefined) throw new SiteBuildError("unavailable");
    const generationContext =
      input.generationContext === undefined
        ? null
        : requireSiteBuildGenerationContextV1(input.generationContext);
    if (
      input.nextPreview !== undefined &&
      (input.nextPreview !== "deterministic-selected-comparison" || !generationContext)
    )
      throw new SiteBuildError("unavailable");
    if (
      generationContext &&
      (generationContext.selectedDirectionHash !== blueprint.selectedDirectionHash ||
        blueprint.commands.some(
          (command) =>
            command.template === "preview-render" &&
            command.comparisonInputsDigest !== generationContext.comparisonInputsDigest,
        ))
    )
      throw new SiteBuildError("conflict");
    if (blueprint.commandRegistryFingerprint !== input.registry.fingerprint)
      throw new SiteBuildError("conflict");
    await input.registry.assertUnchanged();
    await input.assertDependenciesUnchanged();
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.baseImageId)) throw new SiteBuildError("input");
    const project = await realpath(input.project),
      dependencies = await realpath(input.dependencies);
    if (
      project !== resolve(input.project) ||
      dependencies !== resolve(input.dependencies) ||
      project === process.cwd()
    )
      throw new SiteBuildError("path");
    ownedProject = project;
    const config = input.config;
    const sourceBefore = await readSiteSourceTreeV1(project),
      completed = new Set<string>();
    assertPlannedTree(sourceBefore, baseline, blueprint, completed);
    if (
      !["nexpress.config.ts", "src/nexpress.config.ts"].includes(config) ||
      !sourceBefore.manifest.files.some((file) => file.path === config)
    )
      throw new SiteBuildError("input");
    const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
    const baselineTreeDigest = await npBuildCanonicalDigest("np.build-source-tree.v1", baseline);
    const tools = new Map<
      string,
      { descriptor: ToolDescriptor; assertUnchanged(): Promise<void> }
    >();
    const tool = async (name: string, entry: string): Promise<string> => {
      const key = `${name}/${entry}`;
      if (!tools.has(key)) {
        try {
          const root = await realpath(join(dependencies, name));
          const path = await realpath(join(root, entry));
          if (!within(dependencies, root) || !within(root, path))
            throw new SiteBuildError("unavailable");
          const metadata = await observeFile(join(root, "package.json"), 128 * 1024, 128 * 1024);
          const body: unknown = JSON.parse(metadata.prefix.toString("utf8"));
          if (body === null || typeof body !== "object" || Array.isArray(body))
            throw new SiteBuildError("unavailable");
          const data = body as { name?: unknown; version?: unknown };
          if (data.name !== name || typeof data.version !== "string" || data.version.length > 128)
            throw new SiteBuildError("unavailable");
          const executable = await observeFile(path, 64 * 1024 * 1024);
          tools.set(key, {
            descriptor: {
              package: name,
              version: data.version,
              path: entry,
              sha256: executable.sha256,
              packageJsonSha256: metadata.sha256,
            },
            assertUnchanged: async () => {
              if (
                (await realpath(join(dependencies, name))) !== root ||
                (await realpath(join(root, entry))) !== path
              )
                throw new SiteBuildError("conflict");
              await metadata.assertUnchanged();
              await executable.assertUnchanged();
            },
          });
        } catch {
          throw new SiteBuildError("unavailable");
        }
      }
      return `/np/project/node_modules/${key}`;
    };
    const stamp = randomUUID(),
      tmpPath = `.nexpress/site/tmp/command-executor-${stamp}`;
    auditPath = `.nexpress/site/audit/command-executor-${stamp}`;
    const drivers = new Map<string, string>();
    const invocations = new Map<string, string[]>();
    let loader: string | undefined;
    const loaded = async () =>
      (loader ??= await tool("@nexpress/cli", "dist/site-build-loader.js"));
    const script = (id: string, code: string) => {
      const path = `${tmpPath}/command-${blueprint.commands.findIndex((command) => command.id === id)}.mjs`;
      drivers.set(path, code);
      return `/np/project/${path}`;
    };
    const generationDriver = (command: NpAgentBlueprintCommand) => {
      if (
        !generationContext ||
        (command.template !== "schema-generate" && command.template !== "migration-generate")
      )
        throw new SiteBuildError("unavailable");
      const path = `${tmpPath}/generation-${blueprint.commands.findIndex((row) => row.id === command.id)}.mjs`;
      const preloadPath = `/np/project/${path}`;
      const { preload, driver } = createSiteBuildCodegenDriverV1({
        context: generationContext,
        command: {
          id: command.id,
          template: command.template,
          name: command.template === "migration-generate" ? command.name : null,
        },
        configPath: config,
        preloadPath,
        loaderPath: "/np/project/node_modules/@nexpress/cli/dist/site-build-loader.js",
      });
      drivers.set(path, preload.source);
      return { preloadPath, driver };
    };
    if (blueprint.commands.filter((command) => command.template === "build").length > 1)
      throw new SiteBuildError("unavailable");
    for (const command of blueprint.commands) {
      const observerOwned =
        command.template === "preview-render" ||
        command.template === "verify" ||
        (command.template === "doctor" && input.observers?.doctor !== undefined);
      if (
        (!observerOwned && command.timeoutSeconds > 900) ||
        ("workspaceFilter" in command && command.workspaceFilter !== null) ||
        (command.template === "test" && command.integration) ||
        (command.template === "doctor" && command.production)
      )
        throw new SiteBuildError("unavailable");
      let argv: string[];
      switch (command.template) {
        case "format": {
          const entry = await tool("prettier", "bin/prettier.cjs");
          argv = [
            "/usr/local/bin/node",
            script(
              command.id,
              `process.argv=[process.argv[0],${JSON.stringify(entry)},"--write","--",...${JSON.stringify(command.files.map((path) => `./${path}`))}];\nawait import(${JSON.stringify(`file://${entry}`)});\n`,
            ),
          ];
          break;
        }
        case "typecheck":
          argv = [
            "/usr/local/bin/node",
            await tool("typescript", "bin/tsc"),
            "--noEmit",
            "--incremental",
            "--tsBuildInfoFile",
            `/np/project/${tmpPath}/typecheck.tsbuildinfo`,
          ];
          break;
        case "lint":
          argv = ["/usr/local/bin/node", await tool("eslint", "bin/eslint.js"), ".", "--no-cache"];
          break;
        case "test": {
          const entry = await tool("vitest", "dist/node.js");
          const cache = `/np/project/${tmpPath}/vitest-cache`;
          argv = [
            "/usr/local/bin/node",
            script(
              command.id,
              `process.env.NODE_ENV="test";\nconst {startVitest}=await import(${JSON.stringify(`file://${entry}`)});\nawait startVitest("test",[],{run:true,watch:false,passWithNoTests:false,cache:false,configLoader:"runner",experimental:{fsModuleCache:false,fsModuleCachePath:${JSON.stringify(`${cache}/modules`)}}},{cacheDir:${JSON.stringify(`${cache}/vite`)}});\n`,
            ),
          ];
          break;
        }
        case "build":
          argv = [
            "/usr/local/bin/node",
            "--max-old-space-size=3072",
            await tool("next", "dist/bin/next"),
            "build",
          ];
          break;
        case "schema-generate": {
          const { preloadPath, driver } = generationDriver(command);
          await tool("@nexpress/app", "dist/scripts/generate-schema.js");
          argv = [
            "/usr/local/bin/node",
            "--no-warnings",
            "--import",
            preloadPath,
            "--loader",
            await loaded(),
            script(command.id, driver),
          ];
          break;
        }
        case "migration-generate": {
          const { preloadPath, driver } = generationDriver(command);
          if (!sourceBefore.manifest.files.some((file) => file.path === "drizzle.config.ts"))
            throw new SiteBuildError("unavailable");
          await tool("drizzle-kit", "bin.cjs");
          await tool("@nexpress/app", "dist/scripts/generate-migrations-core.js");
          argv = ["/usr/local/bin/node", "--import", preloadPath, script(command.id, driver)];
          break;
        }
        case "doctor": {
          if (input.observers?.doctor) continue;
          await tool("@nexpress/app", "dist/scripts/doctor-core.js");
          await tool("@nexpress/app", "dist/scripts/doctor-output.js");
          argv = [
            "/usr/local/bin/node",
            "--no-warnings",
            "--loader",
            await loaded(),
            script(
              command.id,
              `process.env.NODE_ENV="test";\nconst {collectDoctorChecks}=await import("@nexpress/app/scripts/doctor-core");\nconst {buildDoctorJson}=await import("@nexpress/app/scripts/doctor-output");\nconst checks=await collectDoctorChecks({prodMode:false,target:null,cwd:"/np/project",env:process.env});\nconst report=buildDoctorJson({prodMode:false,target:null,checks});\nprocess.stdout.write(JSON.stringify(report)+"\\n");\nprocess.exitCode=report.ok?0:1;\n`,
            ),
          ];
          break;
        }
        case "preview-render":
          if (!input.observers?.previewRender) throw new SiteBuildError("unavailable");
          continue;
        case "verify":
          if (!input.observers?.verify) throw new SiteBuildError("unavailable");
          continue;
      }
      invocations.set(command.id, argv);
    }
    // The bounded workspace accepts at most 32 fixed control files. Never silently drop a preload.
    if (drivers.size > 32) throw new SiteBuildError("unavailable");
    for (const file of blueprint.filePlan)
      if (
        file.source === "command" &&
        baseline.files.find((row) => row.path === file.path)?.mode === "100755"
      )
        throw new SiteBuildError("unavailable");
    await mkdir(join(project, tmpPath), { recursive: true, mode: 0o700 });
    await mkdir(join(project, auditPath), { recursive: true, mode: 0o700 });
    for (const [path, code] of drivers)
      await writeFile(join(project, path), code, { flag: "wx", mode: 0o400 });
    const commands: NpSiteBuildCommandExecutionReceiptV1["commands"] = [];
    const evidenceLeases: Array<() => Promise<void>> = [];
    const observedDrivers: EvidenceFile[] = [];
    for (const path of drivers.keys()) {
      const observed = await observeFile(join(project, path), 64 * 1024 * 1024);
      observedDrivers.push({ path, bytes: observed.bytes, sha256: observed.sha256 });
      evidenceLeases.push(observed.assertUnchanged);
    }
    const assertTools = async () => {
      await input.registry.assertUnchanged();
      await input.assertDependenciesUnchanged();
      if (input.registry.fingerprint !== blueprint.commandRegistryFingerprint)
        throw new SiteBuildError("conflict");
      for (const observed of tools.values()) await observed.assertUnchanged();
      for (const lease of evidenceLeases) await lease();
    };
    let sourceAfter = sourceBefore;
    let nextDerivation: NpSiteBuildCommandNextDerivationV1 | undefined;
    const ownedAuditPath = auditPath;
    // A native command owns one workspace. Await its removal before invoking
    // an external preview/verification observer or capturing compiled runtime.
    for (const [index, command] of blueprint.commands.entries()) {
      commandId = command.id;
      if (command.prerequisites.some((id) => !completed.has(id)))
        throw new SiteBuildError("conflict");
      await assertTools();
      const commandStarted = Date.now(),
        prefix = `${auditPath}/command-${index}`;
      const nextCompleted = new Set([...completed, command.id]);
      let execution: NpSiteBuildLinuxWorkspaceCommandV1 | null = null;
      let evidence: EvidenceFile | null = null;
      let stdout: Buffer, stderr: Buffer, stdoutBytes: number, stderrBytes: number;
      const argv = invocations.get(command.id);
      if (argv) {
        const permitted = new Set(
          command.template === "format"
            ? command.files
            : blueprint.filePlan
                .filter(
                  (row) => row.source === "command" && row.generatedByCommandId === command.id,
                )
                .map((row) => row.path),
        );
        const commandSource = await readSiteSourceTreeV1(project);
        const next =
          command.template === "build" && input.nextPreview && generationContext
            ? await prepareSiteBuildCommandNextV1({
                project,
                dependencies,
                baseImageId: input.baseImageId,
                config,
                source: commandSource,
                clock: generationContext.clock,
                assertDependenciesUnchanged: () => input.assertDependenciesUnchanged(),
              })
            : undefined;
        await next?.assertPreparedUnchanged();
        let exported: readonly NpSiteBuildLinuxWorkspaceFileV1[] | undefined;
        execution = await withSiteBuildLinuxWorkspaceV1(
          {
            project,
            source: commandSource,
            dependencies,
            baseImageId: input.baseImageId,
            controls: next?.controls ?? { directory: tmpPath, files: [...drivers.keys()] },
            auditPath: ownedAuditPath,
          },
          async (workspace) => {
            const result = await workspace.run({
              id: `command-${index}`,
              argv: next?.argv ?? argv,
              timeoutMs: command.timeoutSeconds * 1000,
              permitted: (path) => permitted.has(path),
              validateSource: (source, exitCode) => {
                if (exitCode !== 0) throw new SiteBuildError("input");
                assertPlannedTree(source, baseline, blueprint, nextCompleted);
              },
            });
            if (command.template === "build") exported = await workspace.finalizeNextAndExport();
            return result;
          },
        );
        if (next) {
          if (!exported) throw new SiteBuildError("unavailable");
          nextDerivation = await next.finalizeAfterBuilderRemoval(exported);
          assertPlannedTree(nextDerivation.sourceAfter, baseline, blueprint, nextCompleted);
        }
        const out = await observeFile(
          join(project, execution.stdout.path),
          8 * 1024 * 1024,
          256 * 1024,
        );
        const err = await observeFile(
          join(project, execution.stderr.path),
          8 * 1024 * 1024,
          256 * 1024,
        );
        if (
          out.sha256 !== execution.stdout.sha256 ||
          err.sha256 !== execution.stderr.sha256 ||
          out.bytes !== execution.stdout.bytes ||
          err.bytes !== execution.stderr.bytes
        )
          throw new SiteBuildError("conflict");
        stdout = out.prefix;
        stderr = err.prefix;
        stdoutBytes = out.bytes;
        stderrBytes = err.bytes;
        evidenceLeases.push(out.assertUnchanged, err.assertUnchanged);
      } else {
        const observe =
          command.template === "doctor"
            ? input.observers?.doctor
            : command.template === "preview-render"
              ? input.observers?.previewRender
              : input.observers?.verify;
        if (!observe) throw new SiteBuildError("unavailable");
        const deadline = createSiteBuildObservationDeadlineV1(command.timeoutSeconds * 1000);
        try {
          deadline.assertActive();
          const before = await readSiteSourceTreeV1(project);
          deadline.assertActive();
          const result = await observe({
            project,
            dependencies,
            blueprint: structuredClone(blueprint),
            blueprintHash,
            command: structuredClone(command),
            source: before,
            baselineTreeDigest,
            timeoutMs: command.timeoutSeconds * 1000,
            signal: deadline.signal,
            remainingMs: deadline.remainingMs,
            completedCommands: structuredClone(commands),
            ...(nextDerivation
              ? {
                  nextDerivation: {
                    schemaVersion: nextDerivation.schemaVersion,
                    scope: nextDerivation.scope,
                    sourceBeforeDigest: nextDerivation.sourceBefore.digest,
                    sourceAfterDigest: nextDerivation.sourceAfter.digest,
                    buildId: nextDerivation.buildId,
                    previewConfig: nextDerivation.previewConfig,
                    nextPreviewRuntime: nextDerivation.nextPreviewRuntime,
                    deterministicNext: nextDerivation.deterministicNext,
                    runtimeCache: nextDerivation.runtimeCache,
                    artifactManifestSha256: nextDerivation.artifactManifestSha256,
                  },
                }
              : {}),
            auditPath: ownedAuditPath,
          });
          deadline.assertActive();
          if (
            Date.now() - commandStarted > command.timeoutSeconds * 1000 ||
            result.commandId !== command.id ||
            result.exitCode !== 0 ||
            result.sourceTreeDigest !== before.digest
          )
            throw new SiteBuildError("input");
          await result.assertUnchanged();
          const path = result.file.path;
          if (
            !/^(?:\.nexpress\/site\/(?:review|audit))\/[A-Za-z0-9_./-]+\.json$/u.test(path) ||
            path.split("/").some((part) => part === "." || part === "..") ||
            path.length > 512 ||
            !within(project, await realpath(join(project, path)))
          )
            throw new SiteBuildError("path");
          const observed = await observeFile(join(project, path), 2 * 1024 * 1024);
          if (observed.sha256 !== result.file.sha256 || observed.bytes !== result.file.bytes)
            throw new SiteBuildError("conflict");
          evidence = { ...result.file };
          evidenceLeases.push(observed.assertUnchanged, () => result.assertUnchanged());
          if ((await readSiteSourceTreeV1(project)).digest !== before.digest)
            throw new SiteBuildError("conflict");
          const outputPath = result.output.path;
          if (
            !/^\.nexpress\/site\/audit\/[A-Za-z0-9_./-]+\.json$/u.test(outputPath) ||
            outputPath.split("/").some((part) => part === "." || part === "..") ||
            outputPath.length > 512 ||
            !within(project, await realpath(join(project, outputPath)))
          )
            throw new SiteBuildError("path");
          const actualOutput = await observeFile(join(project, outputPath), 768 * 1024, 768 * 1024);
          if (
            actualOutput.sha256 !== result.output.sha256 ||
            actualOutput.bytes !== result.output.bytes
          )
            throw new SiteBuildError("conflict");
          const outputBody = npRequireAgentBuildCommandOutputV1(
            JSON.parse(actualOutput.prefix.toString("utf8")),
          );
          stdout = Buffer.from(outputBody.stdout.base64url, "base64url");
          stderr = Buffer.from(outputBody.stderr.base64url, "base64url");
          stdoutBytes = stdout.length + Number(outputBody.stdout.truncated);
          stderrBytes = stderr.length + Number(outputBody.stderr.truncated);
          evidenceLeases.push(actualOutput.assertUnchanged);
          deadline.assertActive();
        } finally {
          deadline.dispose();
        }
      }
      await assertTools();
      const output = npBuildCanonicalBytes("np.build-command-output.v1", {
        schemaVersion: "np.agent-build-command-output.v1",
        stdout: {
          base64url: stdout.toString("base64url"),
          truncated: stdoutBytes > stdout.length,
        },
        stderr: {
          base64url: stderr.toString("base64url"),
          truncated: stderrBytes > stderr.length,
        },
      });
      const outputArtifactPath = `${prefix}.output.json`;
      await writeFile(join(project, outputArtifactPath), output.canonicalJsonUtf8, {
        flag: "wx",
        mode: 0o600,
      });
      const outputFile = await observeFile(join(project, outputArtifactPath), 768 * 1024);
      evidenceLeases.push(outputFile.assertUnchanged);
      commands.push({
        commandId: command.id,
        template: command.template,
        exitCode: 0,
        startedAt: new Date(commandStarted).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - commandStarted,
        execution,
        outputArtifactPath,
        outputDigest: await npBuildCanonicalDigest("np.build-command-output.v1", output.body),
        evidence,
      });
      completed.add(command.id);
      sourceAfter = await readSiteSourceTreeV1(project);
      assertPlannedTree(sourceAfter, baseline, blueprint, completed);
    }
    await assertTools();
    sourceAfter = await readSiteSourceTreeV1(project);
    assertPlannedTree(sourceAfter, baseline, blueprint, completed);
    const receipt: NpSiteBuildCommandExecutionReceiptV1 = {
      schemaVersion: "np.site-build-command-execution.v1",
      scope: "private-build-copy",
      blueprintHash,
      commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
      baselineTreeDigest,
      generationContext,
      generationContextFingerprint: generationContext
        ? fingerprintSiteBuildGenerationContextV1(generationContext)
        : null,
      ...(nextDerivation
        ? {
            nextDerivation: {
              schemaVersion: nextDerivation.schemaVersion,
              scope: nextDerivation.scope,
              sourceBeforeDigest: nextDerivation.sourceBefore.digest,
              sourceAfterDigest: nextDerivation.sourceAfter.digest,
              buildId: nextDerivation.buildId,
              previewConfig: nextDerivation.previewConfig,
              nextPreviewRuntime: nextDerivation.nextPreviewRuntime,
              deterministicNext: nextDerivation.deterministicNext,
              runtimeCache: nextDerivation.runtimeCache,
              artifactManifestSha256: nextDerivation.artifactManifestSha256,
            },
          }
        : {}),
      sourceBefore,
      sourceAfter,
      tools: [...tools.values()]
        .map((tool) => tool.descriptor)
        .sort((a, b) =>
          Buffer.compare(
            Buffer.from(`${a.package}/${a.path}`),
            Buffer.from(`${b.package}/${b.path}`),
          ),
        ),
      auditPath,
      drivers: observedDrivers,
      commands,
    };
    await writeFile(join(project, auditPath, "receipt.json"), `${JSON.stringify(receipt)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return receipt;
  } catch (error) {
    const reason = error instanceof SiteBuildError ? error.reason : "input";
    if (auditPath && ownedProject) {
      try {
        if (!(await lstat(join(ownedProject, auditPath))).isDirectory()) auditPath = null;
      } catch {
        auditPath = null;
      }
    }
    if (auditPath && ownedProject) {
      try {
        await writeFile(
          join(ownedProject, auditPath, "failure.json"),
          JSON.stringify({
            commandId,
            reason,
            startedAt: new Date(started).toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
          }),
          { flag: "wx", mode: 0o600 },
        );
      } catch {
        /* Retain the execution failure; the private copy must be discarded. */
      }
    }
    throw new NpSiteBuildCommandExecutionErrorV1(reason, commandId, auditPath);
  }
}
