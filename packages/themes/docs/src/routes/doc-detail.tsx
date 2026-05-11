import { findDocuments } from "@nexpress/core";
import type { NpRouteRenderProps, NpTemplateRenderProps } from "@nexpress/theme";
import { notFound } from "next/navigation";
import * as React from "react";

import { DocPageTemplate } from "../templates/doc-page.js";

/**
 * Theme route for `/docs/:slug` — looks up a docs collection row
 * and renders it through `DocPageTemplate` (#614).
 *
 * Without this route, the sidebar's `/docs/<slug>` links and the
 * doc template's prev/next links 404 in the reference app — the
 * catch-all only resolves `pages` rows + theme archive routes;
 * arbitrary `docs` collection rows weren't reachable by URL.
 *
 * The lookup is a defensive untyped `findDocuments<DocsRow>`
 * call: the docs collection schema lives in the user's project,
 * not the theme, so we re-declare the minimal shape the template
 * needs (title + body + parent + order) and trust runtime row
 * data to match. Operators who run `theme:install
 * @nexpress/theme-docs` get those fields generated for them.
 *
 * Membership / access: same path the catch-all uses for `pages`
 * — `findDocuments` already enforces `access.read` and
 * `community.visibility` so we don't need to gate here.
 */

interface DocsRow {
  id: string;
  slug: string;
  title: string;
  body?: unknown;
  parent?: string | null;
  order?: number;
  status?: string;
  excerpt?: string;
}

export async function DocsDetailRoute({
  params,
  blockCtx,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) notFound();

  const result = await findDocuments<DocsRow>("docs", {
    where: { slug, status: "published" },
    limit: 1,
  });
  const doc = result.docs[0];
  if (!doc) notFound();

  // `DocPageTemplate`'s prop generic defaults to
  // `Record<string, unknown>` — cast through `unknown` so our
  // narrower `DocsRow` shape (which doesn't carry an index
  // signature) matches the template's contract.
  const templateProps: NpTemplateRenderProps = {
    doc: doc as unknown as Record<string, unknown>,
    blockCtx,
  };
  return <DocPageTemplate {...templateProps} />;
}
