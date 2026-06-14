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

import { writeExpectedSnapshot } from "../src/snapshot-sync.js";

const result = writeExpectedSnapshot();
console.log("✓ snapshot resynced from apps/web/src");
console.log(`  source:  ${result.paths.webRoot}`);
console.log(`  target:  ${result.paths.snapRoot}`);
console.log(`  files:   ${result.filesWritten.toString()}`);
console.log(`  rewrote: globals.css @source paths → node_modules form`);
console.log("");
console.log("Review the diff and commit alongside the apps/web change.");
