import {
  buildPageMetadata,
  buildWebSiteJsonLd,
  findSlugRedirect,
  getPageBySlug,
  getPluginTemplatesForCollection,
  resolveTemplateComponent,
} from "@nexpress/core";
import { createDefaultBlockRenderContext } from "@nexpress/next";
import { getCachedActiveTheme } from "@/lib/cached-theme";
import { renderBlocks } from "@nexpress/blocks";
import type { NpBlockRenderContext } from "@nexpress/blocks";
import type { ComponentType } from "react";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import type { NpPageBlocks } from "@nexpress/blocks";

import { DefaultHomePage } from "@/components/default-home-page";
import { JsonLd } from "@/components/json-ld";
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
    const path =
      pathWithoutLocale === "/" ? `/${loc}` : `/${loc}/${pathWithoutLocale}`;
    return { hreflang: loc, href: path };
  });
}
import {
  RenderBodyEnd,
  RenderHead,
  collectRenderContributions,
} from "@/components/render-contributions";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  await ensureFor("read");
  const { slug } = await params;
  const rawPath = slug?.join("/") || "/";
  const { locale, path } = splitLocaleFromPath(rawPath);
  const page = await getPageBySlug(path, { locale });

  // hreflang alternates: any path that resolves under i18n
  // routing gets one alternate per configured locale plus
  // x-default pointing at the canonical default-locale URL.
  // Search engines use this to deduplicate translated copies.
  const alternates = buildHreflangAlternates(path === "/" ? "" : path);
  const xDefault =
    path === "/" ? "/" : `/${path}`;

  // Pages without a published row fall back to site-wide
  // defaults; that's also what the `DefaultHomePage` empty-state
  // surface uses, so the meta tags still describe the brand.
  const metadata = (await buildPageMetadata({
    title: typeof page?.title === "string" ? page.title : null,
    description:
      typeof page?.seoDescription === "string" ? page.seoDescription : null,
    path: rawPath === "/" ? "/" : `/${rawPath}`,
    ogType: "website",
    locale,
  })) as Metadata;

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

export default async function CatchAllPage({ params }: PageProps) {
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
  // to different rows depending on the visitor's locale. The
  // middleware (`apps/web/src/proxy.ts`) already stripped the
  // locale prefix from `path` for us.
  const page = await getPageBySlug(path, {
    draft: isDraft,
    locale: requestedLocale,
  });

  if (!page) {
    // The site root is special: a fresh install with no pages
    // would 404 on `/` and look broken. Surface a default landing
    // page that confirms NexPress is running and points the
    // operator at /admin. Once an admin publishes a real
    // `pages` row with slug `/`, the lookup above succeeds and
    // this branch never runs.
    if (path === "/") {
      const websiteJsonLd = await buildWebSiteJsonLd();
      return (
        <>
          <JsonLd data={websiteJsonLd as unknown as Record<string, unknown>} />
          <DefaultHomePage />
        </>
      );
    }

    // Slug rename history — when a page used to live at this path
    // but got renamed, walk `np_slug_history` to the current
    // target and 301. Search-engine indices, external links, and
    // bookmarks survive the rename.
    const slugWithoutLeadingSlash = path.replace(/^\/+/, "");
    const target = await findSlugRedirect("pages", slugWithoutLeadingSlash);
    if (target) {
      // Preserve the operator-visible locale prefix when
      // redirecting; only the slug segment changes.
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
  const blockCtx = createDefaultBlockRenderContext();

  return (
    <>
      {websiteJsonLd ? (
        <JsonLd data={websiteJsonLd as unknown as Record<string, unknown>} />
      ) : null}
      <RenderHead entries={head} />
      {isDraft ? (
        <div className="np-draft-banner" style={{ padding: "0.75rem 1rem", background: "#fef3c7", color: "#92400e", fontSize: "0.875rem", textAlign: "center" }}>
          Draft preview — <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>exit</a>
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
    </>
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
): Promise<ComponentType<{ doc: Record<string, unknown>; blockCtx?: NpBlockRenderContext }> | null> {
  // Phase 14.5 — lookup walks theme → plugin so theme templates
  // take precedence on id collision (active theme is the site's
  // design authority). The historical theme.default fallback
  // still applies when the doc didn't pick anything specific.
  if (templateId) {
    const explicit = (await resolveTemplateComponent("pages", templateId)) as
      | { component?: ComponentType<{ doc: Record<string, unknown>; blockCtx?: NpBlockRenderContext }> }
      | null;
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
      | { component?: ComponentType<{ doc: Record<string, unknown>; blockCtx?: NpBlockRenderContext }> }
      | undefined
  )?.component;
  return pluginDefault ?? null;
}
