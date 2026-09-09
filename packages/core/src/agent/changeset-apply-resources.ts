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
import { npSetThemeTokensOverlay } from "../theme/runtime.js";
import {
  npRequireAgentChangeSetProposalCanonical,
  npBuildAgentChangeSetSnapshotCanonicalBytes,
} from "../agent-contract/canonical-changeset.js";
import { npAgentChangeSetLimits } from "../agent-contract/changeset-wire-contract.js";
import type {
  NpAgentInitialChangeSetPlanOperationCanonicalV1,
  NpAgentChangeSetSnapshotCanonicalV1,
} from "../agent-contract/types.js";
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
      // Lock actual owner rows before reading any base. The host transaction must also
      // protect absent keys against non-Agent writers (SERIALIZABLE or equivalent).
      const owners = new Map<string, { collection: string; id: string }>();
      for (const entry of proposal.operations) {
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
      for (const entry of proposal.operations) {
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
          proposal.operations.flatMap(({ operation }) =>
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
        const op = entry.operation;
        // Earlier operations may change an overlapping owner's current item authority.
        await resources.prepare({ ...input, ...entry, reservedCreateDocumentIds });
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
              ...(op.operation === "create"
                ? { createId: entry.canonicalResourceKey.documentId }
                : {}),
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

      // A normal document save rebuilds its complete media index. An explicit relation
      // sharing that owner must agree with the saved content, not silently undo its index.
      const changedDocuments = new Set(
        proposal.operations.flatMap(({ operation, canonicalResourceKey }) =>
          operation.kind === "document" && canonicalResourceKey.kind === "document"
            ? [JSON.stringify([operation.resource.collection, canonicalResourceKey.documentId])]
            : [],
        ),
      );
      for (const { operation } of proposal.operations) {
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
  return { apply };
}
