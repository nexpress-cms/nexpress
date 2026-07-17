import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { asc, count, desc, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { NpCommunityJsonObject } from "../community-contract/types.js";
import {
  NpCollectionContractError,
  npCollectionDocumentToWriteInput,
  npHydrateCollectionDocument,
  npRequireCollectionDocument,
  npRequireCollectionFindOptions,
  npRequireCollectionFindResult,
  npRequireCollectionStorageRow,
} from "../collection-contract/contract.js";

import {
  type NpCollectionConfig,
  type NpDocumentStatus,
  type NpFindOptions,
  type NpFindResult,
  type NpSaveOptions,
  type NpSaveResult,
  type NpAuthUser,
  type NpCollectionHook,
  type NpFieldConfig,
  type NpHookPrincipal,
} from "../config/types.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { isNpRichTextContent } from "../fields/rich-text.js";
import { applySlugField } from "./slug.js";
import { getI18nConfig } from "../i18n/registry.js";
import { getCurrentSiteId } from "../sites/context.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { getCollectionZodSchema } from "./validation.js";
import { getCollectionConfig, getCollectionTable, getCollectionRegistration } from "./registry.js";
import { npRecordCollectionRuntimeDiagnostic } from "./diagnostics.js";
import { buildSearchVector, buildWeightedSearchVectorSql } from "./search.js";
import { enqueueJob } from "../jobs/queue.js";
import { runHook } from "../plugins/host.js";
import { npRevisions, npSlugHistory } from "../db/schema/system.js";
import { npComments, npReactions, npReports } from "../db/schema/community.js";
import { npMediaRefs } from "../db/schema/media.js";
import { getDb } from "../db/runtime.js";
import {
  NpRevisionContractError,
  npAnalyzeRevisionSnapshot,
  npRevisionSnapshotKey,
  type NpRevisionSnapshot,
} from "../revisions/contract.js";

interface PreparedDocumentData {
  mainData: Record<string, unknown>;
  childRows: Record<string, Record<string, unknown>[]>;
  joinRows: Record<string, string[]>;
}

type QueryCondition = ReturnType<typeof sql>;

interface SelectQuery extends Promise<unknown[]> {
  where(condition: QueryCondition): SelectQuery;
  orderBy(order: QueryCondition): SelectQuery;
  limit(limit: number): SelectQuery;
  offset(offset: number): SelectQuery;
  for(strength: "update"): SelectQuery;
}

interface InsertValuesQuery extends Promise<unknown> {
  returning(): Promise<unknown[]>;
}

interface DrizzleTransactionLike {
  insert(table: PgTable): {
    values(values: Record<string, unknown> | Record<string, unknown>[]): InsertValuesQuery;
  };
  update(table: PgTable): {
    set(values: Record<string, unknown>): {
      where(condition: QueryCondition): {
        returning(): Promise<unknown[]>;
      };
    };
  };
  delete(table: PgTable): {
    where(condition: QueryCondition): Promise<unknown>;
  };
  select(selection?: Record<string, unknown>): {
    from(table: PgTable): SelectQuery;
  };
}

interface DrizzleDatabaseLike extends DrizzleTransactionLike {
  transaction<T>(callback: (tx: DrizzleTransactionLike) => Promise<T>): Promise<T>;
}

/**
 * Opaque transaction handle that external callers can thread into
 * pipeline write functions to make a sequence of writes atomic.
 *
 * Today only `deleteDocument` accepts a `{ tx }` option (used by
 * `wipeSeededContent` so a multi-row wipe rolls back as a unit on
 * failure). Callers obtain a handle by wrapping their batch in
 * Drizzle's `db.transaction(async (tx) => { … })`; the `tx` value
 * passed to the callback IS the handle to thread on through.
 *
 * The shape is intentionally minimal — just the Drizzle methods
 * the pipeline actually uses — to keep external code from poking
 * Drizzle internals and to leave room for swapping the backing
 * implementation if `getDb()` ever moves off Drizzle.
 */
export type NpTransaction = DrizzleTransactionLike;

/**
 * Internal actor type. The pipeline accepts either a staff `NpAuthUser`
 * (the original behavior) or a `{ kind: "member", memberId }` shape
 * (Phase 9.7a — `community.memberWrite.create` collections). Member
 * writes bypass the staff `access.create` access function: gating is
 * the per-collection opt-in flag plus `assertNotBanned(memberId)`,
 * not the staff access tree. `createdBy` / `updatedBy` / `authorId`
 * (revisions) are stored as null when the actor is a member; the
 * audit log captures the actual member id.
 */
type SaveActor = { kind: "staff"; user: NpAuthUser } | { kind: "member"; memberId: string };

function actorUserOrNull(actor: SaveActor): NpAuthUser | null {
  return actor.kind === "staff" ? actor.user : null;
}

function actorUserId(actor: SaveActor): string | null {
  return actor.kind === "staff" ? actor.user.id : null;
}

function actorMemberId(actor: SaveActor): string | null {
  return actor.kind === "member" ? actor.memberId : null;
}

function requireDocumentSiteId(document: Record<string, unknown>, context: string): string {
  if (!npIsCanonicalSiteId(document.siteId)) {
    throw new Error(`${context} is missing a canonical siteId.`);
  }
  return document.siteId;
}

function isCanonicalCreateId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

/**
 * Polymorphic actor reference passed to collection hooks and
 * surfaced to plugin hooks via the `principal` payload field.
 * Mirrors `SaveActor` — kept structurally identical so hook
 * authors can switch on `kind` without importing a separate type.
 */
function actorPrincipal(actor: SaveActor): NpHookPrincipal {
  switch (actor.kind) {
    case "staff":
      return { kind: "staff", user: actor.user };
    case "member":
      return { kind: "member", memberId: actor.memberId };
    default: {
      const _exhaustive: never = actor;
      void _exhaustive;
      throw new Error("actorPrincipal: unhandled SaveActor kind");
    }
  }
}

interface DeferredPostCommitHook {
  label: string;
  context: { collection: string; documentId: string; operation?: string };
  fn: () => Promise<unknown>;
}

/**
 * AsyncLocalStorage holding a queue of post-commit hooks that
 * should NOT fire until the surrounding caller-owned scope
 * resolves successfully. `withDeferredPostCommit` sets the store;
 * `runPostCommit` checks for it and pushes to the queue instead
 * of firing. When the scope's callback resolves, the queue is
 * drained in FIFO order; if the callback throws, the queue is
 * discarded along with whatever caused the failure.
 */
const deferredPostCommitStore = new AsyncLocalStorage<DeferredPostCommitHook[]>();

/**
 * Wrap a callback in a "deferred post-commit" scope. Any
 * `runPostCommit` calls made during the callback queue their work
 * instead of firing. After the callback resolves successfully,
 * queued hooks drain in FIFO order — each wrapped in its own
 * try/catch (failures are logged, never surfaced to the caller,
 * subsequent hooks still fire). If the callback throws, the queue
 * is discarded and hooks never run.
 *
 * Use this around batch operations that pair an outer transaction
 * with per-row post-commit side-effects — the reseed POST handler
 * is the motivating case: wipe + setActiveThemeId + seed run inside
 * one `db.transaction`; without deferral the per-row
 * `content:afterDelete` / `content:afterSave` hooks would fire
 * during the tx (committing audit log writes and pg-boss job
 * inserts through separate connections) even if the tx later
 * rolls back, leaving ghost entries that don't match the final DB
 * state. With deferral the queue drains only after commit and
 * vanishes on rollback.
 *
 * Re-entrant: nested calls run their inner queue independently;
 * the inner queue drains when the inner callback resolves, before
 * control returns to the outer.
 */
export async function withDeferredPostCommit<T>(callback: () => Promise<T>): Promise<T> {
  const queue: DeferredPostCommitHook[] = [];
  const result = await deferredPostCommitStore.run(queue, callback);
  // Drain on success. Each hook is independently isolated — one
  // failure logs and moves on, mirroring the eager `runPostCommit`
  // shape. We re-import the logger lazily to avoid a top-of-file
  // cycle with the observability module.
  for (const hook of queue) {
    try {
      await hook.fn();
    } catch (err) {
      const { getLogger } = await import("../observability/logger.js");
      getLogger().error(
        `deferred post-commit ${hook.label} failed — outer scope committed, follow-up skipped`,
        {
          collection: hook.context.collection,
          documentId: hook.context.documentId,
          operation: hook.context.operation,
          label: hook.label,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      );
    }
  }
  return result;
}

/**
 * Run a side-effect that fires AFTER the document transaction has
 * already committed (job enqueue, plugin hook). The doc is durable
 * by this point — surfacing the error to the caller would make a
 * successful save look like a failure, so we swallow and surface
 * via the framework logger instead.
 *
 * When called inside a `withDeferredPostCommit` scope, the work
 * is QUEUED on the scope's AsyncLocalStorage list instead of
 * firing immediately. The scope drains the queue after its
 * callback resolves (which is the moment the caller-owned outer
 * transaction has actually committed). Outside the scope, the
 * behavior is unchanged — fire immediately, swallow errors.
 *
 * Operators rely on the log line to discover skipped follow-ups
 * (search reindex, mention fanout, cache invalidation, etc.) and
 * replay manually. The full outbox-pattern fix lives in #277; this
 * is the minimum viable visibility shim.
 *
 * @internal — exported so the unit test can verify the
 * swallow + log contract directly. Not part of the package's
 * public API; do not use from outside `@nexpress/core`.
 */
export async function runPostCommit(
  label: string,
  context: { collection: string; documentId: string; operation?: string },
  fn: () => Promise<unknown>,
): Promise<void> {
  const queue = deferredPostCommitStore.getStore();
  if (queue) {
    queue.push({ label, context, fn });
    return;
  }
  try {
    await fn();
  } catch (err) {
    const { getLogger } = await import("../observability/logger.js");
    getLogger().error(`post-commit ${label} failed — document persisted, follow-up skipped`, {
      collection: context.collection,
      documentId: context.documentId,
      operation: context.operation,
      label,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

export async function saveDocument(
  collection: string,
  docId: string | null,
  data: Record<string, unknown>,
  user: NpAuthUser,
  options?: NpSaveOptions,
): Promise<NpSaveResult> {
  return saveDocumentImpl(collection, docId, data, { kind: "staff", user }, options);
}

/**
 * Member-side document create. Only valid when
 * `config.community?.memberWrite?.create === true`. Assumes the API
 * layer has already authenticated the member (and that the cookie's
 * status was checked) — this function adds:
 *   - the per-collection opt-in gate, and
 *   - `assertNotBanned(memberId)` (site-wide; per-collection bans
 *     resolve to the same site scope)
 *
 * Fires the `document.created` reputation event after a successful
 * write so adapters can credit the author the same way they credit
 * comments / reactions. Member-side update / delete live in
 * `updateMemberDocument` / `deleteMemberDocument` below.
 */
/**
 * Member-side document update. Only valid when
 * `config.community?.memberWrite?.update === true` AND the existing
 * row's `member_author_id` matches the caller. Members can NOT
 * change `_status` via update — `options.status` is stripped here
 * so a forged body field can't bypass the moderation pipeline. The
 * author column itself is also locked — see saveDocumentImpl.
 */
export async function updateMemberDocument(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  memberId: string,
  options?: NpSaveOptions,
): Promise<NpSaveResult> {
  const memberOptions: NpSaveOptions = { ...(options ?? {}) };
  delete memberOptions.status;

  // Cheap authorization checks BEFORE moderation (#139). Without
  // this gate a banned member or a non-owner could still trigger
  // the (potentially-paid, potentially-network) spam/profanity
  // adapters before `saveDocumentImpl` rejects them. Order:
  //   1. collection opt-in
  //   2. doc existence
  //   3. owner check
  //   4. ban check
  // These are duplicated inside `saveDocumentImpl`, but both
  // execute the same SELECT-or-cache queries; doing them here
  // saves the moderation round-trip on doomed requests. If any
  // of these throw, the moderation never runs.
  const config = getCollectionConfig(collection);
  if (!config.community?.memberWrite?.update) {
    throw new NpForbiddenError(collection, "update");
  }
  const registration = getCollectionRegistration(collection);
  const dbForGate = getDb() as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(dbForGate, registration, collection, docId);
  if (!originalDoc) {
    throw new NpNotFoundError(collection, docId);
  }
  const authorId = (originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
  if (authorId !== memberId) {
    throw new NpForbiddenError(collection, "update");
  }
  const { assertNotBanned } = await import("../community/can.js");
  await assertNotBanned(memberId);

  // Re-run the spam + profanity adapters on the submitted patch.
  // Pre-fix this path skipped moderation entirely, so a member
  // could create a clean discussion, get it published, then PATCH
  // it to spam/profanity and the row stayed published. The same
  // verdict semantics apply as the create path:
  //   - reject → 400, no write
  //   - flag   → status forced to `pending`
  //   - pass   → status untouched (the original status survives)
  const moderation = await runMemberDocModeration({
    collection,
    data,
    memberId,
    targetId: docId,
  });
  if (moderation.flaggedBy.length > 0) {
    memberOptions.status = "pending";
  }

  const result = await saveDocumentImpl(
    collection,
    docId,
    data,
    { kind: "member", memberId },
    memberOptions,
  );
  const { recordAuditEvent } = await import("../community/audit.js");
  await recordAuditEvent({
    actor: { kind: "member", memberId },
    action: moderation.flaggedBy.length > 0 ? "document.flag" : "document.update",
    targetType: collection,
    targetId: docId,
    payload: {
      collectionSlug: collection,
      event: "update",
      ...(moderation.flaggedBy.length > 0 ? { sources: moderation.flaggedBy } : {}),
      ...(moderation.profanityVerdict ? { profanityVerdict: moderation.profanityVerdict } : {}),
      ...(moderation.spamVerdict ? { spamVerdict: moderation.spamVerdict } : {}),
    },
  });

  // Phase 16.2 — @mention fan-out on edit. Only fire for edits
  // that landed `published` (skip flagged-to-pending edits — same
  // policy as `comment.mention` on update). Delta the prior
  // body so toggling unrelated fields doesn't re-notify the same
  // recipients.
  const resultStatus = (result.doc as { status?: unknown }).status;
  if (resultStatus === "published") {
    const { extractMentionHandlesFromDocData, fanOutMentionNotifications } =
      await import("../community/mentions.js");
    const previousHandles = new Set(extractMentionHandlesFromDocData(originalDoc));
    await fanOutMentionNotifications({
      actorMemberId: memberId,
      kind: "document.mention",
      data,
      previousHandles,
      payload: {
        collectionSlug: collection,
        documentId: docId,
      },
    });
  }
  return result;
}

export async function createMemberDocument(
  collection: string,
  data: Record<string, unknown>,
  memberId: string,
  options?: NpSaveOptions,
): Promise<NpSaveResult> {
  // Members can't author drafts / archive / schedule — those status
  // transitions are admin-side affordances. The status that
  // member-authored creates land in is governed by:
  //   1. The collection's `community.memberWrite.defaultStatus`
  //      (default `"published"` — sites that want a moderation gate
  //      flip to `"pending"`).
  //   2. The spam adapter's verdict on this individual write — `flag`
  //      forces `"pending"` regardless of the default; `reject`
  //      refuses the write entirely; `pass` accepts the default.
  // The API body's `_status` is always ignored.
  const config = getCollectionConfig(collection);

  // Cheap authorization checks BEFORE moderation (#139). Banned
  // members or members in collections that haven't opted into
  // member-write should never reach the (potentially-paid)
  // spam/profanity adapters. These same checks run again inside
  // `saveDocumentImpl`, but doing them here saves the
  // moderation round-trip on doomed requests.
  if (!config.community?.memberWrite?.create) {
    throw new NpForbiddenError(collection, "create");
  }
  const { assertNotBanned } = await import("../community/can.js");
  await assertNotBanned(memberId);

  const defaultStatus: NpDocumentStatus =
    config.community?.memberWrite?.defaultStatus === "pending" ? "pending" : "published";

  const moderation = await runMemberDocModeration({
    collection,
    data,
    memberId,
    targetId: "",
  });
  const flaggedBy = moderation.flaggedBy;
  const spamStatus: NpDocumentStatus = flaggedBy.length > 0 ? "pending" : defaultStatus;

  const memberOptions: NpSaveOptions = { ...(options ?? {}), status: spamStatus };
  const result = await saveDocumentImpl(
    collection,
    null,
    data,
    { kind: "member", memberId },
    memberOptions,
  );

  const { applyReputation } = await import("../community/reputation.js");
  const { recordAuditEvent } = await import("../community/audit.js");
  const documentId = getRecordId(result.doc);
  // `document.flag` action when either adapter flagged this row.
  // A pending row that got there via `defaultStatus="pending"` is
  // config-driven, not a per-row flag, so it stays under
  // `document.create`. The `sources` array tells mods which
  // adapter(s) flagged the row.
  await recordAuditEvent({
    actor: { kind: "member", memberId },
    action: flaggedBy.length > 0 ? "document.flag" : "document.create",
    targetType: collection,
    targetId: documentId,
    payload: {
      collectionSlug: collection,
      event: "create",
      ...(flaggedBy.length > 0 ? { sources: flaggedBy } : {}),
      ...(moderation.profanityVerdict ? { profanityVerdict: moderation.profanityVerdict } : {}),
      ...(moderation.spamVerdict ? { spamVerdict: moderation.spamVerdict } : {}),
    },
  });
  // Reputation only credits visible (i.e. `published`) creates.
  // Pending docs wait on a mod restore — at that point the
  // moderation surface can decide whether to retroactively credit.
  // Mirrors the `comment.created` semantic.
  if (spamStatus === "published") {
    await applyReputation(memberId, {
      kind: "document.created",
      collectionSlug: collection,
      documentId,
      memberId,
    });
  }

  // Phase 16.2 — @mention fan-out. Same gate as reputation: only
  // visible (`published`) creates fire. Pending docs wait on mod
  // restore so notifications can't surface text the public list
  // won't render.
  if (spamStatus === "published") {
    const { fanOutMentionNotifications } = await import("../community/mentions.js");
    await fanOutMentionNotifications({
      actorMemberId: memberId,
      kind: "document.mention",
      data,
      payload: {
        collectionSlug: collection,
        documentId,
      },
    });
  }
  return result;
}

interface MemberDocModerationResult {
  flaggedBy: Array<"profanity" | "spam">;
  profanityVerdict: { reason: string | null; metadata: NpCommunityJsonObject | null } | null;
  spamVerdict: { reason: string | null; metadata: NpCommunityJsonObject | null } | null;
}

interface RunMemberDocModerationInput {
  collection: string;
  data: Record<string, unknown>;
  memberId: string;
  /** Empty string for create, the doc id for update. */
  targetId: string;
}

/**
 * Runs the profanity → spam adapter chain on a member-authored
 * document write (create or update). Shared between
 * `createMemberDocument` and `updateMemberDocument` so the
 * moderation gate can't drift between the two surfaces (#121).
 *
 * The moderation text is built from every text / textarea /
 * richText field present in `data` — `buildSearchVector` already
 * implements that walk for the FTS index, so we reuse it here
 * (same input set, different downstream consumer). Pre-fix this
 * function only saw `data.title`, so a member could keep a
 * benign title and put spam / slurs in the rich-text body and
 * the adapters would never see them (#119).
 *
 * Verdict semantics match the comment write path:
 *   - reject  → throws `NpValidationError`
 *   - flag    → returned with the source recorded in `flaggedBy`
 *   - pass    → returned with empty `flaggedBy`
 *
 * Adapter failures and malformed verdicts are isolated as `flag`,
 * keeping the write path available without publishing unchecked
 * content.
 */
async function runMemberDocModeration(
  input: RunMemberDocModerationInput,
): Promise<MemberDocModerationResult> {
  const { collection, data, memberId, targetId } = input;
  const config = getCollectionConfig(collection);
  const { getSpamAdapter } = await import("../community/spam-adapter.js");
  const { getProfanityAdapter } = await import("../community/profanity-adapter.js");
  const { runProfanityCheck, runSpamCheck } = await import("../community/moderation.js");

  // Walk every text / textarea / richText field in the patch.
  // Empty string when none of the moderated fields are touched
  // — the adapters then run on empty text, which by convention
  // passes (no content = no policy violation).
  const moderationText = buildSearchVector(config, data);
  const ctx = {
    memberId,
    targetType: collection,
    targetId,
    parentId: null,
  };

  let profanityVerdict: MemberDocModerationResult["profanityVerdict"] = null;
  const checkedProfanity = await runProfanityCheck(getProfanityAdapter(), moderationText, ctx);
  if (checkedProfanity.kind === "reject") {
    throw new NpValidationError("Invalid input", [
      {
        field: "body",
        message: checkedProfanity.reason ?? "Submission contains prohibited language",
      },
    ]);
  }
  if (checkedProfanity.kind === "flag") {
    profanityVerdict = {
      reason: checkedProfanity.reason ?? null,
      metadata: checkedProfanity.metadata ?? null,
    };
  }

  let spamVerdict: MemberDocModerationResult["spamVerdict"] = null;
  const checkedSpam = await runSpamCheck(getSpamAdapter(), moderationText, ctx);
  if (checkedSpam.kind === "reject") {
    throw new NpValidationError("Invalid input", [
      {
        field: "body",
        message: checkedSpam.reason ?? "Submission rejected",
      },
    ]);
  }
  if (checkedSpam.kind === "flag") {
    spamVerdict = {
      reason: checkedSpam.reason ?? null,
      metadata: checkedSpam.metadata ?? null,
    };
  }

  const flaggedBy: Array<"profanity" | "spam"> = [];
  if (profanityVerdict) flaggedBy.push("profanity");
  if (spamVerdict) flaggedBy.push("spam");

  return { flaggedBy, profanityVerdict, spamVerdict };
}

/**
 * Threaded state for `saveDocumentImpl`'s four concerns (#314).
 * Helpers add to this object as the request progresses through the
 * pipeline; the final concern (`firePostCommitHooks`) consumes the
 * accumulated context. The split makes it visible at review time
 * which step gates what.
 *
 * Some fields (`prepared`, `searchVector`, `publishTransition`) are
 * undefined until `prepareDocumentForWrite` runs; downstream helpers
 * can assume the prepare step has completed because the chain is
 * fixed in `saveDocumentImpl`.
 */
interface SaveContext {
  // === Setup, present from initSaveContext onward. ===
  collection: string;
  docId: string | null;
  validatedData: Record<string, unknown>;
  actor: SaveActor;
  options: NpSaveOptions | undefined;
  config: ReturnType<typeof getCollectionConfig>;
  registration: ReturnType<typeof getCollectionRegistration>;
  table: PgTable;
  db: DrizzleDatabaseLike;
  /**
   * Caller-provided transaction (from `options.tx`). When set,
   * `persistDocumentTx` skips opening a private tx and runs the
   * write block against this handle directly so callers can
   * batch many saves under one outer transaction.
   */
  outerTx: DrizzleTransactionLike | undefined;
  operation: "create" | "update";
  originalDoc: Record<string, unknown> | null;
  userForHooks: NpAuthUser | null;
  principal: NpHookPrincipal;
  // === Populated by prepareDocumentForWrite. ===
  hookData: Record<string, unknown>;
  prepared: PreparedDocumentData;
  searchVector: ReturnType<typeof buildWeightedSearchVectorSql>;
  publishTransition: boolean;
  unpublishTransition: boolean;
  now: Date;
}

async function initSaveContext(
  collection: string,
  docId: string | null,
  data: Record<string, unknown>,
  actor: SaveActor,
  options: NpSaveOptions | undefined,
): Promise<
  Omit<
    SaveContext,
    "hookData" | "prepared" | "searchVector" | "publishTransition" | "unpublishTransition" | "now"
  >
> {
  if (options?.createId !== undefined) {
    if (docId !== null) {
      throw new NpValidationError("Invalid save options", [
        { field: "createId", message: "createId is only valid for document creates." },
      ]);
    }
    if (!isCanonicalCreateId(options.createId)) {
      throw new NpValidationError("Invalid save options", [
        { field: "createId", message: "createId must be a canonical UUID." },
      ]);
    }
  }
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  // Caller can hand us a transaction (e.g. the seed loop batches
  // every theme's seedAll inside one outer tx). Cast from the
  // `unknown`-typed slot on NpSaveOptions; the structural shape
  // matches DrizzleTransactionLike at runtime — see the docstring
  // on the option for the boundary contract.
  const outerTx = options?.tx as DrizzleTransactionLike | undefined;
  const operation: "create" | "update" = docId ? "update" : "create";
  // Read the original doc through the outer tx when one is
  // provided so the read sees the tx's own pending writes
  // (matters when a batch saves dependent docs in sequence and
  // a later one needs to look the earlier one up).
  const readHandle: DrizzleTransactionLike = outerTx ?? db;
  const originalDoc = docId
    ? await getDocumentByIdInternal(readHandle, registration, collection, docId)
    : null;
  // PATCH and programmatic updates are true partial updates. Rebuild the
  // complete writable shape from the validated persisted document, overlay
  // the caller's patch, then run the exact strict schema. This prevents an
  // omitted field from being nulled while still rejecting framework-managed
  // and unknown keys at the earliest write boundary.
  const candidate = originalDoc
    ? { ...npCollectionDocumentToWriteInput(originalDoc, config), ...data }
    : data;
  // Pass the complete candidate so `admin.condition` and required/default
  // semantics are evaluated against the same value that will be persisted.
  const validatedData = toRecord(getCollectionZodSchema(config, candidate).parse(candidate));
  if (hasFrameworkPublishedAt(config)) {
    const publishedAt = normalizeFrameworkPublishedAt(candidate.publishedAt);
    if (publishedAt !== undefined) validatedData.publishedAt = publishedAt;
  }
  return {
    collection,
    docId,
    validatedData,
    actor,
    options,
    config,
    registration,
    table,
    db,
    outerTx,
    operation,
    originalDoc,
    userForHooks: actorUserOrNull(actor),
    principal: actorPrincipal(actor),
  };
}

/**
 * Concern 1 — access checks. Staff writes go through the configured
 * `access.create` / `access.update` tree; member writes hit the
 * per-collection `community.memberWrite.create / update` opt-in
 * plus a ban check, plus an ownership check on update.
 *
 * Throws `NpForbiddenError` / `NpNotFoundError` on rejection.
 */
async function validateActorAccess(ctx: SaveContext): Promise<void> {
  if (ctx.actor.kind === "staff") {
    await assertWriteAccess(
      ctx.config,
      ctx.collection,
      ctx.operation,
      ctx.actor.user,
      ctx.validatedData,
      ctx.originalDoc,
    );
    return;
  }
  // Member actor. Phase 9.7a opened create; 9.7b opens update with
  // an owner-only check. Each transition has a separate opt-in
  // flag so a site can allow self-authoring without enabling
  // self-edit. Defer-load to avoid the community ↔ collections
  // import cycle.
  const { assertNotBanned } = await import("../community/can.js");
  if (ctx.operation === "create") {
    if (!ctx.config.community?.memberWrite?.create) {
      throw new NpForbiddenError(ctx.collection, "create");
    }
    await assertNotBanned(ctx.actor.memberId);
    return;
  }
  // update — the doc must exist and must be authored by THIS
  // member (`member_author_id` matches). 404 / 403 disambiguate:
  // 404 when there's no row at all, 403 when the row belongs to
  // someone else (or to staff with `member_author_id = null`).
  if (!ctx.originalDoc) {
    throw new NpNotFoundError(ctx.collection, ctx.docId ?? "unknown");
  }
  if (!ctx.config.community?.memberWrite?.update) {
    throw new NpForbiddenError(ctx.collection, "update");
  }
  const authorId = (ctx.originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
  if (authorId !== ctx.actor.memberId) {
    throw new NpForbiddenError(ctx.collection, "update");
  }
  await assertNotBanned(ctx.actor.memberId);
}

/**
 * Concern 2 — prepare the document for write. Runs the
 * collection and plugin `beforeCreate` / `beforeUpdate` hooks, applies slug
 * generation, resolves i18n locale + translation group,
 * runs `prepareDocumentData`, stamps multi-site / member-author
 * columns, demotes future-dated `published` to `scheduled`,
 * builds the search-vector SQL fragment, and computes the
 * publish/unpublish transition.
 *
 * Mutates `ctx` to install the prepared fields.
 */
async function prepareDocumentForWrite(c: SaveContext): Promise<void> {
  c.hookData = await runHooks(
    c.operation === "create" ? c.config.hooks?.beforeCreate : c.config.hooks?.beforeUpdate,
    {
      data: c.validatedData,
      user: c.userForHooks,
      principal: c.principal,
      collection: c.collection,
      originalDoc: c.originalDoc,
    },
  );

  // Plugin draft hooks run before slug/i18n/field preparation so in-place
  // mutations of `document` participate in every downstream derived value and
  // the persisted row. The host shallow-freezes only the payload wrapper, not
  // this nested document object.
  if (c.operation === "create") {
    await runHook("content:beforeCreate", {
      collection: c.collection,
      documentId: null,
      document: c.hookData,
      originalDocument: null,
      operation: "create",
      source: "request",
      principal: c.principal,
    });
  } else {
    if (!c.docId || !c.originalDoc) {
      throw new Error(`Update hook context for ${c.collection} is missing its original document.`);
    }
    await runHook("content:beforeUpdate", {
      collection: c.collection,
      documentId: c.docId,
      document: c.hookData,
      originalDocument: c.originalDoc,
      operation: "update",
      source: "request",
      principal: c.principal,
    });
  }

  applySlugField(c.config, c.hookData, c.originalDoc);

  // Collection and plugin hooks are untrusted result boundaries. Re-parse
  // after every hook chain and slug derivation so a hook cannot persist an
  // undeclared key, malformed field, or invalid nested value that the
  // request-side validation never saw.
  try {
    c.hookData = toRecord(getCollectionZodSchema(c.config, c.hookData).parse(c.hookData));
  } catch (error) {
    npRecordCollectionRuntimeDiagnostic(
      c.collection,
      "hook-result",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  // Phase 12.1 — i18n collections need locale + translation
  // group resolved before the row is written. On creates the
  // locale defaults to `defaultLocale`, the translationGroupId
  // defaults to a new UUID. On updates those columns are
  // sticky — pulled from `originalDoc` so a body field can't
  // reassign them.
  let i18nResolved: { locale: string; translationGroupId: string } | null = null;
  if (c.config.i18n) {
    const i18n = getI18nConfig();
    if (!i18n) {
      throw new Error(
        `Collection "${c.collection}" is i18n-enabled but the framework has no i18n config (setI18nConfig was never called).`,
      );
    }
    if (c.operation === "create") {
      const requestedLocale = (c.hookData as { locale?: unknown }).locale;
      const locale =
        typeof requestedLocale === "string" && requestedLocale.length > 0
          ? requestedLocale
          : i18n.defaultLocale;
      if (!i18n.locales.includes(locale)) {
        throw new NpValidationError("Invalid input", [
          {
            field: "locale",
            message: `Locale "${locale}" is not configured. Allowed: ${i18n.locales.join(", ")}.`,
          },
        ]);
      }
      const requestedGroup = (c.hookData as { translationGroupId?: unknown }).translationGroupId;
      const translationGroupId =
        typeof requestedGroup === "string" && requestedGroup.length > 0
          ? requestedGroup
          : randomUUID();
      i18nResolved = { locale, translationGroupId };
    } else {
      const original = c.originalDoc as { locale?: string; translationGroupId?: string } | null;
      if (!original?.locale || !original.translationGroupId) {
        throw new Error(
          `i18n collection "${c.collection}" doc ${c.docId} is missing locale/translationGroupId. The row predates i18n opt-in; backfill required.`,
        );
      }
      i18nResolved = {
        locale: original.locale,
        translationGroupId: original.translationGroupId,
      };
    }
  }

  c.prepared = prepareDocumentData(c.config.fields, c.hookData);
  if (hasFrameworkPublishedAt(c.config)) {
    const publishedAt = normalizeFrameworkPublishedAt(c.hookData.publishedAt);
    if (publishedAt !== undefined) {
      c.prepared.mainData.publishedAt = publishedAt;
    }
  }
  if (c.options?.status) {
    c.prepared.mainData.status = c.options.status;
  }
  if (i18nResolved) {
    c.prepared.mainData.locale = i18nResolved.locale;
    c.prepared.mainData.translationGroupId = i18nResolved.translationGroupId;
  }

  // Phase 15.2 — multi-site scoping. Stamp every write with
  // the resolved site id. Creates pull from the request
  // context (or fall back to the default site for scripts /
  // workers / tests with no resolver). Updates inherit the
  // original row's site id — body fields can't reassign a doc.
  if (c.operation === "create") {
    const resolved = await getCurrentSiteId();
    c.prepared.mainData.siteId = resolved ?? NP_DEFAULT_SITE_ID;
  } else {
    if (!c.originalDoc) {
      throw new Error(`Update context for ${c.collection} is missing its original document.`);
    }
    c.prepared.mainData.siteId = requireDocumentSiteId(
      c.originalDoc,
      `Persisted ${c.collection} document`,
    );
  }
  // Stamp / strip member_author_id. The column is generated only
  // when `community.memberWrite.create` is on; staff-authored docs
  // leave it null. Defense-in-depth on update: even though zod
  // strips unknown keys, we explicitly delete the field on member
  // updates so a body-injected value can't reassign authorship.
  if (c.actor.kind === "member") {
    if (c.operation === "create") {
      c.prepared.mainData.memberAuthorId = c.actor.memberId;
    } else {
      delete c.prepared.mainData.memberAuthorId;
    }
  }
  c.now = new Date();

  // Scheduled publishing: if the caller wants status=published but
  // publishedAt is in the future, demote to "scheduled" so the
  // public site doesn't render it until the scheduler flips it back.
  const desiredStatus = c.prepared.mainData.status as string | undefined;
  const publishedAtValue = c.prepared.mainData.publishedAt;
  if (
    desiredStatus === "published" &&
    publishedAtValue instanceof Date &&
    publishedAtValue > c.now
  ) {
    c.prepared.mainData.status = "scheduled";
  }

  // Phase 10.7 — weighted tsvector so titles outrank body
  // matches at query time.
  c.searchVector = buildWeightedSearchVectorSql(c.config, c.hookData);

  // Publish-transition tracking for content:beforePublish /
  // afterPublish / beforeUnpublish hooks. Status precedence:
  // explicit prepared status > original doc (on update) >
  // "published" default (on create).
  const nextStatus =
    (c.prepared.mainData.status as string | undefined) ??
    (c.operation === "update"
      ? ((c.originalDoc?.status as string | undefined) ?? "published")
      : "published");
  const previousStatus = c.originalDoc?.status as string | undefined;
  const wasPublished = previousStatus === "published";
  const willBePublished = nextStatus === "published";
  c.publishTransition = !wasPublished && willBePublished;
  c.unpublishTransition = wasPublished && !willBePublished;
}

/**
 * Concern 3 — fire publish-transition plugin hooks, then run the document
 * persistence inside one transaction (main row + child + join + media-ref +
 * revision). Returns the saved doc.
 */
async function persistDocumentTx(ctx: SaveContext): Promise<Record<string, unknown>> {
  if (ctx.publishTransition) {
    if (ctx.operation === "create") {
      await runHook("content:beforePublish", {
        collection: ctx.collection,
        documentId: null,
        document: ctx.hookData,
        originalDocument: null,
        operation: "create",
        source: "request",
        principal: ctx.principal,
      });
    } else {
      if (!ctx.docId || !ctx.originalDoc) {
        throw new Error(
          `Publish hook context for ${ctx.collection} is missing its original document.`,
        );
      }
      await runHook("content:beforePublish", {
        collection: ctx.collection,
        documentId: ctx.docId,
        document: ctx.hookData,
        originalDocument: ctx.originalDoc,
        operation: "update",
        source: "request",
        principal: ctx.principal,
      });
    }
  }
  if (ctx.unpublishTransition) {
    if (!ctx.docId || !ctx.originalDoc) {
      throw new Error(
        `Unpublish hook context for ${ctx.collection} is missing its original document.`,
      );
    }
    await runHook("content:beforeUnpublish", {
      collection: ctx.collection,
      documentId: ctx.docId,
      document: ctx.hookData,
      originalDocument: ctx.originalDoc,
      operation: "update",
      source: "request",
      principal: ctx.principal,
    });
  }

  // The whole persistence block runs against one tx — either the
  // caller's outer tx (when `options.tx` was threaded in) or a
  // private one opened here. Extracted into a `persist(tx)` local
  // so both branches share the body verbatim.
  const persist = async (tx: DrizzleTransactionLike): Promise<Record<string, unknown>> => {
    const persistedDoc: Record<string, unknown> =
      ctx.operation === "update"
        ? await updateMainDocument(
            tx,
            ctx.table,
            ctx.collection,
            ctx.docId,
            ctx.prepared.mainData,
            ctx.searchVector,
            ctx.config,
            ctx.userForHooks,
            ctx.now,
          )
        : await createMainDocument(
            tx,
            ctx.table,
            ctx.prepared.mainData,
            ctx.searchVector,
            ctx.config,
            ctx.userForHooks,
            ctx.now,
            ctx.options?.createId,
          );
    const persistedDocId = getRecordId(persistedDoc);

    await syncChildTables(tx, ctx.registration.childTables, ctx.prepared.childRows, persistedDocId);
    await syncJoinTables(tx, ctx.registration.joinTables, ctx.prepared.joinRows, persistedDocId);
    await syncMediaRefsForDocument(
      tx,
      ctx.collection,
      persistedDocId,
      ctx.config.fields,
      ctx.hookData,
    );

    // Slug-rename history. When a slug-having collection's row
    // changes its slug, write an `oldSlug → newSlug` record so
    // the public-site catch-all can 301 old URLs (search-engine
    // indices, external links, bookmarks) to the new path. Doing
    // this inside the same tx keeps the redirect map consistent
    // with the actual doc — half-applied state isn't possible.
    // Skipped on creates and on updates that don't change slug.
    if (
      ctx.operation === "update" &&
      ctx.config.slugField &&
      ctx.originalDoc &&
      typeof ctx.originalDoc.slug === "string" &&
      typeof persistedDoc.slug === "string" &&
      ctx.originalDoc.slug.length > 0 &&
      ctx.originalDoc.slug !== persistedDoc.slug
    ) {
      const siteId = (persistedDoc.siteId as string | undefined) ?? NP_DEFAULT_SITE_ID;
      await tx.insert(npSlugHistory).values({
        siteId,
        collection: ctx.collection,
        documentId: String(persistedDocId),
        oldSlug: ctx.originalDoc.slug,
        newSlug: persistedDoc.slug,
      });
    }

    if (ctx.config.versions) {
      const docStatus = persistedDoc.status as string | undefined;
      // "scheduled" documents haven't actually gone live yet — treat their
      // revisions as drafts (they map to the pre-publish snapshot).
      const revisionStatus = docStatus === "published" ? "published" : "draft";
      const maxRevisions =
        typeof ctx.config.versions === "object" && ctx.config.versions.max !== undefined
          ? ctx.config.versions.max
          : undefined;
      await insertRevision(
        tx,
        ctx.collection,
        persistedDocId,
        ctx.operation,
        ctx.hookData,
        ctx.originalDoc,
        ctx.userForHooks,
        revisionStatus,
        maxRevisions,
      );
    }

    const [hydrated] = await hydratePersistedDocuments(
      tx,
      ctx.registration,
      [persistedDoc],
      "write-result",
    );
    if (!hydrated) {
      throw new Error(`Saved ${ctx.collection} document could not be hydrated.`);
    }
    return hydrated;
  };

  if (ctx.outerTx) {
    return persist(ctx.outerTx);
  }
  return ctx.db.transaction(persist);
}

/**
 * Concern 4 — fire post-commit work: enqueue the
 * `content:afterSave` job, then `content:afterCreate` /
 * `content:afterUpdate` plugin hooks, plus `content:afterPublish`
 * on a publish transition. Each is wrapped in `runPostCommit` so
 * a hook error doesn't roll back the durable write.
 */
async function firePostCommitHooks(
  ctx: SaveContext,
  savedDoc: Record<string, unknown>,
): Promise<void> {
  const savedDocId = getRecordId(savedDoc);
  const siteId = requireDocumentSiteId(savedDoc, `Saved ${ctx.collection} document`);
  const postCommitCtx = {
    collection: ctx.collection,
    documentId: savedDocId,
    operation: ctx.operation,
  };

  await runPostCommit(
    `collection:${ctx.operation === "create" ? "afterCreate" : "afterUpdate"}`,
    postCommitCtx,
    async () => {
      await npRunCollectionDocumentResultHooks(
        ctx.config,
        ctx.operation === "create" ? ctx.config.hooks?.afterCreate : ctx.config.hooks?.afterUpdate,
        {
          data: savedDoc,
          user: ctx.userForHooks,
          principal: ctx.principal,
          collection: ctx.collection,
          originalDoc: ctx.originalDoc,
        },
        "write-result",
      );
    },
  );

  await runPostCommit("enqueue:content:afterSave", postCommitCtx, () =>
    enqueueJob("content:afterSave", {
      siteId,
      collection: ctx.collection,
      documentId: savedDocId,
      operation: ctx.operation,
      userId: actorUserId(ctx.actor),
      memberId: actorMemberId(ctx.actor),
    }),
  );

  if (ctx.operation === "create") {
    await runPostCommit("hook:content:afterCreate", postCommitCtx, () =>
      runHook("content:afterCreate", {
        collection: ctx.collection,
        documentId: savedDocId,
        document: savedDoc,
        originalDocument: null,
        operation: "create",
        source: "request",
        principal: ctx.principal,
      }),
    );
  } else {
    const originalDocument = ctx.originalDoc;
    if (!originalDocument) {
      throw new Error(
        `After-update hook context for ${ctx.collection} is missing its original document.`,
      );
    }
    await runPostCommit("hook:content:afterUpdate", postCommitCtx, () =>
      runHook("content:afterUpdate", {
        collection: ctx.collection,
        documentId: savedDocId,
        document: savedDoc,
        originalDocument,
        operation: "update",
        source: "request",
        principal: ctx.principal,
      }),
    );
  }
  if (ctx.publishTransition) {
    if (ctx.operation === "create") {
      await runPostCommit("hook:content:afterPublish", postCommitCtx, () =>
        runHook("content:afterPublish", {
          collection: ctx.collection,
          documentId: savedDocId,
          document: savedDoc,
          originalDocument: null,
          operation: "create",
          source: "request",
          principal: ctx.principal,
        }),
      );
    } else {
      const originalDocument = ctx.originalDoc;
      if (!originalDocument) {
        throw new Error(
          `After-publish hook context for ${ctx.collection} is missing its original document.`,
        );
      }
      await runPostCommit("hook:content:afterPublish", postCommitCtx, () =>
        runHook("content:afterPublish", {
          collection: ctx.collection,
          documentId: savedDocId,
          document: savedDoc,
          originalDocument,
          operation: "update",
          source: "request",
          principal: ctx.principal,
        }),
      );
    }
  }
}

async function saveDocumentImpl(
  collection: string,
  docId: string | null,
  data: Record<string, unknown>,
  actor: SaveActor,
  options?: NpSaveOptions,
): Promise<NpSaveResult> {
  const ctxBase = await initSaveContext(collection, docId, data, actor, options);
  await validateActorAccess(ctxBase as SaveContext);
  const ctx = ctxBase as SaveContext;
  await prepareDocumentForWrite(ctx);
  const savedDoc = await persistDocumentTx(ctx);
  await firePostCommitHooks(ctx, savedDoc);
  return { doc: savedDoc, operation: ctx.operation };
}

/**
 * Persist an in-flight editor snapshot as a revision **without** touching
 * the main document row. Designed for client-side autosave loops: the
 * editor sends every few seconds while the user types, and a crash mid-
 * edit can be recovered by restoring the latest autosave revision.
 *
 *  - Requires `versions.drafts` to be enabled on the collection.
 *  - Optionally gated by `versions.drafts.autosave === true` (when
 *    `versions` is the object form). Throws `NpValidationError` otherwise
 *    so the API can return a tidy 4xx instead of silently writing.
 *  - Skips the full zod validation that `saveDocument` runs — autosave
 *    payloads may be temporarily incomplete (the user is still typing).
 *  - Skips hooks, jobs, and revalidation: nothing is "saved" yet.
 *  - Deduplicates against the most recent autosave: if the snapshot is
 *    byte-identical to the previous autosave row, returns the existing
 *    summary instead of writing a new one. Avoids unbounded autosave
 *    rows during long idle edit sessions where react-hook-form fires
 *    spurious "change" events.
 */
export async function autosaveRevision(
  collection: string,
  documentId: string,
  data: Record<string, unknown>,
  user: NpAuthUser,
): Promise<{
  id: string;
  version: number;
  status: "autosave";
  createdAt: Date;
  reused: boolean;
}> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const snapshotResult = npAnalyzeRevisionSnapshot(data, config);
  if (!snapshotResult.ok) {
    throw new NpValidationError(
      "Invalid revision snapshot",
      snapshotResult.issues.map((entry) => ({ field: entry.path, message: entry.message })),
    );
  }
  const snapshot = snapshotResult.value;

  const drafts = config.versions?.drafts;
  if (!drafts) {
    throw new NpValidationError("Autosave not available", [
      {
        field: "collection",
        message: `Collection "${collection}" has versions.drafts disabled — autosave is unavailable.`,
      },
    ]);
  }
  // `drafts: true` opts in to drafts but stays silent on autosave; we
  // require an explicit `{ autosave: true }` to avoid surprising existing
  // collections with extra DB writes per keystroke.
  const autosaveEnabled = typeof drafts === "object" && drafts.autosave === true;
  if (!autosaveEnabled) {
    throw new NpValidationError("Autosave disabled", [
      {
        field: "collection",
        message: `Autosave is not enabled for "${collection}" — set versions.drafts.autosave = true.`,
      },
    ]);
  }

  const originalDoc = await getDocumentByIdInternal(db, registration, collection, documentId);
  if (!originalDoc) {
    throw new NpNotFoundError(collection, documentId);
  }

  // Reuse the same access gate `saveDocument` runs for an update — autosave
  // is a write, even if it only lands in np_revisions.
  await assertWriteAccess(config, collection, "update", user, data, originalDoc);

  const maxRevisions =
    typeof config.versions === "object" && config.versions.max !== undefined
      ? config.versions.max
      : undefined;

  const inserted = await db.transaction(async (tx) => {
    // Serialize all revision writers for this document. Without the row
    // lock two concurrent autosaves can allocate the same next version.
    await tx
      .select({ id: getTableColumn(table, "id") })
      .from(table)
      .where(eq(getTableColumn(table, "id"), documentId))
      .limit(1)
      .for("update");

    const [latestAutosave] = (await tx
      .select({
        id: npRevisions.id,
        version: npRevisions.version,
        snapshot: npRevisions.snapshot,
        createdAt: npRevisions.createdAt,
      })
      .from(npRevisions)
      .where(
        sql`${eq(npRevisions.collection, collection)} and ${eq(npRevisions.documentId, documentId)} and ${eq(npRevisions.status, "autosave")}`,
      )
      .orderBy(desc(npRevisions.version))
      .limit(1)) as Array<{
      id: string;
      version: number;
      snapshot: unknown;
      createdAt: Date;
    }>;
    if (latestAutosave) {
      const persisted = npAnalyzeRevisionSnapshot(latestAutosave.snapshot, config);
      if (!persisted.ok) {
        throw new NpRevisionContractError("Invalid persisted revision snapshot", persisted.issues);
      }
      if (npRevisionSnapshotKey(persisted.value) === npRevisionSnapshotKey(snapshot)) {
        return {
          id: latestAutosave.id,
          version: latestAutosave.version,
          createdAt: latestAutosave.createdAt,
          reused: true,
        };
      }
    }

    const [revisionStats] = (await tx
      .select({ total: count(), maxVersion: max(npRevisions.version) })
      .from(npRevisions)
      .where(
        sql`${eq(npRevisions.collection, collection)} and ${eq(npRevisions.documentId, documentId)}`,
      )) as Array<{ total: number | string; maxVersion: number | string | null }>;
    const nextVersion = Number(revisionStats?.maxVersion ?? 0) + 1;
    const createdAt = new Date();

    const [row] = (await tx
      .insert(npRevisions)
      .values({
        collection,
        documentId,
        version: nextVersion,
        status: "autosave",
        snapshot,
        changedFields: getChangedFields(snapshot, originalDoc, "update"),
        authorId: user.id,
        createdAt,
      })
      .returning()) as Array<{ id: string }>;
    if (!row?.id) throw new Error("Revision insert did not return an id");

    if (maxRevisions !== undefined && maxRevisions > 0) {
      const overflow = Number(revisionStats?.total ?? 0) + 1 - maxRevisions;
      if (overflow > 0) {
        const toDelete = (await tx
          .select({ id: npRevisions.id })
          .from(npRevisions)
          .where(
            sql`${eq(npRevisions.collection, collection)} and ${eq(npRevisions.documentId, documentId)}`,
          )
          .orderBy(asc(npRevisions.version))
          .limit(overflow)) as Array<{ id: string }>;
        if (toDelete.length > 0) {
          const ids = toDelete.map((r) => r.id);
          await tx.delete(npRevisions).where(inArray(npRevisions.id, ids));
        }
      }
    }

    return { id: row.id, version: nextVersion, createdAt, reused: false };
  });
  // `registration` reference silences the unused-binding lint; we keep
  // the lookup early so misconfigured collections fail fast.
  void registration;

  return { ...inserted, status: "autosave" };
}

export async function deleteDocument(
  collection: string,
  docId: string,
  user: NpAuthUser,
  options?: { tx?: NpTransaction },
): Promise<void> {
  return deleteDocumentImpl(collection, docId, { kind: "staff", user }, options);
}

/**
 * Member-side delete. Owner-only — the existing row's
 * `member_author_id` must match the caller. Fires
 * `document.deleted` reputation event so adapters can debit the
 * author the same way `comment.deleted` debits commenters.
 *
 * The reputation event is gated on the row's status at delete
 * time: only `published` docs ever earned a `document.created`
 * credit (the create path withholds it for pending rows; promote
 * later backfills the credit). Issuing a `document.deleted`
 * debit for a row that was never credited would drive the
 * member negative for deleting their own not-yet-visible
 * content (#126). The audit row is unconditional — the operator
 * still wants to see "member deleted X".
 */
export async function deleteMemberDocument(
  collection: string,
  docId: string,
  memberId: string,
): Promise<void> {
  // Read the current status BEFORE delete so we know whether a
  // `document.created` credit was ever granted. `deleteDocumentImpl`
  // also looks the row up internally, so this is a small redundant
  // SELECT — but the alternative (returning status from the impl)
  // would change a private API for one caller. Fine to repeat.
  const registration = getCollectionRegistration(collection);
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const original = await getDocumentByIdInternal(db, registration, collection, docId);
  const wasPublished =
    typeof (original as { status?: unknown } | null)?.status === "string" &&
    (original as { status: string }).status === "published";

  await deleteDocumentImpl(collection, docId, { kind: "member", memberId });
  const { applyReputation } = await import("../community/reputation.js");
  const { recordAuditEvent } = await import("../community/audit.js");
  await recordAuditEvent({
    actor: { kind: "member", memberId },
    action: "document.delete",
    targetType: collection,
    targetId: docId,
    payload: {
      collectionSlug: collection,
      // Capture the status that was in effect at delete time so a
      // mod re-reading the audit log can tell "they deleted a
      // pending submission" from "they retracted a published
      // post."
      previousStatus:
        typeof (original as { status?: unknown } | null)?.status === "string"
          ? (original as { status: string }).status
          : null,
    },
  });
  if (wasPublished) {
    await applyReputation(memberId, {
      kind: "document.deleted",
      collectionSlug: collection,
      documentId: docId,
      memberId,
    });
  }
}

/**
 * Staff promotion of a member-authored `pending` row to `published`
 * (Phase 9.7d). Closes the loop on the 9.7c moderation gate:
 *   - the row's status flips to `published` (visible on the public
 *     site immediately)
 *   - the deferred `document.created` reputation event fires now,
 *     crediting the author for content that was held in review
 *     (mirrors how a comment promoted from `pending` would, in a
 *     hypothetical comment-promote API — not implemented yet)
 *   - audit log records `document.promote` with the staff actor
 *     and the original member author in the payload
 *
 * Guards:
 *   - 404 if the row doesn't exist
 *   - 400 (validation) if the row isn't currently `pending`
 *   - 400 (validation) if the row isn't member-authored
 *     (`member_author_id` is null) — staff drafts use the standard
 *     edit path
 *
 * Idempotence: a second promote on an already-`published` row 400s
 * rather than silently no-op'ing — the audit trail and reputation
 * backfill must run exactly once per row.
 */
export async function promoteMemberDocument(
  collection: string,
  docId: string,
  staffUserId: string,
): Promise<NpSaveResult> {
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(db, registration, collection, docId);
  if (!originalDoc) {
    throw new NpNotFoundError(collection, docId);
  }
  const status = (originalDoc as { status?: string }).status;
  if (status !== "pending") {
    throw new NpValidationError("Invalid input", [
      {
        field: "status",
        message: `Cannot promote: document is ${status ?? "unknown"}, expected pending`,
      },
    ]);
  }
  const memberAuthorId = (originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
  if (!memberAuthorId) {
    throw new NpValidationError("Invalid input", [
      {
        field: "memberAuthorId",
        message: "Cannot promote: document is not member-authored",
      },
    ]);
  }

  // Conditional UPDATE on `status = 'pending'`. Two mods racing to
  // promote the same row would each pass the read-side check above
  // and each fire the audit + reputation events; conditioning on
  // status here means the second UPDATE returns zero rows and we
  // surface that as 400 — the row already moved on, no second
  // event-fire. Same pattern protects against an interleaved staff
  // PATCH that ran between our read and our write.
  //
  // Issue #367 — also pin `siteId` in the predicate. The read-side
  // `getDocumentByIdInternal` already enforced the site match, but
  // including siteId in the WHERE means even a stale resolver value
  // between the load and the update can't promote the wrong row.
  const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const now = new Date();
  const updated = (await db
    .update(table)
    .set({ status: "published", updatedAt: now, updatedBy: staffUserId })
    .where(
      sql`${eq(getTableColumn(table, "id"), docId)} and ${eq(getTableColumn(table, "status"), "pending")} and ${eq(getTableColumn(table, "siteId"), requestSiteId)}`,
    )
    .returning()) as Array<Record<string, unknown>>;
  if (updated.length === 0) {
    // Either a concurrent promote already flipped this row, or
    // staff edited it out of `pending` between our read and our
    // write. Surface as a validation error — the caller should
    // re-fetch and retry only if they still want to act.
    throw new NpValidationError("Invalid input", [
      {
        field: "status",
        message: "Cannot promote: row is no longer pending (concurrent change)",
      },
    ]);
  }
  const [persistedDoc] = await hydratePersistedDocuments(
    db,
    registration,
    [toRecord(updated[0])],
    "write-result",
  );
  if (!persistedDoc) throw new Error(`Promoted ${collection} document could not be hydrated.`);

  const { applyReputation } = await import("../community/reputation.js");
  const { recordAuditEvent } = await import("../community/audit.js");
  await recordAuditEvent({
    actor: { kind: "staff", userId: staffUserId },
    action: "document.promote",
    targetType: collection,
    targetId: docId,
    payload: {
      collectionSlug: collection,
      memberAuthorId,
      previousStatus: "pending",
    },
  });
  // Backfill the reputation credit that was withheld at create time
  // when status landed as pending. The adapter sees the same event
  // shape as a fresh member create — adapters that key off creation
  // time should consult the audit log, not infer from the event.
  await applyReputation(memberAuthorId, {
    kind: "document.created",
    collectionSlug: collection,
    documentId: docId,
    memberId: memberAuthorId,
  });

  return { doc: persistedDoc, operation: "update" };
}

async function deleteDocumentImpl(
  collection: string,
  docId: string,
  actor: SaveActor,
  options?: { tx?: NpTransaction },
): Promise<void> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  // When the caller threads an outer transaction (e.g. the
  // seed-content wipe loop wrapping every row in one tx), use
  // that handle for the existence read AND the cascade — so the
  // read sees the tx's own pending deletes and the cascade
  // commits/rolls back as part of the outer scope. Without an
  // outer tx, fall back to the singleton pool handle and open a
  // private tx for the cascade (current behavior).
  const dbHandle = (options?.tx ?? getDb()) as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(dbHandle, registration, collection, docId);

  // Without this guard the call returns success for non-existent ids:
  // hooks fire with `originalDoc = null`, the DELETE matches zero rows,
  // and the route returns 204. Bulk delete then records phantom ids as
  // succeeded. (#59)
  if (!originalDoc) {
    throw new NpNotFoundError(collection, docId);
  }
  const siteId = requireDocumentSiteId(originalDoc, `Persisted ${collection} document`);

  if (actor.kind === "staff") {
    if (config.access?.delete) {
      const allowed = await config.access.delete({ user: actor.user, doc: originalDoc });
      if (!allowed) {
        throw new NpForbiddenError(collection, "delete");
      }
    }
  } else {
    // Member delete: opt-in flag plus owner check plus ban check.
    if (!config.community?.memberWrite?.delete) {
      throw new NpForbiddenError(collection, "delete");
    }
    const authorId = (originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
    if (authorId !== actor.memberId) {
      throw new NpForbiddenError(collection, "delete");
    }
    const { assertNotBanned } = await import("../community/can.js");
    await assertNotBanned(actor.memberId);
  }

  const userForHooks = actorUserOrNull(actor);
  const principal = actorPrincipal(actor);
  const deleteDoc = await npRunCollectionDocumentResultHooks(
    config,
    config.hooks?.beforeDelete,
    {
      data: originalDoc,
      user: userForHooks,
      principal,
      collection,
      originalDoc,
    },
    "write-result",
  );

  await runHook("content:beforeDelete", {
    collection,
    documentId: docId,
    document: deleteDoc,
    originalDocument: null,
    operation: "delete",
    source: "request",
    principal,
  });

  const cascade = async (tx: DrizzleTransactionLike): Promise<void> => {
    await deleteChildTables(tx, registration.childTables, docId);
    await deleteJoinTables(tx, registration.joinTables, docId);
    await tx
      .delete(npMediaRefs)
      .where(
        sql`${eq(getTableColumn(npMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(npMediaRefs as unknown as PgTable, "documentId"), docId)}`,
      );
    // Phase 9.7m: cascade comments + reactions on the deleted doc.
    // The polymorphic `(target_type, target_id)` shape on
    // `np_comments` / `np_reactions` doesn't have a DB-level FK
    // (it can't — the target table varies per row), so without an
    // explicit cleanup these rows would orphan once the parent
    // doc was gone. Order matters: reactions targeting the comments
    // (`target_type='comment'`) must go before the comments
    // themselves, since after the comment rows are gone we can't
    // discover their ids anymore. Top-level comments and replies
    // both carry `target_id=$docId`, so a single SELECT covers both.
    const commentIdRows = (await tx
      .select({
        id: getTableColumn(npComments, "id"),
      })
      .from(npComments)
      .where(
        sql`${eq(getTableColumn(npComments as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(npComments as unknown as PgTable, "targetId"), docId)}`,
      )) as Array<{ id: string }>;
    if (commentIdRows.length > 0) {
      const commentIds = commentIdRows.map((row) => row.id);
      await tx
        .delete(npReactions)
        .where(
          sql`${eq(getTableColumn(npReactions as unknown as PgTable, "targetType"), "comment")} and ${inArray(getTableColumn(npReactions as unknown as PgTable, "targetId"), commentIds)}`,
        );
      // Phase 9.7q: same orphan story for `np_reports` — a member
      // who reported one of these comments would otherwise be left
      // with a row pointing at a non-existent comment id. The
      // existing audit row carries enough context for after-the-
      // fact tracing, so the report itself can go.
      await tx
        .delete(npReports)
        .where(
          sql`${eq(getTableColumn(npReports as unknown as PgTable, "targetType"), "comment")} and ${inArray(getTableColumn(npReports as unknown as PgTable, "targetId"), commentIds)}`,
        );
    }
    await tx
      .delete(npComments)
      .where(
        sql`${eq(getTableColumn(npComments as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(npComments as unknown as PgTable, "targetId"), docId)}`,
      );
    await tx
      .delete(npReactions)
      .where(
        sql`${eq(getTableColumn(npReactions as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(npReactions as unknown as PgTable, "targetId"), docId)}`,
      );
    // Doc-level reports (sites that file `target_type=$collection`
    // reports against a post / discussion). The shipped report API
    // today only files against comments + members, but the schema
    // is polymorphic — a future surface could add doc-level reports
    // and this cascade keeps that case correct from day one.
    await tx
      .delete(npReports)
      .where(
        sql`${eq(getTableColumn(npReports as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(npReports as unknown as PgTable, "targetId"), docId)}`,
      );
    await tx
      .delete(npRevisions)
      .where(
        sql`${eq(npRevisions.collection, collection)} and ${eq(npRevisions.documentId, docId)}`,
      );
    await tx.delete(table).where(eq(getTableColumn(table, "id"), docId));
  };

  if (options?.tx) {
    // Already inside a caller-owned transaction — run the cascade
    // against it directly. No nested savepoint; the outer tx
    // commits/rolls back as a unit.
    await cascade(options.tx);
  } else {
    await dbHandle.transaction(cascade);
  }

  const postCommitCtx = { collection, documentId: docId, operation: "delete" };
  await runPostCommit("collection:afterDelete", postCommitCtx, async () => {
    await npRunCollectionDocumentResultHooks(
      config,
      config.hooks?.afterDelete,
      {
        data: deleteDoc,
        user: userForHooks,
        principal,
        collection,
        originalDoc,
      },
      "write-result",
    );
  });
  await runPostCommit("enqueue:content:afterDelete", postCommitCtx, () =>
    enqueueJob("content:afterDelete", {
      siteId,
      collection,
      documentId: docId,
      userId: actorUserId(actor),
      memberId: actorMemberId(actor),
    }),
  );

  await runPostCommit("hook:content:afterDelete", postCommitCtx, () =>
    runHook("content:afterDelete", {
      collection,
      documentId: docId,
      document: deleteDoc,
      originalDocument: null,
      operation: "delete",
      source: "request",
      principal,
    }),
  );
}

export async function findDocuments<T extends object = Record<string, unknown>>(
  collection: string,
  options: NpFindOptions<NoInfer<T>>,
  user?: NpAuthUser,
): Promise<NpFindResult<T>> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const normalizedOptions = npRequireCollectionFindOptions(options, config, {
    maximumLimit: 10_000,
    allowSystemWildcards: true,
  });
  const page = normalizedOptions.page ?? 1;
  const limit = normalizedOptions.limit ?? 10;
  const offset = (page - 1) * limit;

  await assertReadAccess(config, collection, user ?? null);

  // i18n collections honor the top-level `locale` option as an
  // additional `locale = $1` filter. The canonical find contract
  // rejects locale before this point for non-i18n collections.
  let effectiveWhere: Record<string, unknown> = normalizedOptions.where ?? {};
  if (config.i18n && normalizedOptions.locale) {
    effectiveWhere = { ...effectiveWhere, locale: normalizedOptions.locale };
  }

  // Phase 15.2 — multi-site scoping. Reads filter by the
  // resolved site id so cross-site content can't leak. The
  // resolver returns null in non-request contexts (workers,
  // scripts, tests with no resolver wired) — those default
  // to the framework's `default` site. Callers that want
  // cross-site reads (super-admin search, bulk export) can
  // pass `siteId: "*"` or override `where.siteId` directly,
  // which the dedicated where-clause builder forwards as-is.
  if (effectiveWhere.siteId === undefined) {
    const resolved = await getCurrentSiteId();
    effectiveWhere = {
      ...effectiveWhere,
      siteId: resolved ?? NP_DEFAULT_SITE_ID,
    };
  } else if (effectiveWhere.siteId === "*") {
    // Sentinel: drop the filter entirely (admin-side
    // cross-site queries).
    const { siteId: _siteId, ...rest } = effectiveWhere;
    void _siteId;
    effectiveWhere = rest;
  }

  // Phase 21.17 — per-doc visibility filter. Anonymous reads
  // (no `user` argument, e.g. site-side `findDocuments` from
  // the catch-all renderer or the sitemap) auto-restrict to
  // `visibility = "public"` so a private row never leaks to
  // a crawler / unauthenticated visitor. Authenticated
  // principals (any signed-in member or staff) see both
  // public and private — matching WordPress's "logged-in
  // users see private posts" semantics. Callers that want
  // explicit control (admin queries, bulk export) pass
  // `where.visibility` and bypass the gate.
  if (effectiveWhere.visibility === undefined && !user) {
    effectiveWhere = { ...effectiveWhere, visibility: "public" };
  } else if (effectiveWhere.visibility === "*") {
    const { visibility: _vis, ...rest } = effectiveWhere;
    void _vis;
    effectiveWhere = rest;
  }

  effectiveWhere = await resolveHasManyWhere(db, registration, effectiveWhere);

  const effectiveOptions: NpFindOptions = {
    ...normalizedOptions,
    where: effectiveWhere,
  };
  const conditions = buildQueryConditions(table, effectiveOptions);
  const whereClause = combineConditions(conditions);

  const storageRows = await executeFindQuery(
    db,
    table,
    normalizedOptions,
    whereClause,
    limit,
    offset,
  );
  const hydratedDocs = await hydratePersistedDocuments(db, registration, storageRows, "read");
  const docs: Record<string, unknown>[] = [];
  for (const document of hydratedDocs) {
    docs.push(await runReadHooks(config, document, user ?? null));
  }
  const totalResult = (await (whereClause
    ? db.select({ total: count() }).from(table).where(whereClause)
    : db.select({ total: count() }).from(table).limit(1))) as Array<{ total: number | string }>;
  const totalDocs = Number(totalResult[0]?.total ?? 0);
  if (!Number.isSafeInteger(totalDocs) || totalDocs < 0) {
    throw new NpCollectionContractError("Invalid collection count result", [
      {
        code: "invalid-field",
        path: "result.totalDocs",
        message: "must be a non-negative safe integer.",
      },
    ]);
  }
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

  return npRequireCollectionFindResult<T>(
    {
      docs: docs as unknown as T[],
      totalDocs,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1 && totalDocs > 0,
    },
    config,
  );
}

export async function getDocumentById<T extends object = Record<string, unknown>>(
  collection: string,
  id: string,
  user?: NpAuthUser,
): Promise<T | null> {
  const config = getCollectionConfig(collection);
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const registration = getCollectionRegistration(collection);
  const doc = await getDocumentByIdOptional(db, registration, id);

  if (!doc) {
    return null;
  }

  // Issue #367 — even read-by-id has to honor the tenant boundary
  // before access.read fires. A site A caller naming a site B doc
  // must not get a site B read decision back. Throw `Forbidden
  // cross-site` to match the existing pattern callers (e.g.
  // createComment, the sister-PR community fixes #362–#364) already
  // assert against.
  const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const docSiteId =
    typeof doc.siteId === "string" && doc.siteId.length > 0 ? doc.siteId : NP_DEFAULT_SITE_ID;
  if (docSiteId !== requestSiteId) {
    throw new NpForbiddenError(collection, "cross-site");
  }

  if (config.access?.read) {
    const allowed = await config.access.read({ user: user ?? null, doc });
    if (!allowed) {
      throw new NpForbiddenError(collection, "read");
    }
  }

  return (await runReadHooks(config, doc, user ?? null)) as unknown as T;
}

/** Framework-host scheduler/worker boundary: hydrate an exact stored document without read hooks. */
export async function npGetPersistedCollectionDocumentById(
  collection: string,
  id: string,
  siteId: string,
): Promise<Record<string, unknown> | null> {
  if (!npIsCanonicalSiteId(siteId)) {
    throw new NpValidationError("Invalid collection document site", [
      { field: "siteId", message: "Must be a canonical site id" },
    ]);
  }
  const registration = getCollectionRegistration(collection);
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const document = await getDocumentByIdOptional(db, registration, id, "write-result");
  if (document && document.siteId !== siteId) {
    throw new NpForbiddenError(collection, "cross-site");
  }
  return document;
}

/** Framework-host bulk identity boundary used by content-transfer preflight. */
export async function npGetPersistedCollectionDocumentIds(
  collection: string,
  ids: readonly string[],
  siteId: string,
): Promise<string[]> {
  if (!npIsCanonicalSiteId(siteId)) {
    throw new NpValidationError("Invalid collection document site", [
      { field: "siteId", message: "Must be a canonical site id" },
    ]);
  }
  if (ids.length > 10_000) {
    throw new NpValidationError("Invalid collection document ids", [
      { field: "ids", message: "At most 10000 document ids may be inspected at once." },
    ]);
  }
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    if (!isCanonicalCreateId(id)) {
      throw new NpValidationError("Invalid collection document ids", [
        { field: `ids.${index.toString()}`, message: "Must be a canonical UUID." },
      ]);
    }
    if (seen.has(id)) {
      throw new NpValidationError("Invalid collection document ids", [
        { field: `ids.${index.toString()}`, message: "Document id must be unique." },
      ]);
    }
    seen.add(id);
  }
  if (ids.length === 0) return [];

  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const rows = (await db
    .select({
      id: getTableColumn(table, "id"),
      siteId: getTableColumn(table, "siteId"),
    })
    .from(table)
    .where(inArray(getTableColumn(table, "id"), [...ids]))) as Array<{
    id: unknown;
    siteId: unknown;
  }>;
  for (const row of rows) {
    if (row.siteId !== siteId) throw new NpForbiddenError(collection, "cross-site");
  }
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string")
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function assertWriteAccess(
  config: NpCollectionConfig,
  collection: string,
  operation: NpSaveResult["operation"],
  user: NpAuthUser,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
): Promise<void> {
  const access = operation === "create" ? config.access?.create : config.access?.update;

  if (!access) {
    return;
  }

  const allowed = await access({ user, doc: originalDoc ?? undefined, data });

  if (!allowed) {
    throw new NpForbiddenError(collection, operation);
  }
}

async function assertReadAccess(
  config: NpCollectionConfig,
  collection: string,
  user: NpAuthUser | null,
): Promise<void> {
  if (!config.access?.read) {
    return;
  }

  const allowed = await config.access.read({ user });

  if (!allowed) {
    throw new NpForbiddenError(collection, "read");
  }
}

async function runHooks(
  hooks: NpCollectionHook[] | undefined,
  args: Parameters<NpCollectionHook>[0],
): Promise<Record<string, unknown>> {
  let nextData = args.data;

  for (const hook of hooks ?? []) {
    nextData = await hook({
      ...args,
      data: nextData,
    });
  }

  return nextData;
}

export async function npRunCollectionDocumentResultHooks(
  config: NpCollectionConfig,
  hooks: NpCollectionHook[] | undefined,
  args: Parameters<NpCollectionHook>[0],
  operation: "read" | "write-result",
): Promise<Record<string, unknown>> {
  try {
    const value = await runHooks(hooks, args);
    return npRequireCollectionDocument(value, config);
  } catch (error) {
    npRecordCollectionRuntimeDiagnostic(
      config.slug,
      operation === "read" ? "read" : "hook-result",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

async function runReadHooks(
  config: NpCollectionConfig,
  document: Record<string, unknown>,
  user: NpAuthUser | null,
): Promise<Record<string, unknown>> {
  const principal: NpHookPrincipal | null = user ? { kind: "staff", user } : null;
  const before = await npRunCollectionDocumentResultHooks(
    config,
    config.hooks?.beforeRead,
    {
      data: document,
      user,
      principal,
      collection: config.slug,
      originalDoc: document,
    },
    "read",
  );
  return npRunCollectionDocumentResultHooks(
    config,
    config.hooks?.afterRead,
    {
      data: before,
      user,
      principal,
      collection: config.slug,
      originalDoc: document,
    },
    "read",
  );
}

async function createMainDocument(
  tx: DrizzleTransactionLike,
  table: PgTable,
  mainData: Record<string, unknown>,
  searchVectorSql: SQL,
  config: NpCollectionConfig,
  user: NpAuthUser | null,
  now: Date,
  createId?: string,
): Promise<Record<string, unknown>> {
  // Member writes (`user === null`) leave `createdBy` / `updatedBy`
  // unset so the FK to `np_users` stays null. The audit log captures
  // the actual member; readers that need authorship for member-
  // authored docs should join through the dedicated `member_author_id`
  // column (codegen'd onto every collection that opts into
  // `community.memberWrite.create`).
  const values: Record<string, unknown> = {
    id: createId ?? randomUUID(),
    status: "published",
    ...mainData,
    createdBy: user?.id ?? null,
    updatedBy: user?.id ?? null,
    // Phase 10.7 — composed setweight() tsvector so titles
    // outrank body matches at query time. The 11.x
    // to_tsvector wrap (so colon-containing content doesn't
    // crash the cast) is preserved inside each setweight call
    // by buildWeightedSearchVectorSql.
    searchVector: searchVectorSql,
  };

  if (config.timestamps !== false) {
    values.createdAt = now;
    values.updatedAt = now;
  }

  const [created] = await tx.insert(table).values(values).returning();

  return toRecord(created);
}

async function updateMainDocument(
  tx: DrizzleTransactionLike,
  table: PgTable,
  collection: string,
  docId: string | null,
  mainData: Record<string, unknown>,
  searchVectorSql: SQL,
  config: NpCollectionConfig,
  user: NpAuthUser | null,
  now: Date,
): Promise<Record<string, unknown>> {
  if (!docId) {
    throw new NpNotFoundError(collection, "unknown");
  }

  const values: Record<string, unknown> = {
    ...mainData,
    updatedBy: user?.id ?? null,
    // Phase 10.7 — see createMainDocument: weighted setweight()
    // tsvector preserves the 11.x to_tsvector safety AND adds
    // title boost.
    searchVector: searchVectorSql,
  };

  if (config.timestamps !== false) {
    values.updatedAt = now;
  }

  const [updated] = await tx
    .update(table)
    .set(values)
    .where(eq(getTableColumn(table, "id"), docId))
    .returning();

  if (!updated) {
    throw new NpNotFoundError(collection, docId);
  }

  return toRecord(updated);
}

async function syncChildTables(
  tx: DrizzleTransactionLike,
  childTables: Record<string, unknown> | undefined,
  childRows: Record<string, Record<string, unknown>[]>,
  documentId: string,
): Promise<void> {
  for (const [fieldPath, rows] of Object.entries(childRows)) {
    const table = resolveRelatedTable(childTables, fieldPath);

    if (!table) {
      continue;
    }

    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));

    if (rows.length === 0) {
      continue;
    }

    const values = rows.map((row, index) => ({
      id: randomUUID(),
      ...row,
      [parentColumnName]: documentId,
      order: index,
    }));

    await tx.insert(pgTable).values(values);
  }
}

async function syncJoinTables(
  tx: DrizzleTransactionLike,
  joinTables: Record<string, unknown> | undefined,
  joinRows: Record<string, string[]>,
  documentId: string,
): Promise<void> {
  for (const [fieldPath, ids] of Object.entries(joinRows)) {
    const table = resolveRelatedTable(joinTables, fieldPath);

    if (!table) {
      continue;
    }

    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));

    if (ids.length === 0) {
      continue;
    }

    const values = ids.map((targetId, index) => ({
      id: randomUUID(),
      [parentColumnName]: documentId,
      targetId,
      order: index,
    }));

    await tx.insert(pgTable).values(values);
  }
}

async function deleteChildTables(
  tx: DrizzleTransactionLike,
  childTables: Record<string, unknown> | undefined,
  documentId: string,
): Promise<void> {
  for (const table of Object.values(childTables ?? {})) {
    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));
  }
}

async function deleteJoinTables(
  tx: DrizzleTransactionLike,
  joinTables: Record<string, unknown> | undefined,
  documentId: string,
): Promise<void> {
  for (const table of Object.values(joinTables ?? {})) {
    const pgTable = table as PgTable;
    const parentColumnName = findParentColumnName(pgTable, ["parentId"]);
    await tx.delete(pgTable).where(eq(getTableColumn(pgTable, parentColumnName), documentId));
  }
}

async function insertRevision(
  tx: DrizzleTransactionLike,
  collection: string,
  documentId: string,
  operation: NpSaveResult["operation"],
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  user: NpAuthUser | null,
  status: string,
  maxRevisions?: number,
): Promise<void> {
  const revisionConditions = sql`${eq(npRevisions.collection, collection)} and ${eq(npRevisions.documentId, documentId)}`;
  const snapshotResult = npAnalyzeRevisionSnapshot(data, getCollectionConfig(collection));
  if (!snapshotResult.ok) {
    throw new NpValidationError(
      "Invalid revision snapshot",
      snapshotResult.issues.map((entry) => ({ field: entry.path, message: entry.message })),
    );
  }
  const snapshot = snapshotResult.value;
  const [revisionStats] = (await tx
    .select({ total: count(), maxVersion: max(npRevisions.version) })
    .from(npRevisions)
    .where(revisionConditions)) as Array<{
    total: number | string;
    maxVersion: number | string | null;
  }>;

  await tx.insert(npRevisions).values({
    collection,
    documentId,
    version: Number(revisionStats?.maxVersion ?? 0) + 1,
    status,
    snapshot,
    changedFields: getChangedFields(snapshot, originalDoc, operation),
    // `authorId` references np_users; member-authored revisions
    // store null and the audit log carries the actual member id.
    authorId: user?.id ?? null,
    createdAt: new Date(),
  });

  // Enforce versions.max: drop the oldest revisions so this doc never
  // accumulates more than `maxRevisions` rows. Runs in the same tx as the
  // insert so the row count is stable against races.
  if (maxRevisions !== undefined && maxRevisions > 0) {
    const currentCount = Number(revisionStats?.total ?? 0) + 1;
    const overflow = currentCount - maxRevisions;
    if (overflow > 0) {
      // Select the oldest `overflow` revision ids and delete them. Postgres
      // doesn't support DELETE with LIMIT directly but `id IN (subquery)`
      // works fine.
      const toDelete = (await tx
        .select({ id: npRevisions.id })
        .from(npRevisions)
        .where(revisionConditions)
        .orderBy(asc(npRevisions.version))
        .limit(overflow)) as Array<{ id: string }>;

      if (toDelete.length > 0) {
        const ids = toDelete.map((r) => r.id);
        await tx.delete(npRevisions).where(inArray(npRevisions.id, ids));
      }
    }
  }
}

function collectTopLevelHasManyFields(fields: readonly NpFieldConfig[]): string[] {
  return fields.flatMap((field) => {
    if (field.type === "row" || field.type === "collapsible") {
      return collectTopLevelHasManyFields(field.fields);
    }
    return field.type === "relationship" && field.hasMany ? [field.name] : [];
  });
}

async function resolveHasManyWhere(
  db: DrizzleTransactionLike,
  registration: ReturnType<typeof getCollectionRegistration>,
  where: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved = { ...where };
  let matchingIds: string[] | null = null;
  for (const field of collectTopLevelHasManyFields(registration.config.fields)) {
    const candidate = resolved[field];
    if (candidate === undefined) continue;
    delete resolved[field];
    const targets = (Array.isArray(candidate) ? candidate : [candidate]).filter(
      (value): value is string => typeof value === "string",
    );
    if (targets.length === 0) {
      matchingIds = [];
      continue;
    }
    const tableValue = registration.joinTables?.[field];
    if (!tableValue) {
      throw new NpCollectionContractError("Invalid collection registration", [
        {
          code: "invariant",
          path: `collection.${registration.config.slug}.joinTables.${field}`,
          message: "is required for a hasMany relationship field.",
        },
      ]);
    }
    const table = tableValue as PgTable;
    const parentColumnName = findParentColumnName(table, ["parentId"]);
    const rows = (await db
      .select({ id: getTableColumn(table, parentColumnName) })
      .from(table)
      .where(inArray(getTableColumn(table, "targetId"), targets))) as Array<{ id: unknown }>;
    const ids = [...new Set(rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : [])))];
    if (matchingIds === null) {
      matchingIds = ids;
    } else {
      const allowed = new Set(ids);
      matchingIds = matchingIds.filter((id) => allowed.has(id));
    }
  }
  if (matchingIds !== null) {
    const existing = resolved.id;
    if (typeof existing === "string")
      matchingIds = matchingIds.includes(existing) ? [existing] : [];
    else if (Array.isArray(existing)) {
      const allowed = new Set(
        existing.filter((value): value is string => typeof value === "string"),
      );
      matchingIds = matchingIds.filter((id) => allowed.has(id));
    }
    resolved.id = matchingIds;
  }
  return resolved;
}

function buildQueryConditions(table: PgTable, options: NpFindOptions): QueryCondition[] {
  const conditions: QueryCondition[] = [];

  if (options.where) {
    for (const [field, value] of Object.entries(options.where)) {
      if (value === undefined) {
        continue;
      }

      // Array values → `IN (...)`. Empty array means "match
      // nothing" — emit a tautologically-false condition so the
      // overall query short-circuits to zero rows. (Without this
      // guard, Drizzle's `inArray(col, [])` produces `col IN ()`,
      // which Postgres rejects with a syntax error.)
      if (Array.isArray(value)) {
        if (value.length === 0) {
          conditions.push(sql`false`);
        } else {
          conditions.push(inArray(getTableColumn(table, field), value));
        }
        continue;
      }

      conditions.push(eq(getTableColumn(table, field), value));
    }
  }

  if (options.search) {
    conditions.push(
      sql`${getTableColumn(table, "searchVector")} @@ plainto_tsquery('english', ${options.search})`,
    );
  }

  return conditions;
}

async function executeFindQuery(
  db: DrizzleDatabaseLike,
  table: PgTable,
  options: NpFindOptions,
  whereClause: ReturnType<typeof sql> | undefined,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  if (options.search) {
    const query = whereClause
      ? db
          .select()
          .from(table)
          .where(whereClause)
          .orderBy(
            sql`ts_rank(${getTableColumn(table, "searchVector")}, plainto_tsquery('english', ${options.search})) DESC`,
          )
          .limit(limit)
          .offset(offset)
      : db
          .select()
          .from(table)
          .orderBy(
            sql`ts_rank(${getTableColumn(table, "searchVector")}, plainto_tsquery('english', ${options.search})) DESC`,
          )
          .limit(limit)
          .offset(offset);

    return (await query) as Record<string, unknown>[];
  }

  const orderClause = getSortOrderClause(table, options.sort);

  if (whereClause && orderClause) {
    return (await db
      .select()
      .from(table)
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset)) as Record<string, unknown>[];
  }

  if (whereClause) {
    return (await db.select().from(table).where(whereClause).limit(limit).offset(offset)) as Record<
      string,
      unknown
    >[];
  }

  if (orderClause) {
    return (await db
      .select()
      .from(table)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset)) as Record<string, unknown>[];
  }

  return (await db.select().from(table).limit(limit).offset(offset)) as Record<string, unknown>[];
}

function getSortOrderClause(
  table: PgTable,
  sortValue: string | undefined,
): ReturnType<typeof sql> | undefined {
  const sort = sortValue?.trim();

  if (!sort) {
    return undefined;
  }

  const isDescending = sort.startsWith("-");
  const field = isDescending ? sort.slice(1) : sort;
  const column = getTableColumn(table, field);

  return isDescending ? desc(column) : asc(column);
}

/**
 * Issue #367 — by-id loader for write paths and admin reads.
 *
 * `findDocuments` (the list path) has been site-scoped since Phase
 * 18, but every by-id load was id-only. A staff user with a foreign
 * doc id could reach `getDocumentById`, `saveDocument`,
 * `deleteDocument`, `promoteMemberDocument`, or
 * `createTranslation` outside their tenant. By default this loader
 * now compares the loaded row's `siteId` to the request's resolved
 * site and throws `NpForbiddenError(collection, "cross-site")` on
 * divergence.
 *
 * Cross-site is opt-in via `{ allowCrossSite: true }`. The legitimate
 * users today are background jobs / scripts that run without a
 * request site context (the wp-importer wraps its own
 * `withCurrentSite`, so it stays on the default path).
 */
async function getDocumentByIdInternal(
  db: DrizzleTransactionLike,
  registration: ReturnType<typeof getCollectionRegistration>,
  collection: string,
  id: string,
  options?: { allowCrossSite?: boolean },
): Promise<Record<string, unknown>> {
  const doc = await getDocumentByIdOptional(db, registration, id);

  if (!doc) {
    throw new NpNotFoundError(collection, id);
  }

  if (!options?.allowCrossSite) {
    const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const docSiteId =
      typeof doc.siteId === "string" && doc.siteId.length > 0 ? doc.siteId : NP_DEFAULT_SITE_ID;
    if (docSiteId !== requestSiteId) {
      throw new NpForbiddenError(collection, "cross-site");
    }
  }

  return doc;
}

async function hydratePersistedDocuments(
  db: DrizzleTransactionLike,
  registration: ReturnType<typeof getCollectionRegistration>,
  rows: readonly Record<string, unknown>[],
  operation: "read" | "write-result",
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  try {
    const storageRows = rows.map((row, index) =>
      npRequireCollectionStorageRow(
        row,
        registration.config,
        `document.storage[${index.toString()}]`,
      ),
    );
    const ids = storageRows.map((row) => getRecordId(row));
    const relationState = new Map<
      string,
      {
        arrays: Record<string, unknown[]>;
        hasMany: Record<string, unknown[]>;
      }
    >(ids.map((id) => [id, { arrays: {}, hasMany: {} }]));

    for (const [fieldPath, tableValue] of Object.entries(registration.childTables ?? {})) {
      const table = tableValue as PgTable;
      const parentColumnName = findParentColumnName(table, ["parentId"]);
      const related = await db
        .select()
        .from(table)
        .where(inArray(getTableColumn(table, parentColumnName), ids));
      const byParent = new Map<string, Record<string, unknown>[]>();
      for (const value of related) {
        const row = toRecord(value);
        const parentId = row[parentColumnName];
        if (typeof parentId !== "string") {
          throw new NpCollectionContractError("Invalid persisted collection relation", [
            {
              code: "invalid-field",
              path: `document.${fieldPath}.parentId`,
              message: "must be a string id.",
            },
          ]);
        }
        const normalized =
          parentColumnName === "parentId"
            ? row
            : { ...row, parentId, [parentColumnName]: undefined };
        if (parentColumnName !== "parentId") delete normalized[parentColumnName];
        const current = byParent.get(parentId) ?? [];
        current.push(normalized);
        byParent.set(parentId, current);
      }
      for (const id of ids) {
        const rowsForParent = byParent.get(id) ?? [];
        rowsForParent.sort((left, right) => Number(left.order) - Number(right.order));
        const state = relationState.get(id);
        if (state) state.arrays[fieldPath] = rowsForParent;
      }
    }

    for (const [fieldPath, tableValue] of Object.entries(registration.joinTables ?? {})) {
      const table = tableValue as PgTable;
      const parentColumnName = findParentColumnName(table, ["parentId"]);
      const related = await db
        .select()
        .from(table)
        .where(inArray(getTableColumn(table, parentColumnName), ids));
      const byParent = new Map<string, Record<string, unknown>[]>();
      for (const value of related) {
        const row = toRecord(value);
        const expected = new Set(["id", parentColumnName, "targetId", "order"]);
        const unknownKey = Object.keys(row).find((key) => !expected.has(key));
        const parentId = row[parentColumnName];
        if (
          unknownKey ||
          typeof row.id !== "string" ||
          !isUuid(row.id) ||
          typeof parentId !== "string" ||
          !isUuid(parentId) ||
          !ids.includes(parentId) ||
          typeof row.targetId !== "string" ||
          !isUuid(row.targetId) ||
          !Number.isSafeInteger(row.order) ||
          (row.order as number) < 0
        ) {
          throw new NpCollectionContractError("Invalid persisted collection relation", [
            {
              code: "invalid-field",
              path: `document.${fieldPath}`,
              message: "join rows must contain exact id, parent, targetId, and order fields.",
            },
          ]);
        }
        const current = byParent.get(parentId) ?? [];
        current.push(row);
        byParent.set(parentId, current);
      }
      for (const id of ids) {
        const rowsForParent = byParent.get(id) ?? [];
        rowsForParent.sort((left, right) => Number(left.order) - Number(right.order));
        const targets = rowsForParent.map((row, index) => {
          if (row.order !== index) {
            throw new NpCollectionContractError("Invalid persisted collection relation", [
              {
                code: "invariant",
                path: `document.${fieldPath}[${index.toString()}].order`,
                message: "must be contiguous and zero-based.",
              },
            ]);
          }
          return row.targetId;
        });
        const state = relationState.get(id);
        if (state) state.hasMany[fieldPath] = targets;
      }
    }

    return storageRows.map((row) => {
      const id = getRecordId(row);
      const relations = relationState.get(id) ?? { arrays: {}, hasMany: {} };
      return npHydrateCollectionDocument(registration.config, row, relations);
    });
  } catch (error) {
    if (error instanceof NpCollectionContractError) {
      npRecordCollectionRuntimeDiagnostic(registration.config.slug, operation, error.message);
    }
    throw error;
  }
}

async function getDocumentByIdOptional(
  db: DrizzleTransactionLike,
  registration: ReturnType<typeof getCollectionRegistration>,
  id: string,
  operation: "read" | "write-result" = "read",
): Promise<Record<string, unknown> | null> {
  const table = registration.table as PgTable;
  const [doc] = await db
    .select()
    .from(table)
    .where(eq(getTableColumn(table, "id"), id))
    .limit(1);
  if (!doc) return null;
  const [hydrated] = await hydratePersistedDocuments(db, registration, [toRecord(doc)], operation);
  return hydrated ?? null;
}

function prepareDocumentData(
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
): PreparedDocumentData {
  const prepared: PreparedDocumentData = {
    mainData: {},
    childRows: {},
    joinRows: {},
  };

  collectPreparedDocumentData(fields, data, prepared, []);

  if (typeof data.slug === "string") {
    prepared.mainData.slug = data.slug;
  }
  // i18n columns aren't fields and aren't auto-emitted by
  // collectPreparedDocumentData. Let them through so the
  // caller (saveDocumentImpl) can persist the resolved locale
  // / translationGroupId.
  if (typeof data.locale === "string") {
    prepared.mainData.locale = data.locale;
  }
  if (typeof data.translationGroupId === "string") {
    prepared.mainData.translationGroupId = data.translationGroupId;
  }
  // Phase 15.2 — siteId is also non-field but framework-managed.
  if (typeof data.siteId === "string") {
    prepared.mainData.siteId = data.siteId;
  }
  // Phase 21.17 — visibility is a non-field framework-managed
  // column (codegen'd onto every collection by `getBaseColumns`).
  // Let it through so `createMainDocument` / `updateMainDocument`
  // can persist it; the Zod schema already validated the value
  // is `"public" | "private"`.
  if (typeof data.visibility === "string") {
    prepared.mainData.visibility = data.visibility;
  }
  return prepared;
}

function hasFrameworkPublishedAt(config: NpCollectionConfig): boolean {
  if (!config.versions?.drafts) return false;
  const hasTopLevelPublishedAt = (fields: NpFieldConfig[]): boolean =>
    fields.some((field) => {
      if (field.type === "row" || field.type === "collapsible") {
        return hasTopLevelPublishedAt(field.fields);
      }
      return field.name === "publishedAt";
    });
  return !hasTopLevelPublishedAt(config.fields);
}

function normalizeFrameworkPublishedAt(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new NpValidationError("Invalid input", [
        { field: "publishedAt", message: "Must be a valid date." },
      ]);
    }
    return value;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new NpValidationError("Invalid input", [
        { field: "publishedAt", message: "Must be a valid date." },
      ]);
    }
    return date;
  }
  throw new NpValidationError("Invalid input", [
    { field: "publishedAt", message: "Must be a valid date." },
  ]);
}

