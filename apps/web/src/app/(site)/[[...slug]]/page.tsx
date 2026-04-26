import {
  buildPageMetadata,
  buildWebSiteJsonLd,
  getPageBySlug,
} from "@nexpress/core";
import { getActiveTheme } from "@nexpress/theme";
import { renderBlocks } from "@nexpress/blocks";
import type { ComponentType } from "react";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import type { NxPageBlocks } from "@nexpress/blocks";

import { DefaultHomePage } from "@/components/default-home-page";
import { JsonLd } from "@/components/json-ld";
import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";
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
  const path = slug?.join("/") || "/";
  const page = await getPageBySlug(path);

  // Pages without a published row fall back to site-wide
  // defaults; that's also what the `DefaultHomePage` empty-state
  // surface uses, so the meta tags still describe the brand.
  return (await buildPageMetadata({
    title: typeof page?.title === "string" ? page.title : null,
    description:
      typeof page?.seoDescription === "string" ? page.seoDescription : null,
    path: path === "/" ? "/" : `/${path}`,
    ogType: "website",
  })) as Metadata;
}

export default async function CatchAllPage({ params }: PageProps) {
  ensureCoreServices();
  await ensurePluginsLoaded();
  const { slug } = await params;
  const path = slug?.join("/") || "/";
  const { isEnabled: isDraft } = await draftMode();

  const page = await getPageBySlug(path, { draft: isDraft });
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
        <Template doc={page as Record<string, unknown>} />
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
  const active = await getActiveTheme();
  if (!active) return null;
  const set = active.impl.templates?.pages;
  if (!set) return null;
  const chosen = templateId
    ? (set[templateId]?.component ?? set.default?.component)
    : set.default?.component;
  return (chosen as ComponentType<{ doc: Record<string, unknown> }>) ?? null;
}
