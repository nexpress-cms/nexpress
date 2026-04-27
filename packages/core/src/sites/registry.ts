import { eq, asc, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "../collections/registry.js";
import { getDb } from "../collections/pipeline.js";
import {
  nxNavigation,
  nxSettings,
  nxSiteMemberships,
  nxSites,
  nxStringOverrides,
} from "../db/schema/system.js";
import { NxValidationError } from "../errors.js";

/**
 * Phase 15.1 — multi-site registry. The framework treats
 * sites as long-lived rows in `nx_sites`; the bootstrap calls
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

export interface NxSite {
  id: string;
  name: string;
  hostname: string | null;
  description: string | null;
  settings: Record<string, unknown>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_SITE_ID = "default";

function rowToSite(row: typeof nxSites.$inferSelect): NxSite {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    description: row.description,
    settings: row.settings ?? {},
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Idempotently create the default site if no sites exist.
 * Bootstrap calls this once during framework init; tests
 * that truncate `nx_sites` between cases re-trigger it.
 */
export async function ensureDefaultSite(): Promise<NxSite> {
  const db = getDb();
  const existingDefault = await db
    .select()
    .from(nxSites)
    .where(eq(nxSites.id, DEFAULT_SITE_ID))
    .limit(1);
  if (existingDefault[0]) return rowToSite(existingDefault[0]);

  const now = new Date();
  const [created] = await db
    .insert(nxSites)
    .values({
      id: DEFAULT_SITE_ID,
      name: "Default site",
      hostname: null,
      isDefault: true,
      settings: {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return rowToSite(created);

  // Conflict path: another worker raced us. Re-read.
  const [row] = await db
    .select()
    .from(nxSites)
    .where(eq(nxSites.id, DEFAULT_SITE_ID))
    .limit(1);
  if (!row) {
    throw new Error("Failed to create or read the default site");
  }
  return rowToSite(row);
}

export async function listSites(): Promise<NxSite[]> {
  const db = getDb();
  const rows = await db.select().from(nxSites).orderBy(asc(nxSites.createdAt));
  return rows.map(rowToSite);
}

export async function getSiteById(id: string): Promise<NxSite | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(nxSites)
    .where(eq(nxSites.id, id))
    .limit(1);
  return row ? rowToSite(row) : null;
}

/**
 * Hostname-based lookup. Returns the matching site, or the
 * default site when no row matches (so a request hitting
 * an unconfigured host still gets served by the canonical
 * site rather than 404'ing). Case-insensitive on the host
 * string.
 */
export async function getSiteByHostname(
  hostname: string,
): Promise<NxSite | null> {
  const db = getDb();
  const lower = hostname.toLowerCase();
  const [row] = await db
    .select()
    .from(nxSites)
    .where(eq(nxSites.hostname, lower))
    .limit(1);
  return row ? rowToSite(row) : null;
}

export async function getDefaultSite(): Promise<NxSite | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(nxSites)
    .where(eq(nxSites.isDefault, true))
    .limit(1);
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
): Promise<NxSite | null> {
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
  settings?: Record<string, unknown>;
}

export async function createSite(input: CreateSiteInput): Promise<NxSite> {
  if (!/^[a-z][a-z0-9-]*$/.test(input.id)) {
    throw new NxValidationError("Invalid input", [
      {
        field: "id",
        message:
          "Site id must be lowercase alphanumeric + hyphens, starting with a letter",
      },
    ]);
  }
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(nxSites)
    .values({
      id: input.id,
      name: input.name,
      hostname: input.hostname?.toLowerCase() ?? null,
      description: input.description ?? null,
      settings: input.settings ?? {},
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
  patch: Partial<Pick<NxSite, "name" | "hostname" | "description" | "settings">>,
): Promise<NxSite> {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.hostname !== undefined) {
    updates.hostname = patch.hostname ? patch.hostname.toLowerCase() : null;
  }
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.settings !== undefined) updates.settings = patch.settings;
  const [row] = await db
    .update(nxSites)
    .set(updates)
    .where(eq(nxSites.id, id))
    .returning();
  if (!row) {
    throw new NxValidationError("Invalid input", [
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
 *   - per-collection row counts (codegen'd `nx_c_*` tables)
 *   - system tables that carry `site_id`: settings,
 *     navigation, memberships, string overrides
 *
 * Does NOT include things that aren't site-scoped:
 *   - users (`nx_users` is global)
 *   - media (`nx_media` is global)
 *   - audit events / plugin storage / community rows (the
 *     audit notes these as future work)
 */
export interface NxSiteUsage {
  collections: Record<string, number>;
  settings: number;
  navigation: number;
  memberships: number;
  stringOverrides: number;
  /** Sum of every count above. Convenience for "is anything here?" checks. */
  total: number;
}

export async function getSiteUsageSummary(id: string): Promise<NxSiteUsage> {
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

  const [settingsRow] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nxSettings)
    .where(eq(nxSettings.siteId, id))) as Array<{ count: number }>;
  const [navigationRow] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nxNavigation)
    .where(eq(nxNavigation.siteId, id))) as Array<{ count: number }>;
  const [membershipsRow] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nxSiteMemberships)
    .where(eq(nxSiteMemberships.siteId, id))) as Array<{ count: number }>;
  const [overridesRow] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nxStringOverrides)
    .where(eq(nxStringOverrides.siteId, id))) as Array<{ count: number }>;

  const settings = settingsRow?.count ?? 0;
  const navigation = navigationRow?.count ?? 0;
  const memberships = membershipsRow?.count ?? 0;
  const stringOverrides = overridesRow?.count ?? 0;
  const collectionsTotal = Object.values(collections).reduce(
    (sum, n) => sum + n,
    0,
  );

  return {
    collections,
    settings,
    navigation,
    memberships,
    stringOverrides,
    total:
      collectionsTotal + settings + navigation + memberships + stringOverrides,
  };
}

