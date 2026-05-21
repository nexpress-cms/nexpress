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
 * Why `mergeThemeRequirements` runs per-`it`:
 *   - The base `postsCollection` ships with `kind` options =
 *     `[{ Article }]`. Themes contribute their kind option via
 *     `requires.collections.posts.fields.kind` (docs adds Doc,
 *     portfolio adds Project). `defineConfig` applies the merge at
 *     boot in the real app; the unit-level test harness short-
 *     circuits that. Each `it` re-registers `posts` against a
 *     theme-specific merge so seeding `kind: "doc"` /
 *     `kind: "project"` passes the generated Zod validator.
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
   * Registers `theme` and re-registers the `posts` collection
   * against a `defaultTheme + theme` merge so the kind options
   * the theme contributes are visible to the seed-time validator.
   * Pages / categories / tags stay on the base test config —
   * none of the front templates reach into them, and the merge
   * is a no-op for collections the theme doesn't `require`.
   */
  async function activateThemeForSeed(themeId: "magazine" | "portfolio" | "docs"): Promise<void> {
    const { mergeThemeRequirements, registerCollection, registerThemes, resetThemes } =
      await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const { docsTheme } = await import("@nexpress/theme-docs");
    const { postsCollection } = await import("@nexpress/app/collections/posts");
    const { postsTable } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/integration/fixtures.js"
    );

    const theme =
      themeId === "magazine" ? magazineTheme : themeId === "portfolio" ? portfolioTheme : docsTheme;

    const merged = mergeThemeRequirements([postsCollection], [defaultTheme, theme]);
    const mergedPosts = merged.find((c) => c.slug === "posts");
    if (!mergedPosts) {
      throw new Error("mergeThemeRequirements dropped the posts collection");
    }
    registerCollection("posts", postsTable, {
      ...mergedPosts,
      access: undefined,
      hooks: undefined,
    });

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

  it("portfolio pages.front renders the studio grid with seeded projects", async () => {
    await activateThemeForSeed("portfolio");
    const actor = await asActor();
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    const { findDocuments } = await import("@nexpress/core");
    const { seedAll } = await import("@/lib/seed-content");

    const seed = await seedAll(actor, portfolioTheme);
    expect(seed.posts.created).toBeGreaterThan(0);
    expect(seed.pages.created).toBeGreaterThanOrEqual(4);

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
