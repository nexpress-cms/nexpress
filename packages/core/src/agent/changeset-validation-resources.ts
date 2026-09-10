import { and, desc, eq, ne } from "drizzle-orm";
import {
  npParseCollectionDocumentWire,
  NpCollectionContractError,
  npSerializeCollectionDocument,
} from "../collection-contract/contract.js";
import {
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../collections/pipeline.js";
import { getCollectionConfig, getCollectionTable } from "../collections/registry.js";
import type { PgTable } from "drizzle-orm/pg-core";
import type { NpAuthUser } from "../config/types.js";
import { npMedia, npMediaRefs } from "../db/schema/media.js";
import { npNavigation, npRevisions, npSettings } from "../db/schema/system.js";
import { npValidateNavigationItems } from "../navigation/contract.js";
import { npAssertSettingValue, npNormalizeSeoSettings } from "../settings/contract.js";
import { npAssertSiteDocumentCreateQuota, type NpSiteQuotaDb } from "../sites/quotas.js";
import {
  npRequireAgentChangeSetProposalCanonical,
  npBuildAgentChangeSetSnapshotCanonicalBytes,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../agent-contract/canonical-changeset.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { digestAgentCanonicalSha256 } from "../agent-contract/canonical-digest.js";
import {
  npAgentChangeSetLimits,
  type NpAgentValidationIssueWire,
} from "../agent-contract/changeset-wire-contract.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetProposalOperationCanonicalV1,
  NpAgentChangeSetResourceKeyV1,
  NpAgentChangeSetSnapshotCanonicalV1,
  NpAgentInitialChangeSetPlanOperationCanonicalV1,
  NpAgentJsonValue,
  NpAgentRiskReasonCode,
  NpAgentRiskSummary,
  NpAgentScope,
  NpAgentVersionBaseV1,
} from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { createAgentChangeSetResourceServiceV1 } from "./changeset-resources.js";

interface Context {
  tx: NpTransaction;
  siteId: string;
  user: NpAuthUser;
  changeSetId: string;
}
interface ReadInput extends Context, NpAgentChangeSetProposalOperationCanonicalV1 {
  reservedCreateDocumentIds?: readonly string[];
  currentResource?: boolean;
}
interface ValidateInput extends Context {
  operations: NpAgentChangeSetProposalOperationCanonicalV1[];
  now: Date;
}
export interface NpAgentChangeSetValidationResourcesResultV1 {
  operations: NpAgentInitialChangeSetPlanOperationCanonicalV1[];
  snapshots: NpAgentChangeSetSnapshotCanonicalV1[];
  baseFingerprint: string;
  risk: NpAgentRiskSummary;
  requiredScopes: NpAgentScope[];
  requiredApplyScopes: NpAgentScope[];
  policyHashes: string[];
}
const encoder = new TextEncoder();
const messages: Record<NpAgentValidationIssueWire["code"], string> = {
  SCHEMA_INVALID: "Resource input is invalid.",
  ACCESS_DENIED: "Resource access is unavailable.",
  RESOURCE_NOT_FOUND: "Resource is unavailable.",
  BASE_CONFLICT: "The resource base has changed. Refresh the draft and validate again.",
  REFERENCE_INVALID: "A resource reference is unavailable.",
  QUOTA_EXCEEDED: "The projected resource quota is exceeded.",
  LIMIT_EXCEEDED: "Validation evidence exceeds its bounded limit.",
  POLICY_BLOCKED: "The resource operation is blocked by current policy.",
  ROLLBACK_UNAVAILABLE: "Bounded rollback evidence is unavailable.",
  ROUTE_COLLISION: "The proposed route is unavailable.",
  LINK_INVALID: "A proposed link is invalid.",
  SEO_INVALID: "The proposed SEO value is invalid.",
  ACCESSIBILITY_ERROR: "The proposed content fails an accessibility check.",
  PREVIEW_REQUIRED: "A preview is required.",
  VALIDATION_FAILED: "Resource validation could not be completed.",
};
function issue(
  code: NpAgentValidationIssueWire["code"],
  ordinal: number | null,
): NpAgentValidationIssueWire {
  return {
    code,
    severity: "error",
    operationOrdinal: ordinal,
    path: ordinal === null ? "operations" : `operations[${ordinal.toString()}]`,
    message: messages[code],
    evidenceRefs: [],
  };
}
export class NpAgentChangeSetValidationResourceErrorV1 extends Error {
  readonly issues: NpAgentValidationIssueWire[];
  constructor(issues: NpAgentValidationIssueWire[]) {
    super("ChangeSet resource validation failed.");
    this.name = "NpAgentChangeSetValidationResourceErrorV1";
    this.issues = issues.slice(0, npAgentChangeSetLimits.validationIssues);
  }
}
function fail(code: NpAgentValidationIssueWire["code"], ordinal: number | null): never {
  throw new NpAgentChangeSetValidationResourceErrorV1([issue(code, ordinal)]);
}
function safeError(error: unknown, ordinal: number): NpAgentValidationIssueWire[] {
  if (error instanceof NpAgentChangeSetValidationResourceErrorV1) return error.issues;
  if (error instanceof NpAgentGatewayError) {
    const codes: Record<string, NpAgentValidationIssueWire["code"]> = {
      CHANGESET_ACCESS_DENIED: "ACCESS_DENIED",
      CHANGESET_RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
      CHANGESET_SCHEMA_INVALID: "SCHEMA_INVALID",
      CHANGESET_REFERENCE_INVALID: "REFERENCE_INVALID",
    };
    return [issue(codes[error.code] ?? "VALIDATION_FAILED", ordinal)];
  }
  return [issue("VALIDATION_FAILED", ordinal)];
}
function json(value: unknown): NpAgentJsonValue {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(json);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, json(child)]),
    );
  return value as NpAgentJsonValue;
}
function utc(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error("Invalid persisted timestamp");
  return value.toISOString();
}
async function resourceHash(
  siteId: string,
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1,
  presence: "present" | "absent",
  value: NpAgentJsonValue | null,
): Promise<string> {
  return digestAgentCanonicalSha256(
    encoder.encode(
      `np.agent-changeset-resource.v1\0${serializeAgentCanonicalJson({ siteId, canonicalResourceKey, presence, value })}`,
    ),
  );
}
function semanticDocument(document: Record<string, unknown>): NpAgentJsonValue {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    ...value
  } = document;
  return json(value);
}
function applyScopes(operation: NpAgentChangeSetOperationInput): NpAgentScope[] {
  switch (operation.kind) {
    case "document":
      return ["content:draft", "content:publish"];
    case "navigation":
      return ["navigation:write"];
    case "theme_tokens":
      return ["theme:write"];
    case "setting":
      return ["settings:write"];
    case "media_ref":
      return ["content:draft", "media:read", "media:write"];
  }
}

