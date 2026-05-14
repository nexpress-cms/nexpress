import { findDocuments } from "@nexpress/core";
import type { NpRouteRenderProps, NpTemplateRenderProps } from "@nexpress/theme";
import { notFound } from "next/navigation";
import * as React from "react";

import { ProjectDetailTemplate } from "../templates/project-detail.js";

/**
 * Theme route for `/work/:slug` — looks up a project row (the
 * `posts` collection, which portfolio uses for case studies) and
 * renders it through `templates.posts.detail`
 * (ProjectDetailTemplate) — #613.
 *
 * Without this route, `PortfolioProjectCard`'s `/work/<slug>`
 * links 404 in the reference app. The card emits the URL on its
 * own (`projectHref(doc)`) and the framework had no route to
 * back it.
 *
 * Defensive untyped `findDocuments<ProjectRow>` lookup — the
 * posts schema lives in the operator's project, not the theme.
 * Adding `@nexpress/theme-portfolio` via `theme add` auto-merges
 * the fields ProjectDetailTemplate expects (hero, role/year/client
 * meta) into the operator's posts collection at config-resolution
 * time — no AST patches needed.
 *
 * Access / visibility: `findDocuments` already enforces
 * `access.read` and `community.visibility`, same as the
 * catch-all's `pages` lookup. We pass `status: "published"`
 * explicitly to hide drafts/pending from public URL access.
 */

interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  body?: unknown;
  status?: string;
  hero?: unknown;
  excerpt?: string;
  category?: string;
  role?: string;
  year?: string;
  client?: string;
}

export async function PortfolioProjectDetailRoute({
  params,
  blockCtx,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) notFound();

  const result = await findDocuments<ProjectRow>("posts", {
    where: { slug, status: "published" },
    limit: 1,
  });
  const doc = result.docs[0];
  if (!doc) notFound();

  // `ProjectDetailTemplate`'s prop generic defaults to
  // `Record<string, unknown>` — cast through `unknown` so our
  // narrower `ProjectRow` shape (no index signature) matches.
  const templateProps: NpTemplateRenderProps = {
    doc: doc as unknown as Record<string, unknown>,
    blockCtx,
  };
  return <ProjectDetailTemplate {...templateProps} />;
}
