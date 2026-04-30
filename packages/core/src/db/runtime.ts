import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Single source of truth for the runtime DB handle. Both the
 * collections pipeline and the media service read through `getDb()`
 * so test harnesses that swap the singleton via `setDb(testPool)`
 * affect every consumer in lockstep.
 *
 * Bootstrap glue (e.g. `@nexpress/next`'s `createBootstrap`) calls
 * `setDb()` once with the connection it created. Application code
 * does NOT call this directly — let the bootstrap do it.
 */
let dbInstance: NodePgDatabase<Record<string, unknown>> | null = null;

export function setDb(db: NodePgDatabase<Record<string, unknown>>): void {
  dbInstance = db;
}

export function getDb(): NodePgDatabase<Record<string, unknown>> {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call setDb() first.");
  }
  return dbInstance;
}
