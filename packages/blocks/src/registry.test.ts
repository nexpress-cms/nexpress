import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetBlockCollisionWarnings,
  __resetPatternCollisionWarnings,
  registerBlock,
  registerPattern,
  resetSharedBlockRegistry,
  resetSharedPatternRegistry,
} from "./registry.js";
import type { NpBlockDefinition, NpPattern } from "./types.js";

const StubRender = (() => null) as unknown as NpBlockDefinition["render"];

const stubBlock = (type: string, source: NpBlockDefinition["source"]): NpBlockDefinition => ({
  type,
  label: type,
  iconKind: "lucide",
  icon: "square",
  source,
  defaultProps: {},
  propsSchema: [],
  render: StubRender,
});

const stubPattern = (id: string, source: NpPattern["source"]): NpPattern => ({
  id,
  label: id,
  source,
  blocks: [],
});

describe("block registry collision warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetSharedBlockRegistry();
    __resetBlockCollisionWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not warn on first registration", () => {
    registerBlock(stubBlock("magazine.hero", "theme:magazine"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when same source re-registers (HMR / re-boot)", () => {
    registerBlock(stubBlock("magazine.hero", "theme:magazine"));
    registerBlock(stubBlock("magazine.hero", "theme:magazine"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when overriding a built-in default", () => {
    // Built-in defaults (no source / undefined) can be intentionally
    // overridden by themes/plugins; this is allowed silently.
    registerBlock(stubBlock("magazine.hero", "theme:magazine"));
    // Default seed has no source — registering on top is fine
    // when first-load was undefined. Simulate by registering an
    // unsourced block first.
    registerBlock(stubBlock("test-default", undefined));
    registerBlock(stubBlock("test-default", "plugin:foo"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns on collision between two different non-default sources", () => {
    registerBlock(stubBlock("hero", "theme:magazine"));
    registerBlock(stubBlock("hero", "theme:portfolio"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('"hero"');
    expect(warnSpy.mock.calls[0]?.[0]).toContain("theme:portfolio");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("theme:magazine");
  });

  it("warns once per process per type even on multiple collisions", () => {
    registerBlock(stubBlock("hero", "theme:magazine"));
    registerBlock(stubBlock("hero", "theme:portfolio"));
    registerBlock(stubBlock("hero", "plugin:foo"));
    registerBlock(stubBlock("hero", "plugin:bar"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("plugin/theme cross-collision warns", () => {
    registerBlock(stubBlock("widget", "plugin:reading-time"));
    registerBlock(stubBlock("widget", "theme:magazine"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed definitions before they reach the shared registry", () => {
    expect(() =>
      registerBlock({ ...stubBlock("bad", "plugin:bad"), render: "bad" } as never),
    ).toThrow(/Invalid block definition: block\.render must be a function/);
  });
});

describe("pattern registry collision warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetSharedPatternRegistry();
    __resetPatternCollisionWarnings();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not warn on first registration", () => {
    registerPattern(stubPattern("hero-grid", "theme:magazine"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when same source re-registers", () => {
    registerPattern(stubPattern("hero-grid", "theme:magazine"));
    registerPattern(stubPattern("hero-grid", "theme:magazine"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when overriding a built-in pattern", () => {
    registerPattern(stubPattern("landing-hero", "built-in"));
    registerPattern(stubPattern("landing-hero", "theme:magazine"));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns on cross-source collision", () => {
    registerPattern(stubPattern("hero", "theme:magazine"));
    registerPattern(stubPattern("hero", "theme:portfolio"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('"hero"');
  });

  it("warns once per process per id", () => {
    registerPattern(stubPattern("hero", "theme:magazine"));
    registerPattern(stubPattern("hero", "theme:portfolio"));
    registerPattern(stubPattern("hero", "plugin:foo"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
