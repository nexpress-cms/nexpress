import {
  buildWebSiteJsonLd,
  findSlugRedirect,
  getPageBySlug,
  getPluginTemplatesForCollection,
  resolveTemplateComponent,
} from "@nexpress/core";
import {
  buildPageMetadata,
  buildPluginRouteRenderProps,
  buildRouteRenderProps,
  collectThemeRoutes,
  createSiteScopedBlockRenderContext,
  dispatchPluginRoute,
  dispatchThemeRoute,
} from "@nexpress/next";
import { getCachedActiveTheme } from "@/lib/cached-theme";
import { renderBlocks } from "@nexpress/blocks";
import type { NpBlockRenderContext } from "@nexpress/blocks";
import type { ComponentType } from "react";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import type { NpPageBlocks } from "@nexpress/blocks";

import { DefaultHomePage } from "../../components/default-home-page";
import { JsonLd } from "@nexpress/next";
import { ShellWrap } from "../../components/shell-wrap";
import { i18nConfig, isLocale } from "@/i18n.config";
import { ensureFor } from "@/lib/init-core";

/**
 * Phase 12.2 — peel a locale prefix off the path. Returns
 * `{ locale, path }` where `path` is the slug WITHOUT the
 * leading locale segment (so DB lookups match the stored
 * slug). When the URL doesn't carry a recognized locale, the
 * site's default locale is returned and the path is unchanged.
 */
function splitLocaleFromPath(rawPath: string): {
  locale: string;
  path: string;
} {
  const segments = rawPath.split("/").filter(Boolean);
  const first = segments[0];
  if (first && isLocale(first)) {
    const remaining = segments.slice(1).join("/") || "/";
    return { locale: first, path: remaining };
  }
  return { locale: i18nConfig.defaultLocale, path: rawPath };
}

/**
 * Build hreflang `<link rel="alternate">` URLs for every locale
 * we render the same logical page in. Used for both metadata
 * (next/Metadata) and the in-document JSX fallback.
 */
