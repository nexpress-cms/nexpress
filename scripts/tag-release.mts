/**
 * Tag the current release with a single git tag instead of the
 * per-package tag fanout that `changeset publish` emits by default.
 *
 * Called from `pnpm run release` AFTER `changeset publish --no-git-tag`,
 * so by the time this runs:
 *   - npm publish has already happened for everything in the release;
 *   - `packages/<*>/package.json` carries the just-published version
 *     of each package;
 *   - no per-package tags exist yet for the freshly-published versions.
 *
 * Logic — collapses the fixed-group fanout into one tag:
 *   1. If `v<@nexpress/core's current version>` doesn't yet exist on
 *      origin → this is a fresh @nexpress/* family release. Create
 *      that tag (annotated) and push. The family tag is the "release
 *      identity" for the fixed group; an operator looking at
 *      `git tag -l` sees the release cadence at a glance instead of
 *      ~30 redundant entries.
 *   2. Else, if `create-nexpress@<cli version>` doesn't exist →
 *      this is a CLI-only release (the family tag was already
 *      created on a previous run; only `create-nexpress` bumped
 *      this time). Create + push that single tag.
 *   3. Else → both tags already exist; nothing to do (idempotent).
 *
 * The script is intentionally minimal: it does not try to detect
 * partial-publish states, retroactively name old releases, or
 * handle tags for packages OUTSIDE the fixed group + create-nexpress
 * (no such packages exist today; if one is added, extend the script
 * for it explicitly rather than auto-tagging the wrong thing).
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface PackageJson {
  name: string;
  version: string;
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
}

function tagExists(name: string): boolean {
  // `git ls-remote` is authoritative (vs. local-only `git tag -l`),
  // so a half-pushed prior run can't re-create a tag the remote
  // already has.
  const out = execSync(`git ls-remote --tags origin "refs/tags/${name}"`, {
    encoding: "utf-8",
  }).trim();
  return out.length > 0;
}

function createAndPushTag(name: string, message: string): void {
  console.log(`[tag-release] creating ${name}`);
  execSync(`git tag -a "${name}" -m "${message}"`, { stdio: "inherit" });
  execSync(`git push origin "${name}"`, { stdio: "inherit" });
}

const core = readPackageJson("packages/core/package.json");
const cli = readPackageJson("packages/cli/package.json");

const familyTag = `v${core.version}`;
const cliTag = `${cli.name}@${cli.version}`;

if (!tagExists(familyTag)) {
  createAndPushTag(familyTag, `Release ${familyTag}`);
} else if (!tagExists(cliTag)) {
  createAndPushTag(cliTag, `${cli.name} ${cli.version}`);
} else {
  console.log(
    `[tag-release] ${familyTag} and ${cliTag} both already on origin; nothing to tag.`,
  );
}
