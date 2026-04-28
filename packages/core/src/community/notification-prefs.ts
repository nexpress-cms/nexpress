import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../collections/pipeline.js";
import { nxMembers } from "../db/schema/community.js";
import { NxNotFoundError, NxValidationError } from "../errors.js";

/**
 * Phase 16.3 — per-member notification preferences.
 *
 * The persisted shape is a JSONB blob on `nx_members.notification_prefs`
 * so adding fields (digest cadence in 16.4, channel toggles later)
 * stays a typescript-only change. Today we honor:
 *
 *   - `disabled: string[]` — kinds the member opted out of. The
 *     `createNotification` gate consults this and silently drops
 *     the row. Default empty (= every kind enabled).
 *
 * The vocabulary of `kinds` is defined here so the UI has a single
 * source of truth — settings page renders a toggle for each entry,
 * and the API only accepts kinds that appear in the list (so a
 * forged client can't disable arbitrary strings to bloat the JSONB).
 */

export interface NxNotificationKindMeta {
  kind: string;
  /** Short human label. */
  label: string;
  /** Description rendered next to the toggle. */
  description: string;
}

/**
 * Closed vocabulary of toggle-able kinds. New notification kinds
 * land here when they ship; plugins that want their own
 * preferences register entries via `registerNotificationKind`.
 */
const builtinKinds: NxNotificationKindMeta[] = [
  {
    kind: "comment.reply",
    label: "Replies",
    description: "Someone replied to one of your comments.",
  },
  {
    kind: "comment.mention",
    label: "Mentions in comments",
    description: "Someone @-mentioned you in a comment.",
  },
  {
    kind: "document.mention",
    label: "Mentions in discussions",
    description: "Someone @-mentioned you in a discussion / thread.",
  },
  {
    kind: "reaction.received",
    label: "Reactions",
    description: "Someone reacted to your comment or document.",
  },
  {
    kind: "follow.received",
    label: "New followers",
    description: "Someone started following you.",
  },
];

const dynamicKinds: NxNotificationKindMeta[] = [];

/** Plugin-extensible registration. Idempotent on `kind`. */
export function registerNotificationKind(meta: NxNotificationKindMeta): void {
  if (builtinKinds.some((k) => k.kind === meta.kind)) return;
  const idx = dynamicKinds.findIndex((k) => k.kind === meta.kind);
  if (idx >= 0) {
    dynamicKinds[idx] = meta;
  } else {
    dynamicKinds.push(meta);
  }
}

/** Returns the union of builtin + plugin-registered kinds. */
export function listNotificationKinds(): NxNotificationKindMeta[] {
  return [...builtinKinds, ...dynamicKinds];
}

export type NxDigestCadence = "off" | "daily" | "weekly";

const DIGEST_CADENCES: readonly NxDigestCadence[] = ["off", "daily", "weekly"] as const;

export interface NxNotificationPrefs {
  /** Kinds the member opted out of. Empty / missing = all kinds enabled. */
  disabled: string[];
  /**
   * Phase 16.4 — email digest cadence. `off` (default) disables
   * the digest. `daily` and `weekly` opt the member into a
   * batched email of unread notifications, scheduled by the
   * `notifications:sendDigest` recurring job.
   */
  digest: NxDigestCadence;
  /**
   * Set when the digest sweep last sent an email to this member.
   * Used to scope each digest to "unread since the last send" so
   * members aren't repeatedly emailed about the same row. Stored
   * as ISO-8601 string in the JSONB blob; `null` for accounts
   * that have never received a digest.
   */
  lastDigestAt: string | null;
}

const EMPTY_PREFS: NxNotificationPrefs = {
  disabled: [],
  digest: "off",
  lastDigestAt: null,
};

function normalizeDigest(raw: unknown): NxDigestCadence {
  return DIGEST_CADENCES.includes(raw as NxDigestCadence) ? (raw as NxDigestCadence) : "off";
}

function normalizeLastDigestAt(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function normalizePrefs(raw: unknown): NxNotificationPrefs {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PREFS };
  const obj = raw as Record<string, unknown>;
  const disabled = Array.isArray(obj.disabled)
    ? obj.disabled.filter((k): k is string => typeof k === "string")
    : [];
  return {
    disabled,
    digest: normalizeDigest(obj.digest),
    lastDigestAt: normalizeLastDigestAt(obj.lastDigestAt),
  };
}

