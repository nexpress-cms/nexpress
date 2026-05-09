import { and, eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";

import type { NpThemeManifest } from "../config/types.js";
import { getDb } from "../db/index.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { getActiveTheme, getThemeById } from "./registry.js";
import {
  introspectThemeSettingsSchema,
  type NpThemeSettingsField,
} from "./settings-schema.js";

const DEFAULT_SITE = "default";

/**
 * Phase F.3 — per-theme operator settings.
 *
 * Stored at `np_settings.(site_id, key="theme.settings:<themeId>")`
 * with the value being the parsed `z.infer<typeof
 * settingsSchema>`. Reuses the existing `nx:theme:<siteId>`
 * cache tag (see design doc §5.3) — settings live on the same
 * read paths as tokens / active id, so a shared bust avoids
 * fragmenting the tag namespace.
 */

function settingsKey(themeId: string): string {
  return `theme.settings:${themeId}`;
}

/**
 * v0.3 (D) — versioned envelope for persisted theme settings.
 *
 * Sentinel keys (`__npVersion`, `__npSettings`) avoid collision
 * with theme-owned setting fields (themes rarely choose names
 * starting with `__np`; a `version` / `value` heuristic was
 * considered but rejected because both names are plausible
 * theme-author choices for actual settings).
 *
 * Legacy unwrapped values (written by v0.2 before this PR) are
 * detected by the absence of the sentinel keys and migrated
 * in-place to v1 → current.
 */
/** Internal — exported for unit tests only. */
export interface NpVersionedSettings {
  __npVersion: number;
  __npSettings: unknown;
}

/** Internal — exported for unit tests only. */
export function isVersionedSettings(value: unknown): value is NpVersionedSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NpVersionedSettings>;
  // Number.isFinite rejects NaN / Infinity / non-numbers — a
  // hand-crafted or corrupted DB value with `__npVersion: NaN`
  // would otherwise pass typeof and trip the migration path's
  // `>=` comparisons (NaN >= N always false).
  return (
    typeof candidate.__npVersion === "number" &&
    Number.isFinite(candidate.__npVersion) &&
    "__npSettings" in candidate
  );
}

/** Run the theme's `settingsMigrate` from `from` to current
 *  schema version. No-op when versions match (or when the theme
 *  doesn't declare a migrator). Defensive try/catch — a buggy
 *  migrate fn shouldn't blow up the read path; we fall back to
 *  the original value and let `safeParse` decide. */
/** Internal — exported for unit tests only. */
export function applyMigration(
  manifest: NpThemeManifest,
  rawValue: unknown,
  fromVersion: number,
): unknown {
  const target = manifest.settingsVersion ?? 1;
  if (fromVersion >= target) return rawValue;
  const migrate = manifest.settingsMigrate;
  if (typeof migrate !== "function") return rawValue;
  try {
    return migrate(rawValue, fromVersion);
  } catch {
    return rawValue;
  }
}

function defaultsFrom(fields: NpThemeSettingsField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) {
      out[f.name] = f.default;
      continue;
    }
    if (f.type === "object") {
      out[f.name] = defaultsFrom(f.fields);
    }
    if (f.type === "array") {
      out[f.name] = [];
    }
  }
  return out;
}

/**
 * Read the persisted settings row for a theme and parse it via
 * the theme's schema. Returns the parsed value when valid;
 * falls back to schema defaults on parse failure (with the
 * failure recorded for the admin to surface, see
 * `getThemeSettingsWithStatus`).
 *
 * `themeId` defaults to the active theme. Pass an explicit id
 * to read another installed theme's settings (used by the
 * admin settings page).
 *
 * Return type is `unknown` because core can't type-narrow to
 * a specific theme's `z.infer<typeof schema>` — the schema
 * lives in the theme package, not in core. Theme components
 * should cast at the call site, ideally against an exported
 * type alias from the theme package itself:
 *
 *   // packages/themes/magazine/src/index.ts
 *   export const settingsSchema = z.object({ ... });
 *   export type MagazineSettings = z.infer<typeof settingsSchema>;
 *
 *   // a theme component
 *   const settings = (await getThemeSettings()) as MagazineSettings;
 */
export async function getThemeSettings(
  themeId?: string,
): Promise<unknown> {
  const result = await getThemeSettingsWithStatus(themeId);
  return result.value;
}

export interface NpThemeSettingsResult {
  themeId: string | null;
  /** Parsed settings or schema defaults (never null when a theme
   *  has a schema; empty object when the theme has no schema). */
  value: unknown;
  /** True when there's a stored row, regardless of whether it
   *  passed validation. */
  hasPersisted: boolean;
  /** Set when the persisted value failed `schema.parse()`. The
   *  admin surface uses this to show a "values reset to
   *  defaults" banner. */
  parseError?: string;
}

