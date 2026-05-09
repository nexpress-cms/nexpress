import { and, eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";

import { getDb } from "../db/index.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { getPluginRegistration } from "./host.js";
import {
  introspectThemeSettingsSchema,
  type NpThemeSettingsField,
} from "../themes/settings-schema.js";

const DEFAULT_SITE = "default";
const CONFIG_KEY_PREFIX = "plugin.config:";

/**
 * G.1 — per-plugin operator config.
 *
 * Stored at `np_settings.(site_id, key="plugin.config:<pluginId>")`.
 * Mirrors theme settings storage exactly, including the `__npVersion` /
 * `__npSettings` envelope, so a future shared `getCachedSetting<T>(key)`
 * helper can read both surfaces. Cache invalidation rides a new
 * `np:plugin:<id>` tag (see `packages/next/src/cache.ts`).
 *
 * Per locked decision E (`docs/design/plugin-config-auto-form.md` § 2):
 * we store under `np_settings`, NOT `np_plugins.config` (the legacy
 * column was dropped in the same migration that introduced this module).
 */

function configKey(pluginId: string): string {
  return `${CONFIG_KEY_PREFIX}${pluginId}`;
}

/**
 * Versioned envelope shape for persisted plugin config — identical to the
 * theme `NpVersionedSettings` shape. Two parallel definitions instead of a
 * shared one because (a) themes and plugins share zero schema surface
 * otherwise, (b) the type is only ~5 lines, and (c) collapsing them would
 * couple `themes/` and `plugins/` modules without functional benefit.
 */
export interface NpVersionedPluginConfig {
  __npVersion: number;
  __npSettings: unknown;
}

export function isVersionedPluginConfig(
  value: unknown,
): value is NpVersionedPluginConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NpVersionedPluginConfig>;
  return (
    typeof candidate.__npVersion === "number" &&
    Number.isFinite(candidate.__npVersion) &&
    "__npSettings" in candidate
  );
}

/**
 * Run the plugin's `configMigrate` from `from` to current schema version.
 * No-op when versions match or the plugin doesn't declare a migrator.
 * Defensive try/catch — a buggy migrate fn shouldn't blow up the read
 * path; we fall back to the original value and let `safeParse` decide.
 *
 * Mirrors `applyMigration` in `packages/core/src/themes/settings.ts` line
 * for line.
 */
