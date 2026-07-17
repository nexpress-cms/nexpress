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
 *   1. Read current `@nexpress/core` + `create-nexpress` versions from
 *      their `package.json`.
 *   2. Look at the previous "chore(release): version packages" commit
 *      and read its package.json versions. Compare:
 *        - `core` bumped vs previous → this is a family release.
 *          Tag `v<core>` (covers the whole fixed group; cli's version
 *          is recoverable from `packages/cli/package.json` at the
 *          tagged commit if needed). Skip cli tag — that's the
 *          fanout we collapsed.
 *        - else `cli` bumped vs previous → cli-only release. Tag
 *          `create-nexpress@<cli>`.
 *        - else → no version changes (shouldn't happen during release,
 *          but defensive). Silent no-op.
 *   3. If a tag already exists on origin (recovery / re-run), skip.
 *
 * The previous version of this script chose between family and
 * cli-only by checking "does v<core> exist on origin?" — that bit us
 * when v<core> had been manually created out of band (e.g. recovery
 * after a failed CI run). The git-history compare is unambiguous:
 * it's "what changed in this Version PR" rather than "what tags
 * happen to be on origin".
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

function readPackageJsonAt(ref: string, path: string): PackageJson | null {
  try {
    const out = execSync(`git show ${ref}:${path}`, { encoding: "utf-8" });
    return JSON.parse(out) as PackageJson;
  } catch {
    return null;
  }
}

function tagExists(name: string): boolean {
  // `git ls-remote` is authoritative (vs. local-only `git tag -l`),
  // so a half-pushed prior run can't trick us into re-creating a
  // tag the remote already has.
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

function previousReleaseSha(): string | null {
  // Walk back from HEAD looking for the second `chore(release): version
  // packages` commit (the first one IS HEAD when the release workflow
  // runs immediately after the Version PR merge). For the very first
  // release ever, there's nothing earlier — return null and treat as
  // a family release.
  try {
    const out = execSync(`git log --grep="^chore(release): version packages" --format="%H" -n 2`, {
      encoding: "utf-8",
    }).trim();
    const lines = out.split("\n").filter(Boolean);
    return lines[1] ?? null;
  } catch {
    return null;
  }
}

const core = readPackageJson("packages/core/package.json");
const cli = readPackageJson("packages/cli/package.json");

const familyTag = `v${core.version}`;
const cliTag = `${cli.name}@${cli.version}`;

const prevSha = previousReleaseSha();
const prevCore = prevSha ? readPackageJsonAt(prevSha, "packages/core/package.json") : null;
const prevCli = prevSha ? readPackageJsonAt(prevSha, "packages/cli/package.json") : null;

const coreBumped = !prevCore || prevCore.version !== core.version;
const cliBumped = !prevCli || prevCli.version !== cli.version;

if (coreBumped) {
  if (tagExists(familyTag)) {
    console.log(`[tag-release] ${familyTag} already on origin; skipping.`);
  } else {
    createAndPushTag(familyTag, `Release ${familyTag}`);
  }
} else if (cliBumped) {
  if (tagExists(cliTag)) {
    console.log(`[tag-release] ${cliTag} already on origin; skipping.`);
  } else {
    createAndPushTag(cliTag, `${cli.name} ${cli.version}`);
  }
} else {
  console.log(
    `[tag-release] no version change vs ${prevSha?.slice(0, 8) ?? "(initial)"}; nothing to tag.`,
  );
}
