import {
  NpForbiddenError,
  can,
  findDocuments,
  getAllCollectionSlugs,
  getCollectionConfig,
  saveDocument,
  type NpAuthUser,
  type NpFieldConfig,
} from "@nexpress/core";
import {
  getRegisteredBlocksForActiveSources,
  type NpBlockInstance,
} from "@nexpress/blocks";
import { getCachedActiveThemeId } from "@nexpress/next";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * v0.3 (C) — bulk "cleanup unknown blocks" admin action.
 *
 * Closes a v0.3-deferred item from
 * `docs/design/theme-v0.2-extension.md` §10:
 *
 * > Bulk "cleanup unknown blocks" admin action — placeholder
 * > rendering covers correctness; bulk action is convenience.
 *
 * Surfaces and removes block instances whose `type` is no longer
 * present in the active block registry. This typically happens
 * after:
 *
 *   - `theme:uninstall` removed a theme that contributed blocks
 *     (`magazine.hero-feature`, etc.).
 *   - The operator switched themes A → B without uninstalling A.
 *   - A plugin that contributed blocks was removed.
 *
 * Scoped to admin (`admin.manage` capability) and CSRF-protected
 * by `apps/web/src/proxy.ts`.
 *
 * GET — scan-only. Returns a structured report with affected
 * docs grouped by collection + count per unknown type.
 *
 * POST — apply the cleanup. Optional `{ types: string[] }` body
 * filters to a subset of unknown types (default: all). Goes
 * through `saveDocument` so revisions track the change and
 * media-ref / search-vector hooks fire correctly.
 */

interface AffectedDoc {
  collection: string;
  docId: string;
  fieldName: string;
  removableTypes: string[];
  removedCount: number;
}

interface UnknownBlocksReport {
  unknownTypes: { type: string; instanceCount: number; docCount: number }[];
  affected: AffectedDoc[];
  totalInstances: number;
  totalDocs: number;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("blocks/unknown", "scan");
    }
    await ensureFor("plugins");
    const report = await scanUnknownBlocks(user);
    return npSuccessResponse(report);
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("blocks/unknown", "cleanup");
    }
    await ensureFor("write");

    const body = (await readJsonBody(request)) as
      | { types?: unknown }
      | null;
    const filterTypes =
      body && Array.isArray((body as { types?: unknown[] }).types)
        ? new Set(
            (body as { types: unknown[] }).types.filter(
              (t): t is string => typeof t === "string",
            ),
          )
        : null;

    const report = await scanUnknownBlocks(user);
    const targets = report.affected.filter(
      (a) =>
        !filterTypes ||
        a.removableTypes.some((t) => filterTypes.has(t)),
    );

    let removedInstances = 0;
    let updatedDocs = 0;

    for (const doc of targets) {
      // Re-fetch via findDocuments (single-doc by id) so we have
      // the fresh row state — another writer may have changed
      // the doc between scan and apply.
      const fresh = await findDocuments(
        doc.collection,
        {
          where: { id: { equals: doc.docId } },
          limit: 1,
        },
        user,
      );
      const row = fresh.docs[0] as Record<string, unknown> | undefined;
      if (!row) continue;
      const fieldValue = row[doc.fieldName];
      if (!Array.isArray(fieldValue)) continue;
      const stripped = stripUnknownInstances(
        fieldValue as NpBlockInstance[],
        await getKnownTypes(),
        filterTypes,
      );
      if (stripped.removed === 0) continue;
      const updatedData = { ...row, [doc.fieldName]: stripped.kept };
      await saveDocument(doc.collection, doc.docId, updatedData, user);
      removedInstances += stripped.removed;
      updatedDocs += 1;
    }

    return npSuccessResponse({
      removedInstances,
      updatedDocs,
    });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

async function getKnownTypes(): Promise<Set<string>> {
  // Issue #600 — filter the registry by active-source context.
  // Previously the cleanup used the unfiltered registry, which
  // counts inactive-theme blocks (e.g. `magazine.*` on a site
  // with `portfolio` active) as "known" and so the cleanup
  // scan reports nothing for the exact theme-switch stale-block
  // flow it advertises. Filtering by active theme aligns the
  // scan with how the public site renders these blocks (as
  // "from inactive theme" placeholders, i.e. candidates to
  // strip).
  const themeId = (await getCachedActiveThemeId()) ?? null;
  return new Set(
    getRegisteredBlocksForActiveSources({ themeId }).map((b) => b.type),
  );
}