export function applyPluginConfigMigration(
  registration: {
    configVersion?: number;
    configMigrate?: (old: unknown, fromVersion: number) => unknown;
  },
  rawValue: unknown,
  fromVersion: number,
): unknown {
  const target = registration.configVersion ?? 1;
  if (fromVersion >= target) return rawValue;
  const migrate = registration.configMigrate;
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

export interface NpPluginConfigResult {
  pluginId: string;
  /** Parsed config or schema defaults. Empty object when the plugin has
   *  no configSchema. */
  value: unknown;
  /** True when there's a stored row, regardless of whether it passed
   *  validation. */
  hasPersisted: boolean;
  /** Set when the persisted value failed `schema.parse()`. The admin
   *  surface uses this to render a "settings were reset" banner. */
  parseError?: string;
}

/**
 * Read the persisted config for a plugin and parse it via the plugin's
 * `configSchema`. Returns the parsed value when valid; falls back to
 * schema defaults on parse failure (with the failure recorded for the
 * admin to surface, see `getPluginConfigWithStatus`).
 *
 * Return type is `unknown` because core can't type-narrow to the plugin's
 * `z.infer<typeof configSchema>` — the schema lives in the plugin
 * package, not in core. Plugin code that reads its own config should
 * cast at the call site, ideally against an exported type alias from the
 * plugin package itself:
 *
 *   // packages/plugins/oauth-github/src/index.ts
 *   export const configSchema = z.object({ ... });
 *   export type GithubOauthConfig = z.infer<typeof configSchema>;
 *
 *   // a plugin handler
 *   const config = (await getPluginConfig("oauth-github")) as GithubOauthConfig;
 */
export async function getPluginConfig(pluginId: string): Promise<unknown> {
  const result = await getPluginConfigWithStatus(pluginId);
  return result.value;
}

export async function getPluginConfigWithStatus(
  pluginId: string,
): Promise<NpPluginConfigResult> {
  const registration = getPluginRegistration(pluginId);
  if (!registration) {
    // Plugin not registered — return empty config so callers (plugin
    // hosts iterating contexts, route handlers reading their own config)
    // get a stable shape without having to special-case "plugin not
    // found". The admin surface checks registration separately.
    return { pluginId, value: {}, hasPersisted: false };
  }
  const schema = registration.configSchema as ZodTypeAny | undefined;

  let row: { value: unknown } | undefined;
  try {
    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
    const rows = (await db
      .select()
      .from(npSettings)
      .where(
        and(eq(npSettings.siteId, siteId), eq(npSettings.key, configKey(pluginId))),
      )
      .limit(1)) as Array<{ value: unknown }>;
    row = rows[0];
  } catch {
    // DB not ready — caller is asking before bootstrap. Return empty
    // shape; treats DB-not-ready the same as "no row stored yet".
    return { pluginId, value: schema ? defaultsFromSchema(schema) : {}, hasPersisted: false };
  }

  if (!schema) {
    // Plugin doesn't declare a configSchema. If a row exists (legacy
    // hand-coded UI saved into np_settings, or migrated from
    // np_plugins.config), surface it raw — callers can still read it.
    if (!row) {
      return { pluginId, value: {}, hasPersisted: false };
    }
    const versioned = isVersionedPluginConfig(row.value) ? row.value : null;
    const rawValue = versioned ? versioned.__npSettings : row.value;
    return {
      pluginId,
      value: rawValue ?? {},
      hasPersisted: true,
    };
  }

  const fields = introspectThemeSettingsSchema(schema);
  const defaults = defaultsFrom(fields);

  if (!row) {
    const parsed = schema.safeParse(defaults);
    return {
      pluginId,
      value: parsed.success ? parsed.data : defaults,
      hasPersisted: false,
    };
  }

  // Versioned envelope detection + lazy migration. Mirrors
  // `getThemeSettingsWithStatus` exactly.
  const versioned = isVersionedPluginConfig(row.value) ? row.value : null;
  const storedVersion = versioned ? versioned.__npVersion : 1;
  const rawValue = versioned ? versioned.__npSettings : row.value;
  const valueToParse = applyPluginConfigMigration(registration, rawValue, storedVersion);

  const parsed = schema.safeParse(valueToParse);
  if (parsed.success) {
    return { pluginId, value: parsed.data, hasPersisted: true };
  }

  return {
    pluginId,
    value: defaults,
    hasPersisted: true,
    parseError: parsed.error.message,
  };
}

function defaultsFromSchema(schema: ZodTypeAny): Record<string, unknown> {
  return defaultsFrom(introspectThemeSettingsSchema(schema));
}

/**
 * Validate and persist a plugin's config. Throws `NpValidationError` when
 * `value` doesn't pass the schema — the admin form must surface
 * field-level errors before calling this.
 *
 * **Cache invalidation is the caller's responsibility.** This function
 * writes to `np_settings` only; it doesn't import `next/cache`. The
 * admin API route (`PUT /api/admin/plugins/[id]/config`) busts
 * `np:plugin:<id>` after a successful write.
 *
 * Mirrors `setThemeSettings` in `packages/core/src/themes/settings.ts`.
 */
export async function setPluginConfig(
  pluginId: string,
  value: unknown,
  updatedBy: string | null = null,
): Promise<unknown> {
  const registration = getPluginRegistration(pluginId);
  if (!registration) {
    throw new NpValidationError("Invalid input", [
      {
        field: "pluginId",
        message: `Unknown plugin '${pluginId}'. Register it in nexpress.config.ts first.`,
      },
    ]);
  }
  const schema = registration.configSchema as ZodTypeAny | undefined;
  if (!schema) {
    throw new NpValidationError("Invalid input", [
      {
        field: "pluginId",
        message: `Plugin '${pluginId}' does not declare a configSchema.`,
      },
    ]);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NpValidationError(
      "Config failed validation",
      parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    );
  }

  const wrapped: NpVersionedPluginConfig = {
    __npVersion: registration.configVersion ?? 1,
    __npSettings: parsed.data,
  };

  const db = getDb();
  const now = new Date();
  const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
  await db
    .insert(npSettings)
    .values({
      siteId,
      key: configKey(pluginId),
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

/** Cache tag for a plugin's config invalidation. Per the prefix policy
 *  in CLAUDE.md (Naming convention table) every framework-owned tag
 *  uses the `np` prefix. Distinct from the legacy `nx:theme:<siteId>`
 *  tag — see `docs/design/plugin-config-auto-form.md` § 7. */
export function pluginConfigCacheTag(pluginId: string): string {
  return `np:plugin:${pluginId}`;
}
