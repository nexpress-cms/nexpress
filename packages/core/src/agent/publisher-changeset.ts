import { and, eq, gte, or, sql } from "drizzle-orm";
import { npAgentChangesets, npAgentChangesetOperations, npAgentRuns } from "../db/schema/agent.js";
import { npAgentPublisherProposalCooldownSecondsV1 } from "../agent-contract/publisher-recipe-contract.js";
import type { NpAgentChangeSetDraftInputV1 } from "../agent-contract/changeset-wire-contract.js";
import type { NpAgentChangeSetCapabilityInvocationRequestV1 } from "../agent-contract/installed-capability-contract.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { getCollectionConfig } from "../collections/registry.js";
import type { NpFieldConfig } from "../config/types.js";
import {
  npIsAgentRuntimeDocumentEvidenceReaderV1,
  type NpAgentRuntimeDocumentEvidenceReaderV1,
} from "./read-capability-executors.js";

function reject(
  code:
    | "PUBLISHER_PROPOSAL_UNAVAILABLE"
    | "PUBLISHER_PROPOSAL_DUPLICATE" = "PUBLISHER_PROPOSAL_UNAVAILABLE",
): never {
  throw new NpAgentGatewayError(code, 409, "Publisher content review proposal is unavailable.");
}

// Collection schemas omit hidden fields at every structured level. A proposal
// must stay within that visible shape; the resource owner still validates values.
function visiblePatch(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const node = schema as Record<string, unknown>;
  if (Array.isArray(value))
    return !node.items || value.every((item) => visiblePatch(item, node.items));
  if (!value || typeof value !== "object") return true;
  const properties = node.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties))
    return Object.entries(value).every(
      ([key, child]) =>
        Object.hasOwn(properties, key) &&
        visiblePatch(child, (properties as Record<string, unknown>)[key]),
    );
  return true;
}

/** A top-level replacement must never erase nested fields omitted from model evidence. */
export function npPublisherPatchPreservesProtectedFieldsV1(
  patch: Record<string, unknown>,
  fields: readonly NpFieldConfig[],
): boolean {
  const flatten = (
    fields: readonly NpFieldConfig[],
  ): Exclude<NpFieldConfig, { type: "row" | "collapsible" }>[] =>
    fields.flatMap((field) =>
      field.type === "row" || field.type === "collapsible" ? flatten(field.fields) : [field],
    );
  const protectedField = (
    field: Exclude<NpFieldConfig, { type: "row" | "collapsible" }>,
  ): boolean =>
    field.hidden === true ||
    field.admin?.readOnly === true ||
    field.type === "blocks" ||
    ((field.type === "group" || field.type === "array") &&
      flatten(field.fields).some(protectedField));
  const definitions = new Map(flatten(fields).map((field) => [field.name, field]));
  return Object.keys(patch).every((key) => {
    const field = definitions.get(key);
    return field !== undefined && !protectedField(field);
  });
}

/** This recipe stops at its own draft/preview even when a host grants broader modes. */
export async function npAssertPublisherChangeSetRequestV1(
  context: NpAgentRuntimeRunContextV1,
  request: NpAgentChangeSetCapabilityInvocationRequestV1,
): Promise<void> {
  if (context.run.recipeId !== "publisher.stale-content") return;
  if (request.capabilityId === "changeset.create") return;
  if (
    request.capabilityId !== "changeset.get" &&
    request.capabilityId !== "changeset.validate" &&
    request.capabilityId !== "changeset.preview"
  )
    reject();
  const [row] = await context.db
    .select({ id: npAgentChangesets.id })
    .from(npAgentChangesets)
    .where(
      and(
        eq(npAgentChangesets.siteId, context.siteId),
        eq(npAgentChangesets.id, request.arguments.input.changeSetId),
        eq(npAgentChangesets.runId, context.run.id),
        eq(npAgentChangesets.creatorKind, "runtime"),
      ),
    )
    .limit(1);
  if (!row) reject();
}

