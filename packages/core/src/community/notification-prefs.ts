import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { npMembers } from "../db/schema/community.js";
import { NpNotFoundError, NpValidationError } from "../errors.js";

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

export interface NpNotificationKindMeta {
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
const builtinKinds: NpNotificationKindMeta[] = [
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

const dynamicKinds: NpNotificationKindMeta[] = [];

/** Plugin-extensible registration. Idempotent on `kind`. */
export function registerNotificationKind(meta: NpNotificationKindMeta): void {
  if (builtinKinds.some((k) => k.kind === meta.kind)) return;
  const idx = dynamicKinds.findIndex((k) => k.kind === meta.kind);
  if (idx >= 0) {
    dynamicKinds[idx] = meta;
  } else {
    dynamicKinds.push(meta);
  }
}

/** Returns the union of builtin + plugin-registered kinds. */
export function listNotificationKinds(): NpNotificationKindMeta[] {
  return [...builtinKinds, ...dynamicKinds];
}

export type NpDigestCadence = "off" | "daily" | "weekly";

const DIGEST_CADENCES: readonly NpDigestCadence[] = ["off", "daily", "weekly"] as const;

export interface NpNotificationPrefs {
  /** Kinds the member opted out of. Empty / missing = all kinds enabled. */
  disabled: string[];
  /**
   * Phase 16.4 — email digest cadence. `off` (default) disables
   * the digest. `daily` and `weekly` opt the member into a
   * batched email of unread notifications, scheduled by the
   * `notifications:sendDigest` recurring job.
   */
  digest: NpDigestCadence;
  /**
   * Set when the digest sweep last sent an email to this member.
   * Used to scope each digest to "unread since the last send" so
   * members aren't repeatedly emailed about the same row. Stored
   * as ISO-8601 string in the JSONB blob; `null` for accounts
   * that have never received a digest.
   *
   * Issue #218 — superseded by `lastDigestAtBySite` once a member
   * receives a digest under the per-site fan-out path. The legacy
   * field is preserved for forward-compat reads (single-site
   * deploys still see + write it via the fallback chain) and as
   * a "any digest, ever?" marker for analytics.
   */
  lastDigestAt: string | null;
  /**
   * Issue #218 — per-(site, cadence) timestamp map. Replaces the
   * single `lastDigestAt` for multi-site deployments. Empty when
   * the member has never received a digest under the site-scoped
   * sweep.
   */
  lastDigestAtBySite: Record<string, Partial<Record<NpDigestCadence, string>>>;
}

const EMPTY_PREFS: NpNotificationPrefs = {
  disabled: [],
  digest: "off",
  lastDigestAt: null,
  lastDigestAtBySite: {},
};

function normalizeDigest(raw: unknown): NpDigestCadence {
  return DIGEST_CADENCES.includes(raw as NpDigestCadence) ? (raw as NpDigestCadence) : "off";
}

function normalizeLastDigestAt(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function normalizeLastDigestBySite(
  raw: unknown,
): Record<string, Partial<Record<NpDigestCadence, string>>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Partial<Record<NpDigestCadence, string>>> = {};
  for (const [siteId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const inner: Partial<Record<NpDigestCadence, string>> = {};
    for (const [cadence, ts] of Object.entries(value as Record<string, unknown>)) {
      if (!DIGEST_CADENCES.includes(cadence as NpDigestCadence)) continue;
      if (typeof ts === "string" && ts.length > 0) {
        inner[cadence as NpDigestCadence] = ts;
      }
    }
    if (Object.keys(inner).length > 0) out[siteId] = inner;
  }
  return out;
}

function normalizePrefs(raw: unknown): NpNotificationPrefs {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PREFS, lastDigestAtBySite: {} };
  const obj = raw as Record<string, unknown>;
  const disabled = Array.isArray(obj.disabled)
    ? obj.disabled.filter((k): k is string => typeof k === "string")
    : [];
  return {
    disabled,
    digest: normalizeDigest(obj.digest),
    lastDigestAt: normalizeLastDigestAt(obj.lastDigestAt),
    lastDigestAtBySite: normalizeLastDigestBySite(obj.lastDigestAtBySite),
  };
}

export async function getMemberNotificationPrefs(memberId: string): Promise<NpNotificationPrefs> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [row] = (await db
    .select({ prefs: npMembers.notificationPrefs })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!row) throw new NpNotFoundError("member", memberId);
  return normalizePrefs(row.prefs);
}

export interface SetMemberNotificationPrefsInput {
  memberId: string;
  /**
   * Replacement deny-list. Only kinds listed in
   * `listNotificationKinds()` are accepted; unknown strings
   * raise NpValidationError so a forged client can't bloat the
   * JSONB or hide future framework kinds via a stale list.
   * Optional — when omitted the existing list is preserved.
   */
  disabled?: string[];
  /**
   * Phase 16.4 — email digest cadence. Optional; when omitted
   * the existing setting is preserved. `off` clears the
   * member's enrollment.
   */
  digest?: NpDigestCadence;
}

export async function setMemberNotificationPrefs(
  input: SetMemberNotificationPrefsInput,
): Promise<NpNotificationPrefs> {
  const known = new Set(listNotificationKinds().map((k) => k.kind));
  let cleanedDisabled: string[] | undefined;
  if (input.disabled !== undefined) {
    cleanedDisabled = [];
    const seen = new Set<string>();
    for (const raw of input.disabled) {
      if (typeof raw !== "string") {
        throw new NpValidationError("Invalid input", [
          { field: "disabled", message: "Each entry must be a string" },
        ]);
      }
      if (!known.has(raw)) {
        throw new NpValidationError("Invalid input", [
          { field: "disabled", message: `Unknown notification kind: ${raw}` },
        ]);
      }
      if (seen.has(raw)) continue;
      seen.add(raw);
      cleanedDisabled.push(raw);
    }
  }
  if (input.digest !== undefined && !DIGEST_CADENCES.includes(input.digest)) {
    throw new NpValidationError("Invalid input", [
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
    .select({ prefs: npMembers.notificationPrefs })
    .from(npMembers)
    .where(eq(npMembers.id, input.memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) throw new NpNotFoundError("member", input.memberId);

  const merged: Record<string, unknown> = { ...(existing.prefs ?? {}) };
  if (cleanedDisabled !== undefined) merged.disabled = cleanedDisabled;
  if (input.digest !== undefined) merged.digest = input.digest;

  await db
    .update(npMembers)
    .set({ notificationPrefs: merged, updatedAt: new Date() })
    .where(eq(npMembers.id, input.memberId));

  return normalizePrefs(merged);
}

/**
 * Phase 16.4 — bookkeeping helper called by the digest sweep
 * after a successful email send. Stamps `lastDigestAt` so the
 * next run scopes its query to the correct window. Read-merge
 * to preserve other JSONB keys.
 *
 * Issue #218 — when a `siteId` + `cadence` pair is supplied,
 * the per-site / per-cadence map is updated so the next sweep
 * for that tenant scopes to the correct "since" window. The
 * legacy single `lastDigestAt` field is also stamped for
 * forward-compat with single-site deploys (and as a "received
 * any digest, ever?" marker for analytics).
 */
export async function recordDigestSent(
  memberId: string,
  sentAt: Date,
  scope?: { siteId: string; cadence: NpDigestCadence },
): Promise<void> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const [existing] = (await db
    .select({ prefs: npMembers.notificationPrefs })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) return;
  const prior = existing.prefs ?? {};
  const merged: Record<string, unknown> = {
    ...prior,
    lastDigestAt: sentAt.toISOString(),
  };
  if (scope) {
    const priorBySite = normalizeLastDigestBySite(
      (prior as { lastDigestAtBySite?: unknown }).lastDigestAtBySite,
    );
    const siteSlot = { ...(priorBySite[scope.siteId] ?? {}) };
    siteSlot[scope.cadence] = sentAt.toISOString();
    merged.lastDigestAtBySite = { ...priorBySite, [scope.siteId]: siteSlot };
  }
  await db
    .update(npMembers)
    .set({ notificationPrefs: merged, updatedAt: new Date() })
    .where(eq(npMembers.id, memberId));
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
