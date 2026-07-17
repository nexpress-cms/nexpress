#!/usr/bin/env node
/**
 * Rewrites a scaffolded project's package.json so every @nexpress/*
 * (and `create-nexpress`) dep points at a locally-packed `.tgz`
 * tarball under `file:`. Used by the `scaffold-smoke` CI job to
 * exercise the just-built CLI + packages against a real `pnpm
 * install` — without coupling the smoke job to the monorepo's
 * workspace or to npm registry availability.
 *
 *   node .github/scripts/link-scaffold-tarballs.mjs \
 *     <scaffold-dir> \
 *     <tarball-dir>
 *
 * `<scaffold-dir>` is the project root the CLI just created.
 * `<tarball-dir>` is where every `@nexpress/*` package's
 * `pnpm pack --pack-destination …` deposited its `.tgz`.
 *
 * Two-step rewrite:
 *
 *   1. Top-level `dependencies` + `devDependencies` — replaces
 *      `workspace:*` (or `"latest"`) with `file:<abs-path-to-tgz>`.
 *      Required to get the direct deps installed.
 *
 *   2. `pnpm.overrides` — adds the same `file:` redirect for every
 *      packed package. When `@nexpress/app`'s tarball declares
 *      `"@nexpress/core": "0.1.3"` (the workspace:* → version pin
 *      that `pnpm pack` performs), pnpm would chase npm registry
 *      for that version. The override forces it to the local
 *      tarball instead. Without this transitive resolution fails
 *      on a fresh install because none of these packages are
 *      published to npm yet.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , scaffoldDir, tarballDir] = process.argv;
if (!scaffoldDir || !tarballDir) {
  console.error("Usage: link-scaffold-tarballs.mjs <scaffold-dir> <tarball-dir>");
  process.exit(2);
}

const files = readdirSync(tarballDir).filter((f) => f.endsWith(".tgz"));
if (files.length === 0) {
  throw new Error(`No .tgz tarballs found in ${tarballDir}`);
}

const pkgPath = resolve(scaffoldDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

function tarballFor(npmName) {
  // `@nexpress/core`   → `nexpress-core-X.Y.Z.tgz`
  // `create-nexpress`  → `create-nexpress-X.Y.Z.tgz`
  const base = npmName.startsWith("@") ? npmName.slice(1).replace("/", "-") : npmName;
  const found = files.find((f) => f.startsWith(base + "-") && f.endsWith(".tgz"));
  if (!found) {
    throw new Error(`No tarball for ${npmName} in ${tarballDir}. Have: ${files.join(", ")}`);
  }
  return "file:" + resolve(tarballDir, found);
}

function rewriteBlock(block) {
  if (!pkg[block]) return 0;
  let n = 0;
  for (const name of Object.keys(pkg[block])) {
    if (name.startsWith("@nexpress/") || name === "create-nexpress") {
      pkg[block][name] = tarballFor(name);
      n++;
    }
  }
  return n;
}

const direct = rewriteBlock("dependencies") + rewriteBlock("devDependencies");

// Map every packed tarball back to its npm name and pin via overrides.
// We can't trust the scaffold's package.json to enumerate every package
// that'll appear transitively (@nexpress/app pulls themes that pull
// core), so the canonical list is whatever the pack step produced.
pkg.pnpm ??= {};
pkg.pnpm.overrides ??= {};
for (const f of files) {
  const m = f.match(/^(nexpress-[a-z-]+|create-nexpress)-\d/);
  if (!m) continue;
  const npmName = m[1] === "create-nexpress" ? "create-nexpress" : "@" + m[1].replace(/-/, "/");
  pkg.pnpm.overrides[npmName] = "file:" + resolve(tarballDir, f);
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(
  `✓ linked ${direct} direct + ${Object.keys(pkg.pnpm.overrides).length} override deps → ${tarballDir}`,
);