async function scanUnknownBlocks(
  user: NpAuthUser,
): Promise<UnknownBlocksReport> {
  const known = await getKnownTypes();
  const slugs = getAllCollectionSlugs();
  const affected: AffectedDoc[] = [];
  const typeCounters = new Map<
    string,
    { instanceCount: number; docCount: number; lastDocId: string | null }
  >();
  let totalInstances = 0;

  for (const slug of slugs) {
    const config = getCollectionConfig(slug);
    const blocksFields = collectBlocksFieldNames(config.fields);
    if (blocksFields.length === 0) continue;

    // Pass the admin user so collections with restricted
    // `access.read` (e.g. members-only content) still surface in
    // the scan — without a user, those throw with a forbidden
    // error and the cleanup view would silently miss them. The
    // admin.manage capability gate at the route entry already
    // bounds who can run this.
    const result = await findDocuments(slug, { limit: 1000 }, user);
    for (const row of result.docs) {
      const docId = typeof row.id === "string" ? row.id : null;
      if (!docId) continue;
      for (const fieldName of blocksFields) {
        const value = row[fieldName];
        if (!Array.isArray(value)) continue;
        const found = collectUnknownInstances(
          value as NpBlockInstance[],
          known,
        );
        if (found.types.size === 0) continue;
        const removableTypes = [...found.types];
        affected.push({
          collection: slug,
          docId,
          fieldName,
          removableTypes,
          removedCount: found.count,
        });
        totalInstances += found.count;
        for (const t of removableTypes) {
          const counter = typeCounters.get(t) ?? {
            instanceCount: 0,
            docCount: 0,
            lastDocId: null,
          };
          counter.instanceCount += found.perType.get(t) ?? 0;
          // De-dupe doc count per type — increment only when the
          // doc id changes from the last we saw for this type.
          if (counter.lastDocId !== docId) {
            counter.docCount += 1;
            counter.lastDocId = docId;
          }
          typeCounters.set(t, counter);
        }
      }
    }
  }

  const unknownTypes = [...typeCounters.entries()]
    .map(([type, counter]) => ({
      type,
      instanceCount: counter.instanceCount,
      docCount: counter.docCount,
    }))
    .sort((a, b) => b.instanceCount - a.instanceCount);

  return {
    unknownTypes,
    affected,
    totalInstances,
    totalDocs: affected.length,
  };
}

function collectBlocksFieldNames(fields: NpFieldConfig[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.type === "blocks") out.push(f.name);
    if (f.type === "row" || f.type === "collapsible") {
      out.push(...collectBlocksFieldNames(f.fields));
    }
  }
  return out;
}

interface UnknownScan {
  types: Set<string>;
  count: number;
  perType: Map<string, number>;
}

function collectUnknownInstances(
  instances: NpBlockInstance[],
  known: Set<string>,
): UnknownScan {
  const types = new Set<string>();
  const perType = new Map<string, number>();
  let count = 0;
  walk(instances);
  return { types, count, perType };

  function walk(items: NpBlockInstance[]) {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.type === "string" && !known.has(item.type)) {
        types.add(item.type);
        perType.set(item.type, (perType.get(item.type) ?? 0) + 1);
        count += 1;
      }
      // Walk children whether the parent is known or not — a
      // plugin might have removed a child block type while
      // keeping the container.
      if (Array.isArray(item.children)) {
        walk(item.children);
      }
    }
  }
}

interface StripResult {
  kept: NpBlockInstance[];
  removed: number;
}

function stripUnknownInstances(
  instances: NpBlockInstance[],
  known: Set<string>,
  typeFilter: Set<string> | null,
): StripResult {
  let removed = 0;
  const kept = walk(instances);
  return { kept, removed };

  function walk(items: NpBlockInstance[]): NpBlockInstance[] {
    const out: NpBlockInstance[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") {
        out.push(item);
        continue;
      }
      const isUnknown =
        typeof item.type === "string" && !known.has(item.type);
      const matchesFilter =
        typeFilter === null ||
        (typeof item.type === "string" && typeFilter.has(item.type));
      if (isUnknown && matchesFilter) {
        removed += 1;
        continue;
      }
      // Recurse into children — even known parents can hold
      // unknown descendants.
      if (Array.isArray(item.children)) {
        out.push({
          ...item,
          children: walk(item.children),
        });
      } else {
        out.push(item);
      }
    }
    return out;
  }
}

export const dynamic = "force-dynamic";
