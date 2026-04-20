import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index.js";

export interface CreateDbConnectionConfig {
  connectionString: string;
  pool?: Pool;
}

export function createDbConnection(config: CreateDbConnectionConfig) {
  const pool = config.pool ?? new Pool({ connectionString: config.connectionString });

  return drizzle(pool, { schema });
}
