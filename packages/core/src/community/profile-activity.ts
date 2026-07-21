import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  npCommunityContractLimits,
  npRequireCommunityId,
  npRequireMemberProfileActivityPageWire,
  npRequireMemberProfileActivityQuery,
} from "../community-contract/contract.js";
import type {
  NpMemberProfileActivityItemWire,
  NpMemberProfileActivityPageWire,
  NpMemberProfileActivityQuery,
} from "../community-contract/types.js";
import type { NpCollectionConfig } from "../config/types.js";
import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "../collections/registry.js";
import { getDb } from "../db/runtime.js";
import { npComments, npMembers } from "../db/schema/community.js";
import { NpNotFoundError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";
import { npResolveDocumentPublicHref } from "./engagement-target.js";

interface ActivityIndexRow {
  collectionSlug: string;
  targetId: string;
  createdAt: Date;
  updatedAt: Date;
  commentId?: string;
  bodyMd?: string;
  editedAt?: Date | null;
}

interface RegisteredActivityCollection {
  slug: string;
  config: NpCollectionConfig;
  table: PgTable;
}

type ActivityDb = Pick<ReturnType<typeof getDb>, "execute" | "select">;

async function requirePublicMember(db: ActivityDb, memberId: string): Promise<void> {
  const [member] = await db
    .select({ id: npMembers.id })
    .from(npMembers)
    .where(and(eq(npMembers.id, memberId), inArray(npMembers.status, ["active", "imported"])))
    .limit(1);
  if (!member) throw new NpNotFoundError("member", memberId);
}

function tableColumn(table: PgTable, name: string): unknown {
  return (table as unknown as Record<string, unknown>)[name];
}

function activityCollections(
  kind: NpMemberProfileActivityQuery["kind"],
): RegisteredActivityCollection[] {
  const enabled: RegisteredActivityCollection[] = [];
  for (const slug of getAllCollectionSlugs()) {
    const config = getCollectionConfig(slug);
    const profileActivity = config.community?.profileActivity;
    if (
      (kind === "documents" && profileActivity?.documents !== true) ||
      (kind === "comments" && profileActivity?.comments !== true)
    ) {
      continue;
    }
    enabled.push({ slug, config, table: getCollectionTable(slug) as PgTable });
  }
  return enabled;
}

function documentBranch(
  collection: RegisteredActivityCollection,
  memberId: string,
  siteId: string,
) {
  return sql`
    SELECT
      ${collection.slug}::text AS collection_slug,
      id AS target_id,
      created_at,
      updated_at,
      NULL::uuid AS comment_id,
      NULL::text AS body_md,
      NULL::timestamptz AS edited_at
    FROM ${collection.table}
    WHERE member_author_id = ${memberId}
      AND site_id = ${siteId}
      AND status = 'published'
      AND visibility = 'public'
      ${collection.config.community?.audience === true ? sql`AND audience = 'public'` : sql``}
  `;
}

function commentBranch(collection: RegisteredActivityCollection, memberId: string, siteId: string) {
  return sql`
    SELECT
      ${collection.slug}::text AS collection_slug,
      d.id AS target_id,
      c.created_at,
      d.updated_at,
      c.id AS comment_id,
      c.body_md,
      c.edited_at
    FROM ${npComments} c
    INNER JOIN ${collection.table} d ON d.id = c.target_id
    WHERE c.member_id = ${memberId}
      AND c.site_id = ${siteId}
      AND c.target_type = ${collection.slug}
      AND c.status = 'visible'
      AND d.site_id = ${siteId}
      AND d.status = 'published'
      AND d.visibility = 'public'
      ${collection.config.community?.audience === true ? sql`AND d.audience = 'public'` : sql``}
  `;
}

function dateValue(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid profile activity ${field}.`);
  return parsed;
}

async function queryActivityIndex(
  db: ActivityDb,
  collections: RegisteredActivityCollection[],
  memberId: string,
  siteId: string,
  query: NpMemberProfileActivityQuery,
): Promise<{ rows: ActivityIndexRow[]; totalDocs: number }> {
  if (collections.length === 0) return { rows: [], totalDocs: 0 };
  const branches: SQL[] = collections.map((collection) =>
    query.kind === "documents"
      ? documentBranch(collection, memberId, siteId)
      : commentBranch(collection, memberId, siteId),
  );
  const union = sql.join(branches, sql` UNION ALL `);
  const [countRow] = (
    (await db.execute(sql`SELECT count(*)::int AS total FROM (${union}) activity`)) as unknown as {
      rows: Array<{ total: number | string }>;
    }
  ).rows;
  const totalDocs = Number(countRow?.total ?? 0);
  if (!Number.isSafeInteger(totalDocs) || totalDocs < 0) {
    throw new Error("Invalid profile activity total.");
  }
  const offset = (query.page - 1) * query.limit;
  const result = (await db.execute(sql`
    SELECT *
    FROM (${union}) activity
    ORDER BY created_at DESC, collection_slug ASC, target_id ASC, comment_id ASC NULLS FIRST
    LIMIT ${query.limit} OFFSET ${offset}
  `)) as unknown as {
    rows: Array<{
      collection_slug: string;
      target_id: string;
      created_at: Date | string;
      updated_at: Date | string;
      comment_id?: string;
      body_md?: string;
      edited_at?: Date | string | null;
    }>;
  };
  return {
    totalDocs,
    rows: result.rows.map((row) => ({
      collectionSlug: row.collection_slug,
      targetId: row.target_id,
      createdAt: dateValue(row.created_at, "createdAt"),
      updatedAt: dateValue(row.updated_at, "updatedAt"),
      ...(query.kind === "comments"
        ? {
            commentId: row.comment_id,
            bodyMd: row.body_md,
            editedAt:
              row.edited_at === null || row.edited_at === undefined
                ? null
                : dateValue(row.edited_at, "editedAt"),
          }
        : {}),
    })),
  };
}

async function loadTargetDocuments(
  db: ActivityDb,
  collections: RegisteredActivityCollection[],
  rows: ActivityIndexRow[],
  siteId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const idsByCollection = new Map<string, string[]>();
  for (const row of rows) {
    const ids = idsByCollection.get(row.collectionSlug) ?? [];
    ids.push(row.targetId);
    idsByCollection.set(row.collectionSlug, ids);
  }
  const docs = new Map<string, Record<string, unknown>>();
  const collectionBySlug = new Map(collections.map((collection) => [collection.slug, collection]));
  await Promise.all(
    [...idsByCollection.entries()].map(async ([slug, ids]) => {
      const collection = collectionBySlug.get(slug);
      if (!collection) return;
      const idColumn = tableColumn(collection.table, "id");
      const siteColumn = tableColumn(collection.table, "siteId");
      const statusColumn = tableColumn(collection.table, "status");
      const visibilityColumn = tableColumn(collection.table, "visibility");
      const audienceColumn =
        collection.config.community?.audience === true
          ? tableColumn(collection.table, "audience")
          : null;
      if (!idColumn || !siteColumn || !statusColumn || !visibilityColumn) return;
      const selected = (await db
        .select()
        .from(collection.table)
        .where(
          and(
            inArray(idColumn as never, [...new Set(ids)]),
            eq(siteColumn as never, siteId),
            eq(statusColumn as never, "published"),
            eq(visibilityColumn as never, "public"),
            ...(audienceColumn ? [eq(audienceColumn as never, "public")] : []),
          ),
        )) as Array<Record<string, unknown>>;
      for (const document of selected) {
        if (typeof document.id === "string") docs.set(`${slug}\0${document.id}`, document);
      }
    }),
  );
  return docs;
}

function activityTitle(config: NpCollectionConfig, document: Record<string, unknown>): string {
  const candidates = [document.title, document.name, document.slug];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().slice(0, 240);
    }
  }
  return config.labels.singular.slice(0, 240) || "Untitled";
}

function activityHref(slug: string, document: Record<string, unknown>): string | null {
  try {
    return npResolveDocumentPublicHref(slug, document);
  } catch (error) {
    npRecordCommunityRuntimeDiagnostic(
      "profiles",
      `Unable to resolve public profile activity destination for ${slug}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function commentExcerpt(bodyMd: string): string {
  return bodyMd
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/[`*_>#()~-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, npCommunityContractLimits.profileActivityExcerptLength);
}

function commentHref(href: string | null, commentId: string): string | null {
  if (!href) return null;
  const parsed = new URL(href, "https://nexpress.invalid");
  parsed.hash = `comment-${commentId}`;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function buildItems(
  collections: RegisteredActivityCollection[],
  rows: ActivityIndexRow[],
  documents: Map<string, Record<string, unknown>>,
  kind: NpMemberProfileActivityQuery["kind"],
): NpMemberProfileActivityItemWire[] {
  const configBySlug = new Map(
    collections.map((collection) => [collection.slug, collection.config]),
  );
  const items: NpMemberProfileActivityItemWire[] = [];
  for (const row of rows) {
    const config = configBySlug.get(row.collectionSlug);
    const document = documents.get(`${row.collectionSlug}\0${row.targetId}`);
    if (!config || !document) {
      throw new Error(`Profile activity target disappeared: ${row.collectionSlug}/${row.targetId}`);
    }
    const href = activityHref(row.collectionSlug, document);
    const title = activityTitle(config, document);
    if (kind === "documents") {
      items.push({
        kind: "document",
        collectionSlug: row.collectionSlug,
        collectionLabel: config.labels.singular,
        documentId: row.targetId,
        title,
        href,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      continue;
    }
    if (typeof row.commentId !== "string" || typeof row.bodyMd !== "string") {
      throw new Error("Invalid persisted comment activity row.");
    }
    items.push({
      kind: "comment",
      commentId: row.commentId,
      targetType: row.collectionSlug,
      targetId: row.targetId,
      targetTitle: title,
      href: commentHref(href, row.commentId),
      excerpt: commentExcerpt(row.bodyMd),
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
    });
  }
  return items;
}

/**
 * Lists one exact, public, site-scoped activity page for a member. Only
 * collections that explicitly opt into the requested profile projection are
 * considered; private/pending documents and non-visible comments never enter
 * the count or page window.
 */
export async function listMemberProfileActivity(
  memberId: string,
  input: NpMemberProfileActivityQuery,
): Promise<NpMemberProfileActivityPageWire> {
  const checkedMemberId = npRequireCommunityId(memberId, "community.profileActivity.memberId");
  const query = npRequireMemberProfileActivityQuery(input);
  try {
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const collections = activityCollections(query.kind);
    const { index, documents } = await getDb().transaction(
      async (tx) => {
        await requirePublicMember(tx, checkedMemberId);
        const index = await queryActivityIndex(tx, collections, checkedMemberId, siteId, query);
        const documents = await loadTargetDocuments(tx, collections, index.rows, siteId);
        return { index, documents };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    const totalPages = index.totalDocs === 0 ? 0 : Math.ceil(index.totalDocs / query.limit);
    return npRequireMemberProfileActivityPageWire({
      kind: query.kind,
      items: buildItems(collections, index.rows, documents, query.kind),
      totalDocs: index.totalDocs,
      totalPages,
      page: query.page,
      limit: query.limit,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1 && index.totalDocs > 0,
    });
  } catch (error) {
    npRecordCommunityRuntimeDiagnostic(
      "profiles",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
