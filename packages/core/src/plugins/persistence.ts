import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { npPlugins, npSites, npSitePlugins } from "../db/schema/system.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID, npIsCanonicalSiteId } from "../sites/id-contract.js";
import { invalidatePluginEnabled } from "./enabled-gate.js";

/**
 * `np_plugins` is the process-global installation inventory while
 * `np_site_plugins` stores sparse site activation overrides. The legacy
 * `config` jsonb column was
 * dropped in favor of site-scoped `np_settings` rows keyed by
 * `plugin.config:<id>`
 * (see `packages/core/src/plugins/config.ts` and decision E in
 * `docs/design/plugin-config-auto-form.md`). Read / write plugin
 * config through `getPluginConfig` / `setPluginConfig` from the
 * config module — `getPluginState` only knows about the enable flag.
 */
export interface NpPluginState {
  siteId: string;
  id: string;
  enabled: boolean;
  installedAt: Date;
  updatedAt: Date;
}

export interface NpPluginStateUpdate {
  enabled?: boolean;
}

interface DrizzleDb {
  select: NodePgDatabase<Record<string, unknown>>["select"];
  insert: NodePgDatabase<Record<string, unknown>>["insert"];
}

async function resolveSiteId(siteId?: string): Promise<string> {
  const resolved = siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  if (!npIsCanonicalSiteId(resolved)) {
    throw new Error("Plugin activation site id is not canonical.");
  }
  return resolved;
}

function toState(
  siteId: string,
  row: {
    id: string;
    enabled: boolean | null;
    installedAt: Date;
    updatedAt: Date;
    activationUpdatedAt: Date | null;
  },
): NpPluginState {
  return {
    siteId,
    id: row.id,
    enabled: row.enabled ?? true,
    installedAt: row.installedAt,
    updatedAt: row.activationUpdatedAt ?? row.updatedAt,
  };
}

export async function listPluginStates(
  db: NodePgDatabase<Record<string, unknown>>,
  siteId?: string,
): Promise<NpPluginState[]> {
  const resolvedSiteId = await resolveSiteId(siteId);
  const rows = (await (db as unknown as DrizzleDb)
    .select({
      id: npPlugins.id,
      enabled: npSitePlugins.enabled,
      installedAt: npPlugins.installedAt,
      updatedAt: npPlugins.updatedAt,
      activationUpdatedAt: npSitePlugins.updatedAt,
    })
    .from(npPlugins)
    .leftJoin(
      npSitePlugins,
      and(eq(npSitePlugins.siteId, resolvedSiteId), eq(npSitePlugins.pluginId, npPlugins.id)),
    )) as Array<{
    id: string;
    enabled: boolean | null;
    installedAt: Date;
    updatedAt: Date;
    activationUpdatedAt: Date | null;
  }>;

  return rows.map((row) => toState(resolvedSiteId, row));
}

export async function getPluginState(
  db: NodePgDatabase<Record<string, unknown>>,
  id: string,
  siteId?: string,
): Promise<NpPluginState | null> {
  const resolvedSiteId = await resolveSiteId(siteId);
  const rows = (await (db as unknown as DrizzleDb)
    .select({
      id: npPlugins.id,
      enabled: npSitePlugins.enabled,
      installedAt: npPlugins.installedAt,
      updatedAt: npPlugins.updatedAt,
      activationUpdatedAt: npSitePlugins.updatedAt,
    })
    .from(npPlugins)
    .leftJoin(
      npSitePlugins,
      and(eq(npSitePlugins.siteId, resolvedSiteId), eq(npSitePlugins.pluginId, npPlugins.id)),
    )
    .where(eq(npPlugins.id, id))
    .limit(1)) as Array<{
    id: string;
    enabled: boolean | null;
    installedAt: Date;
    updatedAt: Date;
    activationUpdatedAt: Date | null;
  }>;

  return rows[0] ? toState(resolvedSiteId, rows[0]) : null;
}

export async function listEnabledPluginIds(
  db: NodePgDatabase<Record<string, unknown>>,
  siteId?: string,
): Promise<string[]> {
  return (await listPluginStates(db, siteId))
    .filter((state) => state.enabled)
    .map((state) => state.id);
}

/** All persisted sites where the plugin is active (missing override = active). */
export async function listEnabledPluginSiteIds(
  db: NodePgDatabase<Record<string, unknown>>,
  pluginId: string,
): Promise<string[]> {
  const rows = await db
    .select({ siteId: npSites.id, enabled: npSitePlugins.enabled })
    .from(npSites)
    .leftJoin(
      npSitePlugins,
      and(eq(npSitePlugins.siteId, npSites.id), eq(npSitePlugins.pluginId, pluginId)),
    );
  return rows.filter((row) => row.enabled !== false).map((row) => row.siteId);
}

/**
 * Ensures every known plugin id has a row in `np_plugins`. Missing rows are
 * inserted into the process-global installation inventory. Site activation
 * stays in the sparse `np_site_plugins` table and is never changed here.
 *
 * Uses a single INSERT … ON CONFLICT DO NOTHING so concurrent boots (multi-
 * process deployments) can all race safely without unique-key violations.
 */
export async function syncPluginRegistrations(
  db: NodePgDatabase<Record<string, unknown>>,
  pluginIds: readonly string[],
): Promise<void> {
  if (pluginIds.length === 0) return;

  const now = new Date();
  await db
    .insert(npPlugins)
    .values(
      pluginIds.map((id) => ({
        id,
        installedAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({ target: npPlugins.id });
}

export async function updatePluginState(
  db: NodePgDatabase<Record<string, unknown>>,
  id: string,
  patch: NpPluginStateUpdate,
  siteId?: string,
): Promise<NpPluginState | null> {
  const resolvedSiteId = await resolveSiteId(siteId);
  const installation = await getPluginState(db, id, resolvedSiteId);
  if (!installation) return null;

  if (patch.enabled !== undefined) {
    const now = new Date();
    await db
      .insert(npSitePlugins)
      .values({ siteId: resolvedSiteId, pluginId: id, enabled: patch.enabled, updatedAt: now })
      .onConflictDoUpdate({
        target: [npSitePlugins.siteId, npSitePlugins.pluginId],
        set: { enabled: patch.enabled, updatedAt: now },
      });
  }

  // Drop the cached enabled flag so the very next dispatch re-reads the row
  // instead of waiting out the TTL. Without this, a toggle from the admin UI
  // would feel laggy for up to 5s.
  if (patch.enabled !== undefined) {
    invalidatePluginEnabled(id, resolvedSiteId);
  }

  return getPluginState(db, id, resolvedSiteId);
}
