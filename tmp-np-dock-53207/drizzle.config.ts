import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, ".env") });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
}

export default defineConfig({
  schema: [
    "./node_modules/@nexpress/core/dist/db-schema.js",
    "./src/db/generated/*.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
  // `strict: true` makes drizzle-kit prompt the operator to
  // confirm potentially-destructive diffs. When `pnpm db:migrate`
  // runs inside the setup wizard as a child process with piped
  // stdio, the prompt can't render — drizzle-kit detects the
  // non-TTY and exits silently (no error, just code 1). Operators
  // saw an empty `<details>` toggle in the wizard UI and no useful
  // output from direct `pnpm db:migrate` either. Leaving strict
  // off so migrations are non-interactive by default; operators
  // who want destructive-change confirmation should run
  // `pnpm exec drizzle-kit migrate --strict` directly.
  verbose: true,
});
