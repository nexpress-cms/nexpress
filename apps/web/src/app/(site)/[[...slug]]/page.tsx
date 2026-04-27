import {
  buildPageMetadata,
  buildWebSiteJsonLd,
  findDocuments,
  getPageBySlug,
  getPluginTemplatesForCollection,
  resolveTemplateComponent,
} from "@nexpress/core";
import { getCachedActiveTheme } from "@/lib/cached-theme";
import { renderBlocks } from "@nexpress/blocks";
import type { ComponentType } from "react";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import type { NxPageBlocks } from "@nexpress/blocks";

import { DefaultHomePage } from "@/components/default-home-page";
import { JsonLd } from "@/components/json-ld";
import { i18nConfig, isLocale } from "@/i18n.config";
import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";

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
  ensureCoreServices();
  const { slug } = await params;
  const rawPath = slug?.join("/") || "/";
  const { locale, path } = splitLocaleFromPath(rawPath);
  const page = await getPageBySlug(path);

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
  ensureCoreServices();
  await ensurePluginsLoaded();
  const { slug } = await params;
  const rawPath = slug?.join("/") || "/";
  // Phase 12.2 — strip the locale prefix BEFORE looking the
  // doc up. Stored slugs don't include the prefix; the URL's
  // locale segment is metadata for routing / hreflang.
  const { locale: requestedLocale, path } = splitLocaleFromPath(rawPath);
  const { isEnabled: isDraft } = await draftMode();

  // Try the (single-locale) `pages` collection first. Pages
  // doesn't opt into i18n today; the same row serves every
  // locale URL.
  let page = await getPageBySlug(path, { draft: isDraft });

  // Fall through to `localized-pages` (i18n collection) when
  // the pages lookup misses. The slug match is locale-scoped
  // because the (locale, slug) unique index lives on the
  // localized table — the same slug can resolve to different
  // documents depending on which locale the visitor asked for.
  if (!page && path !== "/") {
    const result = await findDocuments("localized-pages", {
      where: {
        slug: path.replace(/^\/+/, ""),
        ...(isDraft ? {} : { _status: "published" }),
      },
      locale: requestedLocale,
      limit: 1,
    });
    page = result.docs[0] ?? null;
  }

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
    notFound();
  }

  const pageBlocks = page.blocks as NxPageBlocks | undefined;

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

  return (
    <>
      {websiteJsonLd ? (
        <JsonLd data={websiteJsonLd as unknown as Record<string, unknown>} />
      ) : null}
      <RenderHead entries={head} />
      {isDraft ? (
        <div className="nx-draft-banner" style={{ padding: "0.75rem 1rem", background: "#fef3c7", color: "#92400e", fontSize: "0.875rem", textAlign: "center" }}>
          Draft preview — <a href="/api/preview/exit" style={{ color: "inherit", textDecoration: "underline" }}>exit</a>
        </div>
      ) : null}
      {Template ? (
        <Template doc={page} />
      ) : (
        <div className="nx-page">
          {pageBlocks ? (
            renderBlocks(pageBlocks)
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
): Promise<ComponentType<{ doc: Record<string, unknown> }> | null> {
  // Phase 14.5 — lookup walks theme → plugin so theme templates
  // take precedence on id collision (active theme is the site's
  // design authority). The historical theme.default fallback
  // still applies when the doc didn't pick anything specific.
  if (templateId) {
    const explicit = (await resolveTemplateComponent("pages", templateId)) as
      | { component?: ComponentType<{ doc: Record<string, unknown> }> }
      | null;
    if (explicit?.component) return explicit.component;
  }

  // Default fallback: prefer theme's `default` over plugin's.
  const active = await getCachedActiveTheme();
  const themeDefault = active?.impl.templates?.pages?.default?.component as
    | ComponentType<{ doc: Record<string, unknown> }>
    | undefined;
  if (themeDefault) return themeDefault;

  const pluginDefault = (
    getPluginTemplatesForCollection("pages").get("default") as
      | { component?: ComponentType<{ doc: Record<string, unknown> }> }
      | undefined
  )?.component;
  return pluginDefault ?? null;
}
