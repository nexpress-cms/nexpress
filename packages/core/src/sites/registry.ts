import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { getAllCollectionSlugs, getCollectionTable } from "../collections/registry.js";
import { getDb } from "../db/runtime.js";
import {
  npAuditEvents,
  npBans,
  npComments,
  npFollows,
  npMemberMutes,
  npMemberRoles,
  npNotifications,
  npReactions,
  npReports,
} from "../db/schema/community.js";
import { npMediaRefs } from "../db/schema/media.js";
import {
  npNavigation,
  npPluginStorage,
  npRevisions,
  npSettings,
  npSiteMemberships,
  npSites,
  npSlugHistory,
  npStringOverrides,
} from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import {
  DEFAULT_SITE_RUNTIME_SETTINGS,
  npAssertSiteRecord,
  npAssertSiteUsage,
  npIsCanonicalSiteId,
  npNormalizeCreateSiteInput,
  npNormalizeSiteHostHeader,
  npNormalizeUpdateSiteInput,
} from "../settings/contract.js";
import type {
  NpCreateSiteInput,
  NpSiteRecord,
  NpSiteUsage,
  NpUpdateSiteInput,
} from "../settings/types.js";
import { NP_DEFAULT_SITE_ID } from "./id-contract.js";

/**
 * Multi-site registry. Sites are long-lived rows in `np_sites`; bootstrap
 * calls `ensureDefaultSite()` so single-site installs work without operator
 * setup. The reserved default id is permanent and every persisted site row is
 * validated before it reaches callers.
 */

export type NpSite = NpSiteRecord;

function rowToSite(row: typeof npSites.$inferSelect): NpSite {
  const site = {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    description: row.description,
    settings: row.settings,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  npAssertSiteRecord(site);
  return site;
}

/**
 * Idempotently create the reserved default site when its row is absent.
 * Bootstrap calls this once during framework init; tests that delete
 * `np_sites` between cases re-trigger it.
 */
export async function ensureDefaultSite(): Promise<NpSite> {
  const db = getDb();
  const existingDefault = await db
    .select()
    .from(npSites)
    .where(eq(npSites.id, NP_DEFAULT_SITE_ID))
    .limit(1);
  if (existingDefault[0]) return rowToSite(existingDefault[0]);

  const now = new Date();
  const [created] = await db
    .insert(npSites)
    .values({
      id: NP_DEFAULT_SITE_ID,
      name: "Default site",
      hostname: null,
      isDefault: true,
      settings: DEFAULT_SITE_RUNTIME_SETTINGS,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return rowToSite(created);

  // Conflict path: another worker raced us. Re-read.
  const [row] = await db.select().from(npSites).where(eq(npSites.id, NP_DEFAULT_SITE_ID)).limit(1);
  if (!row) {
    throw new Error("Failed to create or read the default site");
  }
  return rowToSite(row);
}

export async function listSites(): Promise<NpSite[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(npSites)
    .orderBy(desc(npSites.isDefault), asc(npSites.createdAt));
  return rows.map(rowToSite);
}

export async function getSiteById(id: string): Promise<NpSite | null> {
  if (!npIsCanonicalSiteId(id)) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: "Site id must be a canonical lowercase id" },
    ]);
  }
  const db = getDb();
  const [row] = await db.select().from(npSites).where(eq(npSites.id, id)).limit(1);
  return row ? rowToSite(row) : null;
}

/**
 * Host-header lookup. Normalizes case, one trailing dot, and an
 * optional port before querying. Returns null on a valid miss;
 * `resolveSiteForHostname()` owns the default-site fallback.
 */
export async function getSiteByHostname(hostname: string): Promise<NpSite | null> {
  const db = getDb();
  let normalized: string;
  try {
    normalized = npNormalizeSiteHostHeader(hostname);
  } catch (error) {
    throw new NpValidationError("Invalid input", [
      {
        field: "hostname",
        message: error instanceof Error ? error.message : "Invalid hostname",
      },
    ]);
  }
  const [row] = await db.select().from(npSites).where(eq(npSites.hostname, normalized)).limit(1);
  return row ? rowToSite(row) : null;
}

export async function getDefaultSite(): Promise<NpSite | null> {
  const db = getDb();
  const [row] = await db.select().from(npSites).where(eq(npSites.id, NP_DEFAULT_SITE_ID)).limit(1);
  return row ? rowToSite(row) : null;
}

