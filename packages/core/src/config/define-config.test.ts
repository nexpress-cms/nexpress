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
    ).toThrow(/auth\.secret.*pnpm run setup/i);
  });

  it("translates a malformed site.url into a setup-wizard hint", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        site: { name: "Test", url: "" },
      }),
    ).toThrow(/site\.url.*pnpm run setup/i);
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

  it("validates themes before merging their collection requirements", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        themes: [
          {
            manifest: { id: "broken", name: "Broken", version: "0.1.0" },
            impl: { routes: [{ component: () => null }] },
          },
        ],
      }),
    ).toThrow(/config\.themes\[0\]\.impl\.routes\.0\.pattern/);
  });

  it("rejects duplicate theme ids before registry last-write-wins can hide them", () => {
    const theme = {
      manifest: { id: "same", name: "Same", version: "0.1.0" },
      impl: {},
    };
    expect(() =>
      defineConfig({
        ...validBase,
        themes: [theme, { ...theme, manifest: { ...theme.manifest, name: "Other" } }],
      }),
    ).toThrow(/duplicate theme id "same"/);
  });

  it("rejects duplicate collection slugs before bootstrap registration", () => {
    const collection = {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [{ name: "title", type: "text" as const }],
    };
    expect(() =>
      defineConfig({
        ...validBase,
        collections: [collection, { ...collection }],
      }),
    ).toThrow(/duplicate collection slug "posts"/);
  });

  it("validates the resolved collection contract after theme requirements merge", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        themes: [
          {
            manifest: {
              id: "reserved-field",
              name: "Reserved field",
              version: "0.1.0",
              requires: {
                collections: {
                  posts: { fields: { createdAt: { type: "date" } } },
                },
              },
            },
            impl: {},
          },
        ],
      }),
    ).toThrow(/resolved collections\[0\]\.fields\.1\.name.*framework-reserved/);
  });

  it("rejects relationship targets missing from the resolved collection set", () => {
    expect(() =>
      defineConfig({
        ...validBase,
        collections: [
          {
            ...validBase.collections[0],
            fields: [
              ...validBase.collections[0].fields,
              { name: "topic", type: "relationship" as const, relationTo: "topics" },
            ],
          },
        ],
      }),
    ).toThrow(/config\.collections\[0\]\.fields\.1\.relationTo.*not a declared collection/);
  });

  it("resolves relationship targets contributed by theme collection creation", () => {
    const resolved = defineConfig({
      ...validBase,
      collections: [
        {
          ...validBase.collections[0],
          fields: [
            ...validBase.collections[0].fields,
            { name: "author", type: "relationship" as const, relationTo: "authors" },
          ],
        },
      ],
      themes: [
        {
          manifest: {
            id: "authors",
            name: "Authors",
            version: "0.1.0",
            requires: {
              collections: {
                authors: {
                  createIfAbsent: true,
                  fields: { name: { type: "text" } },
                },
              },
            },
          },
          impl: {},
        },
      ],
    });

    expect(resolved.collections.map((collection) => collection.slug)).toEqual(["posts", "authors"]);
  });
});
