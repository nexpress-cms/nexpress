import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxSettings } from "../db/schema/system.js";
import { NxValidationError } from "../errors.js";

/**
 * Site-wide community settings, persisted in the generic `nx_settings`
 * table under the `community` key. Sites that never visit the admin UI
 * inherit `DEFAULT_COMMUNITY_SETTINGS` — every read goes through
 * `getCommunitySettings()` which merges the stored value over the
 * defaults so adding a new field doesn't break existing installs.
 *
 * Validation runs on the write path only — readers trust whatever is
 * in the table because the only writer is the admin API which
 * pre-validates. Tests poke values directly into `nx_settings` for
 * fault-injection cases.
 */
export interface NxCommunitySettings {
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
}

export const DEFAULT_COMMUNITY_SETTINGS: NxCommunitySettings = {
  reactionKinds: ["like"],
  registrationEnabled: true,
};

const SETTINGS_KEY = "community";
const KIND_RE = /^[a-z][a-z0-9_-]{0,29}$/;
const MAX_REACTION_KINDS = 32;

function mergeWithDefaults(stored: unknown): NxCommunitySettings {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...DEFAULT_COMMUNITY_SETTINGS };
  }
  const raw = stored as Record<string, unknown>;
  const reactionKinds =
    Array.isArray(raw.reactionKinds) && raw.reactionKinds.every((k) => typeof k === "string")
      ? (raw.reactionKinds as string[])
      : DEFAULT_COMMUNITY_SETTINGS.reactionKinds;
  const registrationEnabled =
    typeof raw.registrationEnabled === "boolean"
      ? raw.registrationEnabled
      : DEFAULT_COMMUNITY_SETTINGS.registrationEnabled;
  return { reactionKinds, registrationEnabled };
}

export async function getCommunitySettings(): Promise<NxCommunitySettings> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select()
    .from(nxSettings)
    .where(eq(nxSettings.key, SETTINGS_KEY))
    .limit(1)) as Array<{ value: unknown }>;
  return mergeWithDefaults(row?.value);
}

/**
 * Validates an incoming partial patch from the admin UI. Returns the
 * fully-merged settings object that should be persisted. Throws
 * `NxValidationError` with field-level errors on any malformed input.
 */
export function validateCommunitySettingsPatch(
  current: NxCommunitySettings,
  patch: unknown,
): NxCommunitySettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new NxValidationError("Invalid input", [
      { field: "body", message: "Body must be a JSON object" },
    ]);
  }
  const raw = patch as Record<string, unknown>;
  const errors: Array<{ field: string; message: string }> = [];
  let next: NxCommunitySettings = { ...current };

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

  if (errors.length > 0) throw new NxValidationError("Invalid input", errors);
  return next;
}

export async function updateCommunitySettings(
  patch: unknown,
  updatedBy: string | null,
): Promise<NxCommunitySettings> {
  const current = await getCommunitySettings();
  const next = validateCommunitySettingsPatch(current, patch);
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  await db
    .insert(nxSettings)
    .values({
      key: SETTINGS_KEY,
      value: next,
      updatedBy: updatedBy ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: nxSettings.key,
      set: {
        value: next,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      },
    });
  return next;
}