export interface NxDeleteSiteOptions {
  /**
   * Phase 15.9 — when `true`, cascade-delete every site-scoped
   * row (collection content, settings, navigation, memberships,
   * string overrides) before dropping the `nx_sites` row.
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
export async function deleteSite(
  id: string,
  options?: NxDeleteSiteOptions,
): Promise<void> {
  const db = getDb();
  const [target] = await db
    .select()
    .from(nxSites)
    .where(eq(nxSites.id, id))
    .limit(1);
  if (!target) {
    throw new NxValidationError("Invalid input", [
      { field: "id", message: `Site "${id}" not found` },
    ]);
  }
  if (target.isDefault) {
    throw new NxValidationError("Invalid input", [
      {
        field: "id",
        message:
          "Cannot delete the default site. Promote another site to default first.",
      },
    ]);
  }

  const usage = await getSiteUsageSummary(id);
  if (usage.total > 0 && !options?.cascade) {
    throw new NxValidationError("Invalid input", [
      {
        field: "cascade",
        message: `Site "${id}" has ${usage.total} attached row(s). Pass cascade=true to delete them, or clear them manually first.`,
      },
    ]);
  }

  if (options?.cascade) {
    // Order: collection content first, then system tables, then
    // the site row itself. Collection deletes go through the
    // raw table (no hook firing) — site teardown isn't a
    // pipeline write and there's no doc-level afterDelete hook
    // expected here.
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
    await db.delete(nxStringOverrides).where(eq(nxStringOverrides.siteId, id));
    await db.delete(nxNavigation).where(eq(nxNavigation.siteId, id));
    await db.delete(nxSettings).where(eq(nxSettings.siteId, id));
    await db.delete(nxSiteMemberships).where(eq(nxSiteMemberships.siteId, id));
  }

  await db.delete(nxSites).where(eq(nxSites.id, id));
}

export const NX_DEFAULT_SITE_ID = DEFAULT_SITE_ID;
