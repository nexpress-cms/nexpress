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
 * Strip JS / JSDoc / line comments before className extraction
 * so docstring examples like
 *   ` * `<main className="np-member-main">` landmark.`
 * don't get matched as if they were real JSX. The original test
 * surfaced this when both portfolio + docs ended up with the
 * shared `np-member-main` class in their baseline solely because
 * each theme's `members-not-found.tsx` docstring referenced it.
 *
 * String-literal contents COULD legitimately contain something
 * that looks like a comment, but in practice no theme `.ts(x)`
 * source today has a string with `/*` inside it. If that ever
 * lands, this stripper would over-eat — at which point we'd
 * switch to a real parser. Until then, regex is good enough.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
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
  const source = stripComments(readFileSync(file, "utf-8"));
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
 *   VERIFIED_LANDMARK_INLINE: the element rendering this class
 *     carries a full `style={{ ... }}` prop covering layout and
 *     typography. The className exists only as a semantic /
 *     test-id hook; no CSS rule needed. Example: each theme's
 *     `not-found.tsx` centers the page with inline `display:
 *     flex`, sets max-width, picks font-family — the class is
 *     just there for grep-ability.
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
 *     History of UNVERIFIED → resolved transitions:
 *       - magazine.hero-feature page-builder block (11 classes)
 *         → real CSS added in #802.
 *       - portfolio project-detail at `/work/:slug` (6 classes)
 *         → real CSS added in #802.
 *       - default MemberStatusWidget + button helpers (5)
 *         → real CSS added in #803.
 *       - portfolio + docs members shell (4 classes) → real CSS
 *         added in #803.
 *       - portfolio + docs error / not-found / members-error /
 *         members-not-found (8 classes) → VERIFIED_LANDMARK_INLINE
 *         (inline style prop covers everything) in #803.
 *       - magazine section-strip + portfolio page-builder blocks
 *         (case-study-hero, image-grid, client-logos) →
 *         VERIFIED_LANDMARK_INLINE (this PR).
 *
 *     Remaining UNVERIFIED: only the dormant `MagazinePostCard`
 *     export's 7 classes — exported from `@nexpress/theme-magazine`
 *     but no internal callers in the reference app or other
 *     themes. Either keep deferring (YAGNI) or design CSS when
 *     a first consumer lands.
 */
const KNOWN_UNSTYLED: Record<string, readonly string[]> = {
  default: [],
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
    // VERIFIED_LANDMARK_INLINE — the SectionStrip page-builder
    // block renders `<section className="np-magazine-section-strip"
    // style={{ margin: "2.5rem 0", padding: "1.5rem 0" }}>` with
    // inline-styled h2 + grid children (blocks.tsx:347-405).
    // Layout is fully self-contained on the inline prop.
    "np-magazine-section-strip",
    // VERIFIED_LANDMARK — subscribe states are <p> inside the
    // styled newsletter-form, no layout needed on them.
    "np-magazine-subscribe-error",
    "np-magazine-subscribe-success",
  ],
  portfolio: [
    // VERIFIED_LANDMARK_INLINE — three page-builder blocks
    // (blocks.tsx). Each renders its `<section>` root with a
    // full inline `style={{...}}` prop:
    //   - case-study-hero — backgroundImage + min-height + flex
    //     end-aligned overlay (lines 30-121).
    //   - image-grid — `display: grid` with dynamic columns from
    //     the operator's `columns` prop (lines 134-174).
    //   - client-logos — auto-fit grid of operator-supplied logos
    //     (lines 244-319).
    // Visuals are self-contained on the inline styles; no CSS
    // rule needed.
    "np-portfolio-case-study-hero",
    "np-portfolio-client-logos",
    "np-portfolio-image-grid",
    // VERIFIED_LANDMARK_INLINE — error.tsx + members-error.tsx +
    // not-found.tsx + members-not-found.tsx all render their
    // root element with a full `style={{...}}` prop covering
    // centering / typography / colors. The classes are semantic
    // hooks. No CSS rule needed; widening the inline styles
    // would just duplicate effort.
    "np-portfolio-error",
    "np-portfolio-members-error",
    "np-portfolio-members-not-found",
    "np-portfolio-not-found",
    // VERIFIED_LANDMARK — nav-toggle / mobile-subnav sit inside
    // the styled `.np-portfolio-nav*` family (styles.ts). Parents
    // provide layout. Desktop subnav + per-item wrapper were
    // dropped to match the design's flat single-level nav.
    "np-portfolio-mobile-subnav",
    "np-portfolio-nav-toggle",
    // VERIFIED_LANDMARK — `.np-portfolio-page-default` IS styled
    // (styles.ts:688); `np-portfolio-page` is a parent hook.
    "np-portfolio-page",
  ],
  docs: [
    // VERIFIED_LANDMARK — `np-docs` (bare) appears as a sibling
    // of `np-docs-shell` (styled) in members-shell.tsx, and as a
    // sibling of inline-styled error / members-error mains. Each
    // usage site has a layout-providing sibling.
    "np-docs",
    // VERIFIED_LANDMARK_INLINE — error.tsx + members-error.tsx +
    // not-found.tsx + members-not-found.tsx all render their
    // root with a full `style={{...}}` prop. No CSS rule needed.
    "np-docs-error",
    "np-docs-members-error",
    "np-docs-members-not-found",
    "np-docs-not-found",
    // VERIFIED_LANDMARK — child of `<article className="np-docs-page">`
    // (styled, styles.ts). Parent article handles padding /
    // max-width / typography; body div is a content hook.
    "np-docs-page-body",
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
