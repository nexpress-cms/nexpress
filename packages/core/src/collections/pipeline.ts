import { randomUUID } from "node:crypto";

import { asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  type NxCollectionConfig,
  type NxDocumentStatus,
  type NxFindOptions,
  type NxFindResult,
  type NxSaveOptions,
  type NxSaveResult,
  type NxAuthUser,
  type NxCollectionHook,
  type NxFieldConfig,
  type NxHookPrincipal,
} from "../config/types.js";
import { NxForbiddenError, NxNotFoundError, NxValidationError } from "../errors.js";
import { applySlugField } from "./slug.js";
import { getI18nConfig } from "../i18n/registry.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";
import { getCollectionZodSchema } from "./validation.js";
import { getCollectionConfig, getCollectionTable, getCollectionRegistration } from "./registry.js";
import { buildSearchVector, buildWeightedSearchVectorSql } from "./search.js";
import { enqueueJob } from "../jobs/queue.js";
import { runHook } from "../plugins/host.js";
import { nxRevisions } from "../db/schema/system.js";
import { nxComments, nxReactions, nxReports } from "../db/schema/community.js";
import { nxMediaRefs } from "../db/schema/media.js";
import { getDb } from "../db/runtime.js";

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
 * Internal actor type. The pipeline accepts either a staff `NxAuthUser`
 * (the original behavior) or a `{ kind: "member", memberId }` shape
 * (Phase 9.7a — `community.memberWrite.create` collections). Member
 * writes bypass the staff `access.create` access function: gating is
 * the per-collection opt-in flag plus `assertNotBanned(memberId)`,
 * not the staff access tree. `createdBy` / `updatedBy` / `authorId`
 * (revisions) are stored as null when the actor is a member; the
 * audit log captures the actual member id.
 */
type SaveActor = { kind: "staff"; user: NxAuthUser } | { kind: "member"; memberId: string };

function actorUserOrNull(actor: SaveActor): NxAuthUser | null {
  return actor.kind === "staff" ? actor.user : null;
}

function actorUserId(actor: SaveActor): string | null {
  return actor.kind === "staff" ? actor.user.id : null;
}

/**
 * Polymorphic actor reference passed to collection hooks and
 * surfaced to plugin hooks via the `principal` payload field.
 * Mirrors `SaveActor` — kept structurally identical so hook
 * authors can switch on `kind` without importing a separate type.
 */
