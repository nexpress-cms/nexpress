import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Sanity coverage for the example themes shipped alongside
 * `theme-default` / `theme-magazine` / `theme-portfolio` / `theme-docs`. We aren't trying to lock
 * in every CSS rule; the goal is to prove each theme exposes
 * the expected manifest, slots, and templates so a future
 * refactor doesn't silently break them.
 */
describe.skipIf(skipIfNoTestDb())("example themes (magazine + portfolio)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("magazine theme exposes the expected manifest + slots + templates", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    expect(magazineTheme.manifest.id).toBe("magazine");
    expect(magazineTheme.impl.shell).toBeTypeOf("function");
    expect(magazineTheme.impl.slots?.header).toBeTypeOf("function");
    expect(magazineTheme.impl.slots?.footer).toBeTypeOf("function");

    // Templates: pages.default + pages.cover + pages.front + pages.masthead,
    // posts.feature + posts.list.
    // posts.list was added in the v0.2 reference impl (#612) for the
    // blog index route's theme template dispatch.
    // pages.front was added in the seed-architecture track (#782) so
    // magazine's seeded "/" page renders the editorial home layout.
    const pageTemplates = magazineTheme.impl.templates?.pages ?? {};
    expect(Object.keys(pageTemplates).sort()).toEqual(["cover", "default", "front", "masthead"]);
    const postTemplates = magazineTheme.impl.templates?.posts ?? {};
    expect(Object.keys(postTemplates).sort()).toEqual(["feature", "list"]);
  });

  it("magazine cover template renders the title with the cover hero markup", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const Cover = magazineTheme.impl.templates!.pages!.cover!.component as (props: {
      doc: Record<string, unknown>;
    }) => React.ReactElement;
    const html = renderToString(
      Cover({ doc: { title: "Issue 01", coverImage: "https://example.com/c.jpg" } }),
    );
    expect(html).toContain("np-magazine-cover");
    expect(html).toContain("Issue 01");
    // Background-image inline style should be present when the
    // cover field carries a URL.
    expect(html).toContain("background-image");
    expect(html).toContain("example.com/c.jpg");
  });

  it("magazine cover template falls back to a flat hero when no cover image is set", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const Cover = magazineTheme.impl.templates!.pages!.cover!.component as (props: {
      doc: Record<string, unknown>;
    }) => React.ReactElement;
    const html = renderToString(Cover({ doc: { title: "Untitled draft" } }));
    expect(html).toContain("np-magazine-cover-hero");
    expect(html).toContain("Untitled draft");
    // No inline background-image style when no cover URL.
    expect(html).not.toContain("background-image");
  });

  it("magazine masthead template renders the designed staff page", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const Masthead = magazineTheme.impl.templates!.pages!.masthead!.component as (props: {
      doc: Record<string, unknown>;
    }) => React.ReactElement;
    const html = renderToString(Masthead({ doc: { title: "Masthead" } }));
    expect(html).toContain("np-magazine-masthead");
    expect(html).toContain("Editor in chief");
  });

  it("portfolio theme exposes the expected manifest + slots + templates", async () => {
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    expect(portfolioTheme.manifest.id).toBe("portfolio");
    expect(portfolioTheme.impl.shell).toBeTypeOf("function");
    expect(portfolioTheme.impl.slots?.header).toBeTypeOf("function");
    expect(portfolioTheme.impl.slots?.footer).toBeTypeOf("function");
    // pages.front added by #783 — portfolio's seeded "/" lands on
    // the project-grid home layout.
    const pageTemplates = portfolioTheme.impl.templates?.pages ?? {};
    expect(Object.keys(pageTemplates).sort()).toEqual([
      "default",
      "front",
      "gallery",
      "journal",
      "press",
      "studio",
    ]);
  });

  it("portfolio gallery template wraps blocks in the grid container", async () => {
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const Gallery = portfolioTheme.impl.templates!.pages!.gallery!.component as (props: {
      doc: Record<string, unknown>;
    }) => React.ReactElement;
    const html = renderToString(Gallery({ doc: { title: "Selected work" } }));
    expect(html).toContain("np-portfolio-gallery-grid");
    expect(html).toContain("Selected work");
  });

  it("portfolio studio and press templates render without rich-text stubs", async () => {
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const Studio = portfolioTheme.impl.templates!.pages!.studio!.component as (props: {
      doc: Record<string, unknown>;
    }) => React.ReactElement;
    const Press = portfolioTheme.impl.templates!.pages!.press!.component as (props: {
      doc: Record<string, unknown>;
    }) => React.ReactElement;

    const studioHtml = renderToString(Studio({ doc: { title: "Studio" } }));
    const pressHtml = renderToString(Press({ doc: { title: "Press" } }));

    expect(studioHtml).toContain("np-portfolio-studio-page");
    expect(studioHtml).toContain("Creative direction");
    expect(pressHtml).toContain("np-portfolio-press-page");
    expect(pressHtml).toContain("Selected coverage");
  });

  it("each example theme's CSS is non-trivial and scoped under its own selectors", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const magazineCss = magazineTheme.impl.css ?? "";
    const portfolioCss = portfolioTheme.impl.css ?? "";
    expect(magazineCss).toContain(".np-magazine");
    expect(portfolioCss).toContain(".np-portfolio");
    // Cross-pollination check: each theme's CSS should NOT
    // mention the other theme's classes.
    expect(magazineCss).not.toContain(".np-portfolio");
    expect(portfolioCss).not.toContain(".np-magazine");
  });

  it("example themes use logical (RTL-safe) properties for directional layout", async () => {
    // Sprint S RTL audit follow-up — physical-direction CSS
    // (`float: left/right`, `margin-left/right`, etc.) breaks
    // RTL locales because the leading edge flips. The default
    // theme already uses logical equivalents (`float: inline-*`,
    // `margin-inline-*`); this test pins the same expectation
    // on the example themes so a future hand-edit can't
    // regress to physical properties without the suite catching
    // it.
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const magazineCss = magazineTheme.impl.css ?? "";
    const portfolioCss = portfolioTheme.impl.css ?? "";

    // NOTE: these regexes inspect the raw CSS string, so any
    // mention of e.g. `float: left` inside a CSS COMMENT will
    // also trip them. Phrase RTL fixes accordingly — describe
    // the fix in terms of "leading edge" / "logical-property
    // equivalents" rather than the physical-direction names.
    for (const css of [magazineCss, portfolioCss]) {
      // Disallow `float: left|right` (use `float: inline-start|end`).
      expect(css).not.toMatch(/float:\s*(left|right)\b/);
      // Disallow physical margin/padding sides; logical
      // equivalents (`margin-inline-start`, `padding-inline-end`,
      // etc.) are required.
      expect(css).not.toMatch(/\bmargin-(left|right)\s*:/);
      expect(css).not.toMatch(/\bpadding-(left|right)\s*:/);
      // Disallow physical `text-align: left|right` (use `start`
      // / `end` so the alignment flips with the document
      // direction). `text-align: center` and `justify` are
      // bidi-safe and stay allowed.
      expect(css).not.toMatch(/text-align:\s*(left|right)\b/);
    }

    // Magazine specifically depends on a leading-edge drop cap;
    // assert the logical-property migration is present so a
    // refactor that strips the comment can't silently revert.
    expect(magazineCss).toContain("float: inline-start");
  });
});
