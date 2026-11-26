import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildContractLimitsV1,
  npBuildDirectionLimitsV1,
  npBuildFileDigest,
  npParseAgentDesignDirectionSetV1,
  npParseAgentSiteBlueprintV1,
  npParseAgentSiteBriefV1,
  npParseBuildJsonV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  type NpAgentBlueprintCommand,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { observeSiteBuildRenderContextV1 } from "./render-context.js";
import { siteBuildDraftFromSealedDirectionsV1 } from "./direction-render.js";
import { runSiteBuildLinuxSandboxV1, SiteBuildLinuxSandboxFailureV1 } from "./linux-sandbox.js";
import { prepareSiteBuildRepositoryEditPlanV1 } from "./repository-edit-plan.js";
import { observeSiteBuildDirtyPathsV1 } from "./repository-status.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { materializeSiteBuildCandidateDependenciesV1 } from "./candidate-dependencies.js";
import {
  withSiteBuildLinuxWorkspaceV1,
  type NpSiteBuildLinuxWorkspaceCommandV1,
} from "./linux-workspace.js";
import {
  requireSiteBuildGenerationContextV1,
  fingerprintSiteBuildGenerationContextV1,
} from "./generation-context.js";
import { createSiteBuildCodegenDriverV1 } from "./codegen-driver.js";
import { observeSiteBuildGeneratorAuditFileV1 } from "./generator-evidence.js";
import { publishSiteBuildGeneratorAuditV1 } from "./render-artifacts.js";

const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason: SiteBuildError["reason"] = "conflict"): never => {
  throw new SiteBuildError(reason);
};
const maximumRaw = 4 * 1024 * 1024,
  maximumOutput = 8 * 1024 * 1024;
const schemaPaths = new Set(["src/db/generated/collections.ts", "src/db/generated/documents.ts"]);
const migrationPath = (path: string) =>
  /^drizzle\/(?:[0-9]{4}_[A-Za-z0-9_-]+\.sql|meta\/(?:_journal|[0-9]{4}_snapshot)\.json)$/u.test(
    path,
  );
type Command = Extract<
  NpAgentBlueprintCommand,
  { template: "schema-generate" | "migration-generate" }
>;
type Stage =
  | "input"
  | "baseline"
  | "private-copy"
  | "dependencies"
  | "commands"
  | "retention"
  | "output"
  | "cleanup";

export class NpSiteBuildCodegenSourceFailureV1 extends SiteBuildError {
  readonly scope = "installed-codegen-source-only";
  readonly sourceWrites = 0;
  constructor(
    reason: SiteBuildError["reason"],
    readonly stage: Stage,
    readonly retention: "not-started" | "retained" | "retention-failed",
    readonly privateCopy: "not-created" | "removed" | "cleanup-failed",
    readonly retainedPaths: readonly string[],
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
const sameDirectory = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;

/** Internal bounded reader only. Every path is selected by an owning closed input,
 * source manifest or fixed tool slot, never a directory-discovery/execution grant. */
async function observe(root: string, path: string, limit: number) {
  if (
    !constants.O_NOFOLLOW ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          Array.from(part).some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ),
      )
  )
    fail("path");
  const directories: Array<{ path: string; identity: BigIntStats }> = [];
  let parent = root;
  for (const part of ["", ...path.split("/").slice(0, -1)]) {
    if (part) parent = join(parent, part);
    const identity = await lstat(parent, { bigint: true });
    if (!identity.isDirectory() || identity.isSymbolicLink()) fail("path");
    directories.push({ path: parent, identity });
  }
  const absolute = join(root, path),
    file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let identity: BigIntStats, bytes: Buffer;
  const checkDirectories = async () => {
    for (const directory of directories)
      if (!sameDirectory(directory.identity, await lstat(directory.path, { bigint: true }))) fail();
  };
  try {
    identity = await file.stat({ bigint: true });
    if (
      !identity.isFile() ||
      identity.nlink !== 1n ||
      identity.size < 0n ||
      identity.size > BigInt(limit)
    )
      fail("input");
    bytes = Buffer.alloc(Number(identity.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!read.bytesRead) fail();
      offset += read.bytesRead;
    }
    const probe = Buffer.alloc(1);
    if (
      (await file.read(probe, 0, 1, offset)).bytesRead ||
      !same(identity, await file.stat({ bigint: true })) ||
      !same(identity, await lstat(absolute, { bigint: true }))
    )
      fail();
    await checkDirectories();
  } finally {
    await file.close();
  }
  return {
    bytes,
    sha256: sha(bytes),
    assertUnchanged: async () => {
      await checkDirectories();
      const current = await observe(root, path, limit);
      if (!same(identity, await lstat(absolute, { bigint: true })) || !current.bytes.equals(bytes))
        fail();
    },
  };
}

