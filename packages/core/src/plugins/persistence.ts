import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { npPlugins } from "../db/schema/system.js";
import { invalidatePluginEnabled } from "./enabled-gate.js";

/**
 * G.1 — `np_plugins` is now a lean meta row: `(id, enabled,
 * installed_at, updated_at)`. The legacy `config` jsonb column was
 * dropped in favor of `np_settings` rows keyed by `plugin.config:<id>`
 * (see `packages/core/src/plugins/config.ts` and decision E in
 * `docs/design/plugin-config-auto-form.md`). Read / write plugin
 * config through `getPluginConfig` / `setPluginConfig` from the
 * config module — `getPluginState` only knows about the enable flag.
 */
export interface NpPluginState {
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
  update: NodePgDatabase<Record<string, unknown>>["update"];
}

function toState(row: {
  id: string;
  enabled: boolean;
  installedAt: Date;
  updatedAt: Date;
}): NpPluginState {
  return {
    id: row.id,
    enabled: row.enabled,
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPluginStates(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<NpPluginState[]> {
  const rows = (await (db as unknown as DrizzleDb).select().from(npPlugins)) as Array<{
    id: string;
    enabled: boolean;
    installedAt: Date;
    updatedAt: Date;
  }>;

  return rows.map(toState);
}

export async function getPluginState(
  db: NodePgDatabase<Record<string, unknown>>,
  id: string,
): Promise<NpPluginState | null> {
  const rows = (await (db as unknown as DrizzleDb)
    .select()
    .from(npPlugins)
    .where(eq(npPlugins.id, id))
    .limit(1)) as Array<{
    id: string;
    enabled: boolean;
    installedAt: Date;
    updatedAt: Date;
  }>;

  return rows[0] ? toState(rows[0]) : null;
}

/**
 * Ensures every known plugin id has a row in `np_plugins`. Missing rows are
 * inserted with `enabled=true`. Existing rows are never touched — this is
 * called on boot and must not clobber operator edits.
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
        enabled: true,
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
): Promise<NpPluginState | null> {
  const values: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (patch.enabled !== undefined) {
    values.enabled = patch.enabled;
  }

  const rows = (await (db as unknown as DrizzleDb)
    .update(npPlugins)
    .set(values)
    .where(eq(npPlugins.id, id))
    .returning()) as Array<{
    id: string;
    enabled: boolean;
    installedAt: Date;
    updatedAt: Date;
  }>;

  // Drop the cached enabled flag so the very next dispatch re-reads the row
  // instead of waiting out the TTL. Without this, a toggle from the admin UI
  // would feel laggy for up to 5s.
  if (patch.enabled !== undefined) {
    invalidatePluginEnabled(id);
  }

  return rows[0] ? toState(rows[0]) : null;
}
