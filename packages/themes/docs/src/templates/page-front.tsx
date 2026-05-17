import * as React from "react";
import { findDocuments } from "@nexpress/core";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import { resolveDocsSettings } from "../settings-helpers.js";

interface DocRow {
  id: unknown;
  slug: unknown;
  title: unknown;
  parent: unknown;
  order: unknown;
  lede: unknown;
  badge: unknown;
  publishedAt: unknown;
  updatedAt: unknown;
  /** Universal-content-model discriminator (#748) — filtered at query time. */
  kind?: string;
}

interface DocNode {
  id: string;
  slug: string;
  title: string;
  lede: string | null;
  parent: string | null;
  order: number;
  badge: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  children: DocNode[];
}

/**
 * Docs theme front page — the landing operators see at `/` once they
 * activate the docs theme.
 *
 * Walks the seeded `kind="doc"` tree: hero (site name + version pill +
 * lede), a 2x2 card grid of the top-level group docs with their first
 * three children listed, and a "Recently updated" row with the four
 * most recently touched docs. Each card title links into `/docs/<slug>`.
 *
 * Lives outside the 3-col docs grid (the shell stamps
 * `data-layout="page"` for non-`/docs` routes, collapsing the grid to a
 * single 1380px column and hiding the sidebar + TOC). Operators who
 * want a marketing-style home swap the template via the admin picker.
 */
export async function PageFrontTemplate(_props: NpTemplateRenderProps) {
  const settings = await resolveDocsSettings();
  const result = await findDocuments<DocRow>("posts", {
    where: { status: "published", kind: "doc" },
    sort: "order",
    limit: 200,
  });

  const tree = buildTree(result.docs);
  const recent = recentlyUpdated(result.docs, 4);
  const quickstart = tree.find((node) =>
    node.slug === "plugins"
      ? node.children.find((c) => c.slug === "author-quickstart")
      : false,
  );
  const quickstartTarget =
    quickstart?.children.find((c) => c.slug === "author-quickstart") ??
    tree[0]?.children[0] ??
    tree[0] ??
    null;

  return (
    <article className="np-docs-front">
      <header className="np-docs-front-hero">
        <span className="np-docs-front-eyebrow">
          <span className="np-docs-front-eyebrow-dot" aria-hidden="true" />
          {settings.version}
          <span aria-hidden="true"> · Stable</span>
        </span>
        <h1>Documentation</h1>
        <p className="np-docs-front-lede">
          Everything you need to install, configure, extend, and ship a
          NexPress site — from a first install to the API reference. Browse
          by section, or jump straight into the plugin author quickstart.
        </p>
        {quickstartTarget ? (
          <div className="np-docs-front-cta">
            <a className="np-docs-front-cta-primary" href={`/docs/${quickstartTarget.slug}`}>
              Open {quickstartTarget.title} →
            </a>
            {settings.githubRepo ? (
              <a
                className="np-docs-front-cta-secondary"
                href={settings.githubRepo}
                target="_blank"
                rel="noreferrer"
              >
                Browse the repository
              </a>
            ) : null}
          </div>
        ) : null}
      </header>

      {tree.length > 0 ? (
        <section className="np-docs-front-groups" aria-label="Documentation sections">
          {tree.map((group) => (
            <a
              className="np-docs-front-group"
              key={group.id}
              href={`/docs/${group.slug}`}
            >
              <h2 className="np-docs-front-group-title">
                {group.title}
                <span className="np-docs-front-group-count">
                  {group.children.length.toString()} page
                  {group.children.length === 1 ? "" : "s"}
                </span>
              </h2>
              {group.lede ? (
                <p className="np-docs-front-group-lede">{group.lede}</p>
              ) : null}
              {group.children.length > 0 ? (
                <ul className="np-docs-front-group-children">
                  {group.children.slice(0, 4).map((child) => (
                    <li key={child.id}>
                      {child.title}
                      {child.badge ? (
                        <span
                          className={`np-docs-sidebar-badge ${child.badge.toLowerCase()}`}
                        >
                          {child.badge.toUpperCase()}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </a>
          ))}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section
          className="np-docs-front-recent"
          aria-label="Recently updated docs"
        >
          <h2 className="np-docs-front-recent-eyebrow">Recently updated</h2>
          <ul className="np-docs-front-recent-list">
            {recent.map((node) => (
              <li key={node.id}>
                <a href={`/docs/${node.slug}`}>
                  <span className="np-docs-front-recent-title">{node.title}</span>
                  {node.updatedAt ? (
                    <time
                      className="np-docs-front-recent-time"
                      dateTime={node.updatedAt}
                    >
                      {formatRelative(node.updatedAt)}
                    </time>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function buildTree(rows: DocRow[]): DocNode[] {
  const byId = new Map<string, DocNode>();
  for (const r of rows) {
    if (typeof r.id !== "string") continue;
    if (typeof r.slug !== "string") continue;
    byId.set(r.id, {
      id: r.id,
      slug: r.slug,
      title: typeof r.title === "string" ? r.title : r.slug,
      lede: typeof r.lede === "string" ? r.lede : null,
      parent: typeof r.parent === "string" ? r.parent : null,
      order: typeof r.order === "number" ? r.order : 0,
      badge: typeof r.badge === "string" ? r.badge : null,
      publishedAt:
        typeof r.publishedAt === "string" ? r.publishedAt : null,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
      children: [],
    });
  }
  const roots: DocNode[] = [];
  for (const node of byId.values()) {
    if (node.parent && byId.has(node.parent)) {
      byId.get(node.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list: DocNode[]) => {
    list.sort((a, b) => a.order - b.order);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function recentlyUpdated(rows: DocRow[], limit: number): DocNode[] {
  const all: DocNode[] = [];
  for (const r of rows) {
    if (typeof r.id !== "string" || typeof r.slug !== "string") continue;
    if (typeof r.parent !== "string") continue;
    all.push({
      id: r.id,
      slug: r.slug,
      title: typeof r.title === "string" ? r.title : r.slug,
      lede: null,
      parent: typeof r.parent === "string" ? r.parent : null,
      order: 0,
      badge: typeof r.badge === "string" ? r.badge : null,
      publishedAt:
        typeof r.publishedAt === "string" ? r.publishedAt : null,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
      children: [],
    });
  }
  return all
    .filter((n) => n.updatedAt !== null)
    .sort((a, b) => {
      const at = a.updatedAt ?? "";
      const bt = b.updatedAt ?? "";
      return bt.localeCompare(at);
    })
    .slice(0, limit);
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const ms = Math.max(now - then, 0);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (ms < hour) return `${Math.max(1, Math.round(ms / minute)).toString()} min ago`;
    if (ms < day) return `${Math.round(ms / hour).toString()} h ago`;
    if (ms < 7 * day) return `${Math.round(ms / day).toString()} d ago`;
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}
