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
 * `theme-default` / `theme-minimal`. We aren't trying to lock
 * in every CSS rule; the goal is to prove each theme exposes
 * the expected manifest, slots, and templates so a future
 * refactor doesn't silently break them.
 */
describe.skipIf(skipIfNoTestDb())("example themes (magazine + portfolio)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
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

    // Templates: pages.default + pages.cover, posts.feature.
    const pageTemplates = magazineTheme.impl.templates?.pages ?? {};
    expect(Object.keys(pageTemplates).sort()).toEqual(["cover", "default"]);
    const postTemplates = magazineTheme.impl.templates?.posts ?? {};
    expect(Object.keys(postTemplates)).toEqual(["feature"]);
  });

  it("magazine cover template renders the title with the cover hero markup", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const Cover = magazineTheme.impl.templates!.pages!.cover!.component as (
      props: { doc: Record<string, unknown> },
    ) => React.ReactElement;
    const html = renderToString(
      Cover({ doc: { title: "Issue 01", coverImage: "https://example.com/c.jpg" } }),
    );
    expect(html).toContain("nx-magazine-cover");
    expect(html).toContain("Issue 01");
    // Background-image inline style should be present when the
    // cover field carries a URL.
    expect(html).toContain("background-image");
    expect(html).toContain("example.com/c.jpg");
  });

  it("magazine cover template falls back to a flat hero when no cover image is set", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const Cover = magazineTheme.impl.templates!.pages!.cover!.component as (
      props: { doc: Record<string, unknown> },
    ) => React.ReactElement;
    const html = renderToString(Cover({ doc: { title: "Untitled draft" } }));
    expect(html).toContain("nx-magazine-cover-hero");
    expect(html).toContain("Untitled draft");
    // No inline background-image style when no cover URL.
    expect(html).not.toContain("background-image");
  });

  it("portfolio theme exposes the expected manifest + slots + templates", async () => {
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    expect(portfolioTheme.manifest.id).toBe("portfolio");
    expect(portfolioTheme.impl.shell).toBeTypeOf("function");
    expect(portfolioTheme.impl.slots?.header).toBeTypeOf("function");
    expect(portfolioTheme.impl.slots?.footer).toBeTypeOf("function");
    const pageTemplates = portfolioTheme.impl.templates?.pages ?? {};
    expect(Object.keys(pageTemplates).sort()).toEqual(["default", "gallery"]);
  });

  it("portfolio gallery template wraps blocks in the grid container", async () => {
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const Gallery = portfolioTheme.impl.templates!.pages!.gallery!.component as (
      props: { doc: Record<string, unknown> },
    ) => React.ReactElement;
    const html = renderToString(Gallery({ doc: { title: "Selected work" } }));
    expect(html).toContain("nx-portfolio-gallery-grid");
    expect(html).toContain("Selected work");
  });

  it("each example theme's CSS is non-trivial and scoped under its own selectors", async () => {
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const magazineCss = magazineTheme.impl.css ?? "";
    const portfolioCss = portfolioTheme.impl.css ?? "";
    expect(magazineCss).toContain(".nx-magazine");
    expect(portfolioCss).toContain(".nx-portfolio");
    // Cross-pollination check: each theme's CSS should NOT
    // mention the other theme's classes.
    expect(magazineCss).not.toContain(".nx-portfolio");
    expect(portfolioCss).not.toContain(".nx-magazine");
  });
});