/** Called within the existing live Runtime authority / ChangeSet creation transaction. */
export async function npAssertPublisherChangeSetDraftV1(input: {
  context: NpAgentRuntimeRunContextV1;
  reader: NpAgentRuntimeDocumentEvidenceReaderV1 | undefined;
  draft: NpAgentChangeSetDraftInputV1;
}): Promise<void> {
  const { context, reader, draft } = input;
  if (context.run.recipeId !== "publisher.stale-content") return;
  if (!reader || !npIsAgentRuntimeDocumentEvidenceReaderV1(reader) || !context.staffUser) reject();
  const settings = context.evidence.definition.settings.find(
    (s) => s.recipeId === "publisher.stale-content",
  );
  if (
    !settings ||
    settings.recipeId !== "publisher.stale-content" ||
    draft.operations.length < 1 ||
    draft.operations.length > settings.batchSize
  )
    reject();
  const selected = await reader.publisherCandidates(context);
  const keys = new Set<string>();
  for (const op of draft.operations) {
    if (
      op.kind !== "document" ||
      op.operation !== "update" ||
      op.input.targetStatus !== "published" ||
      Object.keys(op.input.patch).length === 0
    )
      reject();
    const candidate = selected.candidates.find(
      (c) => c.collection === op.resource.collection && c.documentId === op.resource.documentId,
    );
    const key = `${op.resource.collection}:${op.resource.documentId}`;
    if (
      !candidate ||
      !op.base ||
      candidate.base.version !== op.base.version ||
      candidate.base.digest !== op.base.digest ||
      keys.has(key)
    )
      reject();
    const properties = candidate.schema.properties;
    const data =
      properties && typeof properties === "object" && !Array.isArray(properties)
        ? properties.data
        : undefined;
    if (
      !visiblePatch(op.input.patch, data) ||
      !npPublisherPatchPreservesProtectedFieldsV1(
        op.input.patch,
        getCollectionConfig(op.resource.collection).fields,
      )
    )
      reject();
    keys.add(key);
  }
  // Independent Publisher runs and principals serialize on the same sorted document
  // keys. The second transaction then sees the first committed draft under READ COMMITTED.
  for (const key of [...keys].sort())
    await context.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-publisher:${context.siteId}:${key}`},0))`,
    );
  const [priorRunDraft] = await context.db
    .select({ id: npAgentChangesets.id })
    .from(npAgentChangesets)
    .where(
      and(
        eq(npAgentChangesets.siteId, context.siteId),
        eq(npAgentChangesets.runId, context.run.id),
      ),
    )
    .limit(1);
  if (priorRunDraft) reject("PUBLISHER_PROPOSAL_DUPLICATE");
  const cutoff = new Date(context.now.getTime() - npAgentPublisherProposalCooldownSecondsV1 * 1000);
  for (const op of draft.operations) {
    if (op.kind !== "document" || op.operation !== "update") reject();
    const [prior] = await context.db
      .select({ id: npAgentChangesets.id })
      .from(npAgentChangesetOperations)
      .innerJoin(
        npAgentChangesets,
        and(
          eq(npAgentChangesets.id, npAgentChangesetOperations.changesetId),
          eq(npAgentChangesets.siteId, npAgentChangesetOperations.siteId),
        ),
      )
      .innerJoin(
        npAgentRuns,
        and(
          eq(npAgentRuns.id, npAgentChangesets.runId),
          eq(npAgentRuns.siteId, npAgentChangesets.siteId),
        ),
      )
      .where(
        and(
          eq(npAgentChangesets.siteId, context.siteId),
          eq(npAgentChangesets.creatorKind, "runtime"),
          eq(npAgentRuns.recipeId, "publisher.stale-content"),
          eq(npAgentChangesetOperations.resourceKind, "document"),
          sql`${npAgentChangesetOperations.resourceKey}->>'collection' = ${op.resource.collection}`,
          sql`${npAgentChangesetOperations.resourceKey}->>'documentId' = ${op.resource.documentId}`,
          sql`${npAgentChangesetOperations.baseVersion}->>'version' = ${op.base.version}`,
          sql`${npAgentChangesetOperations.baseVersion}->>'digest' = ${op.base.digest}`,
          or(
            gte(npAgentChangesets.createdAt, cutoff),
            sql`${npAgentChangesets.state} not in ('verified','rejected','cancelled','rolled_back')`,
          ),
        ),
      )
      .limit(1);
    if (prior) reject("PUBLISHER_PROPOSAL_DUPLICATE");
  }
}
