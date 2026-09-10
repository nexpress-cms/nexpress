import {
  npAssertAgentPreviewEffectsAllowed,
  npAgentPreviewReadTransaction,
  npAgentPreviewSettingOverride,
} from "../agent/changeset-preview-overlay.js";
import type { NpTransaction } from "../collections/pipeline.js";
import type { NpAuthUser } from "../config/types.js";
import { can } from "../auth/capabilities.js";
import { NpForbiddenError } from "../errors.js";
import { npAssertSettingValue } from "../settings/contract.js";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { getActiveTheme } from "../themes/registry.js";
import {
  npAnalyzeThemeTokens,
  npAnalyzeThemeTokensOverlay,
  npMergeThemeTokens,
} from "./contract.js";
import { DEFAULT_THEME } from "./defaults.js";
import type { NpThemeTokens, NpThemeTokensOverlay } from "./types.js";

function validatedOverlay(value: unknown, field: string): NpThemeTokensOverlay | undefined {
  if (value === undefined) return undefined;
  const issues = npAnalyzeThemeTokensOverlay(value);
  if (issues.length > 0) {
    throw new NpValidationError(
      "Invalid theme tokens",
      issues.map((entry) => ({
        field: entry.path.replace(/^theme/u, field),
        message: entry.message,
      })),
    );
  }
  return value as NpThemeTokensOverlay;
}

/** Resolve the effective, fully populated token tree for the current site. */
export async function getTheme(options?: { tx?: NpTransaction }): Promise<NpThemeTokens> {
  const db = ((await npAgentPreviewReadTransaction(options?.tx)) ?? getDb()) as ReturnType<
    typeof getDb
  >;
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const rows = await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme")))
    .limit(1);

  const active = await getActiveTheme(options);
  const themeOverlay = validatedOverlay(
    (active?.impl as { tokens?: unknown } | null | undefined)?.tokens,
    "activeTheme.impl.tokens",
  );
  const preview = npAgentPreviewSettingOverride("theme");
  const storedOverlay = validatedOverlay(
    preview ? preview.value : rows[0]?.value,
    "settings.theme",
  );

  return npMergeThemeTokens(DEFAULT_THEME, themeOverlay, storedOverlay);
}

/** Validate a persisted overlay at a named read/write boundary. */
export function npRequireThemeTokensOverlay(value: unknown, field = "theme"): NpThemeTokensOverlay {
  return validatedOverlay(value, field) ?? {};
}

/** Persist the existing complete theme-token request. Cache invalidation belongs after outer commit. */
export async function setTheme(
  value: unknown,
  user: NpAuthUser,
  options?: { tx?: NpTransaction },
): Promise<NpThemeTokens> {
  npAssertAgentPreviewEffectsAllowed();
  if (!can(user, "admin.manage")) throw new NpForbiddenError("settings/theme", "update");
  const issues = npAnalyzeThemeTokens(value);
  if (issues.length > 0) {
    throw new NpValidationError(
      "Invalid input",
      issues.map((issue) => ({ field: issue.path, message: issue.message })),
    );
  }
  npAssertSettingValue("theme", value);
  await persistTheme(value, user, options);
  return value as NpThemeTokens;
}

/** Internal canonical overlay replacement, sharing the normal token writer and ACL. */
export async function npSetThemeTokensOverlay(
  value: unknown,
  user: NpAuthUser,
  options: { tx: NpTransaction },
): Promise<NpThemeTokensOverlay> {
  npAssertAgentPreviewEffectsAllowed();
  if (!can(user, "admin.manage")) throw new NpForbiddenError("settings/theme", "update");
  const overlay = npRequireThemeTokensOverlay(value);
  npAssertSettingValue("theme", overlay);
  await persistTheme(overlay, user, options);
  return overlay;
}

async function persistTheme(
  value: unknown,
  user: NpAuthUser,
  options?: { tx?: NpTransaction },
): Promise<void> {
  const db = ((await npAgentPreviewReadTransaction(options?.tx)) ?? getDb()) as ReturnType<
    typeof getDb
  >;
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const now = new Date();
  await db
    .insert(npSettings)
    .values({ siteId, key: "theme", value, updatedAt: now, updatedBy: user.id })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value, updatedAt: now, updatedBy: user.id },
    });
}

/** Internal restoration of explicit override absence, under the normal theme write admission. */
export async function npRemoveThemeTokensOverlay(
  user: NpAuthUser,
  options: { tx: NpTransaction },
): Promise<void> {
  npAssertAgentPreviewEffectsAllowed();
  if (!can(user, "admin.manage")) throw new NpForbiddenError("settings/theme", "update");
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  await options.tx
    .delete(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme"))!);
}
