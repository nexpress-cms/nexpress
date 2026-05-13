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
    // No leftover monorepo paths on any active `@source` line.
    // (The rationale comment intentionally mentions the old path
    // shape — that's prose, not directives, so scope the check.)
    expect(out).not.toMatch(/@source "\.\.\/\.\.\/\.\.\/\.\.\/packages\//);
  });

  it("is resilient to the prefix depth (apps/web could move)", () => {
    const out = rewriteScaffoldGlobalsCss(
      '@source "../../packages/admin/src/**/*.{ts,tsx}";',
    );
    expect(out).toContain(
      '@source "../../node_modules/@nexpress/admin/dist/**/*.js";',
    );
    expect(out).not.toMatch(/@source "\.\.\/\.\.\/packages\//);
  });

  it("leaves unrelated @source lines alone", () => {
    const input = '@source "./components/**/*.tsx";';
    expect(rewriteScaffoldGlobalsCss(input)).toBe(input);
  });

  it("doesn't double-rewrite an already-rewritten file (with comment)", () => {
    const once = rewriteScaffoldGlobalsCss(
      '@source "../../../../packages/admin/src/**/*.{ts,tsx}";',
    );
    expect(once).toContain("Scaffold variant of these");
    // Second pass on the rewritten output is idempotent — no
    // duplicate comment, paths already in their final form.
    const twice = rewriteScaffoldGlobalsCss(once);
    expect(twice).toBe(once);
  });

  it("inserts the rationale comment alongside the rewritten lines", () => {
    const out = rewriteScaffoldGlobalsCss(
      '@source "../../../../packages/admin/src/**/*.{ts,tsx}";',
    );
    // Comment must precede the @source line, not sit somewhere else.
    const commentIdx = out.indexOf("Scaffold variant of these");
    const sourceIdx = out.indexOf("@source \"../../node_modules");
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    expect(sourceIdx).toBeGreaterThan(commentIdx);
  });

  it("inserts the comment when admin is absent (only blocks/editor present)", () => {
    // Guards against a future apps/web globals.css that reorders or
    // drops the admin line — the comment must still land on the
    // first rewritten line, not vanish silently.
    const out = rewriteScaffoldGlobalsCss(
      [
        '@source "../../../../packages/blocks/src/**/*.{ts,tsx}";',
        '@source "../../../../packages/editor/src/**/*.{ts,tsx}";',
      ].join("\n"),
    );
    expect(out).toContain("Scaffold variant of these");
    const commentIdx = out.indexOf("Scaffold variant of these");
    const firstSourceIdx = out.indexOf("@source \"../../node_modules");
    expect(firstSourceIdx).toBeGreaterThan(commentIdx);
  });
});