export async function getThemeSettingsWithStatus(
  themeId?: string,
): Promise<NpThemeSettingsResult> {
  const theme = themeId ? getThemeById(themeId) : await getActiveTheme();
  if (!theme) {
    return { themeId: null, value: {}, hasPersisted: false };
  }
  const schema = theme.manifest.settingsSchema as ZodTypeAny | undefined;
  if (!schema) {
    return { themeId: theme.manifest.id, value: {}, hasPersisted: false };
  }

  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
  const rows = (await db
    .select()
    .from(npSettings)
    .where(
      and(
        eq(npSettings.siteId, siteId),
        eq(npSettings.key, settingsKey(theme.manifest.id)),
      ),
    )
    .limit(1)) as Array<{ value: unknown }>;

  const fields = introspectThemeSettingsSchema(schema);
  const defaults = defaultsFrom(fields);

  const row = rows[0];
  if (!row) {
    // No row stored yet — first access returns schema defaults.
    // We don't write a row eagerly; the operator's first save
    // creates one.
    const parsed = schema.safeParse(defaults);
    return {
      themeId: theme.manifest.id,
      value: parsed.success ? parsed.data : defaults,
      hasPersisted: false,
    };
  }

  // v0.3 (D) — version detection + migration.
  //
  // Storage shape options:
  //   - `{ __npVersion: N, __npSettings: ... }` (v0.3+ wrapped)
  //   - bare value (legacy v0.2 unwrapped — treated as v1)
  //
  // When stored version < manifest.settingsVersion, run the
  // migrator. Re-parse the result; on parse failure (buggy
  // migrate, or schema drift the migrator doesn't cover), fall
  // back to defaults with parseError so the admin surfaces it.
  const versioned = isVersionedSettings(row.value) ? row.value : null;
  const storedVersion = versioned ? versioned.__npVersion : 1;
  const rawValue = versioned ? versioned.__npSettings : row.value;
  const valueToParse = applyMigration(theme.manifest, rawValue, storedVersion);

  const parsed = schema.safeParse(valueToParse);
  if (parsed.success) {
    return {
      themeId: theme.manifest.id,
      value: parsed.data,
      hasPersisted: true,
    };
  }

  // Schema mismatch (theme upgrade changed the shape and either
  // declared no migrator, or the migrator didn't cover this path).
  // Fall back to defaults and surface the error; the admin
  // renders a "settings were reset" banner.
  return {
    themeId: theme.manifest.id,
    value: defaults,
    hasPersisted: true,
    parseError: parsed.error.message,
  };
}

/**
 * Validate and persist a theme's settings. Throws
 * `NpValidationError` when `value` doesn't pass the schema —
 * the admin form must surface field-level errors before
 * calling this.
 *
 * **Cache invalidation is the caller's responsibility.** This
 * function writes to `np_settings` only; it doesn't import
 * `next/cache`. The admin API route (`PUT
 * /api/admin/themes/[id]/settings`) busts `nx:theme:<siteId>`
 * (and `nx:sitemap:*` / `nx:feed:*` when `impl.seo` is
 * declared) after a successful write. Other callers — jobs,
 * scripts, server actions — must do the same to avoid stale
 * cached reads.
 */
export async function setThemeSettings(
  themeId: string,
  value: unknown,
  updatedBy: string | null = null,
): Promise<unknown> {
  const theme = getThemeById(themeId);
  if (!theme) {
    throw new NpValidationError("Invalid input", [
      {
        field: "themeId",
        message: `Unknown theme '${themeId}'. Register it in nexpress.config.ts first.`,
      },
    ]);
  }
  const schema = theme.manifest.settingsSchema as ZodTypeAny | undefined;
  if (!schema) {
    throw new NpValidationError("Invalid input", [
      {
        field: "themeId",
        message: `Theme '${themeId}' does not declare a settingsSchema.`,
      },
    ]);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NpValidationError(
      "Settings failed validation",
      parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    );
  }

  // v0.3 (D) — wrap in the versioned envelope so future schema
  // changes can detect what version produced this row. Themes
  // that haven't declared `settingsVersion` get `1` (the v0.2
  // baseline) for forward-compat with the migration pipeline.
  const wrapped: NpVersionedSettings = {
    __npVersion: theme.manifest.settingsVersion ?? 1,
    __npSettings: parsed.data,
  };

  const db = getDb();
  const now = new Date();
  const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
  await db
    .insert(npSettings)
    .values({
      siteId,
      key: settingsKey(themeId),
      value: wrapped,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value: wrapped, updatedAt: now, updatedBy },
    });

  return parsed.data;
}

/**
 * Whether the active theme contributes SEO hooks. The settings
 * save path consults this to decide whether to additionally
 * invalidate `nx:sitemap:*` / `nx:feed:*` tags alongside the
 * always-busted `nx:theme:<siteId>`. Implemented here (in core)
 * so the API layer in `apps/web` doesn't need to duck-type the
 * theme `impl`.
 */
export async function activeThemeContributesSeo(): Promise<boolean> {
  const theme = await getActiveTheme();
  if (!theme) return false;
  // `impl` is opaque to core; we do a structural check.
  const impl = theme.impl as
    | { seo?: { sitemapEntries?: unknown; feedEntries?: unknown } }
    | undefined;
  if (!impl?.seo) return false;
  return Boolean(impl.seo.sitemapEntries || impl.seo.feedEntries);
}