function buildHreflangAlternates(
  pathWithoutLocale: string,
): Array<{ hreflang: string; href: string }> {
  return i18nConfig.locales.map((loc) => {
    const path = pathWithoutLocale === "/" ? `/${loc}` : `/${loc}/${pathWithoutLocale}`;
    return { hreflang: loc, href: path };
  });
}
import {
  RenderBodyEnd,
  RenderHead,
  collectRenderContributions,
} from "../../components/render-contributions";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  // PRT.3 — bumped to `"plugins"` so `dispatchPluginRoute`
  // below sees plugin-contributed routes on the first cold-
  // start request. `generateMetadata` runs in parallel with
  // `CatchAllPage` (which already does `ensureFor("plugins")`),
  // so without this bump the metadata path could race on first
  // request and emit page-fallback SEO for plugin URLs.
  await ensureFor("plugins");
  const { slug } = await params;
  const rawPath = slug?.join("/") || "/";
  const { locale, path } = splitLocaleFromPath(rawPath);
  const page = await getPageBySlug(path, { locale });

  // hreflang alternates: any path that resolves under i18n
  // routing gets one alternate per configured locale plus
  // x-default pointing at the canonical default-locale URL.
  // Search engines use this to deduplicate translated copies.
  const alternates = buildHreflangAlternates(path === "/" ? "" : path);
  const xDefault = path === "/" ? "/" : `/${path}`;

  // Phase F.2 — when no page document matches but a theme route
  // does, defer to the route's `metadata` builder. Without this,
  // theme-rendered URLs (e.g. `/category/foo`) would emit
  // page-fallback SEO based on whatever DefaultHomePage carries
  // — a real bug the design doc §4.2 calls out explicitly.
  // Page lookup wins over theme route, mirroring the renderer.
  if (!page) {
    const activeTheme = await getCachedActiveTheme();
    const match = dispatchThemeRoute(activeTheme, path);
    if (match?.route.metadata) {
      const sp = await searchParams;
      const themeMetadata = await match.route.metadata(
        buildRouteRenderProps({
          match,
          searchParams: sp,
          // metadata builders rarely render blocks, but pass the
          // site-scoped ctx for symmetry with the Page render
          // path so any theme that does dispatch blocks from
          // metadata gets the same source filtering.
          blockCtx: await createSiteScopedBlockRenderContext(),
        }),
      );
      return {
        ...themeMetadata,
        alternates: {
          ...(themeMetadata.alternates ?? {}),
          languages: {
            ...Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
            "x-default": xDefault,
          },
        },
      };
    }

    // PRT.2 — plugin route metadata. Same precedence as the
    // renderer: theme metadata wins, then plugin metadata.
    // Without this branch, plugin-served URLs would emit
    // page-fallback SEO based on whatever DefaultHomePage
    // carries — same bug F.2 closed for theme routes.
    const themeRoutes = activeTheme ? collectThemeRoutes(activeTheme) : [];
    const pluginMatch = await dispatchPluginRoute({
      localeAwarePath: path,
      themeRoutes,
    });
    if (pluginMatch?.route.metadata) {
      const sp = await searchParams;
      const pluginMetadata = await pluginMatch.route.metadata(
        buildPluginRouteRenderProps({
          match: pluginMatch,
          searchParams: sp,
          blockCtx: await createSiteScopedBlockRenderContext(),
        }),
      );
      return {
        ...pluginMetadata,
        alternates: {
          ...(pluginMetadata.alternates ?? {}),
          languages: {
            ...Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
            "x-default": xDefault,
          },
        },
      };
    }
  }

  // Pages without a published row fall back to site-wide
  // defaults; that's also what the `DefaultHomePage` empty-state
  // surface uses, so the meta tags still describe the brand.
  const metadata = await buildPageMetadata({
    title: typeof page?.title === "string" ? page.title : null,
    description: typeof page?.seoDescription === "string" ? page.seoDescription : null,
    path: rawPath === "/" ? "/" : `/${rawPath}`,
    ogType: "website",
    locale,
  });

  return {
    ...metadata,
    alternates: {
      ...(metadata.alternates ?? {}),
      languages: {
        ...Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
        "x-default": xDefault,
      },
    },
  };
}