/**
 * Resolve which site a request belongs to. Tries hostname
 * lookup first; falls back to the default site. Returns
 * `null` only when the database has no sites at all (which
 * shouldn't happen post-bootstrap).
 */
export async function resolveSiteForHostname(
  hostname: string | null | undefined,
): Promise<NpSite | null> {
  if (hostname) {
    const matched = await getSiteByHostname(hostname);
    if (matched) return matched;
  }
  return getDefaultSite();
}

export async function createSite(input: NpCreateSiteInput): Promise<NpSite> {
  let normalized: NpCreateSiteInput;
  try {
    normalized = npNormalizeCreateSiteInput(input);
  } catch (error) {
    throw new NpValidationError("Invalid input", [
      { field: "site", message: error instanceof Error ? error.message : "Invalid site" },
    ]);
  }
  const now = new Date();
  const candidate: NpSite = {
    id: normalized.id,
    name: normalized.name,
    hostname: normalized.hostname ?? null,
    description: normalized.description ?? null,
    settings: normalized.settings ?? DEFAULT_SITE_RUNTIME_SETTINGS,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  npAssertSiteRecord(candidate);
  const db = getDb();
  const [row] = await db.insert(npSites).values(candidate).returning();
  if (!row) {
    throw new Error("Failed to create site");
  }
  return rowToSite(row);
}

export async function updateSite(id: string, patch: NpUpdateSiteInput): Promise<NpSite> {
  if (!npIsCanonicalSiteId(id)) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: "Site id must be a canonical lowercase id" },
    ]);
  }
  const db = getDb();
  const current = await getSiteById(id);
  if (!current) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: `Site "${id}" not found` },
    ]);
  }
  let normalized: NpUpdateSiteInput;
  try {
    normalized = npNormalizeUpdateSiteInput(patch);
  } catch (error) {
    throw new NpValidationError("Invalid input", [
      { field: "site", message: error instanceof Error ? error.message : "Invalid site" },
    ]);
  }
  const candidate: NpSite = {
    ...current,
    ...normalized,
    updatedAt: new Date(),
  };
  npAssertSiteRecord(candidate);
  const [row] = await db
    .update(npSites)
    .set({ ...normalized, updatedAt: candidate.updatedAt })
    .where(eq(npSites.id, id))
    .returning();
  if (!row) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: `Site "${id}" not found` },
    ]);
  }
  return rowToSite(row);
}

/**
 * Phase 15.9 — count of every site-scoped row attached to a
 * given site. Surfaces in the admin delete-site dialog so
 * operators see what an explicitly confirmed cascade would remove.
 *
 * Includes:
 *   - per-collection row counts (codegen'd `np_c_*` tables)
 *   - system tables that carry `site_id`: settings,
 *     navigation, slug history, memberships, string overrides, plugin
 *     storage (Issue #220)
 *   - community tables that carry `site_id`: comments,
 *     reactions, follows, mutes, notifications, reports,
 *     audit events, bans, member roles (Issue #220)
 *
 * Does NOT include things that aren't site-scoped:
 *   - users (`np_users` is global)
 *   - members (`np_members` is global; per-site enrollment
 *     happens through the site-scoped `bans` / `member_roles`
 *     tables which DO appear in usage)
 *   - media (`np_media` is global)
 *   - audit events with `site_id IS NULL` — those are
 *     intentional super-admin / background-job events that
 *     don't belong to any tenant.
 */
interface NpSiteCollectionTable {
  slug: string;
  table: PgTable;
  idColumn: AnyPgColumn;
  siteIdColumn: AnyPgColumn;
}

function getSiteCollectionTables(): NpSiteCollectionTable[] {
  return getAllCollectionSlugs().map((slug) => {
    const table = getCollectionTable(slug) as PgTable;
    const columns = table as unknown as Record<string, unknown>;
    const idColumn = columns.id as AnyPgColumn | undefined;
    const siteIdColumn = columns.siteId as AnyPgColumn | undefined;
    if (!idColumn || !siteIdColumn) {
      throw new Error(`Registered collection "${slug}" has no id or siteId column.`);
    }
    return { slug, table, idColumn, siteIdColumn };
  });
}

