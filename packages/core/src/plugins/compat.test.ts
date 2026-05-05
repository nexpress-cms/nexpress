import { afterEach, describe, expect, it } from "vitest";

import {
  checkNexpressCompat,
  compareSemver,
  resetFrameworkVersion,
  setFrameworkVersionForTest,
  topoSort,
} from "./compat.js";

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);
    expect(compareSemver("0.1.5", "0.1.4")).toBe(1);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });

  it("treats a prerelease as less than the matching release", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
  });

  it("ignores build metadata", () => {
    expect(compareSemver("1.2.3+abcd", "1.2.3+xyz")).toBe(0);
  });
});

describe("checkNexpressCompat", () => {
  afterEach(() => {
    resetFrameworkVersion();
  });

  it("accepts a manifest with no nexpress range (legacy / hand-rolled)", () => {
    expect(checkNexpressCompat({}, "0.1.0").compatible).toBe(true);
  });

  it("rejects when host is below minVersion", () => {
    const result = checkNexpressCompat({ nexpress: { minVersion: "0.2.0" } }, "0.1.0");
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/>= 0\.2\.0/);
  });

  it("rejects when host is above maxVersion", () => {
    const result = checkNexpressCompat(
      { nexpress: { minVersion: "0.1.0", maxVersion: "0.5.0" } },
      "1.0.0",
    );
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/<= 0\.5\.0/);
  });

  it("accepts when host is in range", () => {
    expect(
      checkNexpressCompat(
        { nexpress: { minVersion: "0.1.0", maxVersion: "1.0.0" } },
        "0.5.3",
      ).compatible,
    ).toBe(true);
  });

  it("uses the test override when no framework arg is given", () => {
    setFrameworkVersionForTest("9.9.9");
    expect(checkNexpressCompat({ nexpress: { minVersion: "5.0.0" } }).compatible).toBe(true);
    expect(checkNexpressCompat({ nexpress: { minVersion: "10.0.0" } }).compatible).toBe(false);
  });
});

describe("topoSort", () => {
  it("preserves input order when no plugin declares requires", () => {
    const result = topoSort([
      { id: "a", requires: [] },
      { id: "b", requires: [] },
      { id: "c", requires: [] },
    ]);
    expect(result.ordered.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(result.skipped).toHaveLength(0);
  });

  it("loads dependencies before dependents", () => {
    const result = topoSort([
      { id: "blog", requires: ["forum"] },
      { id: "forum", requires: [] },
    ]);
    expect(result.ordered.map((p) => p.id)).toEqual(["forum", "blog"]);
  });

  it("skips plugins with missing dependencies and reports the reason", () => {
    const result = topoSort([
      { id: "needs-x", requires: ["x"] },
      { id: "ok", requires: [] },
    ]);
    expect(result.ordered.map((p) => p.id)).toEqual(["ok"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe("needs-x");
    expect(result.skipped[0]?.reason).toMatch(/missing/);
  });

  it("cascades skips: a plugin whose dep was skipped is itself skipped (#464)", () => {
    // A requires B; B requires missing C. The earlier single-pass check let
    // A slip through because B was in the input set — but B never actually
    // loaded. The cascade fix should mark A as missing-dep too, with a
    // reason that names B (A doesn't know about C).
    const result = topoSort([
      { id: "a", requires: ["b"] },
      { id: "b", requires: ["c"] },
    ]);
    expect(result.ordered).toEqual([]);
    expect(result.skipped.map((s) => s.id).sort()).toEqual(["a", "b"]);
    const reasonForA = result.skipped.find((s) => s.id === "a")?.reason ?? "";
    expect(reasonForA).toMatch(/b/);
  });

  it("cascades multiple levels of missing-dep skips", () => {
    // Chain: A → B → C → missing D. All three should be skipped.
    const result = topoSort([
      { id: "a", requires: ["b"] },
      { id: "b", requires: ["c"] },
      { id: "c", requires: ["d"] },
      { id: "independent", requires: [] },
    ]);
    expect(result.ordered.map((p) => p.id)).toEqual(["independent"]);
    expect(result.skipped.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("breaks cycles by skipping every plugin involved", () => {
    const result = topoSort([
      { id: "a", requires: ["b"] },
      { id: "b", requires: ["a"] },
      { id: "free", requires: [] },
    ]);
    expect(result.ordered.map((p) => p.id)).toEqual(["free"]);
    expect(result.skipped.map((s) => s.id).sort()).toEqual(["a", "b"]);
    for (const entry of result.skipped) {
      expect(entry.reason).toMatch(/cycle/);
    }
  });

  it("returns a stable order for siblings with no edges between them", () => {
    // Two leaves and a shared dependent — leaves keep input order.
    const result = topoSort([
      { id: "ui", requires: ["theme", "i18n"] },
      { id: "theme", requires: [] },
      { id: "i18n", requires: [] },
    ]);
    expect(result.ordered.map((p) => p.id)).toEqual(["theme", "i18n", "ui"]);
  });
});