export default async function CatchAllPage({ params, searchParams }: PageProps) {
  await ensureFor("plugins");
  const { slug } = await params;
  const rawPath = slug?.join("/") || "/";
  // Phase 12.2 — strip the locale prefix BEFORE looking the
  // doc up. Stored slugs don't include the prefix; the URL's
  // locale segment is metadata for routing / hreflang.
  const { locale: requestedLocale, path } = splitLocaleFromPath(rawPath);
  const { isEnabled: isDraft } = await draftMode();

  // Locale-scoped lookup: `pages` is i18n-enabled, so the unique
  // index is `(site_id, locale, slug)` — the same slug resolves
  // to different rows depending on the visitor's locale.
  // `splitLocaleFromPath` (above) peeled the URL's locale segment
  // off `path`; the middleware (`apps/web/src/proxy.ts`)
  // propagates the locale via header but does NOT rewrite the
  // URL, so the strip has to happen here on the server route.
  const page = await getPageBySlug(path, {
    draft: isDraft,
    locale: requestedLocale,
  });

  if (!page) {
    // Slug rename history — when a page used to live at this path
    // but got renamed, walk `np_slug_history` to the current
    // target and 301. Search-engine indices, external links, and
    // bookmarks survive the rename. Slug history is a specific
    // operator-intent record (this URL used to point somewhere)
    // so it wins over a generic theme route match.
    const slugWithoutLeadingSlash = path.replace(/^\/+/, "");
    const target = await findSlugRedirect("pages", slugWithoutLeadingSlash);
    if (target) {
      const localePrefix =
        rawPath.startsWith(`${requestedLocale}/`) || rawPath === requestedLocale
          ? `/${requestedLocale}`
          : "";
      const targetPath = target === "/" ? "/" : `/${target.replace(/^\/+/, "")}`;
      // `permanentRedirect` issues a 308 (the modern 301), telling
      // search engines and clients that the move is permanent so
      // they update their indices. Plain `redirect` would default
      // to 307 — fine for app routing but wrong for slug renames
      // search-engine-wise.
      permanentRedirect(`${localePrefix}${targetPath}`);
    }

    // Phase F.2 — theme route dispatcher. Precedence after page
    // slug + slug-redirect, before the `/` empty-state and 404.
    // Operator-authored content (existing pages, redirects from
    // renamed pages) always wins over theme contributions, so
    // a theme can never silently shadow a CMS page or its
    // history. See `docs/design/theme-v0.2-extension.md` §4.2.
    const activeTheme = await getCachedActiveTheme();
    const match = dispatchThemeRoute(activeTheme, path);
    if (match) {
      const blockCtx = await createSiteScopedBlockRenderContext();
      const RouteComponent = match.route.component;
      const sp = await searchParams;
      const props = buildRouteRenderProps({
        match,
        searchParams: sp,
        blockCtx,
      });
      // Theme routes are public-site by definition.
      return (
        <ShellWrap surface="site">
          <RouteComponent {...props} />
        </ShellWrap>
      );
    }

    // PRT.2 — plugin route dispatcher (#623). Runs after theme
    // dispatch, before the `/` empty-state and 404. Theme >
    // plugin precedence is enforced by ORDER (theme tried first
    // above) plus the boot collision warning emitted by the
    // dispatcher itself when the same pattern is registered on
    // both sides.
    const themeRoutes = activeTheme ? collectThemeRoutes(activeTheme) : [];
    const pluginMatch = await dispatchPluginRoute({
      localeAwarePath: path,
      themeRoutes,
    });
    if (pluginMatch) {
      const blockCtx = await createSiteScopedBlockRenderContext();
      const PluginRouteComponent = pluginMatch.route.component;
      const sp = await searchParams;
      const props = buildPluginRouteRenderProps({
        match: pluginMatch,
        searchParams: sp,
        blockCtx,
      });
      // v0.2 — pick chrome based on the plugin route's declared
      // surface. `surface: "member"` plugin routes (forum's
      // `/discussions/new`, `/discussions/:slug/edit`) render with
      // member chrome (`impl.members.shell` + chrome fallback)
      // even though they live under the (site) catch-all.
      // Without this dispatch a parallel `(member)/[[...slug]]`
      // file route would be needed, which Next.js refuses (URL
      // conflict with this catch-all).
      return (
        <ShellWrap surface={pluginMatch.route.surface}>
          <PluginRouteComponent {...props} />
        </ShellWrap>
      );
    }

    // The site root is special: a fresh install with no pages
    // and no theme route for `/` would 404 and look broken.
    // Surface a default landing page that confirms NexPress is
    // running and points the operator at /admin. Once an admin
    // publishes a real `pages` row with slug `/` OR the active
    // theme declares a `/` route, the lookup above succeeds and
    // this branch never runs.
    if (path === "/") {
      const websiteJsonLd = await buildWebSiteJsonLd();
      return (
        <ShellWrap surface="site">
          <JsonLd data={websiteJsonLd as unknown as Record<string, unknown>} />
          <DefaultHomePage />
        </ShellWrap>
      );
    }

    notFound();
  }

  const pageBlocks = page.blocks as NpPageBlocks | undefined;

  const { head, bodyEnd } = await collectRenderContributions({
    collection: "pages",
    slug: path,
    document: page,
  });

  // The site root gets a WebSite + SearchAction descriptor so
  // search engines can render the sitelinks searchbox in SERP.
  // Other paths skip the descriptor (a generic page row isn't a
  // distinct schema.org type worth expressing here).
  const websiteJsonLd = path === "/" ? await buildWebSiteJsonLd() : null;

  // Phase 11.3 — page template dispatch. The doc carries a
  // `template` id; we look it up in the active theme's
  // `templates.pages` map, fall back to the theme's `default`
  // template, and only if both are missing fall through to the
  // historical block-renderer path. Themes that don't declare
  // any `pages` templates keep working identically — this is
  // additive.
  const Template = await resolvePageTemplate(
    typeof page.template === "string" ? page.template : null,
  );

  // Issue #476 — build a server-side block render ctx and thread
  // it into both the theme template path and the historical
  // fallback renderer. Without this, data-bound blocks
  // (`latest-posts`, `stats.counter`, plugin-contributed dynamic
  // blocks) render the "ctx unavailable" placeholder instead of
  // querying content. Theme packages no longer have to import
  // `@nexpress/next` themselves — the ctx arrives as a prop.
  //
  // Phase F.4 — use the site-scoped variant so block instances
  // belonging to inactive themes (operator switched themes; old
  // page documents still carry magazine.* blocks under a
  // portfolio-active site) render as the "from inactive theme"
  // placeholder instead of mis-rendering with missing CSS.
  const blockCtx = await createSiteScopedBlockRenderContext();

  return (
    <ShellWrap surface="site">
      {websiteJsonLd ? <JsonLd data={websiteJsonLd as unknown as Record<string, unknown>} /> : null}
      <RenderHead entries={head} />
      {isDraft ? (
        <div
          className="np-draft-banner"
          style={{
            padding: "0.75rem 1rem",
            background: "#fef3c7",
            color: "#92400e",
            fontSize: "0.875rem",
            textAlign: "center",
          }}
        >
          Draft preview —{" "}
          <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>
            exit
          </a>
        </div>
      ) : null}
      {Template ? (
        <Template doc={page} blockCtx={blockCtx} />
      ) : (
        <div className="np-page">
          {pageBlocks ? (
            renderBlocks(pageBlocks, { ctx: blockCtx })
          ) : (
            <h1>{(page.title as string) ?? "Untitled"}</h1>
          )}
        </div>
      )}
      <RenderBodyEnd entries={bodyEnd} />
    </ShellWrap>
  );
}

