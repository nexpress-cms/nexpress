import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { QueryResult, QueryResultRow } from "pg";

export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";
export const MIGRATIONS_TABLE_NAME = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;

interface MigrationQueryClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface LocalMigrationEntry {
  index: number;
  tag: string;
  createdAt: number;
  hash: string;
}

export interface AppliedMigrationEntry {
  id: number;
  hash: string;
  createdAt: number;
}

export interface MigrationDrift {
  tag: string;
  createdAt: number;
  localHash: string;
  appliedHash: string;
}

export interface MigrationStatus {
  local: LocalMigrationEntry[];
  applied: AppliedMigrationEntry[];
  latestApplied: AppliedMigrationEntry | null;
  pending: LocalMigrationEntry[];
  drifted: MigrationDrift[];
  unknownApplied: AppliedMigrationEntry[];
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface TableExistsRow extends QueryResultRow {
  migration_table: string | null;
}

interface AppliedMigrationRow extends QueryResultRow {
  id: number | string;
  hash: string;
  created_at: number | string;
}

export function readLocalMigrationEntries(folder: string): LocalMigrationEntry[] {
  const journalEntries = readJournalEntries(folder);
  const migrationFiles = readMigrationFiles({ migrationsFolder: folder });

  if (journalEntries.length !== migrationFiles.length) {
    throw new Error(
      `Drizzle migration journal has ${journalEntries.length} entries but ${migrationFiles.length} SQL files were read.`,
    );
  }

  return journalEntries.map((entry, index) => {
    const migrationFile = migrationFiles[index];
    if (!migrationFile) {
      throw new Error(`Missing local SQL metadata for migration ${entry.tag}.`);
    }

    return {
      index: entry.idx,
      tag: entry.tag,
      createdAt: entry.when,
      hash: migrationFile.hash,
    };
  });
}

export async function readAppliedMigrations(
  client: MigrationQueryClient,
): Promise<AppliedMigrationEntry[]> {
  await client.query("set statement_timeout = 5000");

  const tableExists = await client.query<TableExistsRow>(
    "select to_regclass($1) as migration_table",
    [MIGRATIONS_TABLE_NAME],
  );

  if (!tableExists.rows[0]?.migration_table) return [];

  const result = await client.query<AppliedMigrationRow>(
    `select id, hash, created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by created_at asc, id asc`,
  );

  return result.rows.map((row) => ({
    id: parseRequiredInteger(row.id, "migration id"),
    hash: row.hash,
    createdAt: parseRequiredInteger(row.created_at, "migration created_at"),
  }));
}

export function buildMigrationStatus(
  local: LocalMigrationEntry[],
  applied: AppliedMigrationEntry[],
): MigrationStatus {
  const latestApplied = applied.reduce<AppliedMigrationEntry | null>((latest, migration) => {
    if (!latest) return migration;
    if (migration.createdAt > latest.createdAt) return migration;
    if (migration.createdAt === latest.createdAt && migration.id > latest.id) return migration;
    return latest;
  }, null);

  const latestAppliedCreatedAt = latestApplied?.createdAt ?? Number.NEGATIVE_INFINITY;
  const pending = local.filter((migration) => migration.createdAt > latestAppliedCreatedAt);

  const appliedByCreatedAt = new Map<number, AppliedMigrationEntry>();
  for (const migration of applied) {
    const existing = appliedByCreatedAt.get(migration.createdAt);
    if (!existing || migration.id > existing.id) {
      appliedByCreatedAt.set(migration.createdAt, migration);
    }
  }

  const drifted: MigrationDrift[] = [];
  for (const migration of local) {
    const appliedMigration = appliedByCreatedAt.get(migration.createdAt);
    if (appliedMigration && appliedMigration.hash !== migration.hash) {
      drifted.push({
        tag: migration.tag,
        createdAt: migration.createdAt,
        localHash: migration.hash,
        appliedHash: appliedMigration.hash,
      });
    }
  }

  const localCreatedAt = new Set(local.map((migration) => migration.createdAt));
  const unknownApplied = applied.filter((migration) => !localCreatedAt.has(migration.createdAt));

  return {
    local,
    applied,
    latestApplied,
    pending,
    drifted,
    unknownApplied,
  };
}

export function buildMigrationStatusJson(status: MigrationStatus): Record<string, unknown> {
  return {
    schemaVersion: "np.migrations.v1",
    ok: status.drifted.length === 0 && status.unknownApplied.length === 0,
    migrationsFolder: "./drizzle",
    migrationTable: MIGRATIONS_TABLE_NAME,
    localCount: status.local.length,
    appliedCount: status.applied.length,
    pendingCount: status.pending.length,
    driftedCount: status.drifted.length,
    unknownAppliedCount: status.unknownApplied.length,
    latestApplied: status.latestApplied
      ? {
          id: status.latestApplied.id,
          createdAt: status.latestApplied.createdAt,
          hash: status.latestApplied.hash,
        }
      : null,
    pending: status.pending.map((migration) => ({
      index: migration.index,
      tag: migration.tag,
      createdAt: migration.createdAt,
      hash: migration.hash,
    })),
    drifted: status.drifted.map((migration) => ({
      tag: migration.tag,
      createdAt: migration.createdAt,
      localHash: migration.localHash,
      appliedHash: migration.appliedHash,
    })),
    unknownApplied: status.unknownApplied.map((migration) => ({
      id: migration.id,
      createdAt: migration.createdAt,
      hash: migration.hash,
    })),
  };
}

export function renderMigrationStatus(status: MigrationStatus): string {
  const lines = [
    "NexPress migration status",
    `Tracking table: ${MIGRATIONS_TABLE_NAME}`,
    `Local migrations: ${status.local.length}`,
    `Applied migrations: ${status.applied.length}`,
    `Pending migrations: ${status.pending.length}`,
    `Drifted migrations: ${status.drifted.length}`,
    `Unknown applied migrations: ${status.unknownApplied.length}`,
  ];

  const latestLocal = status.latestApplied
    ? status.local.find((migration) => migration.createdAt === status.latestApplied?.createdAt)
    : null;

  if (status.latestApplied) {
    lines.push(
      "",
      "Latest applied:",
      `  - ${latestLocal?.tag ?? status.latestApplied.hash} (${formatMigrationTime(
        status.latestApplied.createdAt,
      )})`,
    );
  }

  if (status.pending.length > 0) {
    lines.push("", "Pending:");
    for (const migration of status.pending) {
      lines.push(`  - ${migration.tag} (${formatMigrationTime(migration.createdAt)})`);
    }
    lines.push("", "Run `pnpm db:migrate` to apply pending migrations.");
  } else {
    lines.push("", "No pending migrations.");
  }

  if (status.drifted.length > 0) {
    lines.push(
      "",
      "Warning: applied migration hashes differ from local files:",
      ...status.drifted.map(
        (migration) => `  - ${migration.tag} (${formatMigrationTime(migration.createdAt)})`,
      ),
    );
  }

  if (status.unknownApplied.length > 0) {
    lines.push(
      "",
      "Warning: the database has applied migrations that are not present locally:",
      ...status.unknownApplied.map(
        (migration) =>
          `  - id ${migration.id} (${formatMigrationTime(migration.createdAt)}) ${migration.hash}`,
      ),
    );
  }

  return lines.join("\n");
}

function readJournalEntries(folder: string): JournalEntry[] {
  const raw = readFileSync(join(folder, "meta", "_journal.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const record = asRecord(parsed);
  const entries = record?.entries;
  if (!Array.isArray(entries)) {
    throw new Error(`Drizzle migration journal is missing entries: ${folder}/meta/_journal.json`);
  }

  return entries.map((entry, index) => parseJournalEntry(entry, index));
}

function parseJournalEntry(entry: unknown, index: number): JournalEntry {
  const record = asRecord(entry);
  if (!record) {
    throw new Error(`Invalid Drizzle migration journal entry at index ${index}.`);
  }

  const idx = record.idx;
  const tag = record.tag;
  const when = record.when;

  if (typeof idx !== "number" || !Number.isInteger(idx)) {
    throw new Error(`Invalid Drizzle migration index at journal entry ${index}.`);
  }
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error(`Invalid Drizzle migration tag at journal entry ${index}.`);
  }
  if (typeof when !== "number" || !Number.isSafeInteger(when)) {
    throw new Error(`Invalid Drizzle migration timestamp at journal entry ${index}.`);
  }

  return { idx, tag, when };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRequiredInteger(value: number | string, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${label} value returned by Postgres.`);
  }
  return parsed;
}

function formatMigrationTime(createdAt: number): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return String(createdAt);
  return date.toISOString();
}
