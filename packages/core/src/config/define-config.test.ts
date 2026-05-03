import { describe, expect, it } from "vitest";

import { defineConfig } from "./define-config.js";

const validBase = {
  site: { name: "Test", url: "http://localhost:3000" },
  db: { connectionString: "postgres://test" },
  collections: [
    {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [{ type: "text" as const, name: "title" }],
    },
  ],
  auth: { secret: "abcdef" },
};

describe("defineConfig — friendly error messages (#A)", () => {
  it("translates a missing auth.secret into a setup-wizard hint", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        auth: { secret: "" },
      }),
    ).toThrow(/auth\.secret.*pnpm setup/i);
  });

  it("translates a malformed site.url into a setup-wizard hint", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        site: { name: "Test", url: "" },
      }),
    ).toThrow(/site\.url.*pnpm setup/i);
  });

  it("preserves the original cross-field i18n message (not Zod-formatted)", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        collections: [
          {
            slug: "localized",
            labels: { singular: "L", plural: "L" },
            fields: [{ type: "text" as const, name: "title" }],
            i18n: true,
          },
        ],
      }),
    ).toThrow(/sets i18n: true/);
  });

  it("returns the input unchanged when valid", () => {
    const out = defineConfig(validBase);
    expect(out).toEqual(validBase);
  });
});
