import * as React from "react";
import { findDocuments } from "@nexpress/core";

import { resolveDocsSettings } from "./settings-helpers.js";

interface DocNode {
  id: string;
  slug: string;
  title: string;
  parent: string | null;
  order: number;
  /**
   * Optional small label rendered next to the link
   * (`new` / `beta` / `api`). Renders as a pill via the
   * `.np-docs-sidebar-badge.{value}` selector in styles.ts.
   * Treated as advisory; sites without the field render no
   * badge.
   */
  badge: string | null;
  children: DocNode[];
}

/**
 * Hierarchical sidebar for the docs theme.
 *
 * Top-level docs (those without a `parent`) become **group
 * eyebrows** rendered with a bullet dot indicator; each
 * group's children are the linkable items under the eyebrow.
 * Deeper levels render as nested lists with a hairline left
 * rule.
 *
 * The current doc is highlighted via `data-current="true"`
 * resolved from the request's pathname. Wired through
 * `next/headers` (`x-np-pathname`) so the highlight survives
 * server rendering with no client-side hydration.
 */
export async function DocsSidebar(): Promise<React.ReactElement> {
  const settings = await resolveDocsSettings();
  const currentSlug = await currentPathSlug();

  // Pull every doc and assemble the hierarchy. Capped at 500 to
  // keep the query bounded — typical doc sites stay well under.
  // Universal-content-model #748: docs are posts with kind="doc".
  const result = await findDocuments<Record<string, unknown>>("posts", {
    where: { status: "published", kind: "doc" },
    sort: "order",
    limit: 500,
  });

  const tree = buildTree(result.docs);

  if (tree.length === 0) {
    return (
      <aside className="np-docs-sidebar" aria-label="Docs navigation">
        <div className="np-docs-sidebar-group">
          <h2 className="np-docs-sidebar-eyebrow">
            <span className="np-docs-sidebar-eyebrow-dot" aria-hidden="true" />
            {settings.sidebarHeading}
          </h2>
          <p
            style={{
              padding: "0.34rem 0.6rem",
              fontSize: "0.875rem",
              color: "var(--np-color-muted-foreground)",
              margin: 0,
            }}
          >
            No docs yet.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="np-docs-sidebar" aria-label="Docs navigation">
      {tree.map((group) => (
        <div className="np-docs-sidebar-group" key={group.id}>
          <h2 className="np-docs-sidebar-eyebrow">
            <span className="np-docs-sidebar-eyebrow-dot" aria-hidden="true" />
            {group.title}
          </h2>
          {group.children.length > 0 ? (
            <NavTree nodes={group.children} currentSlug={currentSlug} />
          ) : (
            <ul>
              <SidebarLink node={group} currentSlug={currentSlug} />
            </ul>
          )}
        </div>
      ))}
    </aside>
  );
}

interface DocRow {
  id: unknown;
  slug: unknown;
  title: unknown;
  parent: unknown;
  order: unknown;
  badge: unknown;
}

async function currentPathSlug(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const list = await headers();
    const pathname = list.get("x-np-pathname");
    if (!pathname) return null;
    const m = /^\/docs\/(.+?)\/?$/.exec(pathname);
    return m ? (m[1] ?? null) : null;
  } catch {
    return null;
  }
}

function buildTree(rawDocs: Record<string, unknown>[]): DocNode[] {
  const docs = rawDocs as unknown as DocRow[];
  const byId = new Map<string, DocNode>();
  // First pass: every doc as a flat node with empty children.
  for (const d of docs) {
    if (typeof d.id !== "string") continue;
    if (typeof d.slug !== "string") continue;
    byId.set(d.id, {
      id: d.id,
      slug: d.slug,
      title: typeof d.title === "string" ? d.title : d.slug,
      parent: typeof d.parent === "string" ? d.parent : null,
      order: typeof d.order === "number" ? d.order : 0,
      badge: typeof d.badge === "string" ? d.badge : null,
      children: [],
    });
  }
  // Second pass: hang each non-root under its parent.
  const roots: DocNode[] = [];
  for (const node of byId.values()) {
    if (node.parent && byId.has(node.parent)) {
      byId.get(node.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Sort by order at every level.
  const sortRec = (list: DocNode[]) => {
    list.sort((a, b) => a.order - b.order);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function NavTree({
  nodes,
  currentSlug,
}: {
  nodes: DocNode[];
  currentSlug: string | null;
}): React.ReactElement {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <SidebarLink node={n} currentSlug={currentSlug} />
          {n.children.length > 0 ? (
            <NavTree nodes={n.children} currentSlug={currentSlug} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SidebarLink({
  node,
  currentSlug,
}: {
  node: DocNode;
  currentSlug: string | null;
}): React.ReactElement {
  const isCurrent = currentSlug !== null && currentSlug === node.slug;
  const badgeClass = node.badge
    ? `np-docs-sidebar-badge ${node.badge.toLowerCase()}`
    : null;
  return (
    <a
      href={`/docs/${node.slug}`}
      data-current={isCurrent ? "true" : undefined}
      aria-current={isCurrent ? "page" : undefined}
    >
      {node.title}
      {badgeClass ? (
        <span className={badgeClass}>{node.badge!.toUpperCase()}</span>
      ) : null}
    </a>
  );
}