function actorPrincipal(actor: SaveActor): NxHookPrincipal {
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

/**
 * Run a side-effect that fires AFTER the document transaction has
 * already committed (job enqueue, plugin hook). The doc is durable
 * by this point — surfacing the error to the caller would make a
 * successful save look like a failure, so we swallow and surface
 * via the framework logger instead.
 *
 * Operators rely on this log line to discover skipped follow-ups
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
  try {
    await fn();
  } catch (err) {
    const { getLogger } = await import("../observability/logger.js");
    getLogger().error(
      `post-commit ${label} failed — document persisted, follow-up skipped`,
      {
        collection: context.collection,
        documentId: context.documentId,
        operation: context.operation,
        label,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    );
  }
}

export async function saveDocument(
  collection: string,
  docId: string | null,
  data: Record<string, unknown>,
  user: NxAuthUser,
  options?: NxSaveOptions,
): Promise<NxSaveResult> {
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
  options?: NxSaveOptions,
): Promise<NxSaveResult> {
  const memberOptions: NxSaveOptions = { ...(options ?? {}) };
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
    throw new NxForbiddenError(collection, "update");
  }
  const table = getCollectionTable(collection) as PgTable;
  const dbForGate = getDb() as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(dbForGate, table, collection, docId);
  if (!originalDoc) {
    throw new NxNotFoundError(collection, docId);
  }
  const authorId = (originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
  if (authorId !== memberId) {
    throw new NxForbiddenError(collection, "update");
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
  options?: NxSaveOptions,
): Promise<NxSaveResult> {
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
    throw new NxForbiddenError(collection, "create");
  }
  const { assertNotBanned } = await import("../community/can.js");
  await assertNotBanned(memberId);

  const defaultStatus: NxDocumentStatus =
    config.community?.memberWrite?.defaultStatus === "pending" ? "pending" : "published";

  const moderation = await runMemberDocModeration({
    collection,
    data,
    memberId,
    targetId: "",
  });
  const flaggedBy = moderation.flaggedBy;
  const spamStatus: NxDocumentStatus = flaggedBy.length > 0 ? "pending" : defaultStatus;

  const memberOptions: NxSaveOptions = { ...(options ?? {}), status: spamStatus };
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
  profanityVerdict: { reason: string | null; metadata: Record<string, unknown> | null } | null;
  spamVerdict: { reason: string | null; metadata: Record<string, unknown> | null } | null;
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
 *   - reject  → throws `NxValidationError`
 *   - flag    → returned with the source recorded in `flaggedBy`
 *   - pass    → returned with empty `flaggedBy`
 *
 * Adapter throws are fail-open (logged as warnings, treated as
 * pass) — same policy as comments and the original create-only
 * gate.
 */
async function runMemberDocModeration(
  input: RunMemberDocModerationInput,
): Promise<MemberDocModerationResult> {
  const { collection, data, memberId, targetId } = input;
  const config = getCollectionConfig(collection);
  const { getSpamAdapter } = await import("../community/spam-adapter.js");
  const { getProfanityAdapter } = await import("../community/profanity-adapter.js");
  const { getLogger } = await import("../observability/logger.js");

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
  try {
    const verdict = await getProfanityAdapter().check(moderationText, ctx);
    if (verdict.kind === "reject") {
      throw new NxValidationError("Invalid input", [
        {
          field: "body",
          message: verdict.reason ?? "Submission contains prohibited language",
        },
      ]);
    }
    if (verdict.kind === "flag") {
      profanityVerdict = {
        reason: verdict.reason ?? null,
        metadata: verdict.metadata ?? null,
      };
    }
  } catch (err) {
    if (err instanceof NxValidationError) throw err;
    getLogger().warn("profanity adapter threw on doc write — treating as pass", {
      error: err instanceof Error ? err.message : String(err),
      collection,
      memberId,
    });
  }

  let spamVerdict: MemberDocModerationResult["spamVerdict"] = null;
  try {
    const verdict = await getSpamAdapter().check(moderationText, ctx);
    if (verdict.kind === "reject") {
      throw new NxValidationError("Invalid input", [
        {
          field: "body",
          message: verdict.reason ?? "Submission rejected",
        },
      ]);
    }
    if (verdict.kind === "flag") {
      spamVerdict = {
        reason: verdict.reason ?? null,
        metadata: verdict.metadata ?? null,
      };
    }
  } catch (err) {
    if (err instanceof NxValidationError) throw err;
    getLogger().warn("spam adapter threw on doc write — treating as pass", {
      error: err instanceof Error ? err.message : String(err),
      collection,
      memberId,
    });
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
  options: NxSaveOptions | undefined;
  config: ReturnType<typeof getCollectionConfig>;
  registration: ReturnType<typeof getCollectionRegistration>;
  table: PgTable;
  db: DrizzleDatabaseLike;
  operation: "create" | "update";
  originalDoc: Record<string, unknown> | null;
  userForHooks: NxAuthUser | null;
  principal: NxHookPrincipal;
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
  options: NxSaveOptions | undefined,
): Promise<Omit<SaveContext, "hookData" | "prepared" | "searchVector" | "publishTransition" | "unpublishTransition" | "now">> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const validatedData = toRecord(getCollectionZodSchema(config).parse(data));
  const operation: "create" | "update" = docId ? "update" : "create";
  const originalDoc = docId ? await getDocumentByIdInternal(db, table, collection, docId) : null;
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
 * Throws `NxForbiddenError` / `NxNotFoundError` on rejection.
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
      throw new NxForbiddenError(ctx.collection, "create");
    }
    await assertNotBanned(ctx.actor.memberId);
    return;
  }
  // update — the doc must exist and must be authored by THIS
  // member (`member_author_id` matches). 404 / 403 disambiguate:
  // 404 when there's no row at all, 403 when the row belongs to
  // someone else (or to staff with `member_author_id = null`).
  if (!ctx.originalDoc) {
    throw new NxNotFoundError(ctx.collection, ctx.docId ?? "unknown");
  }
  if (!ctx.config.community?.memberWrite?.update) {
    throw new NxForbiddenError(ctx.collection, "update");
  }
  const authorId = (ctx.originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
  if (authorId !== ctx.actor.memberId) {
    throw new NxForbiddenError(ctx.collection, "update");
  }
  await assertNotBanned(ctx.actor.memberId);
}

