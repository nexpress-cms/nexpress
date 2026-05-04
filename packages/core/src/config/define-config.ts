import { ZodError } from "zod";

import { type NxConfig } from "./types.js";
import { nxConfigSchema } from "./validation.js";

/**
 * Validates the project's NxConfig against the declarative schema and returns
 * it unchanged on success. Catches common mistakes (bad collection slug,
 * missing auth.secret, malformed storage adapter, etc.) at module-eval time
 * with a clear message instead of a cryptic runtime failure once the app
 * tries to boot.
 *
 * The most common boot trip-up by far is "auth.secret" / "site.url" /
 * "db.connectionString" missing on a fresh install. We translate Zod's raw
 * `String must contain at least 1 character` style messages into actionable
 * "set NX_SECRET in .env, or run `pnpm run setup`" hints so the new operator
 * isn't googling Zod path strings.
 *
 * Unknown plugin entries are accepted here — the plugin loader does the
 * deeper validation of manifests against @nexpress/plugin-sdk.
 */
export function defineConfig(config: NxConfig): NxConfig {
  try {
    nxConfigSchema.parse(config);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(formatConfigError(err), { cause: err });
    }
    throw err;
  }

  // Phase 12.1 cross-field check — a collection can only opt
  // into i18n if the top-level i18n config is set. The schema
  // can't express this with `.refine()` cleanly because it
  // would force every collection to know the parent config.
  if (config.i18n === undefined) {
    const localized = config.collections.find((c) => c.i18n === true);
    if (localized) {
      throw new Error(
        `Collection "${localized.slug}" sets i18n: true but the top-level config has no \`i18n\` block. Add \`i18n: { locales: [...], defaultLocale: "..." }\` to nexpress.config.ts.`,
      );
    }
  }

  return config;
}

const FRIENDLY_HINTS: Record<string, string> = {
  "auth.secret":
    "Set `NX_SECRET` in `.env` (≥32 random chars) — `pnpm run setup` will generate one for you.",
  "site.url":
    "Set `SITE_URL` in `.env` to your public origin — `pnpm run setup` collects it.",
  "db.connectionString":
    "Set `DATABASE_URL` in `.env` to your Postgres connection string — `pnpm run setup` will write it.",
  "storage.s3.bucket": "Set `NX_S3_BUCKET` in `.env` (or switch storage to local).",
  "storage.s3.region": "Set `NX_S3_REGION` in `.env`.",
};

function formatConfigError(err: ZodError): string {
  const lines = err.issues.map((issue) => {
    const path = issue.path.join(".");
    const hint = FRIENDLY_HINTS[path];
    if (hint) return `  • ${path}: ${hint}`;
    return `  • ${path || "<root>"}: ${issue.message}`;
  });
  return [
    "Invalid NexPress config — boot aborted before any service starts.",
    "",
    ...lines,
    "",
    "If this is your first run, `pnpm run setup` writes a working `.env`.",
  ].join("\n");
}
