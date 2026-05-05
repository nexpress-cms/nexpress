import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { readEnvPositiveInt } from "../config/env.js";
import * as schema from "./schema/index.js";

export interface CreateDbConnectionConfig {
  connectionString: string;
  pool?: Pool;
  /**
   * Override Pool option defaults. Useful for tests, or for sites that need
   * to tune connection limits / timeouts. The fields explicitly set below
   * (`connectionTimeoutMillis`, `statement_timeout`) win unless callers
   * override them here.
   */
  poolOptions?: ConstructorParameters<typeof Pool>[0];
}

/**
 * Defaults chosen so a wedged Postgres (network drop, container paused,
 * lock storm) surfaces a clear error in single-digit seconds rather than
 * letting a Next.js request handler hang past the platform's request
 * deadline. Both bounds can be raised on a per-site basis via `poolOptions`
 * or globally via `NP_DB_CONNECTION_TIMEOUT_MS` / `NP_DB_STATEMENT_TIMEOUT_MS`.
 *
 *  - `connectionTimeoutMillis` caps `pool.connect()` waits — kicks in when
 *    the daemon TCP-accepts but never completes the Postgres handshake (the
 *    Docker-Desktop-stuck failure mode).
 *  - `statement_timeout` is enforced server-side by Postgres and bounds any
 *    single query, including the catch-all "select * from np_users where
 *    email = $1" path that has to be fast on the auth hot path. Sites with
 *    legitimately heavy admin workloads (large audit searches, bulk
 *    exports) raise this rather than dropping the bound entirely.
 */
const DEFAULT_CONNECTION_TIMEOUT_MS = readEnvPositiveInt("NP_DB_CONNECTION_TIMEOUT_MS", 5_000);
const DEFAULT_STATEMENT_TIMEOUT_MS = readEnvPositiveInt("NP_DB_STATEMENT_TIMEOUT_MS", 10_000);

export function createDbConnection(config: CreateDbConnectionConfig) {
  const pool =
    config.pool ??
    new Pool({
      connectionString: config.connectionString,
      connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
      statement_timeout: DEFAULT_STATEMENT_TIMEOUT_MS,
      ...config.poolOptions,
    });

  return drizzle(pool, { schema });
}