function collectPreparedDocumentData(
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
  prepared: PreparedDocumentData,
  prefix: string[],
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      collectPreparedDocumentData(field.fields, data, prepared, prefix);
      continue;
    }

    if (field.type === "group") {
      const groupValue = toOptionalRecord(data[field.name]);
      if (groupValue) {
        collectPreparedDocumentData(field.fields, groupValue, prepared, [...prefix, field.name]);
      }
      continue;
    }

    const fieldPath = [...prefix, field.name];
    const fieldKey = fieldPath.join(".");
    const value = data[field.name];

    if (field.type === "array") {
      prepared.childRows[fieldKey] = normalizeChildRows(field.fields, value);
      continue;
    }

    if (field.type === "relationship" && field.hasMany) {
      prepared.joinRows[fieldKey] = normalizeJoinIds(value);
      continue;
    }

    prepared.mainData[getFlattenedFieldName(prefix, field.name)] = value ?? null;
  }
}

function normalizeChildRows(fields: NpFieldConfig[], value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = toOptionalRecord(item) ?? {};
    const prepared: PreparedDocumentData = {
      mainData: {},
      childRows: {},
      joinRows: {},
    };

    collectPreparedDocumentData(fields, row, prepared, []);
    return prepared.mainData;
  });
}

function normalizeJoinIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

