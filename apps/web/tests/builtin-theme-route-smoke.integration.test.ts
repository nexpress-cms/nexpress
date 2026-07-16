import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import type { NpRouteRenderProps, NpThemeDefinition } from "@nexpress/theme";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type BuiltinThemeId = "default" | "docs" | "magazine" | "portfolio";

interface ThemeFixture {
  id: BuiltinThemeId;
  theme: NpThemeDefinition;
}

type RouteComponent = (props: NpRouteRenderProps) => ReactElement | Promise<ReactElement>;

async function renderHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

/**
 * Public-route smoke coverage for the bundled themes.
 *
 * More specific tests pin the template internals; this suite makes
 * sure each seeded demo theme has working representative public
 * paths after a real seed run. It intentionally stays at the RSC
 * component boundary instead of starting Next.js: cheaper than
 * Playwright, but still catches missing route components, broken
 * seed slugs, empty archive queries, and stale project/doc links.
 */
describe.skipIf(skipIfNoTestDb())("built-in theme public route smoke", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("plugins");
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function loadTheme(id: BuiltinThemeId): Promise<ThemeFixture> {
    if (id === "default") {
      const { defaultTheme } = await import("@nexpress/theme-default");
      return { id, theme: defaultTheme };
    }
    if (id === "docs") {
      const { docsTheme } = await import("@nexpress/theme-docs");
      return { id, theme: docsTheme };
    }
    if (id === "magazine") {
      const { magazineTheme } = await import("@nexpress/theme-magazine");
      return { id, theme: magazineTheme };
    }
    const { portfolioTheme } = await import("@nexpress/theme-portfolio");
    return { id, theme: portfolioTheme };
  }

  async function activateThemeForSeed(id: BuiltinThemeId): Promise<ThemeFixture> {
    const fixture = await loadTheme(id);
    const { registerThemes, resetThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const themes = id === "default" ? [defaultTheme] : [defaultTheme, fixture.theme];

    resetThemes();
    registerThemes(themes);
    return fixture;
  }

  async function seedTheme(fixture: ThemeFixture): Promise<void> {
    const user = await seedUser({ role: "admin" });
    const actor = {
      id: user.userId,
      email: user.email,
      name: "Test Admin",
      role: user.role,
      tokenVersion: 0,
    };
    const { seedAll } = await import("@/lib/seed-content");
    const seeded = await seedAll(actor, fixture.theme);
    expect(seeded.pages.created + seeded.posts.created).toBeGreaterThan(0);
  }

  async function renderPageTemplate(
    fixture: ThemeFixture,
    slug: string,
    expected: string,
  ): Promise<void> {
    const { createSiteScopedBlockRenderContext } = await import("@nexpress/next");
    const { findDocuments } = await import("@nexpress/core");
    const result = await findDocuments<Record<string, unknown>>("pages", {
      where: { slug, status: "published", seedSource: `theme:${fixture.id}` },
      limit: 1,
    });
    const doc = result.docs[0];
    expect(doc).toBeDefined();

    const templateId = typeof doc?.template === "string" ? doc.template : "default";
    const template = fixture.theme.impl.templates?.pages?.[templateId]?.component;
    expect(template).toBeTypeOf("function");

    const element = await template!({
      doc: doc!,
      blockCtx: await createSiteScopedBlockRenderContext(),
    });
    const html = await renderHtml(element);
    expect(html).toContain(expected);
    expect(html).not.toContain("No stories yet.");
  }

  async function renderThemeRoute(
    fixture: ThemeFixture,
    path: string,
    expected: string,
    searchParams: Record<string, string | string[] | undefined> = {},
  ): Promise<void> {
    const { buildRouteRenderProps, createSiteScopedBlockRenderContext, dispatchThemeRoute } =
      await import("@nexpress/next");
    const match = dispatchThemeRoute(fixture.theme, path);
    expect(match).not.toBeNull();
    const props = buildRouteRenderProps({
      match: match!,
      searchParams,
      blockCtx: await createSiteScopedBlockRenderContext(),
    });
    const element = await (match!.route.component as RouteComponent)(props);
    const html = await renderHtml(element);
    expect(html).toContain(expected);
    expect(html).not.toContain("not found");
    expect(html).not.toContain("No stories yet.");
  }

  it("default renders its seeded home, post detail template, and tag archive route", async () => {
    const fixture = await activateThemeForSeed("default");
    await seedTheme(fixture);

    await renderPageTemplate(fixture, "/", "np-post-list");

    const { createSiteScopedBlockRenderContext } = await import("@nexpress/next");
    const { findDocuments } = await import("@nexpress/core");
    const posts = await findDocuments<Record<string, unknown>>("posts", {
      where: {
        slug: "read-your-writes-without-the-asterisks",
        status: "published",
        seedSource: "theme:default",
      },
      limit: 1,
    });
    const post = posts.docs[0];
    expect(post).toBeDefined();
    const PostTemplate = fixture.theme.impl.templates!.posts!.default!.component;
    const postHtml = await renderHtml(
      await PostTemplate({
        doc: post!,
        blockCtx: await createSiteScopedBlockRenderContext(),
      }),
    );
    expect(postHtml).toContain("np-post-hero");
    expect(postHtml).toContain('href="/tag/postgres"');

    await renderThemeRoute(fixture, "/tag/postgres", "np-default-tag-metrics");
  });

  it("docs renders its seeded landing, search, and doc detail route", async () => {
    const fixture = await activateThemeForSeed("docs");
    await seedTheme(fixture);

    await renderPageTemplate(fixture, "/", "np-docs-front-groups");
    await renderThemeRoute(fixture, "/docs/search", "Search the docs");
    await renderThemeRoute(fixture, "/docs/plugin-author-quickstart", "Scaffold the plugin");
  });

  it("magazine renders its seeded front page and section/category archive routes", async () => {
    const fixture = await activateThemeForSeed("magazine");
    await seedTheme(fixture);

    await renderPageTemplate(fixture, "/", "np-magazine-lead");
    await renderPageTemplate(fixture, "masthead", "np-magazine-masthead");
    await renderPageTemplate(fixture, "issue-12", "np-magazine-cover");
    await renderPageTemplate(fixture, "colophon", "np-block-rich-text");
    await renderPageTemplate(fixture, "contact", "np-block-rich-text");
    await renderThemeRoute(fixture, "/features", "np-magazine-section-list");
    await renderThemeRoute(fixture, "/category/features", "np-magazine-archive");
  });

  it("portfolio renders its seeded work pages and project detail route", async () => {
    const fixture = await activateThemeForSeed("portfolio");
    await seedTheme(fixture);

    await renderPageTemplate(fixture, "/", "np-portfolio-grid");
    await renderPageTemplate(fixture, "studio", "np-portfolio-studio-page");
    await renderPageTemplate(fixture, "gallery", "np-portfolio-gallery");
    await renderPageTemplate(fixture, "journal", "np-portfolio-journal-page");
    const { findDocuments } = await import("@nexpress/core");
    const projects = await findDocuments<Record<string, unknown>>("posts", {
      where: { status: "published", kind: "project", seedSource: "theme:portfolio" },
      sort: "-publishedAt",
      limit: 1,
    });
    const slug = projects.docs[0]?.slug;
    expect(slug).toBeTypeOf("string");
    await renderThemeRoute(fixture, `/work/${slug as string}`, "np-portfolio-project");
  });
});