async function getSiteUsageSummaryWithDb(
  db: ReturnType<typeof getDb>,
  id: string,
  collectionTables: NpSiteCollectionTable[],
): Promise<NpSiteUsage> {
  const collections: Record<string, number> = {};
  for (const { slug, table, siteIdColumn } of collectionTables) {
    const [row] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(siteIdColumn as never, id))) as Array<{ count: number }>;
    collections[slug] = row?.count ?? 0;
  }

  const countWhere = async (table: PgTable, where: ReturnType<typeof eq>): Promise<number> => {
    const [row] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(where)) as Array<{ count: number }>;
    return row?.count ?? 0;
  };

  const settings = await countWhere(npSettings, eq(npSettings.siteId, id));
  const navigation = await countWhere(npNavigation, eq(npNavigation.siteId, id));
  const slugHistory = await countWhere(npSlugHistory, eq(npSlugHistory.siteId, id));
  const memberships = await countWhere(npSiteMemberships, eq(npSiteMemberships.siteId, id));
  const stringOverrides = await countWhere(npStringOverrides, eq(npStringOverrides.siteId, id));
  // Issue #220 — include the tables that landed after Phase 15.9
  // shipped. Without them a site looks "empty" in the admin
  // even though it owns thousands of community rows; deleting
  // it would silently leave them orphaned.
  const pluginStorage = await countWhere(npPluginStorage, eq(npPluginStorage.siteId, id));
  const comments = await countWhere(npComments, eq(npComments.siteId, id));
  const reactions = await countWhere(npReactions, eq(npReactions.siteId, id));
  const follows = await countWhere(npFollows, eq(npFollows.siteId, id));
  const mutes = await countWhere(npMemberMutes, eq(npMemberMutes.siteId, id));
  const notifications = await countWhere(npNotifications, eq(npNotifications.siteId, id));
  const reports = await countWhere(npReports, eq(npReports.siteId, id));
  // Audit events with `site_id IS NULL` are the cross-tenant /
  // background-job rows; we deliberately don't count them here.
  const auditEvents = await countWhere(npAuditEvents, eq(npAuditEvents.siteId, id));
  const bans = await countWhere(npBans, eq(npBans.siteId, id));
  const memberRoles = await countWhere(npMemberRoles, eq(npMemberRoles.siteId, id));

  const collectionsTotal = Object.values(collections).reduce((sum, n) => sum + n, 0);

  const usage: NpSiteUsage = {
    collections,
    settings,
    navigation,
    slugHistory,
    memberships,
    stringOverrides,
    pluginStorage,
    comments,
    reactions,
    follows,
    mutes,
    notifications,
    reports,
    auditEvents,
    bans,
    memberRoles,
    total:
      collectionsTotal +
      settings +
      navigation +
      slugHistory +
      memberships +
      stringOverrides +
      pluginStorage +
      comments +
      reactions +
      follows +
      mutes +
      notifications +
      reports +
      auditEvents +
      bans +
      memberRoles,
  };
  npAssertSiteUsage(usage);
  return usage;
}

export async function getSiteUsageSummary(id: string): Promise<NpSiteUsage> {
  const site = await getSiteById(id);
  if (!site) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: `Site "${id}" not found` },
    ]);
  }
  return getSiteUsageSummaryWithDb(getDb(), id, getSiteCollectionTables());
}

export interface NpDeleteSiteOptions {
  /**
   * Phase 15.9 — when `true`, cascade-delete every site-scoped
   * row (collection content, system state, memberships, plugin storage,
   * and community state) before dropping the `np_sites` row.
   *
   * When `false` (default, safe), the call refuses if any
   * site-scoped data still exists. The admin UI uses this to
   * force operators to confirm cascade explicitly so an
   * accidental delete can't quietly orphan thousands of rows.
   */
  cascade?: boolean;
}

/**
 * Delete a non-default site. The reserved `default` site is a
 * permanent framework invariant and cannot be reassigned.
 *
 * Phase 15.9 — `options.cascade` controls whether site-scoped
 * data is deleted alongside. Defaults to `false` for safety;
 * the admin UI surfaces a usage summary first so the operator
 * sees what cascade would touch.
 */
