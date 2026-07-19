import { describe, expect, it } from "vitest";

import type { NpCollectionConfig } from "@nexpress/core";

import { toClientCollectionConfig } from "./client-safe.js";

const baseConfig: NpCollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { type: "text", name: "title" },
    { type: "checkbox", name: "featured", admin: { _themeOrigin: "magazine" } },
    { type: "text", name: "badge", admin: { _themeOrigin: "portfolio", group: "Portfolio" } },
    {
      type: "row",
      fields: [
        { type: "text", name: "lede", admin: { _themeOrigin: "docs" } },
        { type: "text", name: "subtitle" },
      ],
    },
  ],
};

describe("toClientCollectionConfig — active-theme field gate", () => {
  it("strips server-only member-write policy callbacks", () => {
    const out = toClientCollectionConfig({
      ...baseConfig,
      community: {
        comments: true,
        memberWrite: {
          create: true,
          writableFields: ["title"],
          access: { create: () => true },
          resolveCreateStatus: () => "pending",
        },
      },
    });

    expect(out.community).toEqual({
      comments: true,
      memberWrite: { create: true, writableFields: ["title"] },
    });
    expect(JSON.stringify(out)).not.toContain("resolveCreateStatus");
  });

  it("keeps every field when activeThemeId is undefined (back-compat)", () => {
    const out = toClientCollectionConfig(baseConfig);
    const names = out.fields.flatMap((f) =>
      f.type === "row"
        ? f.fields.map((c) => ("name" in c ? c.name : c.type))
        : "name" in f
          ? [f.name]
          : [f.type],
    );
    expect(names).toEqual(["title", "featured", "badge", "lede", "subtitle"]);
  });

  it("drops foreign-theme fields when activeThemeId is set", () => {
    const out = toClientCollectionConfig(baseConfig, "magazine");
    const names = out.fields.flatMap((f) =>
      f.type === "row"
        ? f.fields.map((c) => ("name" in c ? c.name : c.type))
        : "name" in f
          ? [f.name]
          : [f.type],
    );
    // - `title` (operator-declared) stays
    // - `featured` (magazine-tagged) stays
    // - `badge` (portfolio-tagged) drops
    // - `lede` (docs-tagged) drops from the row
    // - `subtitle` (operator-declared inside the row) stays
    expect(names).toEqual(["title", "featured", "subtitle"]);
  });

  it("drops empty container rows after gating their children", () => {
    const onlyForeignRow: NpCollectionConfig = {
      ...baseConfig,
      fields: [
        { type: "text", name: "title" },
        {
          type: "row",
          fields: [
            { type: "text", name: "a", admin: { _themeOrigin: "portfolio" } },
            { type: "text", name: "b", admin: { _themeOrigin: "docs" } },
          ],
        },
      ],
    };
    const out = toClientCollectionConfig(onlyForeignRow, "magazine");
    // Row had two children, both foreign — the row itself disappears
    // rather than render as an empty container that surfaces as a
    // weird blank slot in the editor.
    expect(out.fields).toEqual([{ type: "text", name: "title" }]);
  });

  it("keeps operator-declared fields (no _themeOrigin) regardless of activeThemeId", () => {
    const out = toClientCollectionConfig(baseConfig, "nonexistent-theme");
    const names = out.fields.flatMap((f) =>
      f.type === "row"
        ? f.fields.map((c) => ("name" in c ? c.name : c.type))
        : "name" in f
          ? [f.name]
          : [f.type],
    );
    expect(names).toEqual(["title", "subtitle"]);
  });
});
