import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { defaultThemeCss } from "@nexpress/theme-default";
import { docsCss } from "@nexpress/theme-docs";
import { magazineCss } from "@nexpress/theme-magazine";
import { portfolioCss } from "@nexpress/theme-portfolio";

/**
 * Built-in themes — className ↔ CSS coverage gate.
 *
 * The May 2026 theme rebuild silently broke magazine's mobile nav
 * once: components rendered `np-magazine-nav-*`, CSS declared
 * `np-magazine-mobile-nav-*`. Both built fine, no typecheck error,
 * no console warning — the navigation just had no styles applied
 * and looked broken.
 *
 * This test walks each built-in theme's `src/` for `.tsx` / `.ts`
 * files, extracts every static `className="..."` literal, and
 * asserts that every `np-`-prefixed token appears as a class
 * selector in the same theme's CSS string. Framework-shared
 * classes (`np-block-*` from `@nexpress/blocks`, `np-content` from
 * the rich-text renderer) are allowed through an explicit
 * allowlist — themes legitimately reference them without
 * declaring them.
 *
 * Dynamic class expressions (`className={cond ? "a" : "b"}` or
 * template literals like `np-foo-${kind}`) only catch what's in
 * the literal substrings; the test errs toward false negatives,
 * not false positives. Worst case: a typo in a dynamic class slips
 * through. The wholly-static literal case — which is what bit
 * magazine — is fully covered.
 */

const THEME_SRC_ROOT = resolve(
  fileURLToPath(new URL("../../../packages/themes", import.meta.url)),
);

/**
 * Framework-provided class prefixes that themes use without
 * declaring locally. Keep narrow — drift here turns the test
 * into a rubber stamp.
 */
const SHARED_PREFIXES = ["np-block", "np-content", "np-page"];

function isShared(className: string): boolean {
  return SHARED_PREFIXES.some(
    (prefix) => className === prefix || className.startsWith(`${prefix}-`),
  );
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(fullPath));
    } else if (
      /\.tsx?$/.test(entry) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(fullPath);
    }
  }
  return out;
}

/**
 * Pull static-string className values out of a source file.
 * Matches the two literal forms operators actually write:
 *   - `className="np-foo np-bar"` (plain attribute string)
 *   - `className={"np-foo"}` (JSX-expression containing a string)
 *
 * Dynamic shapes (`className={someVar}`, template literals)
 * intentionally don't match — see the file-level docstring.
 */
function extractClassTokens(file: string): Set<string> {
  const source = readFileSync(file, "utf-8");
  const tokens = new Set<string>();
  const re = /\bclassName=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\})/g;
  for (const match of source.matchAll(re)) {
    const value = match[1] ?? match[2];
    if (!value) continue;
    for (const tok of value.split(/\s+/)) {
      if (tok.startsWith("np-")) tokens.add(tok);
    }
  }
  return tokens;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Look for `.<token>` in the CSS string, with a right-edge
 * boundary so `.np-foo` doesn't trigger on a stylesheet that
 * only defines `.np-foo-bar`. CSS class selectors are followed
 * by a non-(word|hyphen) character (space, comma, `{`, `:`, etc).
 */
function findMissingInCss(tokens: Set<string>, css: string): string[] {
  const missing: string[] = [];
  for (const tok of tokens) {
    if (isShared(tok)) continue;
    const pattern = new RegExp(`\\.${escapeRegex(tok)}(?![\\w-])`);
    if (!pattern.test(css)) missing.push(tok);
  }
  return missing.sort();
}

interface ThemeUnderTest {
  id: string;
  css: string;
  srcDir: string;
}

const themes: ThemeUnderTest[] = [
  {
    id: "default",
    css: defaultThemeCss,
    srcDir: join(THEME_SRC_ROOT, "default", "src"),
  },
  {
    id: "magazine",
    css: magazineCss,
    srcDir: join(THEME_SRC_ROOT, "magazine", "src"),
  },
  {
    id: "portfolio",
    css: portfolioCss,
    srcDir: join(THEME_SRC_ROOT, "portfolio", "src"),
  },
  {
    id: "docs",
    css: docsCss,
    srcDir: join(THEME_SRC_ROOT, "docs", "src"),
  },
];

/**
 * Baseline of currently-unstyled classes per theme. The test
 * asserts exact equality against this list (sorted), so:
 *
 *   - A NEW unstyled class fails the test → catches typos like the
 *     magazine `np-magazine-nav-mobile` vs `np-magazine-mobile-nav`
 *     incident from May 2026.
 *   - An EXISTING entry that's now styled also fails → forces the
 *     baseline to shrink over time rather than rubber-stamping the
 *     gaps forever.
 *
 * Entries are split into two buckets per theme:
 *
 *   VERIFIED_LANDMARK: rendered alongside a styled sibling that
 *     provides the visual layout. The class is a semantic /
 *     ARIA / test-id hook with no styles of its own — by design.
 *     Example: `np-magazine-not-found` on `<div className=
 *     "np-magazine-not-found np-magazine-message">` where
 *     `.np-magazine-message` carries the actual message styling.
 *
 *   UNVERIFIED: the class is the primary one on its element AND
 *     no styled sibling carries the layout — the element renders
 *     with browser-default styling. Could be (a) an intentional
 *     bare landmark (e.g. `<main className="np-member-main">`
 *     relying on framework defaults), (b) a dormant component
 *     exported but not yet consumed, or (c) a real visible bug
 *     that needs CSS in a separate per-theme polish PR.
 *
 *     Per-theme CSS PRs should pick from the UNVERIFIED bucket
 *     and either add the missing rules + trim the baseline, or
 *     reclassify as VERIFIED_LANDMARK with a sibling citation.
 *
 *     Two visible-bug surfaces flagged at gate-merge time were
 *     fixed in the follow-up CSS PR: magazine.hero-feature page-
 *     builder block (11 classes) and portfolio project-detail
 *     template at `/work/:slug` (6 classes). Both removed from
 *     the baseline below.
 */
