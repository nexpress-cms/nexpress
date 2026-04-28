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

export interface NxNotificationPrefs {
  /** Kinds the member opted out of. Empty / missing = all kinds enabled. */
  disabled: string[];
}

const EMPTY_PREFS: NxNotificationPrefs = { disabled: [] };

function normalizePrefs(raw: unknown): NxNotificationPrefs {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PREFS };
  const obj = raw as Record<string, unknown>;
  const disabled = Array.isArray(obj.disabled)
    ? obj.disabled.filter((k): k is string => typeof k === "string")
    : [];
  return { disabled };
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
   */
  disabled: string[];
}

export async function setMemberNotificationPrefs(
  input: SetMemberNotificationPrefsInput,
): Promise<NxNotificationPrefs> {
  const known = new Set(listNotificationKinds().map((k) => k.kind));
  const cleaned: string[] = [];
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
    cleaned.push(raw);
  }
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;

  // Read-then-merge so we don't clobber other JSONB keys (digest
  // cadence in 16.4, future channel toggles, etc.).
  const [existing] = (await db
    .select({ prefs: nxMembers.notificationPrefs })
    .from(nxMembers)
    .where(eq(nxMembers.id, input.memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) throw new NxNotFoundError("member", input.memberId);

  const merged = {
    ...(existing.prefs ?? {}),
    disabled: cleaned,
  };

  await db
    .update(nxMembers)
    .set({ notificationPrefs: merged, updatedAt: new Date() })
    .where(eq(nxMembers.id, input.memberId));

  return normalizePrefs(merged);
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
