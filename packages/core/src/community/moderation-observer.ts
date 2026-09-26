import { npRequireCommentRow } from "../community-contract/contract.js";
import type { NpCommentRow } from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";

export interface NpCommunityModerationObservationV1 {
  db: ReturnType<typeof getDb>;
  row: NpCommentRow;
  operation: "create" | "update";
  actorMemberId: string;
  spamVerdict: "pass" | "flag";
  profanityVerdict: "pass" | "flag";
}
/** Host-installed durable observation only. It must not dispatch a Run or invoke a provider. */
export interface NpCommunityModerationObserverV1 {
  prepare(input: { db: ReturnType<typeof getDb>; siteId: string }): Promise<void>;
  record(input: NpCommunityModerationObservationV1): Promise<void>;
}
let observer: NpCommunityModerationObserverV1 | null = null;
export function setCommunityModerationObserverV1(value: NpCommunityModerationObserverV1): void {
  if (typeof value?.prepare !== "function" || typeof value?.record !== "function")
    throw new Error("Invalid community moderation observer");
  observer = value;
}
export function resetCommunityModerationObserverV1(): void {
  observer = null;
}
/** Capture installation once per source mutation; failed evidence rolls back the source write. */
export async function npWriteObservedCommentV1(input: {
  siteId: string;
  operation: "create" | "update";
  actorMemberId: string;
  spamVerdict: "pass" | "flag";
  profanityVerdict: "pass" | "flag";
  write: (db: ReturnType<typeof getDb>) => Promise<NpCommentRow>;
}): Promise<NpCommentRow> {
  const installed = observer;
  if (!installed) return input.write(getDb());
  return getDb().transaction(async (transaction) => {
    const db = transaction as ReturnType<typeof getDb>;
    await installed.prepare({ db, siteId: input.siteId });
    const row = npRequireCommentRow(await input.write(db));
    if (row.siteId !== input.siteId) throw new Error("Comment observation site mismatch");
    await installed.record({
      db,
      row: npRequireCommentRow(row),
      operation: input.operation,
      actorMemberId: input.actorMemberId,
      spamVerdict: input.spamVerdict,
      profanityVerdict: input.profanityVerdict,
    });
    return row;
  });
}
