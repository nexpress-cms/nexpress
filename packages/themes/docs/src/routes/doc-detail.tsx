import { findDocuments } from "@nexpress/core";
import type { NpRouteRenderProps, NpTemplateRenderProps } from "@nexpress/theme";
import { notFound } from "next/navigation";
import * as React from "react";

import { DocPageTemplate } from "../templates/doc-page.js";

/**
 * Theme route for `/docs/:slug` — looks up a doc-kind post and
 * renders it through `DocPageTemplate`.
 *
 * Universal-content-model #748: docs are posts with `kind="doc"`.
 * The framework's catch-all also matches `/docs/:slug` via the
 * theme's `kinds.doc.urlPattern` metadata; this explicit theme
 * route stays for two reasons:
 *
 *   1. It's the supported path for theme-internal navigation
 *      that bypasses the kinds-metadata dispatcher (prev/next,
 *      sidebar links).
 *   2. It runs ahead of the kinds dispatcher in the precedence
 *      order so a future themes feature that needs to wrap
 *      doc-page rendering (e.g. signing-aware drafts) can hook
 *      in here without touching the framework.
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
  kind?: string;
}

export async function DocsDetailRoute({
  params,
  blockCtx,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) notFound();

  const result = await findDocuments<DocsRow>("posts", {
    where: { slug, status: "published", kind: "doc" },
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
