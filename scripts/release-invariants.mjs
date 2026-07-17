import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FAMILY_PREFIX = "@nexpress/";

/** @typedef {{ name?: string, private?: boolean, path?: string }} WorkspaceManifest */
/** @typedef {{ fixed?: unknown }} ChangesetConfig */

/**
 * @param {Iterable<string>} values
 * @returns {string[]}
 */
function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * @param {WorkspaceManifest[]} workspaces
 * @param {ChangesetConfig} changesetConfig
 */
export function analyzeFixedFamily(workspaces, changesetConfig) {
  const errors = [];
  const publicFamily = new Set(
    workspaces.flatMap((workspace) =>
      workspace.private !== true &&
      typeof workspace.name === "string" &&
      workspace.name.startsWith(FAMILY_PREFIX)
        ? [workspace.name]
        : [],
    ),
  );
  /** @type {unknown[]} */
  const fixedGroups = Array.isArray(changesetConfig.fixed) ? changesetConfig.fixed : [];
  const familyGroups = fixedGroups.filter(
    (group) =>
      Array.isArray(group) &&
      group.some((name) => typeof name === "string" && name.startsWith(FAMILY_PREFIX)),
  );

  if (familyGroups.length !== 1) {
    errors.push(
      `Expected exactly one fixed group for ${FAMILY_PREFIX} packages; found ${familyGroups.length}.`,
    );
    return { errors, publicFamily: sorted(publicFamily), fixedFamily: [] };
  }

  const fixedFamilyValues = /** @type {unknown[]} */ (familyGroups[0]);
  const fixedFamilyList = fixedFamilyValues.filter((name) => typeof name === "string");
  if (fixedFamilyList.length !== fixedFamilyValues.length) {
    errors.push("Every fixed @nexpress/* family entry must be a package-name string.");
  }
  const fixedFamily = new Set(fixedFamilyList);
  const duplicates = fixedFamilyList.filter(
    (name, index) => fixedFamilyList.indexOf(name) !== index,
  );
  const missing = sorted([...publicFamily].filter((name) => !fixedFamily.has(name)));
  const extra = sorted([...fixedFamily].filter((name) => !publicFamily.has(name)));

  if (duplicates.length > 0) {
    errors.push(`Duplicate fixed-family entries: ${sorted(new Set(duplicates)).join(", ")}.`);
  }
  if (missing.length > 0) {
    errors.push(
      `Publishable ${FAMILY_PREFIX} packages missing from the fixed group: ${missing.join(", ")}.`,
    );
  }
  if (extra.length > 0) {
    errors.push(
      `Fixed-family entries that are not publishable workspace packages: ${extra.join(", ")}.`,
    );
  }

  const canonicalOrder = sorted(fixedFamilyList);
  if (JSON.stringify(fixedFamilyList) !== JSON.stringify(canonicalOrder)) {
    errors.push("The fixed @nexpress/* family must remain alphabetically sorted.");
  }

  return {
    errors,
    publicFamily: sorted(publicFamily),
    fixedFamily: sorted(fixedFamily),
  };
}

/**
 * @param {string} repoRoot
 * @returns {WorkspaceManifest[]}
 */
export function readWorkspaceManifests(repoRoot) {
  /** @type {Array<{ path: string }>} */
  const rows = JSON.parse(
    execFileSync("pnpm", ["m", "ls", "--json", "--depth=-1"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );

  return rows.map((row) => {
    const manifest = JSON.parse(readFileSync(resolve(row.path, "package.json"), "utf8"));
    return {
      name: manifest.name,
      private: manifest.private,
      path: row.path,
    };
  });
}

/** @param {string} repoRoot */
export function checkReleaseInvariants(repoRoot) {
  /** @type {ChangesetConfig} */
  const config = JSON.parse(readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"));
  return analyzeFixedFamily(readWorkspaceManifests(repoRoot), config);
}

function main() {
  const repoRoot = resolve(import.meta.dirname, "..");
  const result = checkReleaseInvariants(repoRoot);
  if (result.errors.length > 0) {
    console.error("Release invariant check failed:");
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Release invariants passed: ${result.publicFamily.length} publishable @nexpress/* packages share one fixed group.`,
  );
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) main();
