import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { npValidateSettingValue } from "../settings/contract.js";

/**
 * Site-wide community settings, persisted in the generic `np_settings`
 * table under the `community` key. Sites that never visit the admin UI
 * inherit `DEFAULT_COMMUNITY_SETTINGS` — every read goes through
 * `getCommunitySettings()` which merges the stored value over the
 * defaults so adding a new field doesn't break existing installs.
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
export interface NpMemberUploadQuota {
  /** Max uploads in the trailing 24h window. `null` = unlimited. */
  perDay: number | null;
  /** Lifetime cap on non-deleted member uploads. `null` = unlimited. */
  total: number | null;
}

export interface NpCommunitySettings {
  /**
   * Allow-list of reaction `kind` strings. Members can only add
   * reactions whose kind is in this list; values that pass the
   * `KIND_RE` regex but aren't in the list are rejected with a 400.
   * Removal of an already-existing reaction is NOT gated — if a kind
   * is removed from the list, members can still un-react it.
   */
  reactionKinds: string[];
  /**
   * When false, `/api/members/register` refuses new sign-ups with a
   * 403. Existing members can still sign in. Sites that want
   * invite-only flows turn this off and provision via admin tooling.
   */
  registrationEnabled: boolean;
  /** Per-member upload limits. See `NpMemberUploadQuota`. */
  memberUploadQuota: NpMemberUploadQuota;
}

export const DEFAULT_COMMUNITY_SETTINGS: NpCommunitySettings = {
  reactionKinds: ["like"],
  registrationEnabled: true,
  memberUploadQuota: { perDay: null, total: null },
};

const SETTINGS_KEY = "community";
const KIND_RE = /^[a-z][a-z0-9_-]{0,29}$/;
const MAX_REACTION_KINDS = 32;
const MAX_QUOTA_VALUE = 1_000_000;

export function npRequireCommunitySettings(stored: unknown): NpCommunitySettings {
  const validation = npValidateSettingValue(SETTINGS_KEY, stored);
  if (!validation.ok) {
    throw new NpValidationError("Invalid persisted community settings", [
      { field: validation.issue.path, message: validation.issue.message },
    ]);
  }
  return validateCommunitySettingsPatch(DEFAULT_COMMUNITY_SETTINGS, stored);
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
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new NpValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const raw = patch as Record<string, unknown>;
  const errors: Array<{ field: string; message: string }> = [];
  let next: NpCommunitySettings = { ...current };

  for (const key of Object.keys(raw)) {
    if (key !== "reactionKinds" && key !== "registrationEnabled" && key !== "memberUploadQuota") {
      errors.push({ field: key, message: `Unsupported community settings field '${key}'` });
    }
  }

  if ("reactionKinds" in raw) {
    if (!Array.isArray(raw.reactionKinds)) {
      errors.push({ field: "reactionKinds", message: "Must be an array of strings" });
    } else if (raw.reactionKinds.length === 0) {
      // Empty list disables reactions entirely. Allowed deliberately —
      // sites that don't want reactions opt out by clearing the list.
      next = { ...next, reactionKinds: [] };
    } else if (raw.reactionKinds.length > MAX_REACTION_KINDS) {
      errors.push({
        field: "reactionKinds",
        message: `At most ${MAX_REACTION_KINDS} kinds`,
      });
    } else {
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (let i = 0; i < raw.reactionKinds.length; i++) {
        const k = raw.reactionKinds[i];
        if (typeof k !== "string" || !KIND_RE.test(k)) {
          errors.push({
            field: `reactionKinds[${i}]`,
            message: "Each kind must match [a-z][a-z0-9_-]{0,29}",
          });
          continue;
        }
        if (seen.has(k)) {
          errors.push({ field: `reactionKinds[${i}]`, message: `Duplicate kind '${k}'` });
          continue;
        }
        seen.add(k);
        cleaned.push(k);
      }
      if (errors.length === 0) next = { ...next, reactionKinds: cleaned };
    }
  }

  if ("registrationEnabled" in raw) {
    if (typeof raw.registrationEnabled !== "boolean") {
      errors.push({ field: "registrationEnabled", message: "Must be a boolean" });
    } else {
      next = { ...next, registrationEnabled: raw.registrationEnabled };
    }
  }

  if ("memberUploadQuota" in raw) {
    const q = raw.memberUploadQuota;
    if (!q || typeof q !== "object" || Array.isArray(q)) {
      errors.push({
        field: "memberUploadQuota",
        message: "Must be an object with optional `perDay` / `total` keys",
      });
    } else {
      const obj = q as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (key !== "perDay" && key !== "total") {
          errors.push({
            field: `memberUploadQuota.${key}`,
            message: `Unsupported upload quota field '${key}'`,
          });
        }
      }
      const validateBound = (key: "perDay" | "total"): number | null | undefined => {
        if (!(key in obj)) return undefined; // not patched — keep current
        const v = obj[key];
        if (v === null) return null;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
          errors.push({
            field: `memberUploadQuota.${key}`,
            message: "Must be a non-negative integer or null",
          });
          return undefined;
        }
        if (v > MAX_QUOTA_VALUE) {
          errors.push({
            field: `memberUploadQuota.${key}`,
            message: `At most ${MAX_QUOTA_VALUE}`,
          });
          return undefined;
        }
        return v;
      };
      const perDay = validateBound("perDay");
      const total = validateBound("total");
      if (perDay !== undefined || total !== undefined) {
        next = {
          ...next,
          memberUploadQuota: {
            perDay: perDay !== undefined ? perDay : next.memberUploadQuota.perDay,
            total: total !== undefined ? total : next.memberUploadQuota.total,
          },
        };
      }
    }
  }

  if (errors.length > 0) throw new NpValidationError("Invalid input", errors);
  return next;
}

export async function updateCommunitySettings(
  patch: unknown,
  updatedBy: string | null,
): Promise<NpCommunitySettings> {
  const current = await getCommunitySettings();
  const next = validateCommunitySettingsPatch(current, patch);
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
