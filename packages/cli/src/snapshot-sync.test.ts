import { describe, expect, it } from "vitest";

import {
  buildExpectedSnapshot,
  diffSnapshot,
  formatSnapshotDiff,
  hasSnapshotDiff,
} from "./snapshot-sync.js";

describe("scaffold snapshot sync", () => {
  it("keeps packages/cli/templates/snapshot byte-aligned with apps/web/src", () => {
    const diff = diffSnapshot();
    if (hasSnapshotDiff(diff)) {
      throw new Error(formatSnapshotDiff(diff));
    }
    expect(diff).toEqual({ missing: [], extra: [], changed: [] });
  });

  it("rewrites the scaffold globals.css sources for installed packages", () => {
    const expected = buildExpectedSnapshot();
    const globals = expected.files.get("app/globals.css")?.toString("utf8");
    expect(globals).toBeDefined();
    expect(globals).toContain("Scaffold variant —");
    expect(globals).toContain('@source "../../node_modules/@nexpress/admin/dist/**/*.js";');
    expect(globals).toContain('@source "../../node_modules/@nexpress/app/src/**/*.{ts,tsx}";');
    expect(globals).toContain('@source "../../node_modules/@nexpress/blocks/dist/**/*.js";');
    expect(globals).toContain('@source "../../node_modules/@nexpress/editor/dist/**/*.js";');
    expect(globals).not.toMatch(/@source "\.\.\/\.\.\/\.\.\/\.\.\/packages\//);
  });
});
