import { type and, eq, asc, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "../collections/registry.js";
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
import {
  npNavigation,
  npPluginStorage,
  npSettings,
  npSiteMemberships,
  npSites,
  npStringOverrides,
} from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import {
  DEFAULT_SITE_RUNTIME_SETTINGS,
  npAssertSiteRecord,
  npNormalizeSiteGeneralSettings,
  npNormalizeSiteRuntimeSettings,
  npSiteIdPattern,
} from "../settings/contract.js";
import type { NpSiteRecord, NpSiteRuntimeSettings } from "../settings/types.js";

/**
 * Phase 15.1 — multi-site registry. The framework treats
 * sites as long-lived rows in `np_sites`; the bootstrap calls
 * `ensureDefaultSite()` at boot to guarantee at least one row
 * exists so single-tenant installs (the existing reference
 * app shape) keep working without operator intervention.
 *
 * 15.1 ships the model + lookup helpers; 15.2 wires
 * collection queries through `siteId`; 15.3 ships the
 * super-admin UI for creating / managing sites. Until 15.2
 * lands, nothing in the existing pipeline knows or cares
 * about which site a row belongs to — the columns just
 * exist and the default site backfills.
 */

export type NpSite = NpSiteRecord;

const DEFAULT_SITE_ID = "default";

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
 * Idempotently create the default site if no sites exist.
 * Bootstrap calls this once during framework init; tests
 * that truncate `np_sites` between cases re-trigger it.
 */
export async function ensureDefaultSite(): Promise<NpSite> {
  const db = getDb();
  const existingDefault = await db
    .select()
    .from(npSites)
    .where(eq(npSites.id, DEFAULT_SITE_ID))
    .limit(1);
  if (existingDefault[0]) return rowToSite(existingDefault[0]);

  const now = new Date();
  const [created] = await db
    .insert(npSites)
    .values({
      id: DEFAULT_SITE_ID,
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
  const [row] = await db.select().from(npSites).where(eq(npSites.id, DEFAULT_SITE_ID)).limit(1);
  if (!row) {
    throw new Error("Failed to create or read the default site");
  }
  return rowToSite(row);
}

export async function listSites(): Promise<NpSite[]> {
  const db = getDb();
  const rows = await db.select().from(npSites).orderBy(asc(npSites.createdAt));
  return rows.map(rowToSite);
}

export async function getSiteById(id: string): Promise<NpSite | null> {
  const db = getDb();
  const [row] = await db.select().from(npSites).where(eq(npSites.id, id)).limit(1);
  return row ? rowToSite(row) : null;
}

/**
 * Hostname-based lookup. Returns the matching site, or the
 * default site when no row matches (so a request hitting
 * an unconfigured host still gets served by the canonical
 * site rather than 404'ing). Case-insensitive on the host
 * string.
 */
export async function getSiteByHostname(hostname: string): Promise<NpSite | null> {
  const db = getDb();
  const lower = hostname.toLowerCase();
  const [row] = await db.select().from(npSites).where(eq(npSites.hostname, lower)).limit(1);
  return row ? rowToSite(row) : null;
}

export async function getDefaultSite(): Promise<NpSite | null> {
  const db = getDb();
  const [row] = await db.select().from(npSites).where(eq(npSites.isDefault, true)).limit(1);
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

export interface CreateSiteInput {
  id: string;
  name: string;
  hostname?: string | null;
  description?: string | null;
  settings?: NpSiteRuntimeSettings;
}

export async function createSite(input: CreateSiteInput): Promise<NpSite> {
  if (!new RegExp(npSiteIdPattern, "u").test(input.id)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "id",
        message: "Site id must be lowercase alphanumeric + hyphens, starting with a letter",
      },
    ]);
  }
  let settings: NpSiteRuntimeSettings;
  let name: string;
  let description: string | null;
  const hostname = input.hostname ? input.hostname.trim().toLowerCase() : null;
  const now = new Date();
  try {
    settings = npNormalizeSiteRuntimeSettings(input.settings ?? DEFAULT_SITE_RUNTIME_SETTINGS);
    const general = npNormalizeSiteGeneralSettings({
      name: input.name,
      url: settings.siteUrl,
      description: input.description ?? null,
      defaultLocale: settings.defaultLocale,
      timezone: settings.timezone,
    });
    name = general.name;
    description = general.description;
    npAssertSiteRecord({
      id: input.id,
      name,
      hostname,
      description,
      settings,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    throw new NpValidationError("Invalid input", [
      { field: "site", message: error instanceof Error ? error.message : "Invalid site" },
    ]);
  }
  const db = getDb();
  const [row] = await db
    .insert(npSites)
    .values({
      id: input.id,
      name,
      hostname,
      description,
      settings,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create site");
  }
  return rowToSite(row);
}

export async function updateSite(
  id: string,
  patch: Partial<Pick<NpSite, "name" | "hostname" | "description" | "settings">>,
): Promise<NpSite> {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const current = await getSiteById(id);
  if (!current) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: `Site "${id}" not found` },
    ]);
  }
  const candidateSettings = patch.settings ?? current.settings;
  try {
    const normalizedSettings = npNormalizeSiteRuntimeSettings(candidateSettings);
    const general = npNormalizeSiteGeneralSettings({
      name: patch.name ?? current.name,
      url: normalizedSettings.siteUrl,
      description: patch.description !== undefined ? patch.description : current.description,
      defaultLocale: normalizedSettings.defaultLocale,
      timezone: normalizedSettings.timezone,
    });
    if (patch.name !== undefined) updates.name = general.name;
    if (patch.description !== undefined) updates.description = general.description;
    if (patch.settings !== undefined) updates.settings = normalizedSettings;
  } catch (error) {
    throw new NpValidationError("Invalid input", [
      { field: "site", message: error instanceof Error ? error.message : "Invalid site" },
    ]);
  }
  if (patch.hostname !== undefined) {
    const hostname = patch.hostname ? patch.hostname.trim().toLowerCase() : null;
    const candidate = { ...current, ...updates, hostname, updatedAt: new Date() };
    try {
      npAssertSiteRecord(candidate);
    } catch (error) {
      throw new NpValidationError("Invalid input", [
        { field: "hostname", message: error instanceof Error ? error.message : "Invalid hostname" },
      ]);
    }
    updates.hostname = hostname;
  }
  const [row] = await db.update(npSites).set(updates).where(eq(npSites.id, id)).returning();
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
 * operators see what they're about to nuke (or leave behind
 * as orphans, in the cascade=false path).
 *
 * Includes:
 *   - per-collection row counts (codegen'd `np_c_*` tables)
 *   - system tables that carry `site_id`: settings,
 *     navigation, memberships, string overrides, plugin
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
export interface NpSiteUsage {
  collections: Record<string, number>;
  settings: number;
  navigation: number;
  memberships: number;
  stringOverrides: number;
  /** Issue #220 — newly-included site-scoped tables. */
  pluginStorage: number;
  comments: number;
  reactions: number;
  follows: number;
  mutes: number;
  notifications: number;
  reports: number;
  auditEvents: number;
  bans: number;
  memberRoles: number;
  /** Sum of every count above. Convenience for "is anything here?" checks. */
  total: number;
}

export async function getSiteUsageSummary(id: string): Promise<NpSiteUsage> {
  const db = getDb();
  const collections: Record<string, number> = {};
  for (const slug of getAllCollectionSlugs()) {
    try {
      const config = getCollectionConfig(slug);
      void config;
      const table = getCollectionTable(slug) as PgTable;
      const idCol = (table as unknown as Record<string, unknown>).siteId;
      if (!idCol) continue;
      const [row] = (await db
        .select({ count: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(idCol as never, id))) as Array<{ count: number }>;
      collections[slug] = row?.count ?? 0;
    } catch {
      // Collection without a registered table — skip silently.
    }
  }

  const countWhere = async (
    table: PgTable,
    where: ReturnType<typeof eq> | ReturnType<typeof and>,
  ): Promise<number> => {
    const [row] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(where)) as Array<{ count: number }>;
    return row?.count ?? 0;
  };

  const settings = await countWhere(npSettings, eq(npSettings.siteId, id));
  const navigation = await countWhere(npNavigation, eq(npNavigation.siteId, id));
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

  return {
    collections,
    settings,
    navigation,
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
}

export interface NpDeleteSiteOptions {
  /**
   * Phase 15.9 — when `true`, cascade-delete every site-scoped
   * row (collection content, settings, navigation, memberships,
   * string overrides) before dropping the `np_sites` row.
   *
   * When `false` (default, safe), the call refuses if any
   * site-scoped data still exists. The admin UI uses this to
   * force operators to confirm cascade explicitly so an
   * accidental delete can't quietly orphan thousands of rows.
   */
  cascade?: boolean;
}

/**
 * Delete a non-default site. The default site can't be
 * deleted (the framework's invariant is "at least one site
 * always exists"); operators who want to retire the default
 * promote a different site to default first.
 *
 * Phase 15.9 — `options.cascade` controls whether site-scoped
 * data is deleted alongside. Defaults to `false` for safety;
 * the admin UI surfaces a usage summary first so the operator
 * sees what cascade would touch.
 */
export async function deleteSite(id: string, options?: NpDeleteSiteOptions): Promise<void> {
  const db = getDb();
  const [target] = await db.select().from(npSites).where(eq(npSites.id, id)).limit(1);
  if (!target) {
    throw new NpValidationError("Invalid input", [
      { field: "id", message: `Site "${id}" not found` },
    ]);
  }
  if (target.isDefault) {
    throw new NpValidationError("Invalid input", [
      {
        field: "id",
        message: "Cannot delete the default site. Promote another site to default first.",
      },
    ]);
  }

  const usage = await getSiteUsageSummary(id);
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
    for (const slug of Object.keys(usage.collections)) {
      try {
        const table = getCollectionTable(slug) as PgTable;
        const siteIdCol = (table as unknown as Record<string, unknown>).siteId;
        if (!siteIdCol) continue;
        await db.delete(table).where(eq(siteIdCol as never, id));
      } catch {
        // Ignore — the collection might have been
        // unregistered between the usage scan and the delete.
      }
    }
    // Issue #220 — community rows. Order:
    //   reactions/follows/mutes/notifications/reports/audit/bans/
    //   member_roles → comments → string_overrides/navigation/
    //   settings/plugin_storage/memberships → np_sites.
    // Reactions reference comment ids polymorphically, so they
    // go before comments to keep the DB clean even though there's
    // no FK to enforce ordering.
    await db.delete(npReactions).where(eq(npReactions.siteId, id));
    await db.delete(npFollows).where(eq(npFollows.siteId, id));
    await db.delete(npMemberMutes).where(eq(npMemberMutes.siteId, id));
    await db.delete(npNotifications).where(eq(npNotifications.siteId, id));
    await db.delete(npReports).where(eq(npReports.siteId, id));
    await db.delete(npAuditEvents).where(eq(npAuditEvents.siteId, id));
    await db.delete(npBans).where(eq(npBans.siteId, id));
    await db.delete(npMemberRoles).where(eq(npMemberRoles.siteId, id));
    await db.delete(npComments).where(eq(npComments.siteId, id));

    await db.delete(npStringOverrides).where(eq(npStringOverrides.siteId, id));
    await db.delete(npNavigation).where(eq(npNavigation.siteId, id));
    await db.delete(npSettings).where(eq(npSettings.siteId, id));
    await db.delete(npPluginStorage).where(eq(npPluginStorage.siteId, id));
    await db.delete(npSiteMemberships).where(eq(npSiteMemberships.siteId, id));
  }

  await db.delete(npSites).where(eq(npSites.id, id));
}

export const NP_DEFAULT_SITE_ID = DEFAULT_SITE_ID;
