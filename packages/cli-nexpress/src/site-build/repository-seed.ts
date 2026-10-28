import { isDeepStrictEqual } from "node:util";
import {
  npBuildFileDigest,
  npParseBuildJsonV1,
  npRequireAgentBuildNavigationV1,
  npRequireAgentBuildSeedPlanV1,
  npRequireAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { isNpThemeTokensOverlay } from "@nexpress/core/theme";
import { SiteBuildError } from "./artifact-io.js";

type ConfigPath = "src/nexpress.config.ts" | "nexpress.config.ts";
type SeedPath = "site-build.seed.json" | "scripts/seed-content.ts";
export interface NpSiteBuildRepositorySeedFilesV1 {
  scope: "ordinary-repository-seed-source-only";
  files: Array<{ path: SeedPath; bytes: Uint8Array; contentHash: string }>;
}
const maximumBytes = 4 * 1024 * 1024;
const invalid = (): never => {
  throw new SiteBuildError("input");
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function parseArtifact(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maximumBytes)
    return invalid();
  const artifact = record(
    npParseBuildJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  keys(artifact, ["schemaVersion", "theme", "seed", "navigation"]);
  if (artifact.schemaVersion !== "np.site-build-seed.v1") return invalid();
  const theme = record(artifact.theme);
  keys(theme, ["id", "package", "tokens"]);
  if (
    typeof theme.id !== "string" ||
    theme.id.length > 128 ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(theme.id) ||
    typeof theme.package !== "string" ||
    theme.package.length > 200 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(theme.package) ||
    !isNpThemeTokensOverlay(theme.tokens) ||
    !Array.isArray(artifact.navigation) ||
    artifact.navigation.length > 32
  )
    return invalid();
  const navigation = artifact.navigation.map(npRequireAgentBuildNavigationV1);
  if (
    navigation.some(
      (item, index) =>
        index > 0 &&
        Buffer.compare(Buffer.from(navigation[index - 1].location), Buffer.from(item.location)) >=
          0,
    )
  )
    return invalid();
  return { theme, seed: npRequireAgentBuildSeedPlanV1(artifact.seed), navigation };
}

/** Fixed human continuation, never evaluated or executed by this source owner. */
function script(configPath: ConfigPath, artifactHash: string): string {
  const configImport =
    configPath === "src/nexpress.config.ts" ? "../src/nexpress.config.js" : "../nexpress.config.js";
  return `// Generated ordinary seed continuation. Run exclusively with pnpm seed:content.
// JSON and hashes grant no authority; normal bootstrap, ACLs and hooks remain owners.
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { NpAuthUser, NpTransaction } from "@nexpress/core";

const artifactHash = ${JSON.stringify(artifactHash)};
const maximumBytes = ${maximumBytes};
const sameFile = (a: BigIntStats, b: BigIntStats): boolean =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

async function readSeed(): Promise<Uint8Array> {
  if (!constants.O_NOFOLLOW) throw new Error("Unsupported artifact reader");
  const path = new URL("../site-build.seed.json", import.meta.url);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(maximumBytes)
    )
      throw new Error("Invalid seed artifact");
    const bytes = new Uint8Array(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (
      BigInt(length) !== before.size ||
      !sameFile(before, await file.stat({ bigint: true })) ||
      !sameFile(before, await lstat(path, { bigint: true }))
    )
      throw new Error("Changed seed artifact");
    return bytes.slice(0, length);
  } finally {
    await file.close();
  }
}

function siteFlag(argv: string[]): string {
  if (!argv.length) return "default";
  if (argv.length !== 1 || !/^--site=[a-z][a-z0-9-]{0,62}$/u.test(argv[0]))
    throw new Error("Invalid seed arguments");
  return argv[0].slice("--site=".length);
}

async function main(): Promise<void> {
  let shutdown: (() => Promise<void>) | undefined;
  let completed = false;
  try {
    const siteId = siteFlag(process.argv.slice(2));
    const bytes = await readSeed();
    const { npBuildFileDigest, npParseBuildJsonV1 } = await import("@nexpress/core/agent-contract");
    if ((await npBuildFileDigest("np.build-source-file.v1", bytes)) !== artifactHash)
      throw new Error("Changed seed artifact");
    const parsed = npParseBuildJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const { npRequireSiteBuildSeedArtifactV1, npMaterializeSiteBuildSeedV1 } =
      await import("@nexpress/app/lib/site-build-seed");
    const artifact = npRequireSiteBuildSeedArtifactV1(parsed);
    // Environment loading and project evaluation occur only after the bound artifact passes.
    await import("@nexpress/app/scripts/_load-env");
    const { default: config } = await import(${JSON.stringify(configImport)});
    const generatedSchema = await import("../src/db/generated/collections.js");
    const { observabilityAdapters } = await import("../src/lib/observability.js");
    const { createBootstrap } = await import("@nexpress/next");
    const { npGetDefaultBuildOwnerBindingsV1 } = await import("@nexpress/app/config-defaults");
    const { eq } = await import("drizzle-orm");
    const { getSiteById, npUsers, withCurrentSite, withDeferredPostCommit } =
      await import("@nexpress/core");
    const { npInvalidateCache } = await import("@nexpress/core/cache");
    const bootstrap = createBootstrap({ config, generatedSchema, ...observabilityAdapters });
    shutdown = bootstrap.shutdown;
    await bootstrap.ensureFor("write");
    if (!(await getSiteById(siteId))) throw new Error("Existing site required");
    const db = bootstrap.getDb();
    const rows = await db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      })
      .from(npUsers)
      .where(eq(npUsers.role, "admin"))
      .orderBy(npUsers.id)
      .limit(1);
    const row = rows[0];
    if (!row || row.role !== "admin") throw new Error("Existing admin required");
    const actor: NpAuthUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: "admin",
      tokenVersion: row.tokenVersion,
    };
    await withCurrentSite(siteId, async () => {
      const result = await withDeferredPostCommit(() =>
        db.transaction(async (tx) =>
          npMaterializeSiteBuildSeedV1(artifact, actor, {
            ownerBindings: npGetDefaultBuildOwnerBindingsV1(),
            status: "published",
            tx: tx as unknown as NpTransaction,
          }),
        ),
      );
      let cacheRefreshPending = false;
      for (const request of result.pendingCacheInvalidations) {
        const invalidation = await npInvalidateCache(request);
        if (invalidation.status !== "applied") cacheRefreshPending = true;
      }
      if (cacheRefreshPending)
        console.warn(
          "Site build seed cache refresh is pending. Refresh caches through the serving host before using an already-running site.",
        );
    });
    completed = true;
  } catch {
    console.error(
      "Site build seed failed. Check the reviewed artifact, existing site/admin and local configuration. Earlier committed work may need attention; rerun exclusively after resolving the cause.",
    );
    process.exitCode = 1;
  } finally {
    if (shutdown) {
      try {
        await shutdown();
      } catch {
        console.error("Site build seed shutdown failed.");
        process.exitCode = 1;
        completed = false;
      }
    }
  }
  if (completed) console.log("Site build seed data committed.");
}
await main();
`;
}

/**
 * Produces exact bytes only. The caller must separately hold actual native App
 * producer provenance. This neither authenticates that producer nor publishes,
 * performs repository CAS, loads a project, bootstraps, or executes a seed.
 */
export async function createSiteBuildRepositorySeedFilesV1(input: {
  configPath: ConfigPath;
  seedArtifactBytes: Uint8Array;
}): Promise<NpSiteBuildRepositorySeedFilesV1> {
  try {
    if (!input || !["src/nexpress.config.ts", "nexpress.config.ts"].includes(input.configPath))
      return invalid();
    if (
      !(input.seedArtifactBytes instanceof Uint8Array) ||
      !input.seedArtifactBytes.byteLength ||
      input.seedArtifactBytes.byteLength > maximumBytes
    )
      return invalid();
    const artifact = new Uint8Array(input.seedArtifactBytes);
    parseArtifact(artifact);
    const artifactHash = await npBuildFileDigest("np.build-source-file.v1", artifact);
    const scriptBytes = new TextEncoder().encode(script(input.configPath, artifactHash));
    return {
      scope: "ordinary-repository-seed-source-only",
      files: [
        { path: "site-build.seed.json", bytes: artifact, contentHash: artifactHash },
        {
          path: "scripts/seed-content.ts",
          bytes: scriptBytes,
          contentHash: await npBuildFileDigest("np.build-source-file.v1", scriptBytes),
        },
      ],
    };
  } catch {
    return invalid();
  }
}

/** Exact source expectation binding only; action/old bytes/mode and dirty-file CAS remain controller-owned. */
export async function requireSiteBuildRepositorySeedFilesV1(input: {
  blueprint: unknown;
  configPath: ConfigPath;
  seedArtifactBytes: Uint8Array;
}): Promise<NpSiteBuildRepositorySeedFilesV1> {
  try {
    const blueprint = npRequireAgentSiteBlueprintV1(input.blueprint);
    const result = await createSiteBuildRepositorySeedFilesV1(input);
    const artifact = parseArtifact(result.files[0].bytes);
    const navigation = [...blueprint.navigation].sort((a, b) =>
      Buffer.compare(Buffer.from(a.location), Buffer.from(b.location)),
    );
    if (
      artifact.theme.package !== blueprint.theme.package ||
      !isDeepStrictEqual(artifact.theme.tokens, blueprint.theme.tokens) ||
      !isDeepStrictEqual(artifact.seed, blueprint.seed) ||
      !isDeepStrictEqual(artifact.navigation, navigation)
    )
      return invalid();
    for (const file of result.files) {
      const rows = blueprint.filePlan.filter((row) => row.path === file.path);
      if (
        rows.length !== 1 ||
        rows[0].owner !== "seed" ||
        rows[0].source !== "staged" ||
        rows[0].contentHash !== file.contentHash
      )
        return invalid();
    }
    return result;
  } catch {
    return invalid();
  }
}
