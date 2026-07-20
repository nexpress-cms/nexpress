import { eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npMembers } from "../db/schema/community.js";
import {
  NpCommunityContractError,
  npRequireNotificationKindCatalog,
  npRequireNotificationKindMeta,
  npRequireNotificationPrefs,
  npRequireNotificationPrefsPatch,
} from "../community-contract/contract.js";
import type {
  NpDigestCadence,
  NpNotificationKindMeta,
  NpNotificationPrefs,
} from "../community-contract/types.js";
import { NpNotFoundError } from "../errors.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

/**
 * Phase 16.3 — per-member notification preferences.
 *
 * The persisted shape is an exact JSONB blob on
 * `np_members.notification_prefs`. Adding fields requires extending the
 * shared community contract. Today we honor:
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

export type { NpDigestCadence, NpNotificationKindMeta, NpNotificationPrefs };

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
    kind: "comment.received",
    label: "Comments on your content",
    description: "Someone commented on a document you authored.",
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
  {
    kind: "follow.activity",
    label: "Subscribed activity",
    description: "A followed board or document has new activity.",
  },
];

const dynamicKinds: NpNotificationKindMeta[] = [];

/** Plugin-extensible registration. Idempotent on `kind`. */
export function registerNotificationKind(meta: NpNotificationKindMeta): void {
  let checked: NpNotificationKindMeta;
  try {
    checked = npRequireNotificationKindMeta(meta);
  } catch (error) {
    npRecordCommunityRuntimeDiagnostic(
      "notification-kinds",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  if (builtinKinds.some((k) => k.kind === checked.kind)) return;
  const idx = dynamicKinds.findIndex((k) => k.kind === checked.kind);
  if (idx >= 0) {
    dynamicKinds[idx] = checked;
  } else {
    dynamicKinds.push(checked);
  }
}

/** Returns the union of builtin + plugin-registered kinds. */
export function listNotificationKinds(): NpNotificationKindMeta[] {
  return npRequireNotificationKindCatalog([...builtinKinds, ...dynamicKinds]).map((kind) => ({
    ...kind,
  }));
}

export async function getMemberNotificationPrefs(memberId: string): Promise<NpNotificationPrefs> {
  const db = getDb();
  const [row] = (await db
    .select({ prefs: npMembers.notificationPrefs })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!row) throw new NpNotFoundError("member", memberId);
  return npRequireNotificationPrefs(row.prefs, {
    knownKinds: new Set(listNotificationKinds().map((kind) => kind.kind)),
  });
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
  const patch = npRequireNotificationPrefsPatch(
    {
      ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
      ...(input.digest === undefined ? {} : { digest: input.digest }),
    },
    known,
  );
  const db = getDb();

  // Read-then-merge the known exact shape so digest bookkeeping survives a
  // member's toggle update without preserving undeclared JSONB keys.
  const [existing] = (await db
    .select({ prefs: npMembers.notificationPrefs })
    .from(npMembers)
    .where(eq(npMembers.id, input.memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) throw new NpNotFoundError("member", input.memberId);

  const prior = npRequireNotificationPrefs(existing.prefs, { knownKinds: known });
  const merged: NpNotificationPrefs = {
    ...prior,
    ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
    ...(patch.digest === undefined ? {} : { digest: patch.digest }),
  };

  await db
    .update(npMembers)
    .set({ notificationPrefs: { ...merged }, updatedAt: new Date() })
    .where(eq(npMembers.id, input.memberId));

  return npRequireNotificationPrefs(merged, { knownKinds: known });
}

/**
 * Phase 16.4 — bookkeeping helper called by the digest sweep
 * after a successful email send. Stamps `lastDigestAt` so the
 * next run scopes its query to the correct window. Read-merge
 * preserves the other declared preference fields.
 *
 * Issue #218 — when a `siteId` + `cadence` pair is supplied,
 * the per-site / per-cadence map is updated so the next sweep
 * for that tenant scopes to the correct "since" window. The
 * single `lastDigestAt` field is also stamped as a
 * "received any digest, ever?" marker for analytics.
 */
export async function recordDigestSent(
  memberId: string,
  sentAt: Date,
  scope?: { siteId: string; cadence: NpDigestCadence },
): Promise<void> {
  const db = getDb();
  const [existing] = (await db
    .select({ prefs: npMembers.notificationPrefs })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ prefs: Record<string, unknown> }>;
  if (!existing) return;
  const prior = npRequireNotificationPrefs(existing.prefs, {
    knownKinds: new Set(listNotificationKinds().map((kind) => kind.kind)),
  });
  const merged: NpNotificationPrefs = {
    ...prior,
    lastDigestAt: sentAt.toISOString(),
  };
  if (scope) {
    const priorBySite = prior.lastDigestAtBySite;
    const siteSlot = { ...(priorBySite[scope.siteId] ?? {}) };
    siteSlot[scope.cadence] = sentAt.toISOString();
    merged.lastDigestAtBySite = { ...priorBySite, [scope.siteId]: siteSlot };
  }
  npRequireNotificationPrefs(merged);
  await db
    .update(npMembers)
    .set({ notificationPrefs: { ...merged }, updatedAt: new Date() })
    .where(eq(npMembers.id, memberId));
}

/**
 * Inbox-side gate consulted by `createNotification`. Returns
 * `false` when the recipient explicitly opted out of `kind`.
 * Malformed persisted preferences fail closed for this side effect and emit a
 * bounded diagnostic. Unrelated read failures still fail open so a transient
 * DB blip doesn't silently swallow notifications.
 */
export async function isNotificationKindEnabled(memberId: string, kind: string): Promise<boolean> {
  try {
    const prefs = await getMemberNotificationPrefs(memberId);
    return !prefs.disabled.includes(kind);
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      npRecordCommunityRuntimeDiagnostic("notification-prefs", error.message);
      return false;
    }
    return true;
  }
}
