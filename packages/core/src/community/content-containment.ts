import { createHash } from "node:crypto";
import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAssertAgentPreviewEffectsAllowed } from "../agent/changeset-preview-overlay.js";
import { can } from "../auth/capabilities.js";
import { npCollectionDocumentToWriteInput } from "../collection-contract/contract.js";
import {
  npAssertCollectionReadAccess,
  npGetPersistedCollectionDocumentById,
  runPostCommit,
  saveDocument,
  type NpTransaction,
} from "../collections/pipeline.js";
import { getCollectionConfig, getCollectionTable } from "../collections/registry.js";
import { npRequireCommentRow, npRequireCommunityId } from "../community-contract/contract.js";
import type { NpCommentRow, NpCommunityJsonValue } from "../community-contract/types.js";
import type { NpAuthUser, NpCollectionConfig } from "../config/types.js";
import { npAuditEvents, npComments } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { requireSiteId } from "../sites/context.js";
import { npRequireReadableCommunityDocument } from "./audience.js";
import { applyReputation } from "./reputation.js";
import { npEmitCommunityDocumentChanged } from "./realtime.js";

export type NpCommunityContentTargetV1 = {
  kind: "comment" | "document";
  collection: string;
  id: string;
};

type OriginalState =
  | {
      kind: "comment";
      status: "visible" | "pending";
      hiddenByUserId: string | null;
      hiddenByMemberId: string | null;
      hiddenReason: string | null;
    }
  | {
      kind: "document";
      status: "published" | "pending";
      visibility: string;
      hiddenField: string;
      hiddenValue: false;
    };

/** Server-owned restoration metadata. Bodies stay on the target and are protected by its digest. */
export type NpCommunityContentOriginalStateV1 = {
  schemaVersion: "np.community-content-original-state.v1";
  siteId: string;
  target: NpCommunityContentTargetV1;
  versionDigest: string;
  state: OriginalState;
  digest: string;
};

export interface NpCommunityContentContainmentInputV1 {
  siteId: string;
  target: NpCommunityContentTargetV1;
  user: NpAuthUser;
}

type LoadedTarget = {
  document: Record<string, unknown>;
  config: NpCollectionConfig;
  comment: NpCommentRow | null;
};

function conflict(): never {
  throw new NpValidationError("Content containment conflict", [
    { field: "target", message: "The exact content state is no longer eligible for this action." },
  ]);
}

function json(value: unknown): NpCommunityJsonValue {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) conflict();
    return value.toISOString();
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value !== "object" || value === null) conflict();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) conflict();
  const result: Record<string, NpCommunityJsonValue> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) conflict();
    result[key] = json(descriptor.value);
  }
  return result;
}

