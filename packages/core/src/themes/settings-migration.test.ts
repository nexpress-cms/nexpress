import { describe, expect, it } from "vitest";
import type { NpThemeManifest } from "../config/types.js";

import { applyMigration } from "./settings.js";

const baseManifest = (overrides: Partial<NpThemeManifest>): NpThemeManifest => ({
  id: "test-theme",
  name: "Test Theme",
  version: "0.0.0",
  ...overrides,
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

  it("propagates migrate failures", () => {
    const manifest = baseManifest({
      settingsVersion: 2,
      settingsMigrate: () => {
        throw new Error("migrate explosion");
      },
    });
    expect(() => applyMigration(manifest, { hero: "x" }, 1)).toThrow("migrate explosion");
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
    expect(applyMigration(manifest, { hero: "x", addedAtV2: true }, 2)).toEqual({
      hero: "x",
      addedAtV2: true,
      addedAtV3: true,
    });
  });
});