async function syncMediaRefsForDocument(
  tx: DrizzleTransactionLike,
  collection: string,
  documentId: string,
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
): Promise<void> {
  const refs = extractMediaIdsFromFields(fields, data, []);

  if (refs.length === 0) {
    await tx
      .delete(npMediaRefs)
      .where(
        sql`${eq(getTableColumn(npMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(npMediaRefs as unknown as PgTable, "documentId"), documentId)}`,
      );
    return;
  }

  await tx
    .delete(npMediaRefs)
    .where(
      sql`${eq(getTableColumn(npMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(npMediaRefs as unknown as PgTable, "documentId"), documentId)}`,
    );

  const values = refs.map((ref) => ({
    id: randomUUID(),
    mediaId: ref.mediaId,
    collection,
    documentId,
    field: ref.field,
  }));

  await tx.insert(npMediaRefs).values(values);
}

function extractMediaIdsFromFields(
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
  prefix: string[],
): Array<{ mediaId: string; field: string }> {
  const refs: Array<{ mediaId: string; field: string }> = [];

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      refs.push(...extractMediaIdsFromFields(field.fields, data, prefix));
      continue;
    }

    if (field.type === "group") {
      const groupData = toOptionalRecord(data[field.name]);
      if (groupData) {
        refs.push(...extractMediaIdsFromFields(field.fields, groupData, [...prefix, field.name]));
      }
      continue;
    }

    const fieldPath = [...prefix, field.name].join(".");

    if (field.type === "upload") {
      const mediaId = data[field.name];
      if (typeof mediaId === "string" && mediaId.length > 0) {
        refs.push({ mediaId, field: fieldPath });
      }
      continue;
    }

    if (field.type === "richText") {
      const richTextValue = data[field.name];
      if (isNpRichTextContent(richTextValue)) {
        refs.push(...extractMediaIdsFromLexicalJson(richTextValue.document.root, fieldPath));
      }
      continue;
    }

    if (field.type === "array") {
      const arrayValue = data[field.name];
      if (Array.isArray(arrayValue)) {
        for (const item of arrayValue) {
          const itemRecord = toOptionalRecord(item);
          if (itemRecord) {
            refs.push(
              ...extractMediaIdsFromFields(field.fields, itemRecord, [...prefix, field.name]),
            );
          }
        }
      }
      continue;
    }

    if (field.type === "blocks") {
      const blocksValue = data[field.name];
      if (Array.isArray(blocksValue)) {
        for (const block of blocksValue) {
          const blockRecord = toOptionalRecord(block);
          if (blockRecord) {
            extractBlockMediaIds(blockRecord, fieldPath, refs);
          }
        }
      }
      continue;
    }
  }

  return refs;
}

