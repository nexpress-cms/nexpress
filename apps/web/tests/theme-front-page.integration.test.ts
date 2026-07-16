import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Front-page render coverage for the three themes that ship a
 * `pages.front` template (magazine, portfolio, docs). Closes the
 * remaining gap from the theme-track wish list — `theme-seed-reseed`
 * (#840) locked in the data-layer side; this file proves the
 * full seed → fetch-on-render → template-output path produces the
 * landmarks each theme's design depends on.
 *
 * Why component-level (not Playwright):
 *   - Each front template is an async server component that pulls
 *     posts from the DB at render time. We seed the DB, then call
 *     the template directly. No Next.js routing, no webserver,
 *     no Playwright cost.
 *   - The site catch-all (`(site)/[[...slug]]/page.tsx`) is a thin
 *     resolver — find the slug-`/` page, dispatch to the theme's
 *     `pages.<template>` component, render. That dispatch logic
 *     has its own coverage (`theme-templates.integration.test.ts`).
 *     Bundling the catch-all into these tests would add a Next
 *     render harness for no extra signal.
 *
 * `registerTestCollections()` installs the same all-theme collection
 * definition that generated the integration tables. Individual cases only
 * switch the active theme; narrowing the collection definition to one theme
 * would make valid columns from the generated union look unknown.
 */
describe.skipIf(skipIfNoTestDb())("theme front-page rendering", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    // "plugins" tier so seed hooks (slug, search-vector, etc.)
    // fire — matches `theme-seed-reseed.integration.test.ts`.
    await ensureFor("plugins");
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function asActor() {
    const user = await seedUser({ role: "admin" });
    return {
      id: user.userId,
      email: user.email,
      name: "Test Admin",
      role: user.role,
      tokenVersion: 0,
    };
  }

  /**
   * Registers `theme`; the collection registry remains on the exact
   * all-theme definition installed by `registerTestCollections()`.
   */
  async function activateThemeForSeed(themeId: "magazine" | "portfolio" | "docs"): Promise<void> {
    const { registerThemes, resetThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const { docsTheme } = await import("@nexpress/theme-docs");
    const theme =
      themeId === "magazine" ? magazineTheme : themeId === "portfolio" ? portfolioTheme : docsTheme;

    resetThemes();
    registerThemes([defaultTheme, theme]);
  }

  it("magazine pages.front renders the editorial index with seeded articles", async () => {
    await activateThemeForSeed("magazine");
    const actor = await asActor();
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { seedAll } = await import("@/lib/seed-content");

    const seed = await seedAll(actor, magazineTheme);
    expect(seed.posts.created).toBeGreaterThan(0);

    const Front = magazineTheme.impl.templates!.pages!.front!.component;
    // PageFrontTemplate is an async RSC; calling it returns a
    // Promise resolving to the JSX of its delegate (PostListTemplate),
    // which is itself async. `await`ing the outer call unwraps both —
    // an async function that `return`s a Promise resolves to that
    // Promise's resolved value.
    const element = await (
      Front as (props: { doc: Record<string, unknown> }) => Promise<React.ReactElement>
    )({ doc: {} });
    const html = renderToString(element);

    // PostListTemplate's main container — always emitted when at
    // least one article is in scope.
    expect(html).toContain("np-magazine-index");
    // The cover-story lead block — proves the first seeded post
    // surfaced as the editorial lead, not the empty fallback
    // ("The next issue is on press.").
    expect(html).toContain("np-magazine-lead");
    expect(html).not.toContain("The next issue is on press.");
    // The first seeded post's title bleeds through into the
    // lead's link aria-label / heading. Pin to a substring that's
    // unique to SEED_POSTS[0]; if that entry is renamed the
    // assertion is the right place for the test to fail. Stops
    // before the apostrophe so HTML-entity encoding (React 19
    // emits `&#x27;` for `'` in text nodes) doesn't matter.
    expect(html).toContain("The cartographers of a city that");
  });

  it("magazine section, category, tag, and date archives render seeded posts", async () => {
    await activateThemeForSeed("magazine");
    const actor = await asActor();
    const { magazineTheme, MagazineSectionArchiveRoute } = await import("@nexpress/theme-magazine");
    const { createSiteScopedBlockRenderContext } = await import("@nexpress/next");
    const { seedAll } = await import("@/lib/seed-content");

    const seed = await seedAll(actor, magazineTheme);
    expect(seed.posts.created).toBeGreaterThan(0);
    expect(seed.terms.tagsCreated).toBeGreaterThan(0);
    expect(seed.terms.categoriesCreated).toBeGreaterThan(0);

    const blockCtx = await createSiteScopedBlockRenderContext();
    const sectionElement = await MagazineSectionArchiveRoute({
      params: { section: "features" },
      searchParams: {},
      blockCtx,
    });
    const sectionHtml = renderToString(sectionElement);
    expect(sectionHtml).toContain("np-magazine-section-list");
    expect(sectionHtml).toContain("The cartographers of a city that");
    expect(sectionHtml).not.toContain("No stories yet.");

    const Category = magazineTheme.impl.archives!.posts!.byCategory!.component as (props: {
      params: Record<string, string>;
      searchParams: Record<string, string>;
      blockCtx: typeof blockCtx;
    }) => Promise<React.ReactElement>;
    const categoryElement = await Category({
      params: { slug: "features" },
      searchParams: {},
      blockCtx,
    });
    const categoryHtml = renderToString(categoryElement);
    expect(categoryHtml).toContain("np-magazine-archive");
    expect(categoryHtml).toContain("The cartographers of a city that");
    expect(categoryHtml).not.toContain("No stories yet.");

    const Tag = magazineTheme.impl.archives!.posts!.byTag!.component as (props: {
      params: Record<string, string>;
      searchParams: Record<string, string>;
      blockCtx: typeof blockCtx;
    }) => Promise<React.ReactElement>;
    const tagElement = await Tag({
      params: { slug: "cities" },
      searchParams: {},
      blockCtx,
    });
    const tagHtml = renderToString(tagElement);
    expect(tagHtml).toContain("np-magazine-archive");
    expect(tagHtml).toContain("The cartographers of a city that");
    expect(tagHtml).not.toContain("No stories yet.");

    const DateArchive = magazineTheme.impl.archives!.posts!.byDate!.component as (props: {
      params: Record<string, string>;
      searchParams: Record<string, string>;
      blockCtx: typeof blockCtx;
    }) => Promise<React.ReactElement>;
    const dateElement = await DateArchive({
      params: { year: "2026", month: "05" },
      searchParams: {},
      blockCtx,
    });
    const dateHtml = renderToString(dateElement);
    expect(dateHtml).toContain("May 2026");
    expect(dateHtml).toContain("The cartographers of a city that");
    expect(dateHtml).not.toContain("No stories yet.");
  });

  it("portfolio pages.front renders the studio grid with seeded projects", async () => {
    await activateThemeForSeed("portfolio");
    const actor = await asActor();
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const { findDocuments } = await import("@nexpress/core");
    const { seedAll } = await import("@/lib/seed-content");

    const seed = await seedAll(actor, portfolioTheme);
    expect(seed.posts.created).toBeGreaterThan(0);
    expect(seed.pages.created).toBeGreaterThanOrEqual(3);

    const seededProjects = await findDocuments<Record<string, unknown>>("posts", {
      where: { seedSource: "theme:portfolio", kind: "project" },
      limit: 20,
    });
    const seededJournal = await findDocuments<Record<string, unknown>>("posts", {
      where: { seedSource: "theme:portfolio", kind: "article" },
      limit: 20,
    });
    expect(seededProjects.docs.length).toBeGreaterThan(0);
    expect(seededJournal.docs.length).toBeGreaterThan(0);

    const Front = portfolioTheme.impl.templates!.pages!.front!.component;
    const element = await (
      Front as (props: { doc: Record<string, unknown> }) => Promise<React.ReactElement>
    )({ doc: {} });
    const html = renderToString(element);

    // Hero strip is unconditional, but the grid section only
    // shows projects when `fetchFrontListPosts({ kind: "project" })`
    // returns docs. Pre-fix (SEED_PROJECTS had no `kind` field),
    // the projects defaulted to `kind: "article"` and this section
    // rendered empty — the bug this PR closes.
    expect(html).toContain("np-portfolio-hero");
    expect(html).toContain("np-portfolio-container");
    // First seeded project's title surfaces in the grid.
    expect(html).toContain("Hanmi Gallery");
    expect(html).toContain('href="/work/');
    expect(html).not.toContain('href="/projects/');
  });

  it("docs pages.front renders the documentation landing with seeded doc tree", async () => {
    await activateThemeForSeed("docs");
    const actor = await asActor();
    const { docsTheme } = await import("@nexpress/theme-docs");
    const { seedAll } = await import("@/lib/seed-content");

    const seed = await seedAll(actor, docsTheme);
    expect(seed.posts.created).toBeGreaterThan(0);

    const Front = docsTheme.impl.templates!.pages!.front!.component;
    const element = await (
      Front as (props: { doc: Record<string, unknown> }) => Promise<React.ReactElement>
    )({ doc: {} });
    const html = renderToString(element);

    // Outer article wrapper + hero are always emitted; the
    // groups section only renders when the seeded `kind="doc"`
    // tree is non-empty. The test asserts both so a regression
    // that stops seeded docs from surfacing (e.g. kind=doc filter
    // breaks, or seed posts lose their kind tag) fails here
    // instead of silently rendering the bare hero.
    expect(html).toContain("np-docs-front");
    expect(html).toContain("np-docs-front-hero");
    expect(html).toContain("np-docs-front-groups");
  });
});
