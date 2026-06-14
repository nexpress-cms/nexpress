#!/usr/bin/env tsx
import { diffSnapshot, formatSnapshotDiff, hasSnapshotDiff } from "../src/snapshot-sync.js";

const diff = diffSnapshot();
if (hasSnapshotDiff(diff)) {
  console.error(formatSnapshotDiff(diff));
  process.exit(1);
}

console.log("✓ scaffold snapshot is in sync with apps/web/src");
