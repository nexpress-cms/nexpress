import { createDbConnection } from "@nexpress/core";

export type NxDb = ReturnType<typeof createDbConnection>;

let db: NxDb | null = null;

function getDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return connectionString;
}

export function getDb(): NxDb {
  db ??= createDbConnection({ connectionString: getDatabaseUrl() });

  return db;
}