const KNOWN_UNSTYLED: Record<string, readonly string[]> = {
  default: [
    // UNVERIFIED — member-status widget (member-status-widget.tsx).
    // The 5 np-member-status* + np-button-primary + np-text-button
    // classes are the entire widget; no styled parent provides
    // layout. Widget renders unstyled when a member is signed in.
    "np-button-primary",
    "np-member-status",
    "np-member-status-handle",
    "np-member-status-loading",
    "np-post-meta-date", // VERIFIED_LANDMARK — sibling `.np-post-meta` styled.
    "np-post-meta-reading", // VERIFIED_LANDMARK — sibling `.np-post-meta` styled.
    "np-text-button",
  ],
  magazine: [
    // UNVERIFIED — post-card.tsx (`np-magazine-card-*`, 7 entries).
    // Component is exported from `@nexpress/theme-magazine` but
    // has no internal callers in the reference app or other
    // themes today. Dormant export. Reclassify to VERIFIED if it
    // stays unused, or fix when first consumer lands.
    "np-magazine-card-body",
    "np-magazine-card-cover",
    "np-magazine-card-excerpt",
    "np-magazine-card-kicker",
    "np-magazine-card-link",
    "np-magazine-card-meta",
    "np-magazine-card-title",
    // VERIFIED_LANDMARK — sibling `.np-magazine-message` styled
    // (styles.ts:1017). Both error + not-found use the message
    // surface for visuals; the typed classes are hooks.
    "np-magazine-error",
    "np-magazine-members-error",
    "np-magazine-members-not-found",
    "np-magazine-not-found",
    // VERIFIED_LANDMARK — drawer list/subnav sit inside the styled
    // `.np-magazine-mobile-nav-drawer` parent (mobile-nav.tsx).
    "np-magazine-mobile-nav-drawer-list",
    "np-magazine-mobile-subnav",
    // UNVERIFIED — section-strip is a block container; needs
    // verification of parent block-render context.
    "np-magazine-section-strip",
    // VERIFIED_LANDMARK — subscribe states are <p> inside the
    // styled newsletter-form, no layout needed on them.
    "np-magazine-subscribe-error",
    "np-magazine-subscribe-success",
  ],
  portfolio: [
    // UNVERIFIED — np-member-main is a `<main>` landmark in
    // members-not-found.tsx. Browser-default `<main>` styling is
    // usually fine; verify against design intent.
    "np-member-main",
    // UNVERIFIED — case-study + client-logos + image-grid are
    // page-builder block containers. Need block-render context
    // verification.
    "np-portfolio-case-study-hero",
    "np-portfolio-client-logos",
    "np-portfolio-image-grid",
    // UNVERIFIED — error / not-found / member shells. Browser
    // default block flow renders the text content; layout may or
    // may not look right depending on design intent.
    "np-portfolio-error",
    "np-portfolio-members",
    "np-portfolio-members-column",
    "np-portfolio-members-error",
    "np-portfolio-members-not-found",
    "np-portfolio-not-found",
    // VERIFIED_LANDMARK — nav-item / nav-toggle / subnav /
    // mobile-subnav sit inside the styled `.np-portfolio-nav*`
    // family (styles.ts). Parents provide layout.
    "np-portfolio-mobile-subnav",
    "np-portfolio-nav-item",
    "np-portfolio-nav-toggle",
    "np-portfolio-subnav",
    // VERIFIED_LANDMARK — `.np-portfolio-page-default` IS styled
    // (styles.ts:688); `np-portfolio-page` is a parent hook.
    "np-portfolio-page",
  ],
  docs: [
    // UNVERIFIED — `np-docs` (bare) appears as a sibling of
    // `np-docs-shell` (styled) in members-shell.tsx → LANDMARK
    // there. But also appears with `np-docs-error` (unstyled)
    // and `np-docs-members-error` (unstyled) → UNVERIFIED at
    // those sites. Single entry classification can't capture
    // both; treat as UNVERIFIED conservatively.
    "np-docs",
    // UNVERIFIED — error / not-found / members shells. Browser
    // default block flow; layout may or may not match design.
    "np-docs-error",
    "np-docs-members",
    "np-docs-members-column",
    "np-docs-members-error",
    "np-docs-members-not-found",
    "np-docs-not-found",
    // VERIFIED_LANDMARK — child of `<article className="np-docs-page">`
    // (styled, styles.ts). Parent article handles padding /
    // max-width / typography; body div is a content hook.
    "np-docs-page-body",
    // UNVERIFIED — `<main>` landmark; same triage as portfolio.
    "np-member-main",
  ],
};

describe("built-in themes — className ↔ CSS coverage", () => {
  for (const { id, css, srcDir } of themes) {
    it(`${id}: missing-class baseline matches known-unstyled list`, () => {
      const files = listSourceFiles(srcDir);
      const tokens = new Set<string>();
      for (const file of files) {
        for (const tok of extractClassTokens(file)) tokens.add(tok);
      }
      const missing = findMissingInCss(tokens, css);
      const baseline = [...KNOWN_UNSTYLED[id]].sort();
      expect(
        missing,
        `Theme "${id}" missing-class baseline drifted. ` +
          `If you added a new class to JSX, either add a matching selector ` +
          `to packages/themes/${id}/src/styles.ts or extend KNOWN_UNSTYLED ` +
          `in this test (and explain why). If you styled an existing ` +
          `entry from KNOWN_UNSTYLED, remove it from the baseline here.`,
      ).toEqual(baseline);
    });
  }
});
