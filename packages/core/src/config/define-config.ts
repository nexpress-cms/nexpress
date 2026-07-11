import { ZodError } from "zod";

import { mergeThemeRequirements } from "../themes/merge-requirements.js";
import { npValidateRegisteredThemeDefinition } from "../themes/definition-contract.js";
import { type NpConfig } from "./types.js";
import { npConfigSchema } from "./validation.js";
import {
  npValidateCollectionDefinition,
  npValidateCollectionDefinitions,
} from "./collection-definition-contract.js";

/**
 * Validates the project's NpConfig against the declarative schema and returns
 * it unchanged on success. Catches common mistakes (bad collection slug,
 * missing auth.secret, malformed storage adapter, etc.) at module-eval time
 * with a clear message instead of a cryptic runtime failure once the app
 * tries to boot.
 *
 * The most common boot trip-up by far is "auth.secret" / "site.url" /
 * "db.connectionString" missing on a fresh install. We translate Zod's raw
 * `String must contain at least 1 character` style messages into actionable
 * "set NP_SECRET in .env, or run `pnpm run setup`" hints so the new operator
 * isn't googling Zod path strings.
 *
 * Unknown plugin entries are accepted here — the plugin loader does the
 * deeper validation of manifests against @nexpress/plugin-sdk.
 *
 * After validation, theme requirements are auto-merged into the
 * `collections` array via `mergeThemeRequirements`. Operators no
 * longer need to AST-patch `src/collections/*.ts` when adopting a
 * theme — adding the theme to `themes: [...]` is enough; the next
 * `pnpm db:generate && pnpm db:migrate` picks up the new
 * theme-declared columns.
 */
export function defineConfig(config: NpConfig): NpConfig {
  try {
    npConfigSchema.parse(config);
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

  validateCollectionEntries(config.collections, "config.collections");

  const themeIds = new Set<string>();
  for (const [index, theme] of (config.themes ?? []).entries()) {
    const validation = npValidateRegisteredThemeDefinition(theme);
    if (!validation.ok) {
      throw new Error(
        `Invalid theme at config.themes[${index.toString()}].${validation.issue.location}: ${validation.issue.message}`,
      );
    }
    if (themeIds.has(theme.manifest.id)) {
      throw new Error(
        `Invalid theme config: duplicate theme id "${theme.manifest.id}" at config.themes[${index.toString()}].`,
      );
    }
    themeIds.add(theme.manifest.id);
  }

  // Theme auto-merge. Non-destructive: operator-authored fields
  // are never overwritten, and a no-op when no themes (or no
  // themes with `requires`) are registered. Returns the input
  // array unchanged in that case, so the equality semantics
  // existing callers rely on hold.
  const mergedCollections = mergeThemeRequirements(config.collections, config.themes);
  validateCollections(
    mergedCollections,
    mergedCollections === config.collections ? "config.collections" : "resolved collections",
  );
  if (mergedCollections === config.collections) {
    return config;
  }
  return { ...config, collections: mergedCollections };
}

function validateCollectionEntries(collections: NpConfig["collections"], location: string): void {
  const slugs = new Set<string>();
  for (const [index, collection] of collections.entries()) {
    const validation = npValidateCollectionDefinition(collection);
    if (!validation.ok) {
      const issueLocation = validation.issue.location ? `.${validation.issue.location}` : "";
      throw new Error(
        `Invalid collection at ${location}[${index.toString()}]${issueLocation}: ${validation.issue.message}`,
      );
    }
    if (slugs.has(collection.slug)) {
      throw new Error(
        `Invalid collection config: duplicate collection slug "${collection.slug}" at ${location}[${index.toString()}].`,
      );
    }
    slugs.add(collection.slug);
  }
}

function validateCollections(collections: NpConfig["collections"], location: string): void {
  const validation = npValidateCollectionDefinitions(collections);
  if (!validation.ok) {
    const issueLocation = validation.issue.location.replace(/^(\d+)/u, "[$1]");
    throw new Error(
      `Invalid collection at ${location}${issueLocation}: ${validation.issue.message}`,
    );
  }
}

const FRIENDLY_HINTS: Record<string, string> = {
  "auth.secret":
    "Set `NP_SECRET` in `.env` (≥32 random chars) — `pnpm run setup` will generate one for you.",
  "site.url": "Set `SITE_URL` in `.env` to your public origin — `pnpm run setup` collects it.",
  "db.connectionString":
    "Set `DATABASE_URL` in `.env` to your Postgres connection string — `pnpm run setup` will write it.",
  "storage.s3.bucket": "Set `NP_S3_BUCKET` in `.env` (or switch storage to local).",
  "storage.s3.region": "Set `NP_S3_REGION` in `.env`.",
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
