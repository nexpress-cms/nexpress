import { describe, expect, it } from "vitest";

import {
  isBlockSourceActive,
  parseBlockSource,
} from "./source.js";

describe("parseBlockSource", () => {
  it("returns core for undefined source (registry-default seed)", () => {
    expect(parseBlockSource(undefined)).toEqual({ kind: "core" });
  });

  it("recognizes legacy broad labels", () => {
    expect(parseBlockSource("core")).toEqual({ kind: "core" });
    expect(parseBlockSource("built-in")).toEqual({ kind: "core" });
    expect(parseBlockSource("plugin")).toEqual({ kind: "plugin" });
    expect(parseBlockSource("theme")).toEqual({ kind: "theme" });
  });

  it("parses concrete identity", () => {
    expect(parseBlockSource("theme:magazine")).toEqual({
      kind: "theme",
      id: "magazine",
    });
    expect(parseBlockSource("plugin:reading-time")).toEqual({
      kind: "plugin",
      id: "reading-time",
    });
  });

  it("treats empty id after colon as broad label", () => {
    expect(parseBlockSource("theme:")).toEqual({ kind: "theme" });
    expect(parseBlockSource("plugin:")).toEqual({ kind: "plugin" });
  });

  it("returns null for unrecognized source schemes", () => {
    expect(parseBlockSource("widget:foo")).toBeNull();
    expect(parseBlockSource("random-string")).toBeNull();
  });
});

describe("isBlockSourceActive", () => {
  const ctx = (themeId: string | null) => ({ themeId });

  it("core / built-in always active", () => {
    expect(isBlockSourceActive(undefined, ctx(null))).toBe(true);
    expect(isBlockSourceActive("core", ctx(null))).toBe(true);
    expect(isBlockSourceActive("built-in", ctx("magazine"))).toBe(true);
  });

  it("plugins always pass (process-global; pruned at write time)", () => {
    expect(isBlockSourceActive("plugin:reading-time", ctx(null))).toBe(true);
    expect(isBlockSourceActive("plugin", ctx(null))).toBe(true);
  });

  it("concrete theme source matches active themeId", () => {
    expect(isBlockSourceActive("theme:magazine", ctx("magazine"))).toBe(true);
    expect(isBlockSourceActive("theme:portfolio", ctx("magazine"))).toBe(false);
  });

  it("theme block filtered when no theme active", () => {
    expect(isBlockSourceActive("theme:magazine", ctx(null))).toBe(false);
  });

  it("broad theme label (no concrete id) passes", () => {
    expect(isBlockSourceActive("theme", ctx("magazine"))).toBe(true);
    expect(isBlockSourceActive("theme:", ctx("magazine"))).toBe(true);
  });

  it("unrecognized source schemes pass conservatively", () => {
    expect(isBlockSourceActive("widget:foo", ctx("magazine"))).toBe(true);
  });
});