function requireFlags(values: Map<string, string>) {
  const keys = ["--brief", "--directions", "--blueprint", "--runtime", "--out"];
  if (
    values.size !== keys.length ||
    keys.some((key) => !values.get(key)) ||
    [...values.keys()].some((key) => !keys.includes(key))
  )
    fail("arguments");
  const out = values.get("--out")!;
  if (
    !/^\.nexpress\/site\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/u.test(out) ||
    keys.slice(0, -1).some((key) => values.get(key)!.toLowerCase() === out.toLowerCase())
  )
    fail("path");
  return {
    brief: values.get("--brief")!,
    directions: values.get("--directions")!,
    blueprint: values.get("--blueprint")!,
    runtime: values.get("--runtime")!,
    out,
  };
}

/**
 * Authoring probe only: fixed schema/migration owners execute in an existing
 * closed Linux workspace over a disposable staged copy. Future command hashes
 * are observed, never predicted or accepted as verification. Other blueprint
 * commands, production migration, install, provider, Git and source publication
 * are not executed. Final plan/generate must independently verify the full plan.
 * Changed generated source is bounded to 4 MiB total; no truncation or deletion.
 */
export async function runSiteBuildCodegenSourceV1(values: Map<string, string>, cwd: string) {
  const args = requireFlags(new Map(values)),
    project = await realpath(cwd),
    files = await SiteArtifactFiles.at(project),
    runId = randomUUID();
  try {
    await files.read(args.out, maximumOutput);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const inputLeases: Array<() => Promise<void>> = [];
  const read = async (path: string, max: number) => {
    await files.read(path, max);
    const value = await observe(project, path, max);
    inputLeases.push(value.assertUnchanged);
    return value.bytes;
  };
  const brief = npRequireBuildReadyBriefV1(
    npParseAgentSiteBriefV1(decode(await read(args.brief, npBuildContractLimitsV1.brief.bytes))),
  );
  const directions = await npRequireBuildDirectionSetForBriefV1(
    brief,
    npParseAgentDesignDirectionSetV1(
      decode(await read(args.directions, npBuildDirectionLimitsV1.set.bytes)),
    ),
    "sealed",
  );
  const blueprint = await npRequireBuildBlueprintForBriefV1(
    brief,
    npParseAgentSiteBlueprintV1(
      decode(await read(args.blueprint, npBuildContractLimitsV1.blueprint.bytes)),
    ),
  );
  await read(args.runtime, 4 * 1024 * 1024);
  const commands = blueprint.commands.filter(
    (command): command is Command =>
      command.template === "schema-generate" || command.template === "migration-generate",
  );
  if (
    commands.length !== 2 ||
    commands[0].template !== "schema-generate" ||
    commands[1].template !== "migration-generate" ||
    commands.some((command) => command.timeoutSeconds > 900) ||
    blueprint.filePlan.some(
      (row) =>
        row.source === "staged" && (schemaPaths.has(row.path) || row.path.startsWith("drizzle/")),
    )
  )
    fail("unavailable");
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    original = await readSiteSourceTreeV1(project),
    dirty = await observeSiteBuildDirtyPathsV1(project);
  let expectedOriginal = original;
  let stage: Stage = "baseline",
    plan: Awaited<ReturnType<typeof prepareSiteBuildRepositoryEditPlanV1>> | undefined;
  let retention: "not-started" | "retained" | "retention-failed" = "not-started",
    privateCopy: "not-created" | "removed" | "cleanup-failed" = "not-created";
  let failure: unknown,
    caught = false,
    result: Record<string, unknown> | undefined,
    nativeAudit: unknown,
    nativeBlueprint: Uint8Array | undefined;
  const retainedPaths: string[] = [],
    toolLeases: Array<() => Promise<void>> = [],
    fixedControls: Array<{ path: string; bytes: Uint8Array }> = [];
  const commandResults: NpSiteBuildLinuxWorkspaceCommandV1[] = [],
    missingAuditPaths: string[] = [];
  const auditPath = `.nexpress/site/audit/codegen-source-${runId}`,
    prefix = `.nexpress/site/audit/generator-codegen-${runId}`;
  let envelopeBytes: Uint8Array | undefined;
  const assertInputs = async () => {
    for (const lease of inputLeases) await lease();
    if ((await readSiteSourceTreeV1(project)).digest !== expectedOriginal.digest) fail();
  };
  const retain = async (status: "passed" | "failed") => {
    const artifacts: Array<{ path: string; bytes: Uint8Array }> = [],
      records: Array<{ path: string; sha256: string; bytes: number }> = [],
      leases: Array<() => Promise<void>> = [];
    const append = (name: string, bytes: Uint8Array) => {
      const path = `${prefix}/${name}`;
      artifacts.push({ path, bytes });
      records.push({ path, sha256: sha(bytes), bytes: bytes.length });
    };
    if (nativeAudit) append("baseline-native-audit.json", encode(nativeAudit));
    if (nativeBlueprint) append("baseline-blueprint.json", nativeBlueprint);
    for (const [index, control] of fixedControls.entries())
      append(`control-${index}.source.log`, control.bytes);
    if (plan)
      for (let index = 0; index < commands.length; index++)
        for (const suffix of ["json", "stdout.log", "stderr.log", "source-after.json"]) {
          const path = `${auditPath}/command-${index}.${suffix}`;
          try {
            const file = await observeSiteBuildGeneratorAuditFileV1(
              plan.project,
              path,
              suffix.endsWith("log") ? 8 * 1024 * 1024 : 4 * 1024 * 1024,
            );
            append(`command-${index}.${suffix}`, file.bytes);
            leases.push(file.assertUnchanged);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            missingAuditPaths.push(path);
          }
        }
    if (envelopeBytes) append("observed-source.json", envelopeBytes);
    for (const lease of leases) await lease();
    const publication = await publishSiteBuildGeneratorAuditV1({
      project,
      artifacts,
      manifest: {
        path: `${prefix}/manifest.json`,
        bytes: encode({
          schemaVersion: "np.site-build-codegen-source-audit.v1",
          scope: "authoring-observation-only",
          blueprintHash,
          status,
          stage,
          sourceWrites: 0,
          commands: commandResults,
          missingAuditPaths,
          files: records,
        }),
      },
    });
    for (const lease of leases) await lease();
    retainedPaths.push(...publication.paths);
    return "retained" as const;
  };
  try {
    await assertInputs();
    const rendering = await observeSiteBuildRenderContextV1({
      cwd: project,
      files,
      runtimePath: args.runtime,
      brief,
      drafts: siteBuildDraftFromSealedDirectionsV1(directions),
    });
    const configPath =
      rendering.context.config === "src/nexpress.config.ts" ||
      rendering.context.config === "nexpress.config.ts"
        ? rendering.context.config
        : fail("unavailable");
    if (rendering.commandRegistryFingerprint !== blueprint.commandRegistryFingerprint) fail();
    const assertBaseline = async () => {
      await assertInputs();
      await rendering.context.capsule.assertOriginalUnchanged();
    };
    await assertBaseline();
    try {
      const checked = await runSiteBuildLinuxSandboxV1({
        image: rendering.context.image,
        project: rendering.context.capsule.project,
        inputBytes: encode({
          mode: "blueprint",
          config: configPath,
          renderer: rendering.context.capsule.renderer,
          clockNow: rendering.observed.clock.now,
          randomSeed: rendering.observed.clock.randomSeed,
          brief,
          directions,
          blueprint,
        }),
        artifacts: [{ name: "blueprint.json", maxBytes: npBuildContractLimitsV1.blueprint.bytes }],
      });
      nativeAudit = checked.audit;
      nativeBlueprint = checked.artifacts.get("blueprint.json");
      if (checked.audit.status !== "passed") fail("unavailable");
    } catch (error) {
      if (error instanceof SiteBuildLinuxSandboxFailureV1) nativeAudit = error.audit;
      throw error;
    }
    await assertBaseline();
    if (
      !nativeBlueprint ||
      !Buffer.from(
        npBuildCanonicalBytes(
          "np.build-site-blueprint.v1",
          npParseAgentSiteBlueprintV1(decode(nativeBlueprint)),
        ).canonicalJsonUtf8,
      ).equals(npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint).canonicalJsonUtf8)
    )
      fail();
    const generation = requireSiteBuildGenerationContextV1({
      schemaVersion: "np.site-build-generation-context.v1",
      implementation: "np.site-build-generation.v1",
      selectedDirectionHash: blueprint.selectedDirectionHash,
      comparisonInputsDigest: directions.comparisonInputsDigest,
      selectedRenderEnvironmentFingerprint: rendering.fingerprint,
      clock: rendering.observed.clock,
    });
    stage = "private-copy";
    plan = await prepareSiteBuildRepositoryEditPlanV1({
      scope: "private-build-copy",
      project,
      blueprint,
      baseline: original.manifest,
      dirtyPaths: dirty,
    });
    await plan.apply();
    const privateProject = plan.project,
      staged = await readSiteSourceTreeV1(privateProject);
    if (
      !staged.manifest.files.some((file) => file.path === configPath) ||
      !staged.manifest.files.some((file) => file.path === "drizzle.config.ts")
    )
      fail("unavailable");
    stage = "dependencies";
    const installed = await materializeSiteBuildCandidateDependenciesV1({
      scope: "private-build-copy",
      project: privateProject,
      dependencies: join(rendering.context.capsule.project, "node_modules"),
      assertPreparedUnchanged: assertBaseline,
    });
    const tools: Array<{
      package: string;
      version: string;
      path: string;
      sha256: string;
      packageJsonSha256: string;
    }> = [];
    const tool = async (name: string, entry: string) => {
      const root = await realpath(join(installed.dependencies, name)),
        path = await realpath(join(root, entry));
      if (!root.startsWith(`${installed.dependencies}/`) || !path.startsWith(`${root}/`))
        fail("path");
      const metadata = await observe(root, "package.json", 512 * 1024),
        body = npParseBuildJsonV1(decode(metadata.bytes));
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        body.name !== name ||
        typeof body.version !== "string"
      )
        throw new SiteBuildError("input");
      const executable = await observe(root, relative(root, path), 64 * 1024 * 1024);
      toolLeases.push(metadata.assertUnchanged, executable.assertUnchanged, async () => {
        if (
          (await realpath(join(installed.dependencies, name))) !== root ||
          (await realpath(join(root, entry))) !== path
        )
          fail();
      });
      tools.push({
        package: name,
        version: body.version,
        path: `node_modules/${name}/${entry}`,
        sha256: executable.sha256,
        packageJsonSha256: metadata.sha256,
      });
      return `/np/project/node_modules/${name}/${entry}`;
    };
    const loaderPath = await tool("@nexpress/cli", "dist/site-build-loader.js");
    await tool("@nexpress/app", "dist/scripts/generate-schema.js");
    await tool("@nexpress/app", "dist/scripts/generate-migrations-core.js");
    await tool("drizzle-kit", "bin.cjs");
    const controls = `.nexpress/site/tmp/codegen-source-${runId}`;
    await mkdir(join(privateProject, controls), { recursive: true, mode: 0o700 });
    await mkdir(join(privateProject, auditPath), { recursive: true, mode: 0o700 });
    const drivers = commands.map((command, index) => {
      const preloadPath = `${controls}/generation-${index}.mjs`,
        driverPath = `${controls}/command-${index}.mjs`;
      const driver = createSiteBuildCodegenDriverV1({
        context: generation,
        command: {
          id: command.id,
          template: command.template,
          name: command.template === "migration-generate" ? command.name : null,
        },
        configPath,
        preloadPath: `/np/project/${preloadPath}`,
        loaderPath,
      });
      fixedControls.push(
        { path: preloadPath, bytes: Buffer.from(driver.preload.source) },
        { path: driverPath, bytes: Buffer.from(driver.driver) },
      );
      return { preloadPath, driverPath, driver };
    });
    for (const control of fixedControls) {
      await writeFile(join(privateProject, control.path), control.bytes, {
        flag: "wx",
        mode: 0o400,
      });
      const observed = await observe(privateProject, control.path, 64 * 1024);
      toolLeases.push(observed.assertUnchanged);
    }
    const editPlan = plan;
    const assertLive = async (afterOutput = false) => {
      await assertBaseline();
      // Before publication the ordinary plan's complete inventory lease applies.
      // Afterwards only this owner's exact emitted JSON leaf may be added;
      // recheck the projected raw source and every input/package/tool lease.
      if (!afterOutput) await editPlan.assertOriginalUnchanged();
      await installed.assertUnchanged();
      for (const lease of toolLeases) await lease();
      const observedDirty = await observeSiteBuildDirtyPathsV1(project);
      if (
        JSON.stringify(
          afterOutput ? observedDirty.filter((path) => path !== args.out) : observedDirty,
        ) !== JSON.stringify(afterOutput ? dirty.filter((path) => path !== args.out) : dirty)
      )
        fail();
      await assertInputs();
    };
    await assertLive();
    stage = "commands";
    const generatedBy = new Map<string, string>();
    await withSiteBuildLinuxWorkspaceV1(
      {
        project: privateProject,
        source: staged,
        dependencies: installed.dependencies,
        baseImageId: rendering.context.image.baseImageId,
        controls: { directory: controls, files: fixedControls.map((file) => file.path) },
        auditPath,
      },
      async (workspace) => {
        for (const [index, command] of commands.entries()) {
          await assertLive();
          const before = workspace.source,
            previous = new Map(before.manifest.files.map((file) => [file.path, file])),
            driver = drivers[index];
          const permitted = (path: string) =>
            command.template === "schema-generate"
              ? schemaPaths.has(path)
              : migrationPath(path) &&
                (path === "drizzle/meta/_journal.json" || !previous.has(path));
          const observed = await workspace.run({
            id: `command-${index}`,
            argv:
              command.template === "schema-generate"
                ? [
                    "/usr/local/bin/node",
                    "--no-warnings",
                    "--import",
                    `/np/project/${driver.preloadPath}`,
                    "--loader",
                    loaderPath,
                    `/np/project/${driver.driverPath}`,
                  ]
                : [
                    "/usr/local/bin/node",
                    "--import",
                    `/np/project/${driver.preloadPath}`,
                    `/np/project/${driver.driverPath}`,
                  ],
            timeoutMs: command.timeoutSeconds * 1000,
            permitted,
            validateSource: (after, exitCode) => {
              if (exitCode !== 0) fail("input");
              for (const row of after.manifest.files) {
                const old = previous.get(row.path);
                if (old?.digest === row.digest && old.mode === row.mode) continue;
                if (!permitted(row.path) || row.mode !== "100644") fail();
                generatedBy.set(row.path, command.id);
              }
              for (const old of previous.values())
                if (!after.manifest.files.some((row) => row.path === old.path)) fail();
            },
          });
          commandResults.push(observed);
          await assertLive();
        }
      },
    );
    // Workspace removal completes before observing recovered host bytes.
    const after = await readSiteSourceTreeV1(privateProject),
      previous = new Map(staged.manifest.files.map((file) => [file.path, file])),
      generated = [];
    let total = 0;
    for (const row of after.manifest.files) {
      const old = previous.get(row.path);
      if (old?.digest === row.digest && old.mode === row.mode) continue;
      const commandId = generatedBy.get(row.path);
      if (!commandId || row.mode !== "100644") fail();
      const file = await observe(privateProject, row.path, maximumRaw);
      if ((total += file.bytes.length) > maximumRaw) fail("input");
      if ((await npBuildFileDigest("np.build-source-file.v1", file.bytes)) !== row.digest) fail();
      toolLeases.push(file.assertUnchanged);
      generated.push({
        path: row.path,
        mode: row.mode,
        action: old ? "update" : "create",
        owner: schemaPaths.has(row.path) ? "generated-schema" : "migration",
        expectedHash: old?.digest ?? null,
        contentHash: row.digest,
        generatedByCommandId: commandId,
        bytes: file.bytes.length,
        encoding: "base64url",
        base64url: file.bytes.toString("base64url"),
      });
    }
    for (const old of previous.values())
      if (!after.manifest.files.some((row) => row.path === old.path)) fail();
    if (generatedBy.size !== generated.length) fail();
    await assertLive();
    const envelope = {
      schemaVersion: "np.site-build-codegen-source.v1",
      scope: "installed-codegen-source-only",
      executable: false,
      sourceWrites: 0,
      blueprintHash,
      generationContext: generation,
      generationContextFingerprint: fingerprintSiteBuildGenerationContextV1(generation),
      baselineTreeDigest: original.digest,
      privateSourceBeforeDigest: staged.digest,
      privateSourceAfterDigest: after.digest,
      plannedGeneratedHashesValidation: "deferred-to-final-plan-and-generate",
      executedCommandIds: commands.map((command) => command.id),
      tools,
      files: generated,
    };
    envelopeBytes = encode(envelope);
    if (envelopeBytes.length > maximumOutput) fail("input");
    stage = "retention";
    retention = await retain("passed");
    await assertLive();
    stage = "output";
    const status = await files.write(args.out, envelopeBytes);
    const outputRow: (typeof original.manifest.files)[number] = {
      path: args.out,
      kind: "file",
      mode: original.manifest.files.find((file) => file.path === args.out)?.mode ?? "100644",
      digest: await npBuildFileDigest("np.build-source-file.v1", envelopeBytes),
    };
    const manifest = {
      ...original.manifest,
      files: [...original.manifest.files.filter((file) => file.path !== args.out), outputRow].sort(
        (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
      ),
    };
    expectedOriginal = {
      manifest,
      digest: await npBuildCanonicalDigest("np.build-source-tree.v1", manifest),
    };
    await assertLive(true);
    if (!Buffer.from(await files.read(args.out, maximumOutput)).equals(envelopeBytes)) fail();
    result = {
      schemaVersion: "np.site-build-cli-result.v1",
      operation: "codegen source",
      scope: envelope.scope,
      status,
      path: args.out,
      blueprintHash,
      sourceWrites: 0,
      executable: false,
      retainedPaths: [...retainedPaths],
      files: generated.map(({ base64url: _bytes, ...file }) => file),
    };
  } catch (error) {
    caught = true;
    failure = error;
    if (retention !== "retained") {
      try {
        retention = await retain("failed");
      } catch {
        retention = "retention-failed";
      }
    }
  }
  if (plan) {
    try {
      await plan.close();
      privateCopy = "removed";
    } catch {
      privateCopy = "cleanup-failed";
      caught = true;
      failure ??= new SiteBuildError("unavailable");
      stage = "cleanup";
    }
  }
  if (caught || !result)
    throw new NpSiteBuildCodegenSourceFailureV1(
      failure instanceof SiteBuildError ? failure.reason : "unavailable",
      stage,
      retention,
      privateCopy,
      retainedPaths,
    );
  return result;
}