function extractMediaIdsFromLexicalJson(
  node: unknown,
  fieldPath: string,
): Array<{ mediaId: string; field: string }> {
  const refs: Array<{ mediaId: string; field: string }> = [];

  if (!node || typeof node !== "object") {
    return refs;
  }

  const record = node as Record<string, unknown>;

  if (record.type === "image" || record.type === "upload") {
    const mediaId = record.mediaId ?? record.value;
    if (typeof mediaId === "string" && mediaId.length > 0) {
      refs.push({ mediaId, field: fieldPath });
    }
  }

  const children = record.children ?? toOptionalRecord(record.root)?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      refs.push(...extractMediaIdsFromLexicalJson(child, fieldPath));
    }
  }

  return refs;
}

function extractBlockMediaIds(
  block: Record<string, unknown>,
  fieldPath: string,
  refs: Array<{ mediaId: string; field: string }>,
): void {
  for (const [key, value] of Object.entries(block)) {
    if (key === "blockType" || key === "id") {
      continue;
    }

    if (typeof value === "string" && isUuid(value)) {
      refs.push({ mediaId: value, field: `${fieldPath}.${key}` });
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getChangedFields(
  data: NpRevisionSnapshot,
  originalDoc: Record<string, unknown> | null,
  operation: NpSaveResult["operation"],
): string[] {
  if (operation === "create" || !originalDoc) {
    return Object.keys(data).sort();
  }

  return Object.keys(data)
    .filter((field) => {
      try {
        return (
          npRevisionSnapshotKey({ value: data[field] }) !==
          npRevisionSnapshotKey({ value: originalDoc[field] as never })
        );
      } catch {
        return true;
      }
    })
    .sort();
}

function combineConditions(conditions: QueryCondition[]): ReturnType<typeof sql> | undefined {
  if (conditions.length === 0) {
    return undefined;
  }

  return sql`${sql.join(conditions, sql` and `)}`;
}

function resolveRelatedTable(
  tables: Record<string, unknown> | undefined,
  fieldPath: string,
): unknown {
  return tables?.[fieldPath] ?? tables?.[fieldPath.split(".").at(-1) ?? fieldPath];
}

function findParentColumnName(table: PgTable, preferred: string[]): string {
  const keys = Object.keys(table as unknown as Record<string, unknown>);

  for (const key of preferred) {
    if (keys.includes(key)) {
      return key;
    }
  }

  const derived = keys.find(
    (key) => key !== "id" && key !== "targetId" && key !== "order" && key.endsWith("Id"),
  );

  if (!derived) {
    throw new Error("Unable to resolve parent column for related table.");
  }

  return derived;
}

function getTableColumn(table: PgTable, key: string): AnyPgColumn {
  const column = (table as unknown as Record<string, unknown>)[key];

  if (!column) {
    throw new Error(`Column '${key}' not found on table.`);
  }

  return column as AnyPgColumn;
}

function getRecordId(record: Record<string, unknown>): string {
  const id = record.id;

  if (typeof id !== "string") {
    throw new Error("Expected saved document to include a string id.");
  }

  return id;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object record.");
  }

  return value as Record<string, unknown>;
}

function toOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getFlattenedFieldName(prefix: string[], name: string): string {
  if (prefix.length === 0) {
    return toCamelCase(name);
  }

  return `${prefix.map(toPascalCase).join("")}${toPascalCase(name)}`.replace(/^./u, (char) =>
    char.toLowerCase(),
  );
}

function toCamelCase(value: string): string {
  const parts = splitName(value);
  const [first = "", ...rest] = parts;
  return `${first}${rest.map(toPascalCase).join("")}`;
}

function toPascalCase(value: string): string {
  return splitName(value).map(capitalize).join("");
}

function splitName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
