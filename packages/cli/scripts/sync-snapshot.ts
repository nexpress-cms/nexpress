#!/usr/bin/env tsx
/**
 * Resyncs `templates/snapshot/` from `apps/web/src/{app,lib,i18n.config.ts,proxy.ts}`.
 *
 * Why this exists: after #702–#704 the scaffold's runtime code
 * (admin pages, site pages, API routes, shared lib/) is no longer
 * authored as string templates — it's frozen byte-for-byte copies
 * of apps/web that get mirrored into a freshly scaffolded project
 * so `npx create-nexpress` and `apps/web/pnpm dev` produce
 * identical UIs through @nexpress/app's subpath exports.
 *
 * Run this whenever apps/web's wrappers or shared lib/ change.
 * Commit the resulting snapshot diff in the same PR.
 *
 *   pnpm --filter create-nexpress run sync-snapshot
 */

import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  rewriteScaffoldGlobalsCss,
  type GlobalsCssRewrite,
} from "../src/snapshot-rewrites.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const webRoot = join(repoRoot, "apps/web/src");
const snapRoot = join(repoRoot, "packages/cli/templates/snapshot/src");

function assertExists(path: string): void {
  try {
    statSync(path);
  } catch {
    throw new Error(`Expected ${path} to exist — wrong cwd?`);
  }
}

assertExists(webRoot);
assertExists(join(webRoot, "app"));
assertExists(join(webRoot, "lib"));

rmSync(snapRoot, { recursive: true, force: true });
mkdirSync(snapRoot, { recursive: true });

// `cpSync` recursive copies preserve subdirectory structure.
cpSync(join(webRoot, "app"), join(snapRoot, "app"), { recursive: true });
cpSync(join(webRoot, "lib"), join(snapRoot, "lib"), { recursive: true });
cpSync(join(webRoot, "i18n.config.ts"), join(snapRoot, "i18n.config.ts"));
cpSync(join(webRoot, "proxy.ts"), join(snapRoot, "proxy.ts"));

// Path rewrites that apply to the scaffold context but not to
// apps/web. globals.css's `@source` lines in apps/web reach into
// `../../../../packages/{admin,blocks,editor}/src` via the
// monorepo's relative layout; a scaffolded project has no
// `packages/` sibling, so we point Tailwind v4's content scanner
// at the installed packages' `dist/` under node_modules instead.
// Without this rewrite the scaffolded admin renders unstyled.
const globalsCssPath = join(snapRoot, "app", "globals.css");
const before = readFileSync(globalsCssPath, "utf8");
const after = rewriteScaffoldGlobalsCss(before);
const rewrite: GlobalsCssRewrite = { before, after };
if (rewrite.before === rewrite.after) {
  throw new Error(
    "sync-snapshot: globals.css @source rewrite produced no change. " +
      "Either the rewrite regex no longer matches apps/web's source paths " +
      "(check snapshot-rewrites.ts), or apps/web's globals.css already uses " +
      "node_modules paths (in which case this safety check is the one to remove).",
  );
}
writeFileSync(globalsCssPath, after);

console.log("✓ snapshot resynced from apps/web/src");
console.log(`  source:  ${webRoot}`);
console.log(`  target:  ${snapRoot}`);
console.log(`  rewrote: globals.css @source paths → node_modules form`);
console.log("");
console.log("Review the diff and commit alongside the apps/web change.");
