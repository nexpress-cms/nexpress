import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildContractLimitsV1,
  npBuildDirectionLimitsV1,
  npParseAgentDesignDirectionSetV1,
  npParseAgentSiteBlueprintV1,
  npParseAgentSiteBriefV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { observeSiteBuildRenderContextV1 } from "./render-context.js";
import { siteBuildDraftFromSealedDirectionsV1 } from "./direction-render.js";
import { runSiteBuildLinuxSandboxV1 } from "./linux-sandbox.js";
import { createSiteBuildRepositorySeedFilesV1 } from "./repository-seed.js";

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const maximumOutput = 8 * 1024 * 1024;
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
const fail = (reason: SiteBuildError["reason"] = "conflict"): never => {
  throw new SiteBuildError(reason);
};

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
 * Installed fixed-source extraction only. Actual native configured-App execution
 * supplies seed bytes; JSON descriptors and the output envelope grant no authority.
 * Inputs may be a provisional blueprint without seed file-plan rows or commands.
 * Normal plan/generate own exact staging/CAS, fresh comparisons and execution.
 */
export async function runSiteBuildSeedSourceV1(values: Map<string, string>, cwd: string) {
  const args = requireFlags(new Map(values));
  const project = await realpath(cwd),
    files = await SiteArtifactFiles.at(project);
  // Use the existing bounded no-follow artifact reader also for output preflight.
  // Missing is allowed; aliases, links and non-regular existing files are not.
  try {
    await files.read(args.out, maximumOutput);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const leases: Array<() => Promise<void>> = [];
  const read = async (path: string, limit: number) => {
    // The artifact reader first validates the portable path and observes stable
    // no-follow FD bytes. Retain parent/leaf identities across the native call.
    const bytes = await files.read(path, limit);
    const parents: Array<{ path: string; identity: BigIntStats }> = [];
    let parent = project;
    for (const segment of ["", ...path.split("/").slice(0, -1)]) {
      if (segment) parent = join(parent, segment);
      const identity = await lstat(parent, { bigint: true });
      if (!identity.isDirectory() || identity.isSymbolicLink()) fail("path");
      parents.push({ path: parent, identity });
    }
    const identity = await lstat(join(project, path), { bigint: true });
    if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1n) fail("path");
    const check = async () => {
      for (const directory of parents)
        if (!sameDirectory(directory.identity, await lstat(directory.path, { bigint: true })))
          fail();
      if (
        !same(identity, await lstat(join(project, path), { bigint: true })) ||
        !Buffer.from(await files.read(path, limit)).equals(bytes)
      )
        fail();
      for (const directory of parents)
        if (!sameDirectory(directory.identity, await lstat(directory.path, { bigint: true })))
          fail();
    };
    await check();
    leases.push(check);
    return bytes;
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
  if (
    blueprint.commands.some(
      (command) =>
        command.template === "preview-render" &&
        [
          ...command.artifacts.map((artifact) => artifact.path),
          command.verificationResultPath,
        ].some((path) => path.toLowerCase() === args.out.toLowerCase()),
    )
  )
    fail("path");
  const assertInputs = async () => {
    for (const lease of leases) await lease();
  };
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
  if (blueprint.commandRegistryFingerprint !== rendering.commandRegistryFingerprint) fail();
  const assertLive = async () => {
    await assertInputs();
    await rendering.context.capsule.assertOriginalUnchanged();
  };
  await assertLive();
  const result = await runSiteBuildLinuxSandboxV1({
    image: rendering.context.image,
    project: rendering.context.capsule.project,
    inputBytes: Buffer.from(
      JSON.stringify({
        mode: "blueprint",
        config: configPath,
        renderer: rendering.context.capsule.renderer,
        clockNow: rendering.observed.clock.now,
        randomSeed: rendering.observed.clock.randomSeed,
        brief,
        directions,
        blueprint,
      }),
    ),
    artifacts: [
      { name: "blueprint.json", maxBytes: npBuildContractLimitsV1.blueprint.bytes },
      { name: "repository-seed.json", maxBytes: npBuildContractLimitsV1.blueprint.bytes },
    ],
  });
  await assertLive();
  if (result.audit.status !== "passed") fail("unavailable");
  const returned = result.artifacts.get("blueprint.json"),
    expected = npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint).canonicalJsonUtf8;
  if (
    !returned ||
    !Buffer.from(
      npBuildCanonicalBytes(
        "np.build-site-blueprint.v1",
        npParseAgentSiteBlueprintV1(decode(returned)),
      ).canonicalJsonUtf8,
    ).equals(expected)
  )
    fail();
  const seedArtifactBytes = result.artifacts.get("repository-seed.json") ?? fail("unavailable");
  // No require...SeedFiles call here: obtaining the exact owner bytes precedes
  // staging them into the reviewed blueprint file plan.
  const generated = await createSiteBuildRepositorySeedFilesV1({ configPath, seedArtifactBytes });
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const envelope = {
    schemaVersion: "np.site-build-seed-source.v1",
    scope: "installed-seed-source-only",
    blueprintHash,
    configPath,
    executable: false,
    sourceWrites: 0,
    files: generated.files.map((file) => ({
      path: file.path,
      suggestedStagedArtifactPath:
        file.path === "site-build.seed.json"
          ? ".nexpress/site/files/seed/site-build.seed.json"
          : ".nexpress/site/files/seed/seed-content.ts",
      mode: "100644",
      contentHash: file.contentHash,
      bytes: file.bytes.length,
      encoding: "base64url",
      base64url: Buffer.from(file.bytes).toString("base64url"),
    })),
  };
  const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  if (bytes.length > maximumOutput) fail("input");
  await assertLive();
  const status = await files.write(args.out, bytes);
  await assertLive();
  if (!Buffer.from(await files.read(args.out, maximumOutput)).equals(bytes)) fail();
  return {
    schemaVersion: "np.site-build-cli-result.v1",
    operation: "seed source",
    scope: envelope.scope,
    status,
    path: args.out,
    blueprintHash,
    executable: false,
    sourceWrites: 0,
    files: envelope.files.map(({ base64url: _bytes, ...file }) => file),
  };
}
