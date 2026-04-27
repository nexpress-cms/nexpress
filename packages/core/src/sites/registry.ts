import { eq, asc } from "drizzle-orm";

import { getDb } from "../collections/pipeline.js";
import { nxSites } from "../db/schema/system.js";
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
    settings: (row.settings ?? {}) as Record<string, unknown>,
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
 * Delete a non-default site. The default site can't be
 * deleted (the framework's invariant is "at least one site
 * always exists"); operators who want to retire the default
 * promote a different site to default first.
 */
export async function deleteSite(id: string): Promise<void> {
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
  await db.delete(nxSites).where(eq(nxSites.id, id));
}

export const NX_DEFAULT_SITE_ID = DEFAULT_SITE_ID;
