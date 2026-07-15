import { and, eq } from "drizzle-orm";

import {
  NpCommunityContractError,
  npRequireCommunitySettings as npRequireSharedCommunitySettings,
  npRequireCommunitySettingsPatch,
} from "../community-contract/contract.js";
import type { NpCommunitySettings, NpMemberUploadQuota } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { npAssertSettingValue, npValidateSettingValue } from "../settings/contract.js";

/**
 * Site-wide community settings, persisted in the generic `np_settings`
 * table under the `community` key. Sites that never visit the admin UI
 * inherit `DEFAULT_COMMUNITY_SETTINGS`. Once a row exists it must contain
 * the exact current shape; malformed or partial persisted values fail closed.
 *
 * Reads and writes both validate the same exact shape. Malformed persisted
 * values fail closed instead of silently falling back to defaults.
 */
/**
 * Per-member upload quota / rate limit. `null` on either field
 * means unlimited (the default — no quota). Both bounds count
 * non-deleted rows on `np_media` keyed by `uploaded_by_member_id`,
 * so admin purges (Phase 9.7l) free up quota the same way a
 * member self-deleting their content would. Staff uploads are
 * never gated.
 */
export type { NpCommunitySettings, NpMemberUploadQuota };

export const DEFAULT_COMMUNITY_SETTINGS: NpCommunitySettings = {
  reactionKinds: ["like"],
  registrationEnabled: true,
  memberUploadQuota: { perDay: null, total: null },
};

const SETTINGS_KEY = "community";
export function npRequireCommunitySettings(stored: unknown): NpCommunitySettings {
  const validation = npValidateSettingValue(SETTINGS_KEY, stored);
  if (!validation.ok) {
    throw new NpValidationError("Invalid persisted community settings", [
      { field: validation.issue.path, message: validation.issue.message },
    ]);
  }
  try {
    return npRequireSharedCommunitySettings(stored);
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      throw new NpValidationError(
        "Invalid persisted community settings",
        error.contractIssues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }
    throw error;
  }
}

export async function getCommunitySettings(): Promise<NpCommunitySettings> {
  const db = getDb();
  const { getCurrentSiteId } = await import("../sites/context.js");
  const { NP_DEFAULT_SITE_ID } = await import("../sites/registry.js");
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [row] = (await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, SETTINGS_KEY)))
    .limit(1)) as Array<{ value: unknown }>;
  return row ? npRequireCommunitySettings(row.value) : structuredClone(DEFAULT_COMMUNITY_SETTINGS);
}

/**
 * Validates an incoming partial patch from the admin UI. Returns the
 * fully-merged settings object that should be persisted. Throws
 * `NpValidationError` with field-level errors on any malformed input.
 */
export function validateCommunitySettingsPatch(
  current: NpCommunitySettings,
  patch: unknown,
): NpCommunitySettings {
  try {
    const checkedCurrent = npRequireSharedCommunitySettings(current);
    const checkedPatch = npRequireCommunitySettingsPatch(patch);
    return npRequireSharedCommunitySettings({
      ...checkedCurrent,
      ...checkedPatch,
      memberUploadQuota: {
        ...checkedCurrent.memberUploadQuota,
        ...checkedPatch.memberUploadQuota,
      },
    });
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      throw new NpValidationError(
        "Invalid input",
        error.contractIssues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }
    throw error;
  }
}

export async function updateCommunitySettings(
  patch: unknown,
  updatedBy: string | null,
): Promise<NpCommunitySettings> {
  const current = await getCommunitySettings();
  const next = validateCommunitySettingsPatch(current, patch);
  npAssertSettingValue(SETTINGS_KEY, next);
  const db = getDb();
  // #272 — write: must NOT silently fall through. A staff member
  // on tenant A who saves community settings without a resolved
  // site context would otherwise overwrite the default tenant's
  // policy — silently and across tenants.
  const { requireSiteId } = await import("../sites/context.js");
  const siteId = await requireSiteId();
  await db
    .insert(npSettings)
    .values({
      siteId,
      key: SETTINGS_KEY,
      value: next,
      updatedBy: updatedBy ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: {
        value: next,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      },
    });
  return next;
}
