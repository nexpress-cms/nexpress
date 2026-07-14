/**
 * `@nexpress/core/db` — database connection + schema codegen.
 *
 * Pool factory, the single-instance accessors used by the pipeline,
 * and the schema generators that turn collection definitions into
 * Drizzle tables and TypeScript types. The system tables are
 * re-exported via `./schema/index.js`; consumers usually import the
 * generated `apps/web/src/db/generated/collections.ts` instead.
 */

export * from "./connection.js";
export { getDb } from "./runtime.js";
export { generateDrizzleSchema } from "./generator.js";
export { generateTypeScript } from "./type-generator.js";
export * from "./schema/index.js";
