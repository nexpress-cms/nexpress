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
  const db = (options?.tx ?? getDb()) as ReturnType<typeof getDb>;
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
  const storedOverlay = validatedOverlay(rows[0]?.value, "settings.theme");

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
  if (!can(user, "admin.manage")) throw new NpForbiddenError("settings/theme", "update");
  const issues = npAnalyzeThemeTokens(value);
  if (issues.length > 0) {
    throw new NpValidationError(
      "Invalid input",
      issues.map((issue) => ({ field: issue.path, message: issue.message })),
    );
  }
  npAssertSettingValue("theme", value);
  const db = (options?.tx ?? getDb()) as ReturnType<typeof getDb>;
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const now = new Date();
  await db
    .insert(npSettings)
    .values({ siteId, key: "theme", value, updatedAt: now, updatedBy: user.id })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value, updatedAt: now, updatedBy: user.id },
    });
  return value as NpThemeTokens;
}
