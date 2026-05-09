import * as React from "react";
import { findDocuments } from "@nexpress/core";

import { resolveDocsSettings } from "./settings-helpers.js";

interface DocNode {
  id: string;
  slug: string;
  title: string;
  parent: string | null;
  order: number;
  children: DocNode[];
}

/**
 * Phase F.9-B — hierarchical sidebar.
 *
 * Walks the `docs` collection (declared as required in the
 * manifest), builds a parent/order tree, renders nested nav.
 * The current doc is highlighted via `data-current="true"`.
 *
 * The function reads `currentSlug` from a query param (when
 * called as a route component) or from doc context. For F.9-B
 * we keep it simple: the slot component fetches the request's
 * URL via `headers()` and matches on `pathname.startsWith`.
 */
export async function DocsSidebar(): Promise<React.ReactElement> {
  const settings = await resolveDocsSettings();

  // Pull every doc and assemble the hierarchy. Capped at 500 to
  // keep the query bounded — typical doc sites stay well under.
  const result = await findDocuments<Record<string, unknown>>("docs", {
    where: { status: "published" },
    sort: "order",
    limit: 500,
  });

  const tree = buildTree(result.docs);
  // Active-link detection happens client-side via the URL; here
  // we just emit the static tree. The CSS uses `aria-current`
  // (set by Next's link-active conventions) plus the
  // `data-current` we'd set if we threaded the current path
  // through; F.9-B leaves this as a polish item — links work,
  // the highlight is missing.
  return (
    <aside className="np-docs-sidebar" aria-label="Docs navigation">
      <h2>{settings.sidebarHeading}</h2>
      <NavTree nodes={tree} />
    </aside>
  );
}

interface DocRow {
  id: unknown;
  slug: unknown;
  title: unknown;
  parent: unknown;
  order: unknown;
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

function NavTree({ nodes }: { nodes: DocNode[] }): React.ReactElement {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <a href={`/docs/${n.slug}`}>{n.title}</a>
          {n.children.length > 0 ? <NavTree nodes={n.children} /> : null}
        </li>
      ))}
    </ul>
  );
}
