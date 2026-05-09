import { describe, expect, it } from "vitest";

import {
  applyPluginConfigMigration,
  isVersionedPluginConfig,
  pluginConfigCacheTag,
} from "./config.js";

describe("isVersionedPluginConfig", () => {
  it("returns true for the wrapped envelope shape", () => {
    expect(isVersionedPluginConfig({ __npVersion: 2, __npSettings: {} })).toBe(true);
    expect(isVersionedPluginConfig({ __npVersion: 1, __npSettings: null })).toBe(true);
  });

  it("returns false for legacy unwrapped shapes", () => {
    expect(isVersionedPluginConfig({ wordsPerMinute: 220 })).toBe(false);
    expect(isVersionedPluginConfig({})).toBe(false);
  });

  it("returns false when version is not a number", () => {
    expect(
      isVersionedPluginConfig({ __npVersion: "2", __npSettings: {} }),
    ).toBe(false);
  });

  it("returns false for primitives / null", () => {
    expect(isVersionedPluginConfig(null)).toBe(false);
    expect(isVersionedPluginConfig(undefined)).toBe(false);
    expect(isVersionedPluginConfig("string")).toBe(false);
  });

  it("returns false for NaN / Infinity (corrupted DB row guard)", () => {
    expect(
      isVersionedPluginConfig({ __npVersion: Number.NaN, __npSettings: {} }),
    ).toBe(false);
  });
});

describe("applyPluginConfigMigration", () => {
  it("no-ops when stored version matches configVersion", () => {
    const reg = { configVersion: 2 };
    const result = applyPluginConfigMigration(reg, { foo: 1 }, 2);
    expect(result).toEqual({ foo: 1 });
  });

  it("no-ops when stored version is higher (downgrade)", () => {
    const reg = { configVersion: 1 };
    const result = applyPluginConfigMigration(reg, { foo: 1 }, 2);
    expect(result).toEqual({ foo: 1 });
  });

  it("no-ops when registration declares no migrator", () => {
    const reg = { configVersion: 2 };
    const result = applyPluginConfigMigration(reg, { foo: 1 }, 1);
    expect(result).toEqual({ foo: 1 });
  });

  it("invokes configMigrate with the old value + fromVersion", () => {
    const seen: Array<{ value: unknown; from: number }> = [];
    const reg = {
      configVersion: 2,
      configMigrate: (value: unknown, from: number) => {
        seen.push({ value, from });
        const v = value as { wpm?: number };
        return { wordsPerMinute: v.wpm ?? 0 };
      },
    };
    const result = applyPluginConfigMigration(reg, { wpm: 250 }, 1);
    expect(result).toEqual({ wordsPerMinute: 250 });
    expect(seen).toEqual([{ value: { wpm: 250 }, from: 1 }]);
  });

  it("falls back to the raw value when the migrate fn throws", () => {
    // Mirrors the theme path's defensive try/catch — a buggy
    // migrator must not blow up the read path.
    const reg = {
      configVersion: 2,
      configMigrate: () => {
        throw new Error("buggy migration");
      },
    };
    const original = { wpm: 250 };
    const result = applyPluginConfigMigration(reg, original, 1);
    expect(result).toBe(original);
  });

  it("treats absent configVersion as 1", () => {
    const reg = {
      configMigrate: (value: unknown) => ({ migrated: true, original: value }),
    };
    // fromVersion 1 vs target 1 → no-op (no upgrade needed).
    expect(applyPluginConfigMigration(reg, { x: 1 }, 1)).toEqual({ x: 1 });
  });

  it("supports multi-step migrations branching on fromVersion", () => {
    const reg = {
      configVersion: 3,
      configMigrate: (value: unknown, from: number) => {
        let v = value as Record<string, unknown>;
        if (from < 2) v = { ...v, addedInV2: true };
        if (from < 3) v = { ...v, addedInV3: true };
        return v;
      },
    };
    expect(applyPluginConfigMigration(reg, { x: 1 }, 1)).toEqual({
      x: 1,
      addedInV2: true,
      addedInV3: true,
    });
    expect(applyPluginConfigMigration(reg, { x: 1 }, 2)).toEqual({
      x: 1,
      addedInV3: true,
    });
  });
});

describe("pluginConfigCacheTag", () => {
  it("namespaces with the np prefix and plugin id", () => {
    // Per CLAUDE.md "Naming convention" + design doc § 7, every
    // framework-owned tag uses `np`. The legacy `nx:theme:*` tag
    // is NOT extended in G-track.
    expect(pluginConfigCacheTag("reading-time")).toBe("np:plugin:reading-time");
  });

  it("preserves the raw plugin id (no escaping)", () => {
    expect(pluginConfigCacheTag("@nexpress/plugin-forum")).toBe(
      "np:plugin:@nexpress/plugin-forum",
    );
  });
});