function digest(purpose: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256")
    .update(`np.community-content-containment.v1\0${purpose}\0`)
    .update(serializeAgentCanonicalJson(json(value)))
    .digest("base64url")}`;
}

function version(input: NpCommunityContentContainmentInputV1, loaded: LoadedTarget): string {
  return digest("target-version", {
    siteId: input.siteId,
    target: input.target,
    document: loaded.document,
    comment: loaded.comment,
  });
}

async function load(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1,
): Promise<LoadedTarget> {
  npAssertAgentPreviewEffectsAllowed();
  if (!can(input.user, "community.moderate") || (await requireSiteId()) !== input.siteId)
    throw new NpForbiddenError("content", "moderate");
  npRequireCommunityId(input.target.id, "content-containment.target.id");
  if (input.target.kind !== "comment" && input.target.kind !== "document") conflict();
  const config = getCollectionConfig(input.target.collection);
  let comment: NpCommentRow | null = null;
  if (input.target.kind === "comment") {
    if (config.community?.comments !== true) conflict();
    const [row] = await tx
      .select()
      .from(npComments)
      .where(and(eq(npComments.id, input.target.id), eq(npComments.siteId, input.siteId))!)
      .limit(1);
    if (!row) throw new NpNotFoundError("content", input.target.id);
    comment = npRequireCommentRow(row);
    if (comment.targetType !== input.target.collection) conflict();
  } else if (!config.community?.moderation) conflict();
  const documentId = comment?.targetId ?? input.target.id;
  const table = getCollectionTable(input.target.collection) as PgTable;
  const columns = getTableColumns(table);
  if (!columns.id || !columns.siteId) conflict();
  await tx
    .select({ id: columns.id })
    .from(table)
    .where(and(eq(columns.id, documentId), eq(columns.siteId, input.siteId))!)
    .limit(1)
    .for("update");
  // Match collection deletion's parent-before-comment lock order. Re-read the
  // comment under its lock so even a moved target cannot use the earlier parent.
  if (comment) {
    const [row] = await tx
      .select()
      .from(npComments)
      .where(and(eq(npComments.id, input.target.id), eq(npComments.siteId, input.siteId))!)
      .limit(1)
      .for("update");
    if (!row) throw new NpNotFoundError("content", input.target.id);
    comment = npRequireCommentRow(row);
    if (comment.targetType !== input.target.collection || comment.targetId !== documentId)
      conflict();
  }
  const document = await npGetPersistedCollectionDocumentById(
    input.target.collection,
    documentId,
    input.siteId,
    { tx },
  );
  if (!document) throw new NpNotFoundError("content", input.target.id);
  await npAssertCollectionReadAccess(config, input.target.collection, input.user, document);
  await npRequireReadableCommunityDocument(
    config,
    document,
    { kind: "staff", user: input.user },
    { allowUnpublished: true },
  );
  return { document, config, comment };
}

function originalState(loaded: LoadedTarget): OriginalState {
  if (loaded.comment) {
    const row = loaded.comment;
    if (row.status !== "visible" && row.status !== "pending") conflict();
    return {
      kind: "comment",
      status: row.status,
      hiddenByUserId: row.hiddenByUserId,
      hiddenByMemberId: row.hiddenByMemberId,
      hiddenReason: row.hiddenReason,
    };
  }
  const { document, config } = loaded;
  const hiddenField = config.community?.moderation?.hiddenField;
  if (!hiddenField || document[hiddenField] !== false) conflict();
  if (
    (document.status !== "published" || document.visibility !== "public") &&
    (document.status !== "pending" || typeof document.memberAuthorId !== "string")
  )
    conflict();
  if (typeof document.visibility !== "string") conflict();
  return {
    kind: "document",
    status: document.status,
    visibility: document.visibility,
    hiddenField,
    hiddenValue: false,
  };
}

function freezeOriginal(
  input: NpCommunityContentContainmentInputV1,
  loaded: LoadedTarget,
): NpCommunityContentOriginalStateV1 {
  const body = {
    schemaVersion: "np.community-content-original-state.v1" as const,
    siteId: input.siteId,
    target: { ...input.target },
    versionDigest: version(input, loaded),
    state: originalState(loaded),
  };
  const result = { ...body, digest: digest("original-state", body) };
  if (Buffer.byteLength(serializeAgentCanonicalJson(result)) > 16_384) conflict();
  return result;
}

function requireOriginal(
  input: NpCommunityContentContainmentInputV1,
  raw: NpCommunityContentOriginalStateV1,
): NpCommunityContentOriginalStateV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) conflict();
  const { digest: retainedDigest, ...body } = raw;
  if (
    raw.schemaVersion !== "np.community-content-original-state.v1" ||
    raw.siteId !== input.siteId ||
    serializeAgentCanonicalJson(raw.target) !== serializeAgentCanonicalJson(input.target) ||
    raw.state.kind !== input.target.kind ||
    !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(raw.versionDigest) ||
    Buffer.byteLength(serializeAgentCanonicalJson(raw)) > 16_384 ||
    digest("original-state", body) !== retainedDigest
  )
    conflict();
  if (raw.state.kind === "comment") {
    if (raw.state.status !== "visible" && raw.state.status !== "pending") conflict();
    for (const id of [raw.state.hiddenByUserId, raw.state.hiddenByMemberId])
      if (id !== null) npRequireCommunityId(id, "content-containment.original-state.actor");
    if (raw.state.hiddenReason !== null && typeof raw.state.hiddenReason !== "string") conflict();
  } else if (
    (raw.state.status !== "published" && raw.state.status !== "pending") ||
    typeof raw.state.visibility !== "string" ||
    typeof raw.state.hiddenField !== "string" ||
    raw.state.hiddenValue !== false
  )
    conflict();
  return structuredClone(raw);
}

function unchangedDocumentContent(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  config: NpCollectionConfig,
  hiddenField: string,
): boolean {
  const project = (doc: Record<string, unknown>) => {
    const editable = npCollectionDocumentToWriteInput(doc, config);
    delete editable[hiddenField];
    return {
      editable,
      siteId: doc.siteId,
      memberAuthorId: doc.memberAuthorId ?? null,
      visibility: doc.visibility,
      publishedAt: doc.publishedAt ?? null,
    };
  };
  return (
    digest("unchanged-content", project(before)) === digest("unchanged-content", project(after))
  );
}

async function audit(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1,
  action: string,
  reasonCode: string | null,
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    siteId: input.siteId,
    actorKind: "staff",
    actorUserId: input.user.id,
    actorMemberId: null,
    action,
    targetType: input.target.kind === "comment" ? "comment" : input.target.collection,
    targetId: input.target.id,
    payload: { byStaff: true, containment: true, reasonCode },
  });
}

/** Caller owns the transaction and current staff authorization. No mutation is performed. */
export async function npInspectCommunityContentContainmentV1(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1,
): Promise<{ versionDigest: string }> {
  const loaded = await load(tx, input);
  return { versionDigest: version(input, loaded) };
}

/** Wrap the caller's entire transaction in withDeferredPostCommit, never only this callback. */
export async function npQuarantineCommunityContentV1(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1 & {
    expectedVersionDigest: string;
    reasonCode: string;
  },
): Promise<{
  originalState: NpCommunityContentOriginalStateV1;
  installedVersionDigest: string;
}> {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.reasonCode)) conflict();
  const loaded = await load(tx, input);
  const original = freezeOriginal(input, loaded);
  if (original.versionDigest !== input.expectedVersionDigest) conflict();
  if (loaded.comment) {
    await tx
      .update(npComments)
      .set({
        status: "hidden",
        hiddenByUserId: input.user.id,
        hiddenByMemberId: null,
        hiddenReason: input.reasonCode,
      })
      .where(and(eq(npComments.id, input.target.id), eq(npComments.siteId, input.siteId))!)
      .returning();
  } else {
    const state = original.state;
    if (state.kind !== "document") conflict();
    const result = await saveDocument(
      input.target.collection,
      input.target.id,
      { [state.hiddenField]: true },
      input.user,
      { tx, status: "pending", preserveRevisionHistory: true },
    );
    if (
      result.doc.status !== "pending" ||
      result.doc[state.hiddenField] !== true ||
      !unchangedDocumentContent(loaded.document, result.doc, loaded.config, state.hiddenField)
    )
      conflict();
  }
  const installed = await load(tx, input);
  if (loaded.comment && installed.comment?.status !== "hidden") conflict();
  await audit(tx, input, loaded.comment ? "comment.hide" : "document.unpublish", input.reasonCode);
  if (loaded.comment) {
    const comment = loaded.comment;
    await runPostCommit(
      "community:quarantine-reputation",
      {
        collection: input.target.collection,
        documentId: comment.targetId,
        operation: "update",
      },
      () =>
        applyReputation(comment.memberId, {
          kind: "comment.hidden",
          commentId: comment.id,
          memberId: comment.memberId,
          byStaff: true,
          reason: input.reasonCode,
        }),
    );
    if (comment.status === "visible")
      await runPostCommit(
        "community:quarantine-comments",
        {
          collection: input.target.collection,
          documentId: comment.targetId,
          operation: "update",
        },
        () => npEmitCommunityDocumentChanged("comments", input.target.collection, comment.targetId),
      );
  }
  return { originalState: original, installedVersionDigest: version(input, installed) };
}

/** Restores only retained metadata; edited/deleted/replaced targets remain untouched. */
export async function npRestoreCommunityContentV1(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1 & {
    expectedVersionDigest: string;
    originalState: NpCommunityContentOriginalStateV1;
  },
): Promise<{ restoredVersionDigest: string }> {
  const original = requireOriginal(input, input.originalState);
  const loaded = await load(tx, input);
  if (version(input, loaded) !== input.expectedVersionDigest) conflict();
  const state = original.state;
  if (state.kind === "comment") {
    if (!loaded.comment || loaded.comment.status !== "hidden") conflict();
    await tx
      .update(npComments)
      .set({
        status: state.status,
        hiddenByUserId: state.hiddenByUserId,
        hiddenByMemberId: state.hiddenByMemberId,
        hiddenReason: state.hiddenReason,
      })
      .where(and(eq(npComments.id, input.target.id), eq(npComments.siteId, input.siteId))!)
      .returning();
    if (state.status === "visible")
      await runPostCommit(
        "community:restore-comments",
        {
          collection: input.target.collection,
          documentId: loaded.comment.targetId,
          operation: "update",
        },
        () =>
          npEmitCommunityDocumentChanged(
            "comments",
            input.target.collection,
            loaded.comment!.targetId,
          ),
      );
  } else {
    if (
      loaded.comment ||
      loaded.config.community?.moderation?.hiddenField !== state.hiddenField ||
      loaded.document.status !== "pending" ||
      loaded.document[state.hiddenField] !== true ||
      loaded.document.visibility !== state.visibility
    )
      conflict();
    const result = await saveDocument(
      input.target.collection,
      input.target.id,
      { [state.hiddenField]: state.hiddenValue },
      input.user,
      { tx, status: state.status, preserveRevisionHistory: true },
    );
    if (
      result.doc.status !== state.status ||
      result.doc[state.hiddenField] !== state.hiddenValue ||
      !unchangedDocumentContent(loaded.document, result.doc, loaded.config, state.hiddenField)
    )
      conflict();
  }
  const restored = await load(tx, input);
  const restoredVersionDigest = version(input, restored);
  if (state.kind === "comment") {
    // Comments have no write timestamp for visibility changes. Restoration must
    // reproduce every original field, including the unchanged parent version.
    if (restoredVersionDigest !== original.versionDigest) conflict();
  } else if (
    restored.document.status !== state.status ||
    restored.document[state.hiddenField] !== state.hiddenValue ||
    restored.document.visibility !== state.visibility ||
    !unchangedDocumentContent(loaded.document, restored.document, loaded.config, state.hiddenField)
  )
    conflict();
  await audit(tx, input, state.kind === "comment" ? "comment.restore" : "document.restore", null);
  return { restoredVersionDigest };
}
