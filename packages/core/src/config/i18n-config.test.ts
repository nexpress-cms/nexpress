import { describe, expect, it } from "vitest";

import { defineConfig } from "./define-config.js";

/**
 * Phase 12.1 — config-time validation for i18n. The cross-field
 * check in `defineConfig` rejects a collection that opts into
 * i18n if the top-level config block is missing; the schema
 * also enforces that `defaultLocale` is one of the declared
 * locales.
 */
describe("i18n config validation (Phase 12.1)", () => {
  function baseConfig(overrides: object = {}) {
    return {
      site: { name: "Test", url: "http://localhost:3000" },
      db: { connectionString: "postgres://x" },
      collections: [
        {
          slug: "items",
          labels: { singular: "Item", plural: "Items" },
          fields: [{ type: "text" as const, name: "title" }],
        },
      ],
      ...overrides,
    };
  }

  it("accepts a collection with i18n: true when the top-level i18n block is set", () => {
    expect(() =>
      defineConfig(
        baseConfig({
          i18n: { locales: ["en", "ko"], defaultLocale: "en" },
          collections: [
            {
              slug: "items",
              labels: { singular: "Item", plural: "Items" },
              i18n: true,
              fields: [{ type: "text" as const, name: "title" }],
            },
          ],
        }) as never,
      ),
    ).not.toThrow();
  });

  it("rejects i18n: true on a collection when no top-level i18n block exists", () => {
    expect(() =>
      defineConfig(
        baseConfig({
          collections: [
            {
              slug: "items",
              labels: { singular: "Item", plural: "Items" },
              i18n: true,
              fields: [{ type: "text" as const, name: "title" }],
            },
          ],
        }) as never,
      ),
    ).toThrow(/i18n: true/);
  });

  it("rejects defaultLocale that isn't in the locales list", () => {
    expect(() =>
      defineConfig(
        baseConfig({
          i18n: { locales: ["en", "ko"], defaultLocale: "fr" },
        }) as never,
      ),
    ).toThrow();
  });

  it("a config without any i18n at all stays valid (i18n is purely opt-in)", () => {
    expect(() => defineConfig(baseConfig() as never)).not.toThrow();
  });
});
