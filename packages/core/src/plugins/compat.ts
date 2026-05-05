/**
 * Plugin compatibility checks: framework semver range + inter-plugin
 * dependency ordering.
 *
 * The plugin manifest declares two compatibility hints:
 *   1. `nexpress.minVersion` / `nexpress.maxVersion` — the plugin must run
 *      against a framework version inside this range. The host enforces it
 *      at load time so an outdated plugin can't crash deeper in the call
 *      stack with an unrelated `TypeError`.
 *   2. `requires` — other plugins this one depends on. Used to sort the
 *      load order so a plugin's `setup()` can assume its prerequisites
 *      have already registered hooks/actions.
 *
 * Both checks fail open by default — an incompatible plugin or one with
 * missing deps is logged and skipped, never thrown. Operators see the warn
 * lines in boot logs and decide whether to upgrade or pin a version.
 */

/**
 * Framework version reported to plugin compatibility checks. Kept in sync
 * with `@nexpress/core`'s `package.json`'s `version` by `version.test.ts`,
 * which fails CI if the two drift. We don't import package.json directly
 * because it sits outside the package's `rootDir` and would force a
 * tsconfig-wide change for one constant.
 */
const FRAMEWORK_VERSION_FROM_PACKAGE = "0.1.0";
let frameworkVersion: string = FRAMEWORK_VERSION_FROM_PACKAGE;

/**
 * Returns the running framework version, read from `@nexpress/core`'s
 * package.json at build time and inlined by tsup. Tests can override via
 * `setFrameworkVersionForTest()`.
 */
export function getFrameworkVersion(): string {
  return frameworkVersion;
}

export function setFrameworkVersionForTest(version: string): void {
  frameworkVersion = version;
}

export function resetFrameworkVersion(): void {
  frameworkVersion = FRAMEWORK_VERSION_FROM_PACKAGE;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** `null` for a release version, otherwise the prerelease identifier. */
  prerelease: string | null;
}

/**
 * Parses a semver string per the regex enforced by the manifest schema:
 *   `\d+\.\d+\.\d+(-prerelease)?(+build)?`.
 *
 * Build metadata is ignored for ordering (per semver §10). Prerelease is
 * compared lexicographically, which is enough for the major.minor.patch[-tag]
 * shapes plugins typically use; this is not a full semver implementation.
 */
function parse(version: string): ParsedSemver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/.exec(version);
  if (!match) return null;
  const [, majorStr, minorStr, patchStr, prerelease] = match;
  return {
    major: Number.parseInt(majorStr ?? "0", 10),
    minor: Number.parseInt(minorStr ?? "0", 10),
    patch: Number.parseInt(patchStr ?? "0", 10),
    prerelease: prerelease ?? null,
  };
}

/** Returns -1 / 0 / 1 — same contract as `Array.prototype.sort` callbacks. */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    // Malformed input — fall back to lexicographic so we still produce a
    // total order. Manifest validation should catch this before us.
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  // 1.0.0-alpha < 1.0.0 (semver §11.3 — a release is greater than its
  // prerelease counterpart).
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

export interface NexpressCompatResult {
  compatible: boolean;
  reason?: string;
}

/**
 * Verifies that `frameworkVersion` falls inside `[minVersion, maxVersion]`
 * (inclusive). `maxVersion` is optional — a plugin that omits it claims to
 * support every later version of the framework.
 */
export function checkNexpressCompat(
  manifest: { nexpress?: { minVersion?: string; maxVersion?: string } },
  framework: string = getFrameworkVersion(),
): NexpressCompatResult {
  const min = manifest.nexpress?.minVersion;
  if (!min) {
    // Manifest is missing the field — should have been caught by the zod
    // schema, but be lenient at runtime.
    return { compatible: true };
  }
  if (compareSemver(framework, min) < 0) {
    return {
      compatible: false,
      reason: `requires NexPress >= ${min}, host is ${framework}`,
    };
  }
  const max = manifest.nexpress?.maxVersion;
  if (max && compareSemver(framework, max) > 0) {
    return {
      compatible: false,
      reason: `requires NexPress <= ${max}, host is ${framework}`,
    };
  }
  return { compatible: true };
}

export interface SortedPlugins<T> {
  /** Plugins in load order — every plugin's `requires` appear before it. */
  ordered: T[];
  /** Plugins skipped because of a missing or cyclic dependency. */
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Sorts plugins so each one's declared `requires` are loaded first. Missing
 * deps and cycles produce a `skipped` entry with a human-readable reason
 * instead of throwing — boot logs will surface the issue to the operator.
 *
 * Algorithm: Kahn's. Stable for plugins with no incoming edges (preserves
 * the input order for a tie), so users still get a deterministic sort when
 * `requires` is empty for everyone.
 */
export function topoSort<T extends { id: string; requires: readonly string[] }>(
  plugins: T[],
): SortedPlugins<T> {
  const known = new Set(plugins.map((p) => p.id));
  const skipped: Array<{ id: string; reason: string }> = [];

  // Filter out plugins whose deps aren't even installed — they can't load
  // and including them would block their dependents indefinitely.
  const eligible: T[] = [];
  for (const plugin of plugins) {
    const missing = plugin.requires.filter((dep) => !known.has(dep));
    if (missing.length > 0) {
      skipped.push({
        id: plugin.id,
        reason: `missing required plugin(s): ${missing.join(", ")}`,
      });
      continue;
    }
    eligible.push(plugin);
  }

  const eligibleIds = new Set(eligible.map((p) => p.id));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const plugin of eligible) {
    indegree.set(plugin.id, 0);
    dependents.set(plugin.id, []);
  }
  for (const plugin of eligible) {
    for (const dep of plugin.requires) {
      if (!eligibleIds.has(dep)) continue;
      indegree.set(plugin.id, (indegree.get(plugin.id) ?? 0) + 1);
      dependents.get(dep)!.push(plugin.id);
    }
  }

  // Process in input order so the output stays stable for sibling plugins.
  const queue: T[] = eligible.filter((p) => (indegree.get(p.id) ?? 0) === 0);
  const ordered: T[] = [];
  const byId = new Map(eligible.map((p) => [p.id, p] as const));

  while (queue.length > 0) {
    const next = queue.shift()!;
    ordered.push(next);
    for (const dependent of dependents.get(next.id) ?? []) {
      const updated = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, updated);
      if (updated === 0) {
        const plugin = byId.get(dependent);
        if (plugin) queue.push(plugin);
      }
    }
  }

  if (ordered.length !== eligible.length) {
    for (const plugin of eligible) {
      if (!ordered.includes(plugin)) {
        skipped.push({
          id: plugin.id,
          reason: "dependency cycle — refusing to load",
        });
      }
    }
  }

  return { ordered, skipped };
}
