import { and, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  saveDocument,
  npExtractPersistedDocumentMediaReferences,
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../collections/pipeline.js";
import { getCollectionConfig, getCollectionTable } from "../collections/registry.js";
import type { NpAuthUser, NpDocumentStatus } from "../config/types.js";
import { setNavigation } from "../content/helpers.js";
import { npMedia, npMediaRefs } from "../db/schema/media.js";
import { npNavigation, npSettings } from "../db/schema/system.js";
import { npSetMediaReference } from "../media/refs.js";
import { setSeoSettings, removeSeoSettings } from "../settings/service.js";
import { withCurrentSite } from "../sites/context.js";
import { npSetThemeTokensOverlay, npRemoveThemeTokensOverlay } from "../theme/runtime.js";
import {
  npRequireAgentChangeSetProposalCanonical,
  npBuildAgentChangeSetSnapshotCanonicalBytes,
  npDigestAgentChangeSetSnapshotCanonical,
  npRequireAgentChangeSetRollbackCompensationInputV1,
} from "../agent-contract/canonical-changeset.js";
import { npAgentChangeSetLimits } from "../agent-contract/changeset-wire-contract.js";
import type {
  NpAgentInitialChangeSetPlanOperationCanonicalV1,
  NpAgentRollbackChangeSetPlanOperationCanonicalV1,
  NpAgentChangeSetProposalOperationCanonicalV1,
  NpAgentChangeSetOperationInput,
  NpAgentJsonValue,
  NpAgentScope,
  NpAgentChangeSetSnapshotCanonicalV1,
} from "../agent-contract/types.js";
import { digestAgentCanonicalSha256 } from "../agent-contract/canonical-digest.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { createAgentChangeSetResourceServiceV1 } from "./changeset-resources.js";
import { createAgentChangeSetValidationResourceServiceV1 } from "./changeset-validation-resources.js";

interface ApplyInput {
  tx: NpTransaction;
  siteId: string;
  user: NpAuthUser;
  changeSetId: string;
  operations: readonly NpAgentInitialChangeSetPlanOperationCanonicalV1[];
}
export interface NpAgentChangeSetAppliedResourceV1 {
  ordinal: number;
  afterHash: string;
  snapshot: NpAgentChangeSetSnapshotCanonicalV1;
  snapshotHash: string;
}
const conflict = () =>
  new NpAgentGatewayError(
    "CHANGESET_BASE_CONFLICT",
    409,
    "ChangeSet resource changed. Validate a new plan.",
  );

/** Thin transaction-bound adapter over the existing domain writers; admission remains with its caller. */
export function createAgentChangeSetApplyResourceServiceV1() {
  const resources = createAgentChangeSetResourceServiceV1();
  const validation = createAgentChangeSetValidationResourceServiceV1();

  async function lockResources(
    input: Omit<ApplyInput, "operations">,
    entries: readonly NpAgentChangeSetProposalOperationCanonicalV1[],
  ) {
    // Lock actual owner rows before reading any base. The host transaction must also
    // protect absent keys against non-Agent writers (SERIALIZABLE or equivalent).
    const owners = new Map<string, { collection: string; id: string }>();
    for (const entry of entries) {
      if (entry.operation.kind === "document" && entry.canonicalResourceKey.kind === "document")
        owners.set(
          JSON.stringify([
            entry.operation.resource.collection,
            entry.canonicalResourceKey.documentId,
          ]),
          {
            collection: entry.operation.resource.collection,
            id: entry.canonicalResourceKey.documentId,
          },
        );
      if (entry.operation.kind === "media_ref")
        owners.set(
          JSON.stringify([
            entry.operation.resource.collection,
            entry.operation.resource.documentId,
          ]),
          {
            collection: entry.operation.resource.collection,
            id: entry.operation.resource.documentId,
          },
        );
    }
    for (const [, owner] of [...owners].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const table = getCollectionTable(owner.collection) as PgTable;
      const columns = table as unknown as Record<string, Parameters<typeof eq>[0]>;
      await input.tx
        .select({ id: columns.id })
        .from(table)
        .where(and(eq(columns.siteId, input.siteId), eq(columns.id, owner.id))!)
        .limit(1)
        .for("update");
    }
    for (const entry of entries) {
      const op = entry.operation;
      if (op.kind === "navigation")
        await input.tx
          .select({ location: npNavigation.location })
          .from(npNavigation)
          .where(
            and(
              eq(npNavigation.siteId, input.siteId),
              eq(npNavigation.location, op.resource.location),
            )!,
          )
          .limit(1)
          .for("update");
      if (op.kind === "theme_tokens" || op.kind === "setting")
        await input.tx
          .select({ key: npSettings.key })
          .from(npSettings)
          .where(
            and(
              eq(npSettings.siteId, input.siteId),
              eq(npSettings.key, op.kind === "theme_tokens" ? "theme" : op.resource.key),
            )!,
          )
          .limit(1)
          .for("update");
    }
    const mediaIds = [
      ...new Set(
        entries.flatMap(({ operation }) =>
          operation.kind === "media_ref" ? [operation.resource.mediaId] : [],
        ),
      ),
    ].sort();
    for (const id of mediaIds)
      await input.tx
        .select({ id: npMedia.id })
        .from(npMedia)
        .where(and(eq(npMedia.siteId, input.siteId), eq(npMedia.id, id))!)
        .limit(1)
        .for("key share");
  }
  async function writeOperation(
    input: Omit<ApplyInput, "operations">,
    entry: NpAgentChangeSetProposalOperationCanonicalV1,
    preserveRevisionHistory = false,
  ) {
    const op = entry.operation;
    if (op.kind === "document") {
      if (entry.canonicalResourceKey.kind !== "document") throw conflict();
      let status: NpDocumentStatus | undefined;
      let data: Record<string, unknown> = {};
      if (op.operation === "create") {
        data = op.input.document;
        status = op.input.targetStatus;
      }
      if (op.operation === "update") {
        data = op.input.patch;
        status = op.input.targetStatus ?? undefined;
      }
      if (op.operation === "publish") status = "published";
      if (op.operation === "archive") status = "archived";
      if (op.operation === "schedule") {
        status = "scheduled";
        data = { publishedAt: op.input.publishAt };
      }
      await saveDocument(
        op.resource.collection,
        op.operation === "create" ? null : entry.canonicalResourceKey.documentId,
        data,
        input.user,
        {
          tx: input.tx,
          status,
          ...(preserveRevisionHistory ? { preserveRevisionHistory: true as const } : {}),
          ...(op.operation === "create" ? { createId: entry.canonicalResourceKey.documentId } : {}),
        },
      );
    } else if (op.kind === "navigation") {
      await setNavigation(op.resource.location, op.input.items, input.user, {
        tx: input.tx,
        expectedUpdatedAt: op.base.version.replace(/^updated:/u, ""),
      });
    } else if (op.kind === "theme_tokens")
      await npSetThemeTokensOverlay(op.input.tokens, input.user, { tx: input.tx });
    else if (op.kind === "setting") {
      if (op.operation === "remove") await removeSeoSettings(input.siteId, { tx: input.tx });
      else await setSeoSettings(op.input.value, input.user.id, input.siteId, { tx: input.tx });
    } else
      await npSetMediaReference(
        input.tx,
        { siteId: input.siteId, ...op.resource },
        op.operation === "attach",
      );
  }
  async function assertMediaOverlap(
    input: Omit<ApplyInput, "operations">,
    entries: readonly NpAgentChangeSetProposalOperationCanonicalV1[],
  ) {
    // A normal document save rebuilds its complete media index. An explicit relation
    // sharing that owner must agree with the saved content, not silently undo its index.
    const changedDocuments = new Set(
      entries.flatMap(({ operation, canonicalResourceKey }) =>
        operation.kind === "document" && canonicalResourceKey.kind === "document"
          ? [JSON.stringify([operation.resource.collection, canonicalResourceKey.documentId])]
          : [],
      ),
    );
    for (const { operation } of entries) {
      if (operation.kind !== "media_ref") continue;
      const resource = operation.resource;
      const attached = operation.operation === "attach";
      const rows = await input.tx
        .select({ id: npMediaRefs.id })
        .from(npMediaRefs)
        .where(
          and(
            eq(npMediaRefs.siteId, input.siteId),
            eq(npMediaRefs.mediaId, resource.mediaId),
            eq(npMediaRefs.collection, resource.collection),
            eq(npMediaRefs.documentId, resource.documentId),
            eq(npMediaRefs.field, resource.field),
          )!,
        )
        .limit(2);
      if (rows.length !== (attached ? 1 : 0)) throw conflict();
      if (changedDocuments.has(JSON.stringify([resource.collection, resource.documentId]))) {
        const document = await npGetPersistedCollectionDocumentById(
          resource.collection,
          resource.documentId,
          input.siteId,
          { tx: input.tx },
        );
        if (!document) throw conflict();
        const refs = npExtractPersistedDocumentMediaReferences(
          getCollectionConfig(resource.collection).fields,
          document,
        );
        if (
          refs.some((ref) => ref.mediaId === resource.mediaId && ref.field === resource.field) !==
          attached
        )
          throw conflict();
      }
    }
  }

  async function apply(
    input: ApplyInput,
  ): Promise<{ operations: NpAgentChangeSetAppliedResourceV1[] }> {
    const proposal = npRequireAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: input.siteId,
      changeSetId: input.changeSetId,
      draftVersion: 1,
      title: "Apply",
      summary: null,
      operations: input.operations.map(({ ordinal, operation, canonicalResourceKey }) => ({
        ordinal,
        operation,
        canonicalResourceKey,
      })),
    });
    return withCurrentSite(input.siteId, async () => {
      await lockResources(input, proposal.operations);
      const reservedCreateDocumentIds = proposal.operations.flatMap(
        ({ operation, canonicalResourceKey }) =>
          operation.kind === "document" &&
          operation.operation === "create" &&
          canonicalResourceKey.kind === "document"
            ? [canonicalResourceKey.documentId]
            : [],
      );
      for (const entry of proposal.operations) {
        const current = await validation.readBase({
          ...input,
          ...entry,
          reservedCreateDocumentIds,
        });
        const expected = entry.operation.base;
        if (
          expected === null
            ? current.base !== null
            : current.base === null ||
              expected.version !== current.base.version ||
              expected.digest !== current.base.digest
        )
          throw conflict();
        await resources.prepare({ ...input, ...entry, reservedCreateDocumentIds });
      }

      for (const entry of proposal.operations) {
        // Earlier operations may change an overlapping owner's current item authority.
        await resources.prepare({ ...input, ...entry, reservedCreateDocumentIds });
        await writeOperation(input, entry);
      }

      await assertMediaOverlap(input, proposal.operations);
      const operations: NpAgentChangeSetAppliedResourceV1[] = [];
      let snapshotBytes = 0;
      for (const entry of proposal.operations) {
        const current = await validation.readCurrent({ ...input, ...entry });
        snapshotBytes += npBuildAgentChangeSetSnapshotCanonicalBytes(current.snapshot)
          .canonicalJsonUtf8.byteLength;
        if (snapshotBytes > npAgentChangeSetLimits.aggregateSnapshotBytes)
          throw new NpAgentGatewayError(
            "CHANGESET_LIMIT_EXCEEDED",
            400,
            "ChangeSet applied snapshots exceed the bounded evidence limit.",
          );
        operations.push({
          ordinal: entry.ordinal,
          afterHash: current.beforeHash,
          snapshot: current.snapshot,
          snapshotHash: current.snapshotHash,
        });
      }
      return { operations };
    });
  }
  type Context = Omit<ApplyInput, "operations">;
  type RollbackEntry = NpAgentRollbackChangeSetPlanOperationCanonicalV1;
  type RollbackInput = Context & {
    operations: readonly RollbackEntry[];
    beforeSnapshots: readonly NpAgentChangeSetSnapshotCanonicalV1[];
  };
  const unavailable = () =>
    new NpAgentGatewayError(
      "CHANGESET_ROLLBACK_UNAVAILABLE",
      409,
      "Rollback evidence is unavailable.",
    );
  const hash = (value: unknown) =>
    digestAgentCanonicalSha256(new TextEncoder().encode(serializeAgentCanonicalJson(value)));
  const same = (a: unknown, b: unknown) =>
    serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
  function readEntry(entry: RollbackEntry): NpAgentChangeSetProposalOperationCanonicalV1 {
    const op = npRequireAgentChangeSetRollbackCompensationInputV1(entry.compensationOperation);
    const base = { version: entry.expectedCurrentVersion, digest: entry.expectedCurrentHash };
    let operation: NpAgentChangeSetOperationInput;
    if (op.operation !== "restore") operation = op;
    else if (op.kind === "document")
      operation = {
        kind: "document",
        operation: "update",
        resource: op.resource,
        clientOperationId: `rollback-${entry.ordinal}`,
        reason: null,
        base,
        input: { patch: {}, targetStatus: null },
      };
    else
      operation = {
        kind: "theme_tokens",
        operation: "replace",
        resource: op.resource,
        clientOperationId: `rollback-${entry.ordinal}`,
        reason: null,
        base,
        input: { tokens: {} },
      };
    return { ordinal: entry.ordinal, canonicalResourceKey: entry.canonicalResourceKey, operation };
  }
  async function boundSnapshot(input: RollbackInput, entry: RollbackEntry) {
    const matches = input.beforeSnapshots.filter(
      (s) => s.operationOrdinal === entry.originalOperationOrdinal,
    );
    if (matches.length !== 1) throw unavailable();
    const snapshot = matches[0];
    if (
      snapshot.siteId !== input.siteId ||
      snapshot.changeSetId !== input.changeSetId ||
      !same(snapshot.canonicalResourceKey, entry.canonicalResourceKey) ||
      (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== entry.originalSnapshotHash
    )
      throw unavailable();
    return snapshot;
  }
  async function readRollback(input: Context & { operation: RollbackEntry }) {
    return validation.readCurrent({ ...input, ...readEntry(input.operation) });
  }
  async function admitRollback(input: RollbackInput, entry: RollbackEntry) {
    const snapshot = await boundSnapshot(input, entry);
    const synthetic = readEntry(entry);
    const op = entry.compensationOperation;
    const value = snapshot.value as Record<string, NpAgentJsonValue> | null;
    if (op.operation !== "restore") {
      if (op.kind === "document" && (op.operation !== "archive" || snapshot.presence !== "absent"))
        throw unavailable();
      if (
        op.kind === "navigation" &&
        (snapshot.presence !== "present" || !same(op.input.items, value?.items))
      )
        throw unavailable();
      if (
        op.kind === "setting" &&
        (snapshot.presence === "absent"
          ? op.operation !== "remove"
          : op.operation !== "replace" || !same(op.input.value, value?.value))
      )
        throw unavailable();
      if (
        op.kind === "media_ref" &&
        (snapshot.presence !== "present" || value?.attached !== (op.operation === "attach"))
      )
        throw unavailable();
      if (op.kind === "theme_tokens") throw unavailable();
    }
    if (
      entry.compensationOperation.operation === "restore" &&
      entry.compensationOperation.kind === "document"
    ) {
      return resources.prepareDocumentRestore({ ...input, ...synthetic, snapshot });
    }
    if (entry.compensationOperation.operation === "restore") {
      const value = snapshot.value as { value: unknown } | null;
      if (synthetic.operation.kind !== "theme_tokens") throw unavailable();
      synthetic.operation = {
        ...synthetic.operation,
        input: {
          tokens: (snapshot.presence === "absent"
            ? {}
            : value?.value) as typeof synthetic.operation.input.tokens,
        },
      };
    }
    await resources.prepare({ ...input, ...synthetic, reservedCreateDocumentIds: [] });
    return resources.inspectForValidation({
      ...input,
      ...synthetic,
      reservedCreateDocumentIds: [],
    });
  }
  async function prepareRollback(
    input: Context & {
      operations: readonly NpAgentInitialChangeSetPlanOperationCanonicalV1[];
      /** Matched by operationOrdinal, never trusted by array position. */
      beforeSnapshots: readonly NpAgentChangeSetSnapshotCanonicalV1[];
      /** The immutable original execution resultBody.operations, matched by ordinal. */
      appliedResources: readonly NpAgentChangeSetAppliedResourceV1[];
    },
  ) {
    if (
      !input.operations.length ||
      input.operations.length > npAgentChangeSetLimits.operations ||
      input.beforeSnapshots.length !== input.operations.length ||
      input.appliedResources.length !== input.operations.length
    )
      throw unavailable();
    const operations: RollbackEntry[] = [];
    const snapshots: NpAgentChangeSetSnapshotCanonicalV1[] = [];
    const requiredScopes = new Set<NpAgentScope>();
    const requiredApplyScopes = new Set<NpAgentScope>();
    await withCurrentSite(input.siteId, async () => {
      for (const original of input.operations) {
        if (operations.some((e) => e.ordinal === original.ordinal)) throw unavailable();
        const before = input.beforeSnapshots.filter((s) => s.operationOrdinal === original.ordinal);
        const applied = input.appliedResources.filter((s) => s.ordinal === original.ordinal);
        if (before.length !== 1 || applied.length !== 1) throw unavailable();
        const snapshot = before[0],
          result = applied[0];
        if (
          (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== original.snapshotHash ||
          snapshot.siteId !== input.siteId ||
          snapshot.changeSetId !== input.changeSetId ||
          !same(snapshot.canonicalResourceKey, original.canonicalResourceKey)
        )
          throw unavailable();
        if (
          result.snapshot.siteId !== input.siteId ||
          result.snapshot.changeSetId !== input.changeSetId ||
          result.snapshot.operationOrdinal !== original.ordinal ||
          !same(result.snapshot.canonicalResourceKey, original.canonicalResourceKey) ||
          (await npDigestAgentChangeSetSnapshotCanonical(result.snapshot)) !==
            result.snapshotHash ||
          (await validation.hashSnapshot(result.snapshot)) !== result.afterHash
        )
          throw unavailable();
        const current = await validation.readCurrent({ ...input, ...original });
        if (
          current.beforeHash !== result.afterHash ||
          current.base?.version !== result.snapshot.base?.version
        )
          throw conflict();
        const base = current.base;
        const common = { clientOperationId: `rollback-${original.ordinal}`, reason: null, base };
        const op = original.operation;
        let compensationOperation: RollbackEntry["compensationOperation"];
        let target = snapshot;
        if (op.kind === "document") {
          if (original.canonicalResourceKey.kind !== "document") throw unavailable();
          const resource = {
            collection: op.resource.collection,
            documentId: original.canonicalResourceKey.documentId,
          };
          if (op.operation === "create") {
            if (snapshot.presence !== "absent" || !base) throw unavailable();
            compensationOperation = {
              ...common,
              base,
              kind: "document",
              operation: "archive",
              resource,
              input: {},
            };
            target = {
              ...current.snapshot,
              value: {
                ...(current.snapshot.value as Record<string, NpAgentJsonValue>),
                status: "archived",
              },
            };
          } else compensationOperation = { kind: "document", operation: "restore", resource };
          requiredApplyScopes.add("content:draft");
          requiredApplyScopes.add("content:publish");
        } else if (op.kind === "theme_tokens") {
          compensationOperation = {
            kind: "theme_tokens",
            operation: "restore",
            resource: op.resource,
          };
          requiredApplyScopes.add("theme:write");
        } else if (op.kind === "navigation") {
          if (!base || snapshot.presence !== "present") throw unavailable();
          compensationOperation = {
            ...common,
            base,
            kind: "navigation",
            operation: "replace",
            resource: op.resource,
            input: { items: (snapshot.value as unknown as { items: typeof op.input.items }).items },
          };
          requiredApplyScopes.add("navigation:write");
        } else if (op.kind === "setting") {
          if (snapshot.presence === "absent") {
            if (!base) throw unavailable();
            compensationOperation = {
              ...common,
              base,
              kind: "setting",
              operation: "remove",
              resource: op.resource,
              input: {},
            };
          } else
            compensationOperation = {
              ...common,
              kind: "setting",
              operation: "replace",
              resource: op.resource,
              input: { value: (snapshot.value as { value: NpAgentJsonValue }).value },
            };
          requiredApplyScopes.add("settings:write");
        } else {
          if (!base || snapshot.presence !== "present") throw unavailable();
          const attached = (snapshot.value as { attached: unknown }).attached;
          if (typeof attached !== "boolean") throw unavailable();
          compensationOperation = {
            ...common,
            base,
            kind: "media_ref",
            operation: attached ? "attach" : "detach",
            resource: op.resource,
            input: {},
          };
          requiredApplyScopes.add("content:draft");
          requiredApplyScopes.add("media:read");
          requiredApplyScopes.add("media:write");
        }
        const entry: RollbackEntry = {
          ordinal: original.ordinal,
          originalOperationOrdinal: original.ordinal,
          canonicalResourceKey: original.canonicalResourceKey,
          originalSnapshotHash: original.snapshotHash,
          expectedCurrentHash: current.beforeHash,
          expectedCurrentVersion: current.base?.version ?? "absent",
          compensationOperation,
          proposedAfterHash: await validation.hashSnapshot(target),
          rollbackClass: original.rollbackClass,
          residualCodes: original.residualCodes,
        };
        const admitted = await admitRollback({ ...input, operations: [entry] }, entry);
        admitted.requiredScopes.forEach((s) => requiredScopes.add(s));
        operations.push(entry);
        snapshots.push(current.snapshot);
      }
    });
    const partial = operations.some((e) => e.rollbackClass === "residual");
    return {
      operations,
      snapshots,
      requiredScopes: [...requiredScopes].sort(),
      requiredApplyScopes: [...requiredApplyScopes].sort(),
      baseFingerprint: await hash({
        domain: "np.agent-changeset-rollback-bases.v1",
        siteId: input.siteId,
        bases: operations.map((e) => ({
          ordinal: e.ordinal,
          key: e.canonicalResourceKey,
          hash: e.expectedCurrentHash,
          version: e.expectedCurrentVersion,
        })),
      }),
      policyHashes: [
        await hash({
          domain: "np.agent-changeset-rollback-resource-policy.v1",
          snapshotRestore: 1,
          limits: npAgentChangeSetLimits,
        }),
      ],
      risk: {
        level: "high" as const,
        reasonCodes: partial ? ["ROLLBACK_PARTIAL" as const] : [],
        approvalMode: "human" as const,
        reversible: !partial,
      },
    };
  }
  async function applyRollback(
    input: RollbackInput,
  ): Promise<{ operations: NpAgentChangeSetAppliedResourceV1[] }> {
    if (
      !input.operations.length ||
      input.operations.length > npAgentChangeSetLimits.operations ||
      input.beforeSnapshots.length !== input.operations.length ||
      new Set(input.operations.map((e) => e.ordinal)).size !== input.operations.length
    )
      throw unavailable();
    return withCurrentSite(input.siteId, async () => {
      const entries = input.operations.map(readEntry);
      await lockResources(input, entries);
      for (const entry of input.operations) {
        const current = await readRollback({ ...input, operation: entry });
        if (
          current.beforeHash !== entry.expectedCurrentHash ||
          (current.base?.version ?? "absent") !== entry.expectedCurrentVersion
        )
          throw conflict();
        await admitRollback(input, entry);
      }
      for (const entry of input.operations) {
        const admitted = await admitRollback(input, entry);
        const op = entry.compensationOperation;
        if (op.operation !== "restore") await writeOperation(input, readEntry(entry), true);
        else if (op.kind === "document") {
          if (!("data" in admitted)) throw unavailable();
          await saveDocument(
            op.resource.collection,
            op.resource.documentId,
            admitted.data,
            input.user,
            { tx: input.tx, status: admitted.status, preserveRevisionHistory: true },
          );
        } else {
          const snapshot = await boundSnapshot(input, entry);
          if (snapshot.presence === "absent")
            await npRemoveThemeTokensOverlay(input.user, { tx: input.tx });
          else
            await npSetThemeTokensOverlay(
              (snapshot.value as { value: unknown }).value,
              input.user,
              { tx: input.tx },
            );
        }
      }
      await assertMediaOverlap(input, entries);
      const operations: NpAgentChangeSetAppliedResourceV1[] = [];
      let bytes = 0;
      for (const entry of input.operations) {
        const current = await readRollback({ ...input, operation: entry });
        bytes += npBuildAgentChangeSetSnapshotCanonicalBytes(current.snapshot).canonicalJsonUtf8
          .byteLength;
        if (bytes > npAgentChangeSetLimits.aggregateSnapshotBytes) throw unavailable();
        operations.push({
          ordinal: entry.ordinal,
          afterHash: current.beforeHash,
          snapshot: current.snapshot,
          snapshotHash: current.snapshotHash,
        });
      }
      return { operations };
    });
  }

  return { apply, prepareRollback, applyRollback, readRollback };
}