/**
 * Concern 2 — prepare the document for write. Runs the
 * collection's `beforeCreate` / `beforeUpdate` hooks, applies
 * slug generation, resolves i18n locale + translation group,
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

  applySlugField(c.config, c.hookData, c.originalDoc);

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
        throw new NxValidationError("Invalid input", [
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
    c.prepared.mainData.siteId = resolved ?? NX_DEFAULT_SITE_ID;
  } else {
    const original = c.originalDoc as { siteId?: string } | null;
    c.prepared.mainData.siteId = original?.siteId ?? NX_DEFAULT_SITE_ID;
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
  if (desiredStatus === "published" && publishedAtValue instanceof Date && publishedAtValue > c.now) {
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
 * Concern 3 — fire pre-write plugin hooks, then run the document
 * persistence inside one transaction (main row + child + join +
 * media-ref + revision). Returns the saved doc.
 */
async function persistDocumentTx(ctx: SaveContext): Promise<Record<string, unknown>> {
  await runHook(
    ctx.operation === "create" ? "content:beforeCreate" : "content:beforeUpdate",
    {
      collection: ctx.collection,
      data: ctx.hookData,
      originalDoc: ctx.originalDoc,
      user: ctx.userForHooks,
      principal: ctx.principal,
      operation: ctx.operation,
    },
  );
  if (ctx.publishTransition) {
    await runHook("content:beforePublish", {
      collection: ctx.collection,
      data: ctx.hookData,
      originalDoc: ctx.originalDoc,
      user: ctx.userForHooks,
      principal: ctx.principal,
    });
  }
  if (ctx.unpublishTransition) {
    await runHook("content:beforeUnpublish", {
      collection: ctx.collection,
      data: ctx.hookData,
      originalDoc: ctx.originalDoc,
      user: ctx.userForHooks,
      principal: ctx.principal,
    });
  }

  return ctx.db.transaction(async (tx) => {
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
          );
    const persistedDocId = getRecordId(persistedDoc);

    await syncChildTables(tx, ctx.registration.childTables, ctx.prepared.childRows, persistedDocId);
    await syncJoinTables(tx, ctx.registration.joinTables, ctx.prepared.joinRows, persistedDocId);
    await syncMediaRefsForDocument(tx, ctx.collection, persistedDocId, ctx.config.fields, ctx.hookData);

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

    return persistedDoc;
  });
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
  const postCommitCtx = {
    collection: ctx.collection,
    documentId: savedDocId,
    operation: ctx.operation,
  };

  await runPostCommit("enqueue:content:afterSave", postCommitCtx, () =>
    enqueueJob("content:afterSave", {
      collection: ctx.collection,
      documentId: savedDocId,
      operation: ctx.operation,
      userId: actorUserId(ctx.actor),
    }),
  );

  const pluginHookName = ctx.operation === "create" ? "content:afterCreate" : "content:afterUpdate";
  await runPostCommit(`hook:${pluginHookName}`, postCommitCtx, () =>
    runHook(pluginHookName, {
      collection: ctx.collection,
      doc: savedDoc,
      operation: ctx.operation,
      user: ctx.userForHooks,
      principal: ctx.principal,
    }),
  );
  if (ctx.publishTransition) {
    await runPostCommit("hook:content:afterPublish", postCommitCtx, () =>
      runHook("content:afterPublish", {
        collection: ctx.collection,
        doc: savedDoc,
        operation: ctx.operation,
        user: ctx.userForHooks,
        principal: ctx.principal,
      }),
    );
  }
}

