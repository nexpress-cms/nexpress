import { describe, expect, it } from "vitest";
import type { NpThemeManifest } from "../config/types.js";

import { applyMigration, isVersionedSettings } from "./settings.js";

const baseManifest = (
  overrides: Partial<NpThemeManifest>,
): NpThemeManifest => ({
  id: "test-theme",
  name: "Test Theme",
  version: "0.0.0",
  ...overrides,
});

describe("isVersionedSettings", () => {
  it("returns true for the wrapped envelope shape", () => {
    expect(isVersionedSettings({ __npVersion: 2, __npSettings: {} })).toBe(true);
    expect(isVersionedSettings({ __npVersion: 1, __npSettings: null })).toBe(true);
  });

  it("returns false for legacy unwrapped shapes", () => {
    expect(isVersionedSettings({ heroStyle: "featured" })).toBe(false);
    expect(isVersionedSettings({})).toBe(false);
  });

  it("returns false when version is not a number", () => {
    expect(
      isVersionedSettings({ __npVersion: "2", __npSettings: {} }),
    ).toBe(false);
    expect(isVersionedSettings({ __npSettings: {} })).toBe(false);
  });

  it("returns false for primitives / null", () => {
    expect(isVersionedSettings(null)).toBe(false);
    expect(isVersionedSettings(undefined)).toBe(false);
    expect(isVersionedSettings("string")).toBe(false);
    expect(isVersionedSettings(42)).toBe(false);
  });

  it("returns false when only the version sentinel is present", () => {
    // Themes might add their own `__npVersion` field by accident;
    // we require BOTH sentinels.
    expect(isVersionedSettings({ __npVersion: 2 })).toBe(false);
  });
});

describe("applyMigration", () => {
  it("no-ops when stored version matches the manifest version", () => {
    const manifest = baseManifest({ settingsVersion: 2 });
    const out = applyMigration(manifest, { hero: "x" }, 2);
    expect(out).toEqual({ hero: "x" });
  });

  it("no-ops when stored version is higher (operator downgraded the theme)", () => {
    const manifest = baseManifest({ settingsVersion: 1 });
    const out = applyMigration(manifest, { hero: "x" }, 3);
    expect(out).toEqual({ hero: "x" });
  });

  it("no-ops when manifest declares no migrate fn", () => {
    const manifest = baseManifest({ settingsVersion: 2 });
    const out = applyMigration(manifest, { hero: "x" }, 1);
    // No migrate to call, value passes through unchanged. The
    // schema parse layer will catch any mismatch downstream.
    expect(out).toEqual({ hero: "x" });
  });

  it("invokes settingsMigrate with the old value + fromVersion", () => {
    const calls: Array<{ value: unknown; from: number }> = [];
    const manifest = baseManifest({
      settingsVersion: 2,
      settingsMigrate: (value, from) => {
        calls.push({ value, from });
        const v = value as { accent?: string };
        return { accentColor: v.accent };
      },
    });
    const out = applyMigration(manifest, { accent: "#abc123" }, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ value: { accent: "#abc123" }, from: 1 });
    expect(out).toEqual({ accentColor: "#abc123" });
  });

  it("falls back to the raw value when the migrate fn throws", () => {
    const manifest = baseManifest({
      settingsVersion: 2,
      settingsMigrate: () => {
        throw new Error("migrate explosion");
      },
    });
    // Defensive — a buggy migrate fn shouldn't crash the read
    // path. The downstream schema parse decides what to do with
    // the (still-old) value.
    const out = applyMigration(manifest, { hero: "x" }, 1);
    expect(out).toEqual({ hero: "x" });
  });

  it("treats absent settingsVersion as 1", () => {
    // Theme didn't declare settingsVersion — framework's baseline
    // is v1, so anything stored at v1 with no migrator is no-op.
    const manifest = baseManifest({});
    const out = applyMigration(manifest, { hero: "x" }, 1);
    expect(out).toEqual({ hero: "x" });
  });

  it("supports multi-step migrations branching on fromVersion", () => {
    const manifest = baseManifest({
      settingsVersion: 3,
      settingsMigrate: (value, from) => {
        const v = value as Record<string, unknown>;
        if (from === 1) return { ...v, addedAtV2: true, addedAtV3: true };
        if (from === 2) return { ...v, addedAtV3: true };
        return v;
      },
    });
    expect(applyMigration(manifest, { hero: "x" }, 1)).toEqual({
      hero: "x",
      addedAtV2: true,
      addedAtV3: true,
    });
    expect(applyMigration(manifest, { hero: "x", addedAtV2: true }, 2)).toEqual(
      {
        hero: "x",
        addedAtV2: true,
        addedAtV3: true,
      },
    );
  });
});
