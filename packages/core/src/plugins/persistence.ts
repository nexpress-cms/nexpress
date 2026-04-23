import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { nxPlugins } from "../db/schema/system.js";

export interface NxPluginState {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
}

export interface NxPluginStateUpdate {
  enabled?: boolean;
  config?: Record<string, unknown>;
}

interface DrizzleDb {
  select: NodePgDatabase<Record<string, unknown>>["select"];
  insert: NodePgDatabase<Record<string, unknown>>["insert"];
  update: NodePgDatabase<Record<string, unknown>>["update"];
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toState(row: {
  id: string;
  enabled: boolean;
  config: unknown;
  installedAt: Date;
  updatedAt: Date;
}): NxPluginState {
  return {
    id: row.id,
    enabled: row.enabled,
    config: normalizeConfig(row.config),
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPluginStates(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<NxPluginState[]> {
  const rows = (await (db as unknown as DrizzleDb).select().from(nxPlugins)) as Array<{
    id: string;
    enabled: boolean;
    config: unknown;
    installedAt: Date;
    updatedAt: Date;
  }>;

  return rows.map(toState);
}

export async function getPluginState(
  db: NodePgDatabase<Record<string, unknown>>,
  id: string,
): Promise<NxPluginState | null> {
  const rows = (await (db as unknown as DrizzleDb)
    .select()
    .from(nxPlugins)
    .where(eq(nxPlugins.id, id))
    .limit(1)) as Array<{
    id: string;
    enabled: boolean;
    config: unknown;
    installedAt: Date;
    updatedAt: Date;
  }>;

  return rows[0] ? toState(rows[0]) : null;
}

/**
 * Ensures every known plugin id has a row in `nx_plugins`. Missing rows are
 * inserted with `enabled=true` and an empty config. Existing rows are never
 * touched — this is called on boot and must not clobber operator edits.
 */
export async function syncPluginRegistrations(
  db: NodePgDatabase<Record<string, unknown>>,
  pluginIds: readonly string[],
): Promise<void> {
  if (pluginIds.length === 0) return;

  const existing = (await (db as unknown as DrizzleDb)
    .select({ id: nxPlugins.id })
    .from(nxPlugins)
    .where(inArray(nxPlugins.id, [...pluginIds]))) as Array<{ id: string }>;

  const existingIds = new Set(existing.map((row) => row.id));
  const missing = pluginIds.filter((id) => !existingIds.has(id));
  if (missing.length === 0) return;

  const now = new Date();
  await (db as unknown as DrizzleDb).insert(nxPlugins).values(
    missing.map((id) => ({
      id,
      enabled: true,
      config: {},
      installedAt: now,
      updatedAt: now,
    })),
  );
}

export async function updatePluginState(
  db: NodePgDatabase<Record<string, unknown>>,
  id: string,
  patch: NxPluginStateUpdate,
): Promise<NxPluginState | null> {
  const values: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (patch.enabled !== undefined) {
    values.enabled = patch.enabled;
  }
  if (patch.config !== undefined) {
    values.config = patch.config;
  }

  const rows = (await (db as unknown as DrizzleDb)
    .update(nxPlugins)
    .set(values)
    .where(eq(nxPlugins.id, id))
    .returning()) as Array<{
    id: string;
    enabled: boolean;
    config: unknown;
    installedAt: Date;
    updatedAt: Date;
  }>;

  return rows[0] ? toState(rows[0]) : null;
}
