import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig, type Config } from "drizzle-kit";

/**
 * Default drizzle-kit config. Both apps/web and scaffolded sites
 * call `createDrizzleConfig()` from `drizzle.config.ts`. The
 * single knob most consumers care about is `envPath` — apps/web
 * points it at the monorepo root `.env`, scaffolds use the
 * project-local `.env` (the default).
 *
 * `strict: true` deliberately stays off — drizzle-kit's strict
 * mode prompts the operator to confirm potentially-destructive
 * diffs, which doesn't render in the wizard's piped stdio
 * (#316). Operators who want destructive-change confirmation can
 * run `pnpm exec drizzle-kit migrate --strict` directly.
 */
export interface CreateDrizzleConfigOptions {
  /**
   * `.env` location relative to the project root (cwd). Defaults
   * to `".env"` (project-local). The monorepo's apps/web passes
   * `"../../.env"` to reach the shared root file.
   */
  envPath?: string;
  /** Merge / override fields on the final config. */
  overrides?: Partial<Config>;
}

export function createDrizzleConfig(
  options: CreateDrizzleConfigOptions = {},
): Config {
  const envFile = resolve(process.cwd(), options.envPath ?? ".env");
  loadEnv({ path: envFile });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      `DATABASE_URL is not set — copy .env.example to .env first (looked at ${envFile}).`,
    );
  }

  return defineConfig({
    schema: [
      "./node_modules/@nexpress/core/dist/db-schema.js",
      "./src/db/generated/*.ts",
    ],
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: { url: connectionString },
    verbose: true,
    ...options.overrides,
  });
}
