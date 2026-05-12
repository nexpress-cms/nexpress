import { describe, expect, it } from "vitest";

import { rewriteScaffoldGlobalsCss } from "./snapshot-rewrites.js";

describe("rewriteScaffoldGlobalsCss", () => {
  it("rewrites the three monorepo `@source` lines to node_modules paths", () => {
    const input = [
      '@import "tailwindcss";',
      "",
      '@source "../../../../packages/admin/src/**/*.{ts,tsx}";',
      '@source "../../../../packages/blocks/src/**/*.{ts,tsx}";',
      '@source "../../../../packages/editor/src/**/*.{ts,tsx}";',
      "",
      "@variant dark (&:where(.dark, .dark *));",
    ].join("\n");

    const out = rewriteScaffoldGlobalsCss(input);

    expect(out).toContain(
      '@source "../../node_modules/@nexpress/admin/dist/**/*.js";',
    );
    expect(out).toContain(
      '@source "../../node_modules/@nexpress/blocks/dist/**/*.js";',
    );
    expect(out).toContain(
      '@source "../../node_modules/@nexpress/editor/dist/**/*.js";',
    );
    // Untouched lines pass through.
    expect(out).toContain('@import "tailwindcss";');
    expect(out).toContain("@variant dark (&:where(.dark, .dark *));");
    // No leftover monorepo paths.
    expect(out).not.toMatch(/\.\.\/\.\.\/\.\.\/\.\.\/packages\//);
  });

  it("is resilient to the prefix depth (apps/web could move)", () => {
    const input = '@source "../../packages/admin/src/**/*.{ts,tsx}";';
    expect(rewriteScaffoldGlobalsCss(input)).toBe(
      '@source "../../node_modules/@nexpress/admin/dist/**/*.js";',
    );
  });

  it("leaves unrelated @source lines alone", () => {
    const input = '@source "./components/**/*.tsx";';
    expect(rewriteScaffoldGlobalsCss(input)).toBe(input);
  });

  it("doesn't double-rewrite an already-rewritten file", () => {
    const input = [
      '@source "../../node_modules/@nexpress/admin/dist/**/*.js";',
      '@source "../../node_modules/@nexpress/blocks/dist/**/*.js";',
    ].join("\n");
    expect(rewriteScaffoldGlobalsCss(input)).toBe(input);
  });
});