export async function deleteSite(id: string, options?: NpDeleteSiteOptions): Promise<void> {
  if (!npIsCanonicalSiteId(id)) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: "Site id must be a canonical lowercase id" },
    ]);
  }
  if (
    options !== undefined &&
    (typeof options !== "object" ||
      options === null ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== "cascade") ||
      (options.cascade !== undefined && typeof options.cascade !== "boolean"))
  ) {
    throw new NpValidationError("Invalid input", [
      { field: "options", message: "Delete options may contain only a boolean cascade field" },
    ]);
  }
  const db = getDb();
  const collectionTables = getSiteCollectionTables();
  await db.transaction(async (transaction) => {
    const tx = transaction as ReturnType<typeof getDb>;
    const [target] = await tx.select().from(npSites).where(eq(npSites.id, id)).limit(1);
    if (!target) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }
    rowToSite(target);
    if (target.id === NP_DEFAULT_SITE_ID) {
      throw new NpValidationError("Invalid input", [
        {
          field: "id",
          message: `Cannot delete the reserved "${NP_DEFAULT_SITE_ID}" site.`,
        },
      ]);
    }

    const usage = await getSiteUsageSummaryWithDb(tx, id, collectionTables);
    if (usage.total > 0 && !options?.cascade) {
      throw new NpValidationError("Invalid input", [
        {
          field: "cascade",
          message: `Site "${id}" has ${usage.total} attached row(s). Pass cascade=true to delete them, or clear them manually first.`,
        },
      ]);
    }

    if (options?.cascade) {
      // Order: collection content first, then community rows that
      // reference comments / members polymorphically (so we don't
      // leave orphan reactions pointing at deleted comments mid-
      // sweep), then community parent tables, then system tables.
      // Collection deletes go through the raw table (no hook
      // firing) — site teardown isn't a pipeline write and there's
      // no doc-level afterDelete hook expected here.
      for (const { slug, table, idColumn, siteIdColumn } of collectionTables) {
        const documentIds = tx
          .select({ id: sql<string>`${idColumn}::text` })
          .from(table)
          .where(eq(siteIdColumn, id));
        // These tables are intentionally global and identify their owner by
        // collection + document id instead of site_id. Remove the rows while
        // the owning documents are still available so site teardown does not
        // leave revision history or media reference orphans. A SQL subquery
        // keeps the operation bounded even for sites with many documents.
        await tx
          .delete(npMediaRefs)
          .where(
            and(eq(npMediaRefs.collection, slug), inArray(npMediaRefs.documentId, documentIds)),
          );
        await tx
          .delete(npRevisions)
          .where(
            and(eq(npRevisions.collection, slug), inArray(npRevisions.documentId, documentIds)),
          );
        await tx.delete(table).where(eq(siteIdColumn, id));
      }
      // Issue #220 — community rows. Order:
      //   reactions/follows/mutes/notifications/reports/audit/bans/
      //   member_roles → comments → string_overrides/navigation/
      //   settings/plugin_storage/memberships → np_sites.
      // Reactions reference comment ids polymorphically, so they
      // go before comments to keep the DB clean even though there's
      // no FK to enforce ordering.
      await tx.delete(npReactions).where(eq(npReactions.siteId, id));
      await tx.delete(npFollows).where(eq(npFollows.siteId, id));
      await tx.delete(npMemberMutes).where(eq(npMemberMutes.siteId, id));
      await tx.delete(npNotifications).where(eq(npNotifications.siteId, id));
      await tx.delete(npReports).where(eq(npReports.siteId, id));
      await tx.delete(npAuditEvents).where(eq(npAuditEvents.siteId, id));
      await tx.delete(npBans).where(eq(npBans.siteId, id));
      await tx.delete(npMemberRoles).where(eq(npMemberRoles.siteId, id));
      await tx.delete(npComments).where(eq(npComments.siteId, id));

      await tx.delete(npStringOverrides).where(eq(npStringOverrides.siteId, id));
      await tx.delete(npSlugHistory).where(eq(npSlugHistory.siteId, id));
      await tx.delete(npNavigation).where(eq(npNavigation.siteId, id));
      await tx.delete(npSettings).where(eq(npSettings.siteId, id));
      await tx.delete(npPluginStorage).where(eq(npPluginStorage.siteId, id));
      await tx.delete(npSiteMemberships).where(eq(npSiteMemberships.siteId, id));
    }

    await tx.delete(npSites).where(eq(npSites.id, id));
  });
}

export { NP_DEFAULT_SITE_ID } from "./id-contract.js";
