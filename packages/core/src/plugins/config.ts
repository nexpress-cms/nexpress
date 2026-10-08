import {
  npAssertAgentPreviewEffectsAllowed,
  npAgentPreviewReadTransaction,
} from "../agent/changeset-preview-overlay.js";
import { and, eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";

import { getDb, getOptionalDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { getPluginRegistration } from "./host.js";
import { introspectThemeSettingsSchema } from "../themes/settings-schema.js";
import { npAssertSettingValue } from "../settings/contract.js";
import { settingsDefaultsFromFields } from "../settings/defaults.js";

const DEFAULT_SITE = "default";
const CONFIG_KEY_PREFIX = "plugin.config:";

function configKey(pluginId: string): string {
  return `${CONFIG_KEY_PREFIX}${pluginId}`;
}

/** Persisted at `np_settings.(site_id, key="plugin.config:<pluginId>")`. */
export interface NpVersionedPluginConfig {
  __npVersion: number;
  __npSettings: unknown;
}

/**
 * Run the plugin's `configMigrate` from `from` to current schema version.
 * No-op when versions match or the plugin doesn't declare a migrator.
 * Migrator failures propagate so partially migrated config cannot be
 * accepted silently.
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
  npAssertAgentPreviewEffectsAllowed();
  return migrate(rawValue, fromVersion);
}

function requirePluginConfigObject(value: unknown, field: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new NpValidationError("Invalid plugin config", [
      { field, message: "Plugin config schemas must resolve to a plain object." },
    ]);
  }
  return value as Record<string, unknown>;
}

export interface NpPluginConfigResult {
  pluginId: string;
  /** Parsed config or schema defaults. Empty object when the plugin has
   *  no configSchema. */
  value: unknown;
  /** True when a valid stored row exists. */
  hasPersisted: boolean;
}

/**
 * Read the persisted config for a plugin and parse it via the plugin's
 * `configSchema`. Missing rows use schema defaults; malformed persisted
 * rows and migration/schema failures fail closed.
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

export async function getPluginConfigWithStatus(pluginId: string): Promise<NpPluginConfigResult> {
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

  const db = ((await npAgentPreviewReadTransaction()) ?? getOptionalDb()) as ReturnType<
    typeof getOptionalDb
  >;
  if (!db) {
    return {
      pluginId,
      value: schema ? settingsDefaultsFromFields(introspectThemeSettingsSchema(schema)) : {},
      hasPersisted: false,
    };
  }
  const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
  const rows = (await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, configKey(pluginId))))
    .limit(1)) as Array<{ value: unknown }>;
  const row = rows[0];

  if (!schema) {
    // Plugins without configSchema still use the exact versioned envelope;
    // their hand-authored Admin field contract owns the inner object.
    if (!row) {
      return { pluginId, value: {}, hasPersisted: false };
    }
    npAssertSettingValue(configKey(pluginId), row.value);
    const versioned = row.value as NpVersionedPluginConfig;
    const rawValue = versioned.__npSettings;
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      throw new NpValidationError("Invalid persisted plugin config", [
        {
          field: `settings.${configKey(pluginId)}.__npSettings`,
          message: "Plugin config must be a plain object when configSchema is not declared.",
        },
      ]);
    }
    return {
      pluginId,
      value: rawValue,
      hasPersisted: true,
    };
  }

  const fields = introspectThemeSettingsSchema(schema);
  const defaults = settingsDefaultsFromFields(fields);

  if (!row) {
    const parsed = schema.safeParse(defaults);
    return {
      pluginId,
      value: parsed.success ? parsed.data : defaults,
      hasPersisted: false,
    };
  }

  // Validate the stored envelope before migration and schema parsing.
  npAssertSettingValue(configKey(pluginId), row.value);
  const versioned = row.value as NpVersionedPluginConfig;
  const storedVersion = versioned.__npVersion;
  const rawValue = versioned.__npSettings;
  const valueToParse = applyPluginConfigMigration(registration, rawValue, storedVersion);

  const parsed = schema.safeParse(valueToParse);
  if (parsed.success) {
    return {
      pluginId,
      value: requirePluginConfigObject(parsed.data, `settings.${configKey(pluginId)}`),
      hasPersisted: true,
    };
  }

  throw new NpValidationError("Invalid persisted plugin config", [
    { field: `settings.${configKey(pluginId)}`, message: parsed.error.message },
  ]);
}

/**
 * Validate and persist a plugin's config when the plugin declares a
 * `configSchema`. Plugins without `configSchema` are legacy declarative
 * `admin.settings.fields` users; persist their value in the same envelope
 * without schema validation so old admin settings panels keep working.
 *
 * **Cache invalidation is the caller's responsibility.** This function
 * writes to `np_settings` only; it doesn't import `next/cache`. The
 * admin API route (`PUT /api/admin/plugins/[id]/config`) busts
 * `np:plugin:<id>` after a successful write.
 */
export async function setPluginConfig(
  pluginId: string,
  value: unknown,
  updatedBy: string | null = null,
): Promise<unknown> {
  npAssertAgentPreviewEffectsAllowed();
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
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new NpValidationError("Invalid input", [
        {
          field: "value",
          message: "Plugin config must be an object when configSchema is not declared.",
        },
      ]);
    }
    return persistPluginConfigEnvelope(pluginId, value, 1, updatedBy);
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

  const config = requirePluginConfigObject(parsed.data, "value");

  return persistPluginConfigEnvelope(pluginId, config, registration.configVersion ?? 1, updatedBy);
}

async function persistPluginConfigEnvelope(
  pluginId: string,
  value: unknown,
  version: number,
  updatedBy: string | null,
): Promise<unknown> {
  const wrapped: NpVersionedPluginConfig = {
    __npVersion: version,
    __npSettings: value,
  };
  npAssertSettingValue(configKey(pluginId), wrapped);
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
  return value;
}

/** Cache tag for a plugin's config invalidation. */
export function pluginConfigCacheTag(pluginId: string): string {
  return `np:plugin:${pluginId}`;
}
