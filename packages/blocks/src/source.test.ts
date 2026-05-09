import { describe, expect, it } from "vitest";

import {
  registerBlock,
  registerPattern,
  resetSharedBlockRegistry,
  resetSharedPatternRegistry,
} from "./registry.js";
import {
  getRegisteredBlockMetadataForActiveSources,
  getRegisteredBlocksForActiveSources,
  getRegisteredPatternsForActiveSources,
  isBlockSourceActive,
  parseBlockSource,
} from "./source.js";
import type { NpBlockDefinition, NpPattern } from "./types.js";

const StubRender = (() => null) as unknown as NpBlockDefinition["render"];

const stub = (
  type: string,
  source: NpBlockDefinition["source"],
): NpBlockDefinition => ({
  type,
  label: type,
  iconKind: "lucide",
  icon: "square",
  source,
  defaultProps: {},
  propsSchema: [],
  render: StubRender,
});

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

  it("recognizes custom kind (operator-saved patterns)", () => {
    expect(parseBlockSource("custom")).toEqual({ kind: "custom" });
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

describe("getRegisteredBlocks*ForActiveSources — integration with shared registry", () => {
  it("filters theme blocks by active theme id", () => {
    resetSharedBlockRegistry();
    registerBlock(stub("magazine.hero", "theme:magazine"));
    registerBlock(stub("portfolio.grid", "theme:portfolio"));
    registerBlock(stub("plugin.cta", "plugin:reading-time"));

    const definitions = getRegisteredBlocksForActiveSources({
      themeId: "magazine",
    });
    const types = definitions.map((d) => d.type);
    expect(types).toContain("magazine.hero");
    expect(types).not.toContain("portfolio.grid");
    expect(types).toContain("plugin.cta");
    // Built-ins (registry seed) pass through.
    expect(types.length).toBeGreaterThan(3);
  });

  it("metadata variant strips the render fn", () => {
    resetSharedBlockRegistry();
    registerBlock(stub("magazine.hero", "theme:magazine"));

    const metadata = getRegisteredBlockMetadataForActiveSources({
      themeId: "magazine",
    });
    const hero = metadata.find((m) => m.type === "magazine.hero");
    expect(hero).toBeDefined();
    expect((hero as unknown as { render?: unknown }).render).toBeUndefined();
  });

  it("filters out all theme blocks when no theme active", () => {
    resetSharedBlockRegistry();
    registerBlock(stub("magazine.hero", "theme:magazine"));
    registerBlock(stub("portfolio.grid", "theme:portfolio"));

    const types = getRegisteredBlocksForActiveSources({
      themeId: null,
    }).map((d) => d.type);
    expect(types).not.toContain("magazine.hero");
    expect(types).not.toContain("portfolio.grid");
  });
});

const stubPattern = (
  id: string,
  source: NpPattern["source"],
  extras?: Partial<NpPattern>,
): NpPattern => ({
  id,
  label: id,
  source,
  blocks: [],
  ...extras,
});

describe("getRegisteredPatternsForActiveSources — theme pattern filter", () => {
  it("filters theme patterns by active theme id", () => {
    resetSharedPatternRegistry();
    registerPattern(stubPattern("magazine.hero-cta", "theme:magazine"));
    registerPattern(stubPattern("portfolio.grid-3", "theme:portfolio"));
    registerPattern(stubPattern("plugin.email-cta", "plugin:reading-time"));
    registerPattern(stubPattern("custom.saved", "custom"));

    const ids = getRegisteredPatternsForActiveSources({
      themeId: "magazine",
    }).map((p) => p.id);
    expect(ids).toContain("magazine.hero-cta");
    expect(ids).not.toContain("portfolio.grid-3");
    expect(ids).toContain("plugin.email-cta");
    expect(ids).toContain("custom.saved");
  });

  it("filters out all theme patterns when no theme active", () => {
    resetSharedPatternRegistry();
    registerPattern(stubPattern("magazine.hero-cta", "theme:magazine"));
    registerPattern(stubPattern("plugin.email-cta", "plugin:reading-time"));

    const ids = getRegisteredPatternsForActiveSources({
      themeId: null,
    }).map((p) => p.id);
    expect(ids).not.toContain("magazine.hero-cta");
    expect(ids).toContain("plugin.email-cta");
  });

  it("preserves preview + category fields through the filter", () => {
    resetSharedPatternRegistry();
    registerPattern(
      stubPattern("magazine.hero-cta", "theme:magazine", {
        preview: "/themes/magazine/preview.png",
        category: "homepage",
      }),
    );

    const filtered = getRegisteredPatternsForActiveSources({
      themeId: "magazine",
    });
    expect(filtered[0]?.preview).toBe("/themes/magazine/preview.png");
    expect(filtered[0]?.category).toBe("homepage");
  });
});
