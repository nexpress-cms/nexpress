import { createHash } from "node:crypto";
import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
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

/** Internal post-write verification marker; callers must confirm rollback before recording failure. */
export class NpCommunityContainmentVerificationError extends NpValidationError {
  constructor() {
    super("Content containment conflict", [
      {
        field: "target",
        message: "The exact content state is no longer eligible for this action.",
      },
    ]);
  }
}

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

async function assertInput(input: NpCommunityContentContainmentInputV1): Promise<void> {
  npAssertAgentPreviewEffectsAllowed();
  if (!can(input.user, "community.moderate") || (await requireSiteId()) !== input.siteId)
    throw new NpForbiddenError("content", "moderate");
  npRequireCommunityId(input.target.id, "content-containment.target.id");
  if (input.target.kind !== "comment" && input.target.kind !== "document") conflict();
}

async function assertReadable(
  config: NpCollectionConfig,
  input: NpCommunityContentContainmentInputV1,
  document: Record<string, unknown>,
): Promise<void> {
  await npAssertCollectionReadAccess(config, input.target.collection, input.user, document);
  await npRequireReadableCommunityDocument(
    config,
    document,
    { kind: "staff", user: input.user },
    { allowUnpublished: true },
  );
}

async function load(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1,
): Promise<LoadedTarget> {
  await assertInput(input);
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
  await assertReadable(config, input, document);
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

/** Server-only source review seam; the same content owner checks current parent and staff ACLs.
 * The caller must separately bind the retained observation's original document before projection. */
export async function npInspectCommunityCommentEvidenceV1(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1,
): Promise<{ versionDigest: string; comment: NpCommentRow }> {
  if (input.target.kind !== "comment") conflict();
  const loaded = await load(tx, input);
  if (!loaded.comment) conflict();
  return { versionDigest: version(input, loaded), comment: loaded.comment };
}

type CommentEvidence = { versionDigest: string; comment: NpCommentRow };

/** One fresh, bounded evidence pass. Parent hydration is shared only within this
 * call; every comment still gets its own current ACL check and version digest.
 * Mutations continue to use the single-target loader and its original locks. */
export async function npInspectCommunityCommentEvidenceBatchV1(
  tx: NpTransaction,
  input: Omit<NpCommunityContentContainmentInputV1, "target"> & {
    targets: readonly NpCommunityContentTargetV1[];
  },
): Promise<(CommentEvidence | null)[]> {
  if (input.targets.length > 100) conflict();
  const result: (CommentEvidence | null)[] = input.targets.map(() => null);
  if (!input.targets.length) return result;
  for (const target of input.targets) {
    await assertInput({ ...input, target });
    if (target.kind !== "comment") conflict();
  }
  const initial = await tx
    .select()
    .from(npComments)
    .where(
      and(
        eq(npComments.siteId, input.siteId),
        inArray(
          npComments.id,
          input.targets.map((t) => t.id),
        ),
      )!,
    );
  const byId = new Map(
    initial.map((row) => {
      const comment = npRequireCommentRow(row);
      return [comment.id, comment] as const;
    }),
  );
  const groups = new Map<string, { collection: string; documentId: string; indices: number[] }>();
  for (const [index, target] of input.targets.entries()) {
    const comment = byId.get(target.id);
    if (!comment || comment.targetType !== target.collection) continue;
    const key = JSON.stringify([target.collection, comment.targetId]);
    const group = groups.get(key) ?? {
      collection: target.collection,
      documentId: comment.targetId,
      indices: [],
    };
    group.indices.push(index);
    groups.set(key, group);
  }
  const denied = (error: unknown) =>
    error instanceof NpForbiddenError ||
    error instanceof NpNotFoundError ||
    error instanceof NpValidationError;
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      // Unshared parents keep the original single-target read cost and checks.
      if (group.indices.length === 1) {
        const index = group.indices[0];
        result[index] = await npInspectCommunityCommentEvidenceV1(tx, {
          siteId: input.siteId,
          user: input.user,
          target: input.targets[index],
        });
        continue;
      }
      const config = getCollectionConfig(group.collection);
      if (config.community?.comments !== true) conflict();
      const columns = getTableColumns(getCollectionTable(group.collection) as PgTable);
      if (!columns.id || !columns.siteId) conflict();
      await tx
        .select({ id: columns.id })
        .from(getCollectionTable(group.collection) as PgTable)
        .where(and(eq(columns.id, group.documentId), eq(columns.siteId, input.siteId))!)
        .limit(1)
        .for("update");
      // Preserve parent-before-comment locking, then reject moved targets.
      const locked = await tx
        .select()
        .from(npComments)
        .where(
          and(
            eq(npComments.siteId, input.siteId),
            inArray(
              npComments.id,
              group.indices.map((i) => input.targets[i].id),
            ),
          )!,
        )
        .orderBy(asc(npComments.id))
        .for("update");
      const current = new Map(
        locked.map((row) => {
          const comment = npRequireCommentRow(row);
          return [comment.id, comment] as const;
        }),
      );
      const parent = await npGetPersistedCollectionDocumentById(
        group.collection,
        group.documentId,
        input.siteId,
        { tx },
      );
      if (!parent) continue;
      for (const index of group.indices) {
        const target = input.targets[index];
        const selected = { siteId: input.siteId, user: input.user, target };
        try {
          await assertInput(selected);
          if (
            getCollectionConfig(group.collection) !== config ||
            config.community?.comments !== true
          )
            conflict();
          const comment = current.get(target.id);
          if (
            !comment ||
            comment.targetType !== group.collection ||
            comment.targetId !== group.documentId
          )
            continue;
          // A custom ACL must never mutate the document seen by another target.
          const document = structuredClone(parent);
          await assertReadable(config, selected, document);
          result[index] = {
            comment,
            versionDigest: version(selected, { document, config, comment }),
          };
        } catch (error) {
          if (!denied(error)) throw error;
        }
      }
      // ACL callbacks may await host policy reads. A changed/deleted parent or
      // sibling comment must not survive the shared hydration interval, even
      // when the caller supplied an autocommit DB handle rather than a tx.
      if (getCollectionConfig(group.collection) !== config || config.community?.comments !== true)
        conflict();
      const latestParent = await npGetPersistedCollectionDocumentById(
        group.collection,
        group.documentId,
        input.siteId,
        { tx },
      );
      if (
        !latestParent ||
        serializeAgentCanonicalJson(json(latestParent)) !==
          serializeAgentCanonicalJson(json(parent))
      )
        conflict();
      const latestRows = await tx
        .select()
        .from(npComments)
        .where(
          and(
            eq(npComments.siteId, input.siteId),
            inArray(
              npComments.id,
              group.indices.map((i) => input.targets[i].id),
            ),
          )!,
        );
      const latest = new Map(
        latestRows.map((row) => {
          const comment = npRequireCommentRow(row);
          return [comment.id, comment] as const;
        }),
      );
      for (const index of group.indices) {
        const id = input.targets[index].id;
        const before = current.get(id),
          after = latest.get(id);
        if (
          !before ||
          !after ||
          serializeAgentCanonicalJson(json(before)) !== serializeAgentCanonicalJson(json(after))
        )
          result[index] = null;
      }
    } catch (error) {
      if (!denied(error)) throw error;
      for (const index of group.indices) result[index] = null;
    }
  }
  return result;
}

/** Server-only document review uses the same current ACL, lock and version owner. */
export async function npInspectCommunityDocumentEvidenceV1(
  tx: NpTransaction,
  input: NpCommunityContentContainmentInputV1,
): Promise<{
  document: Record<string, unknown>;
  config: NpCollectionConfig;
  versionDigest: string;
  eligible: boolean;
}> {
  if (input.target.kind !== "document") conflict();
  const loaded = await load(tx, input);
  let eligible = true;
  try {
    originalState(loaded);
  } catch (error) {
    if (!(error instanceof NpValidationError)) throw error;
    eligible = false;
  }
  return {
    document: loaded.document,
    config: loaded.config,
    versionDigest: version(input, loaded),
    eligible,
  };
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
      throw new NpCommunityContainmentVerificationError();
  }
  const installed = await load(tx, input);
  if (loaded.comment && installed.comment?.status !== "hidden")
    throw new NpCommunityContainmentVerificationError();
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