/**
 * Resolves the page template component from the active theme.
 * Tries the doc's chosen template id, then the theme's
 * `default`, then null (which signals the catch-all to use the
 * historical block renderer). Returns the component itself so
 * the route doesn't have to know how the theme stored it.
 */
async function resolvePageTemplate(
  templateId: string | null,
): Promise<ComponentType<{
  doc: Record<string, unknown>;
  blockCtx?: NpBlockRenderContext;
}> | null> {
  // Phase 14.5 — lookup walks theme → plugin so theme templates
  // take precedence on id collision (active theme is the site's
  // design authority). The historical theme.default fallback
  // still applies when the doc didn't pick anything specific.
  if (templateId) {
    const explicit = (await resolveTemplateComponent("pages", templateId)) as {
      component?: ComponentType<{ doc: Record<string, unknown>; blockCtx?: NpBlockRenderContext }>;
    } | null;
    if (explicit?.component) return explicit.component;
  }

  // Default fallback: prefer theme's `default` over plugin's.
  const active = await getCachedActiveTheme();
  const themeDefault = active?.impl.templates?.pages?.default?.component as
    | ComponentType<{ doc: Record<string, unknown>; blockCtx?: NpBlockRenderContext }>
    | undefined;
  if (themeDefault) return themeDefault;

  const pluginDefault = (
    getPluginTemplatesForCollection("pages").get("default") as
      | {
          component?: ComponentType<{
            doc: Record<string, unknown>;
            blockCtx?: NpBlockRenderContext;
          }>;
        }
      | undefined
  )?.component;
  return pluginDefault ?? null;
}