export async function getMemberNotificationPrefs(memberId: string): Promise<NxNotificationPrefs> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ prefs: nxMembers.notificationPrefs })
    .from(nxMembers)
    .where(eq(nxMembers.id, memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!row) throw new NxNotFoundError("member", memberId);
  return normalizePrefs(row.prefs);
}

export interface SetMemberNotificationPrefsInput {
  memberId: string;
  /**
   * Replacement deny-list. Only kinds listed in
   * `listNotificationKinds()` are accepted; unknown strings
   * raise NxValidationError so a forged client can't bloat the
   * JSONB or hide future framework kinds via a stale list.
   * Optional — when omitted the existing list is preserved.
   */
  disabled?: string[];
  /**
   * Phase 16.4 — email digest cadence. Optional; when omitted
   * the existing setting is preserved. `off` clears the
   * member's enrollment.
   */
  digest?: NxDigestCadence;
}

export async function setMemberNotificationPrefs(
  input: SetMemberNotificationPrefsInput,
): Promise<NxNotificationPrefs> {
  const known = new Set(listNotificationKinds().map((k) => k.kind));
  let cleanedDisabled: string[] | undefined;
  if (input.disabled !== undefined) {
    cleanedDisabled = [];
    const seen = new Set<string>();
    for (const raw of input.disabled) {
      if (typeof raw !== "string") {
        throw new NxValidationError("Invalid input", [
          { field: "disabled", message: "Each entry must be a string" },
        ]);
      }
      if (!known.has(raw)) {
        throw new NxValidationError("Invalid input", [
          { field: "disabled", message: `Unknown notification kind: ${raw}` },
        ]);
      }
      if (seen.has(raw)) continue;
      seen.add(raw);
      cleanedDisabled.push(raw);
    }
  }
  if (input.digest !== undefined && !DIGEST_CADENCES.includes(input.digest)) {
    throw new NxValidationError("Invalid input", [
      {
        field: "digest",
        message: `digest must be one of: ${DIGEST_CADENCES.join(", ")}`,
      },
    ]);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Read-then-merge so we don't clobber other JSONB keys
  // (lastDigestAt, future channel toggles, etc.).
  const [existing] = (await db
    .select({ prefs: nxMembers.notificationPrefs })
    .from(nxMembers)
    .where(eq(nxMembers.id, input.memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) throw new NxNotFoundError("member", input.memberId);

  const merged: Record<string, unknown> = { ...(existing.prefs ?? {}) };
  if (cleanedDisabled !== undefined) merged.disabled = cleanedDisabled;
  if (input.digest !== undefined) merged.digest = input.digest;

  await db
    .update(nxMembers)
    .set({ notificationPrefs: merged, updatedAt: new Date() })
    .where(eq(nxMembers.id, input.memberId));

  return normalizePrefs(merged);
}

/**
 * Phase 16.4 — bookkeeping helper called by the digest sweep
 * after a successful email send. Stamps `lastDigestAt` so the
 * next run scopes its query to the correct window. Read-merge
 * to preserve other JSONB keys.
 */
export async function recordDigestSent(memberId: string, sentAt: Date): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select({ prefs: nxMembers.notificationPrefs })
    .from(nxMembers)
    .where(eq(nxMembers.id, memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) return;
  const merged = {
    ...(existing.prefs ?? {}),
    lastDigestAt: sentAt.toISOString(),
  };
  await db
    .update(nxMembers)
    .set({ notificationPrefs: merged, updatedAt: new Date() })
    .where(eq(nxMembers.id, memberId));
}

/**
 * Inbox-side gate consulted by `createNotification`. Returns
 * `false` when the recipient explicitly opted out of `kind`.
 * Errors fail-open (return `true`) so a transient DB blip
 * doesn't silently swallow notifications.
 */
export async function isNotificationKindEnabled(memberId: string, kind: string): Promise<boolean> {
  try {
    const prefs = await getMemberNotificationPrefs(memberId);
    return !prefs.disabled.includes(kind);
  } catch {
    return true;
  }
}