async function saveDocumentImpl(
  collection: string,
  docId: string | null,
  data: Record<string, unknown>,
  actor: SaveActor,
  options?: NxSaveOptions,
): Promise<NxSaveResult> {
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
 *    `versions` is the object form). Throws `NxValidationError` otherwise
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
  user: NxAuthUser,
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

  const drafts = config.versions?.drafts;
  if (!drafts) {
    throw new NxValidationError("Autosave not available", [
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
    throw new NxValidationError("Autosave disabled", [
      {
        field: "collection",
        message: `Autosave is not enabled for "${collection}" — set versions.drafts.autosave = true.`,
      },
    ]);
  }

  const originalDoc = await getDocumentByIdInternal(db, table, collection, documentId);
  if (!originalDoc) {
    throw new NxNotFoundError(collection, documentId);
  }

  // Reuse the same access gate `saveDocument` runs for an update — autosave
  // is a write, even if it only lands in nx_revisions.
  await assertWriteAccess(config, collection, "update", user, data, originalDoc);

  // Dedup against the latest autosave for this doc.
  const [latestAutosave] = (await db
    .select({
      id: nxRevisions.id,
      version: nxRevisions.version,
      snapshot: nxRevisions.snapshot,
      createdAt: nxRevisions.createdAt,
    })
    .from(nxRevisions)
    .where(
      sql`${eq(nxRevisions.collection, collection)} and ${eq(nxRevisions.documentId, documentId)} and ${eq(nxRevisions.status, "autosave")}`,
    )
    .orderBy(desc(nxRevisions.version))
    .limit(1)) as Array<{
    id: string;
    version: number;
    snapshot: Record<string, unknown> | null;
    createdAt: Date;
  }>;
  if (latestAutosave && stableJson(latestAutosave.snapshot) === stableJson(data)) {
    return {
      id: latestAutosave.id,
      version: latestAutosave.version,
      status: "autosave",
      createdAt: latestAutosave.createdAt,
      reused: true,
    };
  }

  const maxRevisions =
    typeof config.versions === "object" && config.versions.max !== undefined
      ? config.versions.max
      : undefined;

  const inserted = await db.transaction(async (tx) => {
    const [revisionCount] = (await tx
      .select({ total: count() })
      .from(nxRevisions)
      .where(
        sql`${eq(nxRevisions.collection, collection)} and ${eq(nxRevisions.documentId, documentId)}`,
      )) as Array<{ total: number | string }>;
    const nextVersion = Number(revisionCount?.total ?? 0) + 1;
    const createdAt = new Date();

    await tx.insert(nxRevisions).values({
      collection,
      documentId,
      version: nextVersion,
      status: "autosave",
      snapshot: data,
      changedFields: getChangedFields(data, originalDoc, "update"),
      authorId: user.id,
      createdAt,
    });

    if (maxRevisions !== undefined && maxRevisions > 0 && nextVersion > maxRevisions) {
      const overflow = nextVersion - maxRevisions;
      const toDelete = (await tx
        .select({ id: nxRevisions.id })
        .from(nxRevisions)
        .where(
          sql`${eq(nxRevisions.collection, collection)} and ${eq(nxRevisions.documentId, documentId)}`,
        )
        .orderBy(asc(nxRevisions.version))
        .limit(overflow)) as Array<{ id: string }>;
      if (toDelete.length > 0) {
        const ids = toDelete.map((r) => r.id);
        await tx.delete(nxRevisions).where(sql`${nxRevisions.id} = any(${ids}::uuid[])`);
      }
    }

    // Read back the row we just inserted to get its generated id —
    // `tx.insert(...).returning(...)` isn't part of our Drizzle adapter
    // interface, so a follow-up SELECT is the simplest portable path.
    const [row] = (await tx
      .select({ id: nxRevisions.id })
      .from(nxRevisions)
      .where(
        sql`${eq(nxRevisions.collection, collection)} and ${eq(nxRevisions.documentId, documentId)} and ${eq(nxRevisions.version, nextVersion)}`,
      )
      .limit(1)) as Array<{ id: string }>;

    return { id: row?.id ?? "", version: nextVersion, createdAt };
  });
  // `registration` reference silences the unused-binding lint; we keep
  // the lookup early so misconfigured collections fail fast.
  void registration;

  return { ...inserted, status: "autosave", reused: false };
}

function stableJson(value: unknown): string {
  // JSON.stringify with deterministic key ordering is enough for dedup —
  // autosave payloads are user-edited records, not arbitrary structures.
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

export async function deleteDocument(
  collection: string,
  docId: string,
  user: NxAuthUser,
): Promise<void> {
  return deleteDocumentImpl(collection, docId, { kind: "staff", user });
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
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const original = await getDocumentByIdInternal(db, table, collection, docId);
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
): Promise<NxSaveResult> {
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(db, table, collection, docId);
  if (!originalDoc) {
    throw new NxNotFoundError(collection, docId);
  }
  const status = (originalDoc as { status?: string }).status;
  if (status !== "pending") {
    throw new NxValidationError("Invalid input", [
      {
        field: "status",
        message: `Cannot promote: document is ${status ?? "unknown"}, expected pending`,
      },
    ]);
  }
  const memberAuthorId = (originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
  if (!memberAuthorId) {
    throw new NxValidationError("Invalid input", [
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
  const now = new Date();
  const updated = (await db
    .update(table)
    .set({ status: "published", updatedAt: now, updatedBy: staffUserId })
    .where(
      sql`${eq(getTableColumn(table, "id"), docId)} and ${eq(getTableColumn(table, "status"), "pending")}`,
    )
    .returning()) as Array<Record<string, unknown>>;
  if (updated.length === 0) {
    // Either a concurrent promote already flipped this row, or
    // staff edited it out of `pending` between our read and our
    // write. Surface as a validation error — the caller should
    // re-fetch and retry only if they still want to act.
    throw new NxValidationError("Invalid input", [
      {
        field: "status",
        message: "Cannot promote: row is no longer pending (concurrent change)",
      },
    ]);
  }
  const persistedDoc = toRecord(updated[0]);

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
): Promise<void> {
  const config = getCollectionConfig(collection);
  const registration = getCollectionRegistration(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const originalDoc = await getDocumentByIdInternal(db, table, collection, docId);

  // Without this guard the call returns success for non-existent ids:
  // hooks fire with `originalDoc = null`, the DELETE matches zero rows,
  // and the route returns 204. Bulk delete then records phantom ids as
  // succeeded. (#59)
  if (!originalDoc) {
    throw new NxNotFoundError(collection, docId);
  }

  if (actor.kind === "staff") {
    if (config.access?.delete) {
      const allowed = await config.access.delete({ user: actor.user, doc: originalDoc });
      if (!allowed) {
        throw new NxForbiddenError(collection, "delete");
      }
    }
  } else {
    // Member delete: opt-in flag plus owner check plus ban check.
    if (!config.community?.memberWrite?.delete) {
      throw new NxForbiddenError(collection, "delete");
    }
    const authorId = (originalDoc as { memberAuthorId?: string | null }).memberAuthorId ?? null;
    if (authorId !== actor.memberId) {
      throw new NxForbiddenError(collection, "delete");
    }
    const { assertNotBanned } = await import("../community/can.js");
    await assertNotBanned(actor.memberId);
  }

  const userForHooks = actorUserOrNull(actor);
  const principal = actorPrincipal(actor);
  await runHooks(config.hooks?.beforeDelete, {
    data: originalDoc,
    user: userForHooks,
    principal,
    collection,
    originalDoc,
  });

  await runHook("content:beforeDelete", {
    collection,
    doc: originalDoc,
    user: userForHooks,
    principal,
  });

  await db.transaction(async (tx) => {
    await deleteChildTables(tx, registration.childTables, docId);
    await deleteJoinTables(tx, registration.joinTables, docId);
    await tx
      .delete(nxMediaRefs as unknown as PgTable)
      .where(
        sql`${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "documentId"), docId)}`,
      );
    // Phase 9.7m: cascade comments + reactions on the deleted doc.
    // The polymorphic `(target_type, target_id)` shape on
    // `nx_comments` / `nx_reactions` doesn't have a DB-level FK
    // (it can't — the target table varies per row), so without an
    // explicit cleanup these rows would orphan once the parent
    // doc was gone. Order matters: reactions targeting the comments
    // (`target_type='comment'`) must go before the comments
    // themselves, since after the comment rows are gone we can't
    // discover their ids anymore. Top-level comments and replies
    // both carry `target_id=$docId`, so a single SELECT covers both.
    const commentIdRows = (await tx
      .select({
        id: getTableColumn(nxComments as unknown as PgTable, "id"),
      })
      .from(nxComments as unknown as PgTable)
      .where(
        sql`${eq(getTableColumn(nxComments as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(nxComments as unknown as PgTable, "targetId"), docId)}`,
      )) as Array<{ id: string }>;
    if (commentIdRows.length > 0) {
      const commentIds = commentIdRows.map((row) => row.id);
      await tx
        .delete(nxReactions as unknown as PgTable)
        .where(
          sql`${eq(getTableColumn(nxReactions as unknown as PgTable, "targetType"), "comment")} and ${inArray(getTableColumn(nxReactions as unknown as PgTable, "targetId"), commentIds)}`,
        );
      // Phase 9.7q: same orphan story for `nx_reports` — a member
      // who reported one of these comments would otherwise be left
      // with a row pointing at a non-existent comment id. The
      // existing audit row carries enough context for after-the-
      // fact tracing, so the report itself can go.
      await tx
        .delete(nxReports as unknown as PgTable)
        .where(
          sql`${eq(getTableColumn(nxReports as unknown as PgTable, "targetType"), "comment")} and ${inArray(getTableColumn(nxReports as unknown as PgTable, "targetId"), commentIds)}`,
        );
    }
    await tx
      .delete(nxComments as unknown as PgTable)
      .where(
        sql`${eq(getTableColumn(nxComments as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(nxComments as unknown as PgTable, "targetId"), docId)}`,
      );
    await tx
      .delete(nxReactions as unknown as PgTable)
      .where(
        sql`${eq(getTableColumn(nxReactions as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(nxReactions as unknown as PgTable, "targetId"), docId)}`,
      );
    // Doc-level reports (sites that file `target_type=$collection`
    // reports against a post / discussion). The shipped report API
    // today only files against comments + members, but the schema
    // is polymorphic — a future surface could add doc-level reports
    // and this cascade keeps that case correct from day one.
    await tx
      .delete(nxReports as unknown as PgTable)
      .where(
        sql`${eq(getTableColumn(nxReports as unknown as PgTable, "targetType"), collection)} and ${eq(getTableColumn(nxReports as unknown as PgTable, "targetId"), docId)}`,
      );
    await tx.delete(table).where(eq(getTableColumn(table, "id"), docId));
  });

  const postCommitCtx = { collection, documentId: docId, operation: "delete" };
  await runPostCommit("enqueue:content:afterDelete", postCommitCtx, () =>
    enqueueJob("content:afterDelete", {
      collection,
      documentId: docId,
      userId: actorUserId(actor),
    }),
  );

  await runPostCommit("hook:content:afterDelete", postCommitCtx, () =>
    runHook("content:afterDelete", {
      collection,
      documentId: docId,
      user: userForHooks,
      principal,
    }),
  );
}

export async function findDocuments(
  collection: string,
  options: NxFindOptions,
  user?: NxAuthUser,
): Promise<NxFindResult> {
  const config = getCollectionConfig(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const offset = (page - 1) * limit;

  await assertReadAccess(config, collection, user ?? null);

  // Phase 12.1 — i18n collections honor the top-level `locale`
  // option as an additional `locale = $1` filter. Non-i18n
  // collections silently drop it (the column doesn't exist;
  // forwarding it would 500 on the SQL parse).
  let effectiveWhere: Record<string, unknown> = options.where ?? {};
  if (config.i18n && options.locale) {
    effectiveWhere = { ...effectiveWhere, locale: options.locale };
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
      siteId: resolved ?? NX_DEFAULT_SITE_ID,
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

  const effectiveOptions: NxFindOptions = {
    ...options,
    where: effectiveWhere,
  };
  const conditions = buildQueryConditions(table, effectiveOptions);
  const whereClause = combineConditions(conditions);

  const docs = await executeFindQuery(db, table, options, whereClause, limit, offset);
  const totalResult = (await (whereClause
    ? db.select({ total: count() }).from(table).where(whereClause)
    : db.select({ total: count() }).from(table).limit(1))) as Array<{ total: number | string }>;
  const totalDocs = Number(totalResult[0]?.total ?? 0);
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);

  return {
    docs: docs,
    totalDocs,
    totalPages,
    page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1 && totalDocs > 0,
  };
}

export async function getDocumentById(
  collection: string,
  id: string,
  user?: NxAuthUser,
): Promise<Record<string, unknown> | null> {
  const config = getCollectionConfig(collection);
  const table = getCollectionTable(collection) as PgTable;
  const db = getDb() as unknown as DrizzleDatabaseLike;
  const doc = await getDocumentByIdOptional(db, table, id);

  if (!doc) {
    return null;
  }

  if (config.access?.read) {
    const allowed = await config.access.read({ user: user ?? null, doc });
    if (!allowed) {
      throw new NxForbiddenError(collection, "read");
    }
  }

  return doc;
}

async function assertWriteAccess(
  config: NxCollectionConfig,
  collection: string,
  operation: NxSaveResult["operation"],
  user: NxAuthUser,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
): Promise<void> {
  const access = operation === "create" ? config.access?.create : config.access?.update;

  if (!access) {
    return;
  }

  const allowed = await access({ user, doc: originalDoc ?? undefined, data });

  if (!allowed) {
    throw new NxForbiddenError(collection, operation);
  }
}

async function assertReadAccess(
  config: NxCollectionConfig,
  collection: string,
  user: NxAuthUser | null,
): Promise<void> {
  if (!config.access?.read) {
    return;
  }

  const allowed = await config.access.read({ user });

  if (!allowed) {
    throw new NxForbiddenError(collection, "read");
  }
}

async function runHooks(
  hooks: NxCollectionHook[] | undefined,
  args: Parameters<NxCollectionHook>[0],
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

async function createMainDocument(
  tx: DrizzleTransactionLike,
  table: PgTable,
  mainData: Record<string, unknown>,
  searchVectorSql: SQL,
  config: NxCollectionConfig,
  user: NxAuthUser | null,
  now: Date,
): Promise<Record<string, unknown>> {
  // Member writes (`user === null`) leave `createdBy` / `updatedBy`
  // unset so the FK to `nx_users` stays null. The audit log captures
  // the actual member; readers that need authorship for member-
  // authored docs should join through the dedicated `member_author_id`
  // column (codegen'd onto every collection that opts into
  // `community.memberWrite.create`).
  const values: Record<string, unknown> = {
    id: randomUUID(),
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
  config: NxCollectionConfig,
  user: NxAuthUser | null,
  now: Date,
): Promise<Record<string, unknown>> {
  if (!docId) {
    throw new NxNotFoundError(collection, "unknown");
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
    throw new NxNotFoundError(collection, docId);
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
  operation: NxSaveResult["operation"],
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  user: NxAuthUser | null,
  status: string,
  maxRevisions?: number,
): Promise<void> {
  const revisionConditions = sql`${eq(nxRevisions.collection, collection)} and ${eq(nxRevisions.documentId, documentId)}`;
  const [revisionCount] = (await tx
    .select({ total: count() })
    .from(nxRevisions)
    .where(revisionConditions)) as Array<{ total: number | string }>;

  await tx.insert(nxRevisions).values({
    collection,
    documentId,
    version: Number(revisionCount?.total ?? 0) + 1,
    status,
    snapshot: data,
    changedFields: getChangedFields(data, originalDoc, operation),
    // `authorId` references nx_users; member-authored revisions
    // store null and the audit log carries the actual member id.
    authorId: user?.id ?? null,
    createdAt: new Date(),
  });

  // Enforce versions.max: drop the oldest revisions so this doc never
  // accumulates more than `maxRevisions` rows. Runs in the same tx as the
  // insert so the row count is stable against races.
  if (maxRevisions !== undefined && maxRevisions > 0) {
    const currentCount = Number(revisionCount?.total ?? 0) + 1;
    const overflow = currentCount - maxRevisions;
    if (overflow > 0) {
      // Select the oldest `overflow` revision ids and delete them. Postgres
      // doesn't support DELETE with LIMIT directly but `id IN (subquery)`
      // works fine.
      const toDelete = (await tx
        .select({ id: nxRevisions.id })
        .from(nxRevisions)
        .where(revisionConditions)
        .orderBy(asc(nxRevisions.version))
        .limit(overflow)) as Array<{ id: string }>;

      if (toDelete.length > 0) {
        const ids = toDelete.map((r) => r.id);
        await tx.delete(nxRevisions).where(sql`${nxRevisions.id} = any(${ids}::uuid[])`);
      }
    }
  }
}

function buildQueryConditions(table: PgTable, options: NxFindOptions): QueryCondition[] {
  const conditions: QueryCondition[] = [];

  if (options.where) {
    for (const [field, value] of Object.entries(options.where)) {
      if (value === undefined) {
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
  options: NxFindOptions,
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

async function getDocumentByIdInternal(
  db: DrizzleDatabaseLike,
  table: PgTable,
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const doc = await getDocumentByIdOptional(db, table, id);

  if (!doc) {
    throw new NxNotFoundError(collection, id);
  }

  return doc;
}

async function getDocumentByIdOptional(
  db: DrizzleDatabaseLike,
  table: PgTable,
  id: string,
): Promise<Record<string, unknown> | null> {
  const [doc] = await db
    .select()
    .from(table)
    .where(eq(getTableColumn(table, "id"), id))
    .limit(1);
  return doc ? toRecord(doc) : null;
}

function prepareDocumentData(
  fields: NxFieldConfig[],
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

function collectPreparedDocumentData(
  fields: NxFieldConfig[],
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

function normalizeChildRows(fields: NxFieldConfig[], value: unknown): Record<string, unknown>[] {
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
  fields: NxFieldConfig[],
  data: Record<string, unknown>,
): Promise<void> {
  const refs = extractMediaIdsFromFields(fields, data, []);

  if (refs.length === 0) {
    await tx
      .delete(nxMediaRefs as unknown as PgTable)
      .where(
        sql`${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "documentId"), documentId)}`,
      );
    return;
  }

  await tx
    .delete(nxMediaRefs as unknown as PgTable)
    .where(
      sql`${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "collection"), collection)} and ${eq(getTableColumn(nxMediaRefs as unknown as PgTable, "documentId"), documentId)}`,
    );

  const values = refs.map((ref) => ({
    id: randomUUID(),
    mediaId: ref.mediaId,
    collection,
    documentId,
    field: ref.field,
  }));

  await tx.insert(nxMediaRefs as unknown as PgTable).values(values);
}

function extractMediaIdsFromFields(
  fields: NxFieldConfig[],
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
      if (richTextValue && typeof richTextValue === "object") {
        refs.push(...extractMediaIdsFromLexicalJson(richTextValue, fieldPath));
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
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null,
  operation: NxSaveResult["operation"],
): string[] {
  if (operation === "create" || !originalDoc) {
    return Object.keys(data);
  }

  return Object.keys(data).filter((field) => !Object.is(data[field], originalDoc[field]));
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

function normalizePage(page?: number): number {
  if (!page || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return 10;
  }

  return Math.floor(limit);
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