/** All reads use the caller's transaction. This service never opens a transaction or writes. */
export function createAgentChangeSetValidationResourceServiceV1() {
  const resources = createAgentChangeSetResourceServiceV1();
  async function inspect(input: ReadInput) {
    const inspected = await resources.inspectForValidation({
      ...input,
      reservedCreateDocumentIds: input.reservedCreateDocumentIds ?? [],
    });
    const { operation, canonicalResourceKey } = input;
    let presence: "present" | "absent" = "present";
    let value: NpAgentJsonValue | null;
    let semantic: NpAgentJsonValue | null;
    let version: string;
    if (operation.kind === "document") {
      if (canonicalResourceKey.kind !== "document" || !inspected.document)
        fail("SCHEMA_INVALID", input.ordinal);
      if (operation.operation === "create" && !input.currentResource) {
        const collision = await npGetPersistedCollectionDocumentById(
          operation.resource.collection,
          canonicalResourceKey.documentId,
          input.siteId,
          { tx: input.tx },
        );
        if (collision) fail("BASE_CONFLICT", input.ordinal);
        presence = "absent";
        value = null;
        semantic = null;
        version = "absent";
      } else {
        const document = inspected.document.original;
        if (!document) fail("RESOURCE_NOT_FOUND", input.ordinal);
        value = json(npSerializeCollectionDocument(document, inspected.document.config));
        semantic = semanticDocument(document);
        const timestamp =
          inspected.document.config.timestamps === false
            ? "untimestamped"
            : utc(document.updatedAt);
        if (inspected.document.config.versions) {
          const [head] = (await input.tx
            .select({ id: npRevisions.id, version: npRevisions.version })
            .from(npRevisions)
            .where(
              and(
                eq(npRevisions.collection, operation.resource.collection),
                eq(npRevisions.documentId, canonicalResourceKey.documentId),
                ne(npRevisions.status, "autosave"),
              )!,
            )
            .orderBy(desc(npRevisions.version))
            .limit(1)) as Array<{ id: string; version: number }>;
          if (!head || !Number.isSafeInteger(head.version) || head.version < 1)
            fail("ROLLBACK_UNAVAILABLE", input.ordinal);
          version = `revision:${head.id}:${head.version.toString()}:${timestamp}`;
        } else version = `updated:${timestamp}`;
      }
    } else if (operation.kind === "navigation") {
      const [row] = (await input.tx
        .select()
        .from(npNavigation)
        .where(
          and(
            eq(npNavigation.siteId, input.siteId),
            eq(npNavigation.location, operation.resource.location),
          )!,
        )
        .limit(1)) as Array<typeof npNavigation.$inferSelect>;
      if (!row) fail("RESOURCE_NOT_FOUND", input.ordinal);
      if (!npValidateNavigationItems(row.items).ok) fail("SCHEMA_INVALID", input.ordinal);
      value = json({ items: row.items, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
      semantic = json(row.items);
      version = `updated:${utc(row.updatedAt)}`;
    } else if (operation.kind === "theme_tokens" || operation.kind === "setting") {
      const key = operation.kind === "theme_tokens" ? "theme" : operation.resource.key;
      const [row] = (await input.tx
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, input.siteId), eq(npSettings.key, key))!)
        .limit(1)) as Array<typeof npSettings.$inferSelect>;
      if (!row) {
        presence = "absent";
        value = null;
        semantic = null;
        version = "absent";
      } else {
        npAssertSettingValue(key, row.value);
        value = json({ value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
        semantic = json(row.value);
        version = `updated:${utc(row.updatedAt)}`;
      }
    } else {
      const [media] = (await input.tx
        .select({
          id: npMedia.id,
          siteId: npMedia.siteId,
          status: npMedia.status,
          deletedAt: npMedia.deletedAt,
          updatedAt: npMedia.updatedAt,
        })
        .from(npMedia)
        .where(and(eq(npMedia.siteId, input.siteId), eq(npMedia.id, operation.resource.mediaId))!)
        .limit(1)) as Array<{
        id: string;
        siteId: string;
        status: string;
        deletedAt: Date | null;
        updatedAt: Date;
      }>;
      if (!media || media.deletedAt !== null || media.status !== "ready")
        fail("REFERENCE_INVALID", input.ordinal);
      const owner = await npGetPersistedCollectionDocumentById(
        operation.resource.collection,
        operation.resource.documentId,
        input.siteId,
        { tx: input.tx },
      );
      if (!owner) fail("RESOURCE_NOT_FOUND", input.ordinal);
      const refs = await input.tx
        .select({ id: npMediaRefs.id })
        .from(npMediaRefs)
        .where(
          and(
            eq(npMediaRefs.siteId, input.siteId),
            eq(npMediaRefs.mediaId, operation.resource.mediaId),
            eq(npMediaRefs.collection, operation.resource.collection),
            eq(npMediaRefs.documentId, operation.resource.documentId),
            eq(npMediaRefs.field, operation.resource.field),
          )!,
        )
        .limit(2);
      if (refs.length > 1) fail("SCHEMA_INVALID", input.ordinal);
      value = json({
        media,
        ownerUpdatedAt: owner.updatedAt,
        ownerValue: owner[operation.resource.field],
        attached: refs.length === 1,
      });
      semantic = json({
        media: {
          id: media.id,
          siteId: media.siteId,
          status: media.status,
          deletedAt: media.deletedAt,
        },
        ownerValue: owner[operation.resource.field],
        attached: refs.length === 1,
      });
      const ownerTimestamp =
        getCollectionConfig(operation.resource.collection).timestamps === false
          ? "untimestamped"
          : utc(owner.updatedAt);
      version = `media:${utc(media.updatedAt)}:owner:${ownerTimestamp}`;
    }
    const beforeHash = await resourceHash(input.siteId, canonicalResourceKey, presence, semantic);
    const base: NpAgentVersionBaseV1 | null =
      presence === "absent" ? null : { version, digest: beforeHash };
    const snapshot: NpAgentChangeSetSnapshotCanonicalV1 = {
      schemaVersion: "np.agent-changeset-snapshot.v1",
      siteId: input.siteId,
      changeSetId: input.changeSetId,
      operationOrdinal: input.ordinal,
      canonicalResourceKey,
      presence,
      base,
      value,
    };
    let snapshotBytes: number;
    let snapshotHash: string;
    try {
      snapshotBytes =
        npBuildAgentChangeSetSnapshotCanonicalBytes(snapshot).canonicalJsonUtf8.byteLength;
      snapshotHash = await npDigestAgentChangeSetSnapshotCanonical(snapshot);
    } catch {
      fail("LIMIT_EXCEEDED", input.ordinal);
    }
    return { inspected, snapshot, base, beforeHash, snapshotHash, snapshotBytes, semantic };
  }
  async function readBase(input: ReadInput) {
    try {
      const { snapshot, base, beforeHash, snapshotHash } = await inspect(input);
      return {
        snapshot,
        base:
          base ??
          (input.operation.kind === "theme_tokens"
            ? { version: "absent", digest: beforeHash }
            : null),
        beforeHash,
        snapshotHash,
      };
    } catch (error) {
      throw new NpAgentChangeSetValidationResourceErrorV1(safeError(error, input.ordinal));
    }
  }
  async function validate(
    input: ValidateInput,
  ): Promise<NpAgentChangeSetValidationResourcesResultV1> {
    let proposal: ReturnType<typeof npRequireAgentChangeSetProposalCanonical>;
    try {
      proposal = npRequireAgentChangeSetProposalCanonical({
        schemaVersion: "np.agent-changeset-proposal.v1",
        siteId: input.siteId,
        changeSetId: input.changeSetId,
        draftVersion: 1,
        title: "Validation",
        summary: null,
        operations: input.operations,
      });
      if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
        throw new Error("Invalid validation time");
    } catch {
      fail("SCHEMA_INVALID", null);
    }
    const reserved = proposal.operations.flatMap((entry) =>
      entry.operation.kind === "document" &&
      entry.operation.operation === "create" &&
      entry.canonicalResourceKey.kind === "document"
        ? [entry.canonicalResourceKey.documentId]
        : [],
    );
    const issues: NpAgentValidationIssueWire[] = [];
    const operations: NpAgentInitialChangeSetPlanOperationCanonicalV1[] = [];
    const snapshots: NpAgentChangeSetSnapshotCanonicalV1[] = [];
    const bases: NpAgentJsonValue[] = [];
    const requiredScopes = new Set<NpAgentScope>();
    const requiredApplyScopes = new Set<NpAgentScope>();
    const reasons = new Set<NpAgentRiskReasonCode>();
    let snapshotBytes = 0;
    const proposedSlugs = new Set<string>();
    for (const entry of proposal.operations) {
      try {
        const current = await inspect({ ...input, ...entry, reservedCreateDocumentIds: reserved });
        const operation = entry.operation;
        const expectedBase =
          current.base ??
          (operation.kind === "theme_tokens"
            ? { version: "absent", digest: current.beforeHash }
            : null);
        if (
          operation.base === null
            ? expectedBase !== null
            : expectedBase === null ||
              operation.base.version !== expectedBase.version ||
              operation.base.digest !== expectedBase.digest
        )
          fail("BASE_CONFLICT", entry.ordinal);
        snapshotBytes += current.snapshotBytes;
        if (snapshotBytes > npAgentChangeSetLimits.aggregateSnapshotBytes)
          fail("LIMIT_EXCEEDED", entry.ordinal);
        let after: NpAgentJsonValue;
        let afterPresence: "present" | "absent" = "present";
        let publicWrite = false;
        if (operation.kind === "document") {
          const document = current.inspected.document;
          if (!document || entry.canonicalResourceKey.kind !== "document")
            fail("SCHEMA_INVALID", entry.ordinal);
          const candidate = { ...document.candidate };
          let status =
            typeof document.original?.status === "string" ? document.original.status : "draft";
          if (operation.operation === "create") status = operation.input.targetStatus;
          if (operation.operation === "update" && operation.input.targetStatus !== null)
            status = operation.input.targetStatus;
          if (operation.operation === "publish") status = "published";
          if (operation.operation === "archive") status = "archived";
          if (operation.operation === "schedule") {
            if (
              !document.config.versions?.drafts ||
              Date.parse(operation.input.publishAt) <= input.now.getTime()
            )
              fail("POLICY_BLOCKED", entry.ordinal);
            candidate.publishedAt = operation.input.publishAt;
            status = "scheduled";
          }
          if (
            status === "published" &&
            candidate.publishedAt instanceof Date &&
            candidate.publishedAt > input.now
          )
            status = "scheduled";
          publicWrite =
            document.original?.status === "published" ||
            status === "published" ||
            status === "scheduled";
          if (document.config.slugField && typeof candidate.slug === "string") {
            const slugKey = serializeAgentCanonicalJson([
              operation.resource.collection,
              candidate.locale ?? null,
              candidate.slug,
            ]);
            if (proposedSlugs.has(slugKey)) fail("ROUTE_COLLISION", entry.ordinal);
            proposedSlugs.add(slugKey);
            const table = getCollectionTable(operation.resource.collection) as PgTable;
            const columns = table as unknown as Record<string, Parameters<typeof eq>[0]>;
            const matches = await input.tx
              .select({ id: columns.id })
              .from(table)
              .where(
                and(
                  eq(columns.siteId, input.siteId),
                  eq(columns.slug, candidate.slug),
                  ne(columns.id, entry.canonicalResourceKey.documentId),
                  document.config.i18n ? eq(columns.locale, candidate.locale) : undefined,
                )!,
              )
              .limit(1);
            if (matches.length) fail("ROUTE_COLLISION", entry.ordinal);
          }
          // This is normalized pre-apply intent, not invented DB defaults or hook output.
          after = json({
            ...candidate,
            id: entry.canonicalResourceKey.documentId,
            siteId: input.siteId,
            status,
            visibility: candidate.visibility ?? "public",
          });
          if (operation.operation === "archive") reasons.add("ARCHIVE");
          if (operation.operation === "create") reasons.add("ROLLBACK_PARTIAL");
        } else if (operation.kind === "navigation") {
          after = json(operation.input.items);
          publicWrite = true;
          reasons.add("NAVIGATION_WRITE");
        } else if (operation.kind === "theme_tokens") {
          after = json(operation.input.tokens);
          publicWrite = true;
          reasons.add("THEME_WRITE");
        } else if (operation.kind === "setting") {
          after =
            operation.operation === "remove"
              ? null
              : json(npNormalizeSeoSettings(operation.input.value));
          afterPresence = operation.operation === "remove" ? "absent" : "present";
          publicWrite = true;
          reasons.add("SETTING_WRITE");
        } else {
          after = {
            ...(current.semantic as Record<string, NpAgentJsonValue>),
            attached: operation.operation === "attach",
          };
        }
        if (publicWrite) reasons.add("PUBLIC_WRITE");
        current.inspected.requiredScopes.forEach((scope) => requiredScopes.add(scope));
        applyScopes(operation).forEach((scope) => requiredApplyScopes.add(scope));
        const create = operation.kind === "document" && operation.operation === "create";
        const proposedAfterHash = await resourceHash(
          input.siteId,
          entry.canonicalResourceKey,
          afterPresence,
          after,
        );
        operations.push({
          ...entry,
          beforeHash: create ? null : current.beforeHash,
          proposedAfterHash,
          snapshotHash: current.snapshotHash,
          rollbackClass: create ? "residual" : "full",
          residualCodes: create ? ["ROW_REMAINS"] : [],
        });
        snapshots.push(current.snapshot);
        bases.push(
          json({
            ordinal: entry.ordinal,
            canonicalResourceKey: entry.canonicalResourceKey,
            presence: current.snapshot.presence,
            base: current.base,
            snapshotHash: current.snapshotHash,
          }),
        );
      } catch (error) {
        issues.push(...safeError(error, entry.ordinal));
      }
    }
    if (issues.length) throw new NpAgentChangeSetValidationResourceErrorV1(issues);
    if (reserved.length) {
      try {
        await npAssertSiteDocumentCreateQuota(
          input.tx as unknown as NpSiteQuotaDb,
          input.siteId,
          reserved.length,
        );
      } catch {
        fail("QUOTA_EXCEEDED", null);
      }
    }
    if (operations.length > 1) reasons.add("MULTI_RESOURCE");
    if (operations.length >= 100) reasons.add("OPERATION_VOLUME");
    const reasonCodes = [...reasons].sort();
    const risk: NpAgentRiskSummary = {
      level:
        reasons.has("ARCHIVE") || reasons.has("ROLLBACK_PARTIAL") || reasons.has("OPERATION_VOLUME")
          ? "high"
          : reasonCodes.length
            ? "medium"
            : "low",
      reasonCodes,
      approvalMode: "human",
      reversible: !reasons.has("ROLLBACK_PARTIAL"),
    };
    const baseFingerprint = await digestAgentCanonicalSha256(
      encoder.encode(
        `np.agent-changeset-bases.v1\0${serializeAgentCanonicalJson({ siteId: input.siteId, bases })}`,
      ),
    );
    return {
      operations,
      snapshots,
      baseFingerprint,
      risk,
      requiredScopes: [...requiredScopes].sort(),
      requiredApplyScopes: [...requiredApplyScopes].sort(),
      policyHashes: [
        await digestAgentCanonicalSha256(
          encoder.encode(
            `np.agent-changeset-validation-policy.v1\0${serializeAgentCanonicalJson({
              resourceHashDomain: "np.agent-changeset-resource.v1",
              basesHashDomain: "np.agent-changeset-bases.v1",
              limits: npAgentChangeSetLimits,
              documentApplyScopes: ["content:draft", "content:publish"],
              risk: {
                high: ["ARCHIVE", "ROLLBACK_PARTIAL", "OPERATION_VOLUME"],
                volumeMinimum: 100,
                multiResourceMinimum: 2,
                otherReasons: "medium",
                noReasons: "low",
                approvalMode: "human",
                createResidualCodes: ["ROW_REMAINS"],
              },
            })}`,
          ),
        ),
      ],
    };
  }
  return {
    /** Same resource hash recipe for a verified retained snapshot; never reconstruct from a digest. */
    hashSnapshot: async (snapshot: NpAgentChangeSetSnapshotCanonicalV1) => {
      const key = snapshot.canonicalResourceKey;
      let semantic: NpAgentJsonValue | null = null;
      if (snapshot.presence === "present") {
        const value = snapshot.value as Record<string, NpAgentJsonValue>;
        if (key.kind === "document") {
          try {
            semantic = semanticDocument(
              npParseCollectionDocumentWire(snapshot.value, getCollectionConfig(key.collection)),
            );
          } catch (error) {
            if (error instanceof NpCollectionContractError)
              throw new NpAgentGatewayError(
                "CHANGESET_SCHEMA_INVALID",
                400,
                "Retained document is incompatible with the current schema.",
              );
            throw error;
          }
        } else if (key.kind === "navigation") semantic = value.items;
        else if (key.kind === "theme_tokens" || key.kind === "setting") semantic = value.value;
        else {
          const media = value.media as Record<string, NpAgentJsonValue>;
          semantic = {
            media: {
              id: media.id,
              siteId: media.siteId,
              status: media.status,
              deletedAt: media.deletedAt,
            },
            ownerValue: value.ownerValue,
            attached: value.attached,
          };
        }
      }
      return resourceHash(snapshot.siteId, key, snapshot.presence, semantic);
    },
    readBase,
    validate,
    /** Actual persisted state after the complete batch, using the same snapshot/hash recipe. */
    readCurrent: (input: ReadInput) => readBase({ ...input, currentResource: true }),
  };
}
