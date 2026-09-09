import { createAgentChangeSetApplyResourceServiceV1 } from "./changeset-apply-resources.js";
import { npVerifyChangeSetExecutionV1 } from "./changeset-execution-verification.js";
import {
  withDeferredPostCommit,
  type NpDeferredPostCommitMetadata,
} from "../collections/pipeline.js";
import { withCurrentSite } from "../sites/context.js";
import { registerJobHandler } from "../jobs/handlers.js";
import { npNormalizeJobPayload } from "../jobs-contract/contract.js";
import type {
  NpAgentChangeSetApplyJobPayload,
  NpAgentChangeSetVerifyJobPayload,
} from "../jobs-contract/types.js";
import {
  npRequireAgentChangeSetApplyInputV1,
  npRequireAgentChangeSetScheduleInputV1,
  npRequireAgentChangeSetCancelInputV1,
  npRequireAgentChangeSetExecutionDetailV1,
  type NpAgentVerificationCheckV1,
} from "../agent-contract/changeset-execution-contract.js";
import {
  createAgentApprovalServiceV1,
  type NpAgentApprovalServiceV1,
  type NpAgentApprovalServiceOptionsV1,
  type NpAgentApprovalTargetAccessV1,
} from "./approval-service.js";
import {
  npRequireAgentChangeSetRequestApprovalInputV1,
  type NpAgentApprovalDetailV1,
} from "../agent-contract/approval-contract.js";
import { npRequireAgentApprovalStatementCanonical } from "../agent-contract/canonical-approval.js";
import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import type {
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentApprovalTargetV1,
} from "../agent-contract/types.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  npAgentChangeSetCapabilityIdsV1,
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  npRequireAgentInstalledCapabilityOutputV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
  type NpAgentChangeSetCapabilityOutputMapV1,
  type NpAgentChangeSetCapabilityIdV1,
} from "../agent-contract/installed-capability-contract.js";
import { runAgentPreviewChecksV1, npAgentPreviewCheckVersionsV1 } from "./preview-checks.js";
import { npProjectAgentChangeSetReviewOperationV1 } from "./changeset-review.js";
import {
  npRequireAgentChangeSetReviewV1,
  type NpAgentChangeSetReviewV1,
} from "../agent-contract/changeset-review-contract.js";
import type { NpAgentHttpArtifactFacadeV1 } from "./agent-http-gateway.js";
import {
  createAgentPreviewArtifactServiceV1,
  type NpAgentPreviewArtifactServiceV1,
  type NpAgentPreviewArtifactInputV1,
  type NpAgentPreviewArtifactServiceOptionsV1,
} from "./preview-artifact-service.js";
import {
  withAgentChangeSetPreview,
  type NpAgentChangeSetPreviewContextV1,
} from "./changeset-preview-overlay.js";
import {
  npRequireAgentPreviewContractCanonical,
  npDigestAgentPreviewContractCanonical,
  npRequireAgentPreviewRoutesCanonical,
  npDigestAgentPreviewRoutesCanonical,
} from "../agent-contract/canonical-preview.js";
import { npDigestAgentPreviewArtifactManifestCanonical } from "../agent-contract/canonical-preview-artifact.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, chmod, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, desc, eq, gt, gte, lt, lte, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesets,
  npAgentChangesetExecutions,
  type NpAgentChangeSetExecutionEffectV1,
  npAgentChangesetOperations,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentApprovals,
  npAgentChangesetValidationAttempts,
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
} from "../db/schema/agent.js";
import { npUsers, npSessions, npSiteMemberships, npRevisions } from "../db/schema/system.js";
import { npAuditEvents } from "../db/schema/community.js";
import { can } from "../auth/capabilities.js";
import type { NpTransaction } from "../collections/pipeline.js";
import type { NpAuthUser } from "../config/types.js";
import {
  npRequireAgentChangeSetWire,
  npRequireAgentPreviewReportV1,
  npAnalyzeAgentChangeSetWire,
  npVerifyAgentChangeSetAdminProposalV1,
  npDigestAgentChangeSetDraftInputV1,
  npBuildAgentChangeSetDraftInputJsonV1,
  npRequireAgentChangeSetDraftInputV1,
  npAgentChangeSetLimits,
  npAgentChangeSetStates,
  type NpAgentChangeSetState,
  npRequireAgentChangeSetValidateRequestV1,
  npRequireAgentChangeSetPreviewRequestV1,
  npRequireAgentPreviewDetailWireV1,
  npRequireAgentPreviewSummaryV1,
  type NpAgentChangeSetPreviewRequestV1,
  type NpAgentPreviewDetailWireV1,
  type NpAgentChangeSetValidateRequestV1,
  type NpAgentValidationIssueWire,
  type NpAgentChangeSetDraftInputV1,
  type NpAgentChangeSetWire,
  type NpAgentChangeSetAdminInputV1,
} from "../agent-contract/changeset-wire-contract.js";
import {
  npDigestAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../agent-contract/canonical-changeset.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npDigestAgentInvocationRequestCanonical,
  npRequireAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import {
  npRequireAgentAuthorizationContextCanonical,
  npDigestAgentAuthorizationContextCanonical,
} from "../agent-contract/canonical-authorization-context.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npAnalyzeAgentCursorPageV1,
  type NpAgentCursorPageV1,
} from "../agent-contract/wire-contract.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
import {
  npAgentScopeStaffCapability,
  type NpAgentJsonObject,
  type NpAgentChangeSetProposalOperationCanonicalV1,
  type NpAgentScope,
  type NpAgentAuthorizationContextCanonicalV1,
  type NpAgentPreviewContractCanonicalV1,
  type NpAgentPreviewRouteCanonicalV1,
  type NpAgentChangeSetPlanCanonicalV1,
  type NpAgentStaffSiteAuthorizationCanonicalV1,
} from "../agent-contract/types.js";
import {
  createAgentAdminAdmissionV1,
  npResolveAgentStaffSessionAuthorizationV1,
  npResolveLiveAgentStaffAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminAdmissionOptionsV1,
} from "./admin-admission.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";
import { createAgentChangeSetResourceServiceV1 } from "./changeset-resources.js";
import type { NpAgentGatewayServiceV1 } from "./gateway-service.js";
import { npDigestAgentStaffSiteAuthorizationCanonical } from "../agent-contract/canonical-bodies.js";
import {
  createAgentChangeSetValidationResourceServiceV1,
  NpAgentChangeSetValidationResourceErrorV1,
} from "./changeset-validation-resources.js";
import { createAgentCursorCodecV1 } from "./cursor.js";

type Db = ReturnType<typeof getDb>;
type Row = typeof npAgentChangesets.$inferSelect;
type PreviewRow = typeof npAgentChangesetPreviews.$inferSelect;
type OpRow = typeof npAgentChangesetOperations.$inferSelect;
export type NpAgentChangeSetActorV1 =
  | { kind: "staff"; siteId: string; actor: NpAgentAdminActorV1 }
  | { kind: "principal"; authentication: NpAgentCapabilityAuthenticationV1 };
export interface NpAgentChangeSetServiceOptionsV1 extends NpAgentAdminAdmissionOptionsV1 {
  cursorKey: Uint8Array;
  /** Explicit host installation; no worker, queue, or runtime is created. */
  execution?: {
    resolveIntent: (input: { siteId: string }) => Promise<{ enabled: boolean; paused: boolean }>;
    verificationFingerprint: string;
    verifyConvergence: Parameters<typeof npVerifyChangeSetExecutionV1>[0]["verifyConvergence"];
    inspectPostCommitEffect?: Parameters<
      typeof npVerifyChangeSetExecutionV1
    >[0]["inspectPostCommitEffect"];
    enqueueApply?: (job: NpAgentChangeSetApplyJobPayload) => Promise<void>;
    enqueueVerify?: (job: NpAgentChangeSetVerifyJobPayload) => Promise<void>;
  };
  /** Explicit approval-only installation. Execution is not installed or advertised. */
  approvals?: Pick<NpAgentApprovalServiceOptionsV1, "integrityKeys" | "challengeKeys"> & {
    lifetimeSeconds?: number;
    resolveExecutionBinding: (input: {
      siteId: string;
      intendedOperation: "apply" | "schedule";
    }) => Promise<NpAgentCapabilityRegistryCanonicalV1>;
    policy?: (input: {
      siteId: string;
      plan: Extract<NpAgentChangeSetPlanCanonicalV1, { planKind: "changeset" }>;
    }) => Promise<{
      policyHashes: string[];
      requiresLivePreview: boolean;
      reauthenticationMaxAgeSeconds: number | null;
    }>;
  };
  preview?: {
    storageAdapter?: NpAgentPreviewArtifactServiceOptionsV1["storageAdapter"];
    resolveAdapter?: NpAgentPreviewArtifactServiceOptionsV1["resolveAdapter"];
    /** Explicit registered host capture. The complete output is private and bounded before reservation. */
    screenshotAdapter?: {
      id: string;
      contractVersion: number;
      fingerprint: string;
      capture: (input: {
        siteId: string;
        previewId: string;
        routes: readonly NpAgentPreviewRouteCanonicalV1[];
        signal: AbortSignal;
        render: <T>(
          route: NpAgentPreviewRouteCanonicalV1,
          renderer: (context: NpAgentChangeSetPreviewContextV1) => Promise<T>,
        ) => Promise<T>;
      }) => Promise<readonly NpAgentPreviewArtifactInputV1[]>;
    };
    /** Explicit effect-free host renderer; checks use the existing sealed overlay and authority. */
    checks?: {
      rendererId: string;
      rendererVersion: number;
      rendererFingerprint: string;
      productionOrigins: readonly string[];
      render: (context: NpAgentChangeSetPreviewContextV1) => Promise<string>;
      resolveManifest: (
        context: NpAgentChangeSetPreviewContextV1,
      ) => Promise<NpAgentPreviewRouteCanonicalV1[]>;
    };
    contract: NpAgentPreviewContractCanonicalV1;
    resolveRoutes: (input: {
      tx: NpTransaction;
      siteId: string;
      user: NpAuthUser;
      plan: Extract<NpAgentChangeSetPlanCanonicalV1, { planKind: "changeset" }>;
    }) => Promise<NpAgentPreviewRouteCanonicalV1[]>;
    enqueue?: (input: { siteId: string; previewId: string }) => Promise<void>;
  };
  admission?: NpAgentCapabilityAdmissionServiceV1;
  eligibilitySeconds?: number;
  gateway?: Pick<NpAgentGatewayServiceV1, "getTransportAudience">;
  validationLifetimeSeconds?: number;
  inlineValidationOperationLimit?: number;
  rollbackWindowSeconds?: number;
  /** Explicit host producer. Failure leaves a durable queued attempt for reconciliation. */
  enqueueValidation?: (job: {
    siteId: string;
    attemptId: string;
    changeSetId: string;
    generation: number;
    draftVersion: number;
    draftHash: string;
  }) => Promise<void>;
}
export interface NpAgentChangeSetListFiltersV1 {
  states?: NpAgentChangeSetState[];
  actorKinds?: Array<"runtime" | "external" | "staff">;
  createdAfter?: string | null;
  createdBefore?: string | null;
}
export interface NpAgentChangeSetServiceV1 {
  apply: (input: {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  }) => Promise<NpAgentChangeSetReviewV1>;
  schedule: (input: {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  }) => Promise<NpAgentChangeSetReviewV1>;
  cancel: (input: {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  }) => Promise<NpAgentChangeSetReviewV1>;
  processExecution: (
    input: NpAgentChangeSetApplyJobPayload,
    control?: { signal: AbortSignal },
  ) => Promise<{ state: string }>;
  processVerification: (input: NpAgentChangeSetVerifyJobPayload) => Promise<void>;
  reconcileExecutions: (input: {
    siteId: string;
    limit?: number;
    cursor?: string;
  }) => Promise<{ examined: number; nextCursor: string | null }>;
  registerExecutionJobs: () => void;
  readonly approvals: NpAgentApprovalServiceV1 | null;
  requestApproval: (input: {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  }) => Promise<NpAgentApprovalDetailV1>;
  readonly capabilityIds: readonly NpAgentChangeSetCapabilityIdV1[];
  invokeCapability: (input: {
    authentication: NpAgentCapabilityAuthenticationV1;
    request: NpAgentChangeSetCapabilityInvocationRequestV1;
  }) => Promise<{
    invocationId: string;
    output: NpAgentChangeSetCapabilityOutputMapV1[NpAgentChangeSetCapabilityIdV1];
  }>;

  artifacts: NpAgentPreviewArtifactServiceV1;
  processPreview: (input: { siteId: string; previewId: string }) => Promise<{ state: string }>;
  reconcilePreviews: (input: {
    siteId: string;
    limit?: number;
    cursor?: string;
  }) => Promise<{ examined: number; completed: number; nextCursor: string | null }>;
  readPreviewArtifact: (input: {
    actor: NpAgentChangeSetActorV1;
    previewId: string;
    artifactId: string;
  }) => Promise<{ bytes: Uint8Array; mime: string; contentDigest: string; expiresAt: string }>;
  renderPreview: <T>(input: {
    db?: Db;
    siteId: string;
    previewId: string;
    viewer?: { userId: string; sessionId: string };
    route: NpAgentPreviewRouteCanonicalV1;
    render: (context: NpAgentChangeSetPreviewContextV1) => Promise<T>;
  }) => Promise<T>;
  preview: (input: {
    actor: NpAgentChangeSetActorV1;
    id: string;
    command: unknown;
  }) => Promise<NpAgentPreviewDetailWireV1>;
  getPreview: (input: {
    actor: NpAgentChangeSetActorV1;
    previewId: string;
    changeSetId?: string;
  }) => Promise<NpAgentPreviewDetailWireV1>;
  withPreviewAuthority: <T>(input: {
    siteId: string;
    previewId: string;
    mutate: (db: Db, preview: PreviewRow) => Promise<T>;
  }) => Promise<T>;
  withPreviewViewer: <T>(input: {
    db?: Db;
    siteId: string;
    userId: string;
    sessionId: string;
    previewId: string;
    changeSetId?: string;
    requireReady: boolean;
    mutate: (
      db: Db,
      preview: PreviewRow,
      authority: NpAgentStaffSiteAuthorizationCanonicalV1,
    ) => Promise<T>;
  }) => Promise<T>;
  create: (input: {
    actor: NpAgentChangeSetActorV1;
    command: unknown;
  }) => Promise<NpAgentChangeSetWire>;
  update: (input: {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  }) => Promise<NpAgentChangeSetWire>;
  getReview: (input: {
    actor: NpAgentChangeSetActorV1;
    id: string;
  }) => Promise<NpAgentChangeSetReviewV1>;
  get: (input: { actor: NpAgentChangeSetActorV1; id: string }) => Promise<NpAgentChangeSetWire>;
  list: (
    input: NpAgentChangeSetListFiltersV1 & {
      actor: NpAgentChangeSetActorV1;
      limit?: number;
      cursor?: string;
    },
  ) => Promise<NpAgentCursorPageV1<NpAgentChangeSetWire, "np.agent-changesets.v1">>;
  reconcileExpired: (input: {
    siteId: string;
    limit?: number;
  }) => Promise<{ examined: number; cancelled: number }>;
  validate: (input: {
    expectedDraftHash?: string;
    actor: NpAgentChangeSetActorV1;
    id: string;
    command: unknown;
  }) => Promise<NpAgentChangeSetWire>;
  processValidation: (input: { siteId: string; attemptId: string }) => Promise<{ state: string }>;
  reconcileValidations: (input: {
    siteId: string;
    limit?: number;
  }) => Promise<{ examined: number; completed: number }>;
}
const hash = (domain: string, value: unknown): `cj1:sha256:${string}` =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const missing = () =>
  new NpAgentGatewayError("CHANGESET_NOT_FOUND", 404, "ChangeSet is unavailable.");
const conflict = () =>
  new NpAgentGatewayError(
    "CHANGESET_CONFLICT",
    409,
    "ChangeSet changed or the request conflicts with an earlier operation.",
  );
const denied = () =>
  new NpAgentGatewayError("CHANGESET_ACCESS_DENIED", 403, "ChangeSet access is denied.");
const staffUserProjection = {
  id: npUsers.id,
  email: npUsers.email,
  name: npUsers.name,
  role: npUsers.role,
  tokenVersion: npUsers.tokenVersion,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const json = (value: object) => value as unknown as NpAgentJsonObject;
interface Actor {
  source?: NpAgentChangeSetActorV1;
  siteId: string;
  user: NpAuthUser;
  fingerprint: string;
  authorization: string;
  principalId: string | null;
  scopes: readonly NpAgentScope[] | null;
}

/** Explicit server service. No transport registration, preview, apply, worker or runtime is installed. */
export function createAgentChangeSetServiceV1(
  options: NpAgentChangeSetServiceOptionsV1,
): NpAgentChangeSetServiceV1 {
  if (
    options.execution &&
    (!options.approvals ||
      !/^cj1:sha256:[A-Za-z0-9_-]{43}$/.test(options.execution.verificationFingerprint) ||
      typeof options.execution.resolveIntent !== "function" ||
      typeof options.execution.verifyConvergence !== "function" ||
      [
        options.execution.enqueueApply,
        options.execution.enqueueVerify,
        options.execution.inspectPostCommitEffect,
      ].some((fn) => fn !== undefined && typeof fn !== "function"))
  )
    throw new Error("Invalid explicit ChangeSet execution installation.");
  const now = options.now ?? (() => new Date());
  const lifetime = options.eligibilitySeconds ?? 30 * 86400;
  if (!Number.isSafeInteger(lifetime) || lifetime < 60 || lifetime > 90 * 86400)
    throw new Error("ChangeSet eligibility must be 60..7776000 seconds.");
  const cursor = createAgentCursorCodecV1(options.cursorKey, "np.agent-changeset.cursor");
  const admin = createAgentAdminAdmissionV1(options);
  const resources = createAgentChangeSetResourceServiceV1();
  const validationResources = createAgentChangeSetValidationResourceServiceV1();
  const validationLifetime = options.validationLifetimeSeconds ?? 3600;
  const inlineLimit = options.inlineValidationOperationLimit ?? 25;
  const rollbackWindow =
    options.rollbackWindowSeconds ?? npAgentChangeSetLimits.rollbackDefaultSeconds;
  if (
    !Number.isSafeInteger(validationLifetime) ||
    validationLifetime < 60 ||
    validationLifetime > 86400 ||
    !Number.isSafeInteger(inlineLimit) ||
    inlineLimit < 0 ||
    inlineLimit > 500 ||
    !Number.isSafeInteger(rollbackWindow) ||
    rollbackWindow < 60 ||
    rollbackWindow > npAgentChangeSetLimits.rollbackMaximumSeconds
  )
    throw new Error("Invalid ChangeSet validation limits.");
  async function resolve(input: NpAgentChangeSetActorV1, write: boolean): Promise<Actor> {
    const scope: NpAgentScope = write ? "changeset:write" : "changeset:read";
    if (input.kind === "staff") {
      const authority = await npResolveAgentStaffSessionAuthorizationV1(
        getDb(),
        input.siteId,
        input.actor,
        now(),
      );
      if (!authority.authority.capabilities.includes(npAgentScopeStaffCapability[scope]))
        throw denied();
      return {
        source: input,
        siteId: input.siteId,
        user: {
          ...input.actor.user,
          role:
            authority.authority.kind === "super-admin"
              ? "admin"
              : (authority.authority.role as NpAuthUser["role"]),
        },
        fingerprint: hash("np.agent-staff-actor.v1", {
          siteId: input.siteId,
          userId: input.actor.user.id,
        }),
        authorization: serializeAgentCanonicalJson(authority),
        principalId: null,
        scopes: null,
      };
    }
    if (!options.admission) throw missing();
    const auth = input.authentication;
    await options.admission.project({ authentication: auth });
    if (
      !auth.scopes.includes(scope) ||
      auth.principal.authority.kind !== "user" ||
      !auth.principal.authority.userId
    )
      throw denied();
    const siteId = auth.principal.siteId;
    const userId = auth.principal.authority.userId;
    const live = await npResolveLiveAgentStaffAuthorizationV1(getDb(), siteId, userId);
    const [user] = await getDb()
      .select(staffUserProjection)
      .from(npUsers)
      .where(eq(npUsers.id, userId))
      .limit(1);
    if (!user || !live.authority.capabilities.includes(npAgentScopeStaffCapability[scope]))
      throw denied();
    return {
      source: input,
      siteId,
      principalId: auth.principal.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tokenVersion: user.tokenVersion,
        role:
          live.authority.kind === "super-admin"
            ? "admin"
            : (live.authority.role as NpAuthUser["role"]),
      },
      scopes: auth.scopes,
      fingerprint: auth.authorizationContext.actor.actorFingerprint,
      authorization: serializeAgentCanonicalJson({ context: auth.authorizationContext, live }),
    };
  }
  async function same(input: NpAgentChangeSetActorV1, actor: Actor, write = false) {
    if ((await resolve(input, write)).authorization !== actor.authorization) throw denied();
  }
  function requireScopes(actor: Actor, scopes: readonly NpAgentScope[]) {
    for (const scope of scopes)
      if (
        (actor.scopes && !actor.scopes.includes(scope)) ||
        !can(actor.user, npAgentScopeStaffCapability[scope])
      )
        throw denied();
  }
  async function operations(db: Db, row: Row) {
    const rows = await db
      .select()
      .from(npAgentChangesetOperations)
      .where(
        and(
          eq(npAgentChangesetOperations.siteId, row.siteId),
          eq(npAgentChangesetOperations.changesetId, row.id),
        ),
      )
      .orderBy(npAgentChangesetOperations.ordinal)
      .limit(501);
    if (rows.length > 500 || rows.some((op, index) => op.ordinal !== index + 1)) throw missing();
    return rows;
  }
  async function project(
    row: Row,
    actor: Actor,
    write = false,
    db: Db = getDb(),
    includePreview = true,
  ): Promise<NpAgentChangeSetWire> {
    const ops = await operations(db, row);
    const execution = await executionEvidence(db, row, ops);
    const reserved = ops
      .filter((op) => op.input.kind === "document" && op.input.operation === "create")
      .flatMap((op) => (op.resourceKey.kind === "document" ? [op.resourceKey.documentId] : []));
    for (const op of ops) {
      const context = {
        siteId: row.siteId,
        user: actor.user,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
        tx: db as unknown as NpTransaction,
      };
      requireScopes(
        actor,
        write
          ? (await resources.prepare({ ...context, reservedCreateDocumentIds: reserved }))
              .requiredScopes
          : await resources.assertVisible({
              ...context,
              currentResource: Boolean(execution?.committedAt),
            }),
      );
    }
    // Canonical draft identity is checked again on every read; denormalized payloads never win.
    const proposal = npRequireAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    });
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== row.draftHash)
      throw missing();
    if (
      ![
        "draft",
        "validating",
        "invalid",
        "ready",
        "approval_pending",
        "approved",
        "rejected",
        "cancelled",
        "scheduled",
        "applying",
        "applied",
        "apply_failed",
        "verifying",
        "verified",
        "verification_failed",
      ].includes(row.state)
    )
      throw missing();
    let validation: NpAgentChangeSetWire["validation"] = null;
    let attempt: typeof npAgentChangesetValidationAttempts.$inferSelect | undefined;
    if (row.state !== "draft" && row.validationGeneration > 0) {
      [attempt] = await db
        .select()
        .from(npAgentChangesetValidationAttempts)
        .where(
          and(
            eq(npAgentChangesetValidationAttempts.siteId, row.siteId),
            eq(npAgentChangesetValidationAttempts.changesetId, row.id),
            eq(npAgentChangesetValidationAttempts.generation, row.validationGeneration),
            eq(npAgentChangesetValidationAttempts.draftVersion, row.draftVersion),
            eq(npAgentChangesetValidationAttempts.draftHash, row.draftHash),
          ),
        )
        .limit(1);
    }
    if (
      ["validating", "invalid", "ready", "approval_pending", "approved", "rejected"].includes(
        row.state,
      ) &&
      !attempt
    )
      throw missing();
    if (attempt) {
      const context = npRequireAgentAuthorizationContextCanonical(attempt.authorizationContextBody);
      if (
        context.siteId !== row.siteId ||
        (await npDigestAgentAuthorizationContextCanonical(context)) !==
          attempt.authorizationContextFingerprint ||
        serializeAgentCanonicalJson(context.authorityRef) !==
          serializeAgentCanonicalJson(attempt.authorityRef) ||
        context.actor.kind !== attempt.requesterKind ||
        context.actor.actorFingerprint !== attempt.requesterFingerprint ||
        (context.actor.kind === "staff" ? context.actor.userId : context.actor.principalId) !==
          attempt.requesterId
      )
        throw missing();
      const [invocation] = await db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, row.siteId),
            eq(npAgentInvocations.id, attempt.admittingInvocationId),
          ),
        )
        .limit(1);
      if (
        !invocation ||
        invocation.state !== "completed" ||
        !["agents.changesets.validate", "changeset.validate"].includes(invocation.operationId) ||
        invocation.resultId !== row.id ||
        invocation.outputRedacted?.attemptId !== attempt.id ||
        invocation.authorizationContextFingerprint !== attempt.authorizationContextFingerprint ||
        serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
          serializeAgentCanonicalJson(context) ||
        (await npDigestAgentInvocationRequestCanonical(invocation.requestBody)) !==
          invocation.requestHash
      )
        throw missing();
      if (
        (row.state === "validating" && !["queued", "validating"].includes(attempt.state)) ||
        (row.state === "invalid" && !["invalid", "failed"].includes(attempt.state)) ||
        (["ready", "approval_pending", "approved", "rejected"].includes(row.state) &&
          attempt.state !== "ready")
      )
        throw missing();
      validation = {
        state:
          attempt.state === "ready"
            ? "valid"
            : attempt.state === "validating"
              ? "running"
              : (attempt.state as "queued" | "invalid" | "failed"),
        generation: attempt.generation,
        issueCount: attempt.issues.length,
        digest: attempt.resultDigest,
        completedAt: attempt.finishedAt?.toISOString() ?? null,
      };
      if (attempt.state === "invalid") {
        if (
          attempt.resultDigest !==
          hash("np.agent-changeset-validation-result.v1", {
            generation: attempt.generation,
            draftHash: attempt.draftHash,
            issues: attempt.issues,
          })
        )
          throw missing();
        for (const op of ops) {
          const relevant = attempt.issues.filter(
            (issue) => issue.operationOrdinal === null || issue.operationOrdinal === op.ordinal,
          );
          if (
            serializeAgentCanonicalJson(op.issues) !== serializeAgentCanonicalJson(relevant) ||
            op.state !== (relevant.length ? "invalid" : "draft")
          )
            throw missing();
        }
      }
    }
    if (row.sealedPlanBody !== null) {
      const sealed = npRequireAgentChangeSetPlanCanonical(row.sealedPlanBody);
      if (
        sealed.planKind !== "changeset" ||
        sealed.siteId !== row.siteId ||
        sealed.changeSetId !== row.id ||
        !attempt ||
        attempt.state !== "ready" ||
        ![
          "ready",
          "approval_pending",
          "approved",
          "rejected",
          "cancelled",
          "scheduled",
          "applying",
          "applied",
          "apply_failed",
          "verifying",
          "verified",
          "verification_failed",
        ].includes(row.state)
      )
        throw missing();
      const body = sealed.body;
      if (
        (await npDigestAgentChangeSetPlanCanonical(sealed)) !== row.planHash ||
        body.draftVersion !== row.draftVersion ||
        body.draftHash !== row.draftHash ||
        body.validationGeneration !== row.validationGeneration ||
        body.baseFingerprint !== row.baseFingerprint ||
        body.expiresAt !== row.expiresAt.toISOString() ||
        body.rollbackWindowSeconds !== row.rollbackWindowSeconds ||
        body.operations.length !== ops.length ||
        serializeAgentCanonicalJson(body.risk) !== serializeAgentCanonicalJson(row.riskSummary) ||
        serializeAgentCanonicalJson(body.risk) !==
          serializeAgentCanonicalJson(attempt.riskSummary) ||
        attempt.issues.length !== 0 ||
        attempt.resultDigest !==
          hash("np.agent-changeset-validation-result.v1", {
            generation: attempt.generation,
            draftHash: attempt.draftHash,
            planHash: row.planHash,
            issues: [],
          })
      )
        throw missing();
      let bytes = 0;
      const bases = [];
      for (let index = 0; index < ops.length; index++) {
        const op = ops[index];
        const planned = body.operations[index];
        const snapshot = op.beforeSnapshot;
        if (
          op.state !==
            (execution?.committedAt
              ? row.state === "verified"
                ? "verified"
                : "applied"
              : "valid") ||
          op.issues.length !== 0 ||
          (!execution?.committedAt && (op.afterHash !== null || op.resultDigest !== null)) ||
          planned.ordinal !== op.ordinal ||
          serializeAgentCanonicalJson(planned.operation) !==
            serializeAgentCanonicalJson(op.input) ||
          serializeAgentCanonicalJson(planned.canonicalResourceKey) !==
            serializeAgentCanonicalJson(op.resourceKey) ||
          serializeAgentCanonicalJson(op.baseVersion) !==
            serializeAgentCanonicalJson(op.input.base) ||
          op.beforeHash !== planned.beforeHash ||
          op.snapshotHash !== planned.snapshotHash ||
          !snapshot ||
          snapshot.siteId !== row.siteId ||
          snapshot.changeSetId !== row.id ||
          snapshot.operationOrdinal !== op.ordinal ||
          serializeAgentCanonicalJson(snapshot.canonicalResourceKey) !==
            serializeAgentCanonicalJson(op.resourceKey) ||
          (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== planned.snapshotHash
        )
          throw missing();
        bytes += Buffer.byteLength(serializeAgentCanonicalJson(snapshot));
        if (bytes > npAgentChangeSetLimits.aggregateSnapshotBytes) throw missing();
        const absentCreate =
          planned.operation.kind === "document" && planned.operation.operation === "create";
        if (
          snapshot.presence === "present" &&
          serializeAgentCanonicalJson(snapshot.base) !==
            serializeAgentCanonicalJson(planned.operation.base)
        )
          throw missing();
        if (
          snapshot.presence === "absent" &&
          !absentCreate &&
          !(
            planned.operation.kind === "setting" &&
            planned.operation.operation === "replace" &&
            planned.operation.base === null
          ) &&
          !(
            planned.operation.kind === "theme_tokens" &&
            planned.operation.base?.version === "absent" &&
            planned.operation.base.digest === planned.beforeHash
          )
        )
          throw missing();
        if (
          snapshot.presence === "present"
            ? snapshot.base?.digest !== planned.beforeHash
            : absentCreate
              ? planned.beforeHash !== null
              : planned.beforeHash !==
                hash("np.agent-changeset-resource.v1", {
                  siteId: row.siteId,
                  canonicalResourceKey: op.resourceKey,
                  presence: "absent",
                  value: null,
                })
        )
          throw missing();
        bases.push({
          ordinal: op.ordinal,
          canonicalResourceKey: op.resourceKey,
          presence: snapshot.presence,
          base: snapshot.base,
          snapshotHash: op.snapshotHash,
        });
      }
      if (
        body.baseFingerprint !== hash("np.agent-changeset-bases.v1", { siteId: row.siteId, bases })
      )
        throw missing();
    } else {
      if (
        row.planHash !== null ||
        row.baseFingerprint !== null ||
        row.riskSummary !== null ||
        row.rollbackWindowSeconds !== null ||
        row.state === "ready" ||
        attempt?.state === "ready"
      )
        throw missing();
      if (
        ops.some(
          (op) =>
            op.beforeSnapshot !== null ||
            op.snapshotHash !== null ||
            op.beforeHash !== null ||
            op.afterHash !== null ||
            op.resultDigest !== null,
        )
      )
        throw missing();
      if (
        ["draft", "validating"].includes(row.state) &&
        ops.some((op) => op.state !== "draft" || op.issues.length !== 0)
      )
        throw missing();
    }
    let name = "Deleted staff";
    const actorId = row.principalId ?? row.createdByUserId ?? row.actorFingerprint;
    if (row.principalId) {
      const [principal] = await db
        .select({ name: npAgentPrincipals.name })
        .from(npAgentPrincipals)
        .where(
          and(eq(npAgentPrincipals.siteId, row.siteId), eq(npAgentPrincipals.id, row.principalId)),
        )
        .limit(1);
      if (!principal) throw missing();
      name = principal.name;
    } else if (row.createdByUserId) {
      const [user] = await db
        .select({ name: npUsers.name })
        .from(npUsers)
        .where(eq(npUsers.id, row.createdByUserId))
        .limit(1);
      name = user?.name ?? "Deleted staff";
    }
    return npRequireAgentChangeSetWire({
      schemaVersion: "np.agent-changeset.v1",
      id: row.id,
      siteId: row.siteId,
      title: row.title,
      summary: row.summary,
      state: row.state,
      actor: { id: actorId, kind: row.creatorKind, name },
      agentId: row.agentId,
      agentVersionId: row.agentVersionId,
      agentConfigHash: row.agentConfigHash,
      runId: row.runId,
      planHash: row.planHash,
      baseFingerprint: row.baseFingerprint,
      draftVersion: row.draftVersion,
      draftHash: row.draftHash,
      risk: row.riskSummary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
        beforeHash: op.beforeHash,
        afterHash: op.afterHash,
        state: op.state,
        issues: op.issues,
        resultDigest: op.resultDigest,
      })),
      validation,
      preview: includePreview ? await latestPreviewSummary(db, row, actor) : null,
      approval: await latestApprovalSummary(db, row),
      schedule: row.scheduledFor ? { at: row.scheduledFor.toISOString() } : null,
      execution: execution ? executionSummary(execution) : null,
      verification: execution ? verificationSummary(execution) : null,
      rollback: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  async function get(input: { actor: NpAgentChangeSetActorV1; id: string }) {
    const actor = await resolve(input.actor, false);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, input.id)))
      .limit(1);
    if (!row) throw missing();
    let result: NpAgentChangeSetWire;
    try {
      result = await project(row, actor);
    } catch {
      throw missing();
    }
    await same(input.actor, actor);
    return result;
  }
  async function getReview(
    input: {
      actor: NpAgentChangeSetActorV1;
      id: string;
    },
    approvalChecks = false,
  ): Promise<NpAgentChangeSetReviewV1> {
    const actor = await resolve(input.actor, false);
    if (!uuid.test(input.id)) throw missing();
    const { review, row } = await getDb().transaction(
      async (tx) => {
        const db = tx as unknown as Db;
        const [row] = await tx
          .select()
          .from(npAgentChangesets)
          .where(
            and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, input.id)),
          )
          .limit(1);
        if (!row) throw missing();
        const changeSet = await project(row, actor, false, db, false);
        const ops = await operations(db, row);
        const sealed =
          row.sealedPlanBody === null
            ? null
            : npRequireAgentChangeSetPlanCanonical(row.sealedPlanBody);
        const review = npRequireAgentChangeSetReviewV1({
          schemaVersion: "np.agent-changeset-review.v1",
          changeSet,
          executionDetail: await executionDetail(db, row, ops),
          executionActions: [],
          requiredStaffCapabilities:
            sealed?.planKind === "changeset" ? sealed.body.requiredHumanCapabilities : [],
          operations: ops.map((op) =>
            npProjectAgentChangeSetReviewOperationV1({
              ordinal: op.ordinal,
              operation: op.input,
              snapshot: op.beforeSnapshot,
              expired: row.expiresAt <= now(),
            }),
          ),
        });
        return { review, row };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    // Artifact verification re-enters current viewer admission. Release the snapshot
    // connection first so explicitly installed single-connection pools remain usable.
    const preview = await latestPreviewSummary(getDb(), row, actor, approvalChecks);
    await same(input.actor, actor);
    return npRequireAgentChangeSetReviewV1({
      ...review,
      executionActions: await executionActions(row, actor),
      changeSet: { ...review.changeSet, preview },
    });
  }
  async function prepare(
    actor: Actor,
    draft: NpAgentChangeSetDraftInputV1,
    previous: readonly OpRow[],
  ) {
    const old = new Map(previous.map((op) => [op.clientOperationId, op]));
    const proposed: NpAgentChangeSetProposalOperationCanonicalV1[] = draft.operations.map(
      (op, index) => {
        const prior = old.get(op.clientOperationId);
        const key =
          op.kind === "document" && op.operation === "create"
            ? {
                kind: "document" as const,
                collection: op.resource.collection,
                documentId:
                  prior?.input.kind === "document" && prior.input.operation === "create"
                    ? prior.resourceKey.kind === "document"
                      ? prior.resourceKey.documentId
                      : randomUUID()
                    : randomUUID(),
              }
            : { kind: op.kind, ...op.resource };
        if (
          prior &&
          op.kind === "document" &&
          op.operation === "create" &&
          (prior.input.kind !== "document" ||
            prior.input.operation !== "create" ||
            prior.input.resource.collection !== op.resource.collection)
        )
          throw conflict();
        return {
          ordinal: index + 1,
          operation: op,
          canonicalResourceKey: key,
        } as NpAgentChangeSetProposalOperationCanonicalV1;
      },
    );
    const reserved = proposed
      .filter((op) => op.operation.kind === "document" && op.operation.operation === "create")
      .map((op) =>
        op.canonicalResourceKey.kind === "document" ? op.canonicalResourceKey.documentId : "",
      );
    for (const op of proposed) {
      const result = await resources.prepare({
        siteId: actor.siteId,
        user: actor.user,
        operation: op.operation,
        canonicalResourceKey: op.canonicalResourceKey,
        reservedCreateDocumentIds: reserved,
      });
      requireScopes(actor, result.requiredScopes);
      op.operation = result.operation;
    }
    return proposed;
  }
  async function mutate(
    db: Db,
    time: Date,
    actor: Actor,
    draft: NpAgentChangeSetDraftInputV1,
    request: NpAgentChangeSetAdminInputV1,
    id: string | null,
    invocationId: string,
  ) {
    const inputHash = await npDigestAgentChangeSetDraftInputV1(draft);
    const sourceKey = hash("np.agent-changeset-source-idempotency.v1", request.idempotencyKey);
    let current: Row | undefined;
    if (id) {
      [current] = await db
        .select()
        .from(npAgentChangesets)
        .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
        .for("update")
        .limit(1);
      if (!current) throw missing();
      if (
        !("expectedVersion" in request) ||
        current.draftVersion !== request.expectedVersion ||
        !["draft", "invalid"].includes(current.state) ||
        current.expiresAt <= now()
      )
        throw conflict();
      const [approval] = await db
        .select({ id: npAgentApprovals.id })
        .from(npAgentApprovals)
        .where(and(eq(npAgentApprovals.siteId, actor.siteId), eq(npAgentApprovals.targetId, id)))
        .limit(1);
      if (approval) throw conflict();
    } else {
      [current] = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, actor.siteId),
            eq(npAgentChangesets.actorFingerprint, actor.fingerprint),
            eq(npAgentChangesets.sourceOperationId, "changeset.create"),
            eq(npAgentChangesets.sourceIdempotencyFingerprint, sourceKey),
          ),
        )
        .limit(1);
      if (current) {
        if (current.sourceInputHash !== inputHash) throw conflict();
        return current.id;
      }
    }
    const previous = current ? await operations(db, current) : [];
    if (current)
      for (const op of previous)
        requireScopes(
          actor,
          await resources.assertVisible({
            siteId: actor.siteId,
            user: actor.user,
            operation: op.input,
            canonicalResourceKey: op.resourceKey,
          }),
        );
    const changeSetId = current?.id ?? randomUUID();
    const version = current ? current.draftVersion + 1 : 1;
    const ops = await prepare(actor, draft, previous);
    const draftHash = await npDigestAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: actor.siteId,
      changeSetId,
      draftVersion: version,
      title: draft.title,
      summary: draft.summary,
      operations: ops,
    });
    time = now();
    if (current && current.expiresAt <= time) throw conflict();
    if (!current) {
      const [invocation] = await db
        .select({ fingerprint: npAgentInvocations.requestHash })
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, invocationId))
        .limit(1);
      if (!invocation) throw missing();
      await db.insert(npAgentChangesets).values({
        id: changeSetId,
        siteId: actor.siteId,
        creatorKind: actor.principalId ? "external" : "staff",
        principalId: actor.principalId,
        createdByUserId: actor.principalId ? null : actor.user.id,
        actorFingerprint: actor.fingerprint,
        sourceOperationId: "changeset.create",
        sourceInputHash: inputHash,
        sourceIdempotencyFingerprint: sourceKey,
        invocationId,
        invocationFingerprint: invocation.fingerprint,
        title: draft.title,
        summary: draft.summary,
        draftHash,
        expiresAt: new Date(time.getTime() + lifetime * 1000),
        createdAt: time,
        updatedAt: time,
      });
    } else {
      await db
        .update(npAgentChangesets)
        .set({
          title: draft.title,
          summary: draft.summary,
          draftVersion: version,
          draftHash,
          state: "draft",
          planHash: null,
          sealedPlanBody: null,
          baseFingerprint: null,
          rollbackWindowSeconds: null,
          riskSummary: null,
          policyRefs: [],
          rollbackEligibleUntil: null,
          scheduledFor: null,
          cancellationCode: null,
          updatedAt: time,
        })
        .where(eq(npAgentChangesets.id, changeSetId));
      await db
        .delete(npAgentChangesetOperations)
        .where(
          and(
            eq(npAgentChangesetOperations.siteId, actor.siteId),
            eq(npAgentChangesetOperations.changesetId, changeSetId),
          ),
        );
    }
    if (ops.length)
      await db.insert(npAgentChangesetOperations).values(
        ops.map((op) => ({
          siteId: actor.siteId,
          changesetId: changeSetId,
          ordinal: op.ordinal,
          clientOperationId: op.operation.clientOperationId,
          resourceKind: op.operation.kind,
          resourceKey: op.canonicalResourceKey,
          operation: op.operation.operation,
          input: op.operation,
          baseVersion: op.operation.base,
          beforeHash: null,
          state: "draft",
          createdAt: time,
          updatedAt: time,
        })),
      );
    if (current && current.expiresAt <= now()) throw conflict();
    return changeSetId;
  }
  function definition(operation: "create" | "validate" | "preview") {
    return npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(`changeset.${operation}`);
  }
  const gatewayRequestContext =
    new AsyncLocalStorage<NpAgentChangeSetCapabilityInvocationRequestV1>();
  const createDefinition = definition("create");
  const validateDefinition = definition("validate");
  const previewDefinition = definition("preview");
  async function invokePrincipal(
    input: Extract<NpAgentChangeSetActorV1, { kind: "principal" }>,
    actor: Actor,
    request:
      | NpAgentChangeSetAdminInputV1<"create">
      | NpAgentChangeSetValidateRequestV1
      | NpAgentChangeSetPreviewRequestV1,
    kind: "create" | "validate" | "preview",
    persist: (
      db: Db,
      time: Date,
      invocationId: string,
    ) => Promise<{ changeSetId: string; attemptId?: string; previewId?: string }>,
    targetId?: string,
  ) {
    if (!options.admission) throw missing();
    const authentication = input.authentication;
    const operationId = `changeset.${kind}`;
    const resultKey = kind === "preview" ? "previewId" : "attemptId";
    const profileId = kind === "create" ? "changeset.draft-create" : "domain.read";
    const definitionBody =
      kind === "create"
        ? createDefinition
        : kind === "preview"
          ? previewDefinition
          : validateDefinition;
    const fingerprint = await npDigestAgentCapabilityRegistryCanonical(
      definitionBody,
      definitionBody.capabilities,
    );
    const authorizationFingerprint = await npDigestAgentAuthorizationContextCanonical(
      authentication.authorizationContext,
    );
    let descriptorInput = gatewayRequestContext.getStore()?.arguments.input;
    if (descriptorInput === undefined) {
      if (kind === "create" && "proposalJson" in request)
        descriptorInput = npRequireAgentChangeSetDraftInputV1(JSON.parse(request.proposalJson));
      else if (kind === "preview" && "expectedPlanHash" in request)
        descriptorInput = { changeSetId: targetId!, planHash: request.expectedPlanHash };
      else {
        const [row] = await getDb()
          .select({ draftHash: npAgentChangesets.draftHash })
          .from(npAgentChangesets)
          .where(
            and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, targetId!)),
          )
          .limit(1);
        if (!row || !("expectedVersion" in request)) throw missing();
        descriptorInput = {
          changeSetId: targetId!,
          draftVersion: request.expectedVersion,
          draftHash: row.draftHash,
        };
      }
    }
    const body = npRequireAgentInvocationRequestCanonical({
      schemaVersion: "np.agent-idempotency-request.v1",
      siteId: actor.siteId,
      actorKind: "principal",
      actorFingerprint: actor.fingerprint,
      authorizationContextFingerprint: authorizationFingerprint,
      operationKind: "capability",
      operationId,
      contractVersion: 1,
      contractFingerprint: fingerprint,
      effectProfile: { id: profileId, contractVersion: 1 },
      input: json(descriptorInput),
    });
    const expectedDescriptorInput = descriptorInput;
    const requestHash = await npDigestAgentInvocationRequestCanonical(body);
    return options.admission.withCurrentAuthority({
      authentication,
      requiredScopes: authentication.scopes,
      minimumExposure: "propose",
      mutate: async (db, time) => {
        const [previous] = await db
          .select()
          .from(npAgentInvocations)
          .where(
            and(
              eq(npAgentInvocations.siteId, actor.siteId),
              eq(npAgentInvocations.actorFingerprint, actor.fingerprint),
              eq(npAgentInvocations.authorizationContextFingerprint, authorizationFingerprint),
              eq(npAgentInvocations.operationKind, "capability"),
              eq(npAgentInvocations.operationId, operationId),
              eq(npAgentInvocations.idempotencyKey, request.idempotencyKey),
            ),
          )
          .limit(1);
        if (previous) {
          if (
            previous.requestHash !== requestHash ||
            previous.state !== "completed" ||
            !previous.resultId
          )
            throw conflict();
          const output = previous.outputRedacted;
          if (
            !output ||
            output.changeSetId !== previous.resultId ||
            (kind !== "create" &&
              (typeof output[resultKey] !== "string" || !uuid.test(output[resultKey])))
          )
            throw conflict();
          return {
            changeSetId: previous.resultId,
            ...(kind !== "create" ? { [resultKey]: output[resultKey] as string } : {}),
          };
        }
        if (kind === "validate" && "draftHash" in expectedDescriptorInput) {
          const [current] = await db
            .select({ draftHash: npAgentChangesets.draftHash })
            .from(npAgentChangesets)
            .where(
              and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, targetId!)),
            )
            .for("update")
            .limit(1);
          if (!current || current.draftHash !== expectedDescriptorInput.draftHash) throw conflict();
        }
        const [audit] = await db
          .insert(npAuditEvents)
          .values({
            siteId: actor.siteId,
            actorKind: "agent-principal",
            action: `agents.changesets.${kind}`,
            targetType: "agent-changeset",
            targetId: null,
            payload: { requestHash, operationId, outcome: "completed" },
            createdAt: time,
          })
          .returning({ id: npAuditEvents.id });
        if (!audit) throw missing();
        const invocationId = randomUUID();
        await db.insert(npAgentInvocations).values({
          id: invocationId,
          siteId: actor.siteId,
          actorKind: "principal",
          principalId: actor.principalId,
          actorFingerprint: actor.fingerprint,
          authorizationContextBody: authentication.authorizationContext,
          authorizationContextFingerprint: authorizationFingerprint,
          authorityRef: authentication.authorizationContext.authorityRef,
          operationKind: "capability",
          operationId,
          contractVersion: 1,
          contractFingerprint: fingerprint,
          capabilityDefinitionBody: definitionBody,
          effectProfileId: profileId,
          effectContractVersion: 1,
          transport: authentication.authorizationContext.transport,
          mcpExecutionMode: ["mcp-service", "mcp-oauth"].includes(
            authentication.authorizationContext.transport,
          )
            ? "normal"
            : null,
          idempotencyKey: request.idempotencyKey,
          requestBody: body,
          requestHash,
          state: "started",
          auditEventId: audit.id,
          requestedAt: time,
          expiresAt: new Date(time.getTime() + 86400_000),
        });
        const output = await persist(db, time, invocationId);
        const id = output.changeSetId;
        await db.update(npAuditEvents).set({ targetId: id }).where(eq(npAuditEvents.id, audit.id));
        await db
          .update(npAgentInvocations)
          .set({
            state: "completed",
            resultKind: "changeset",
            resultId: id,
            outputRedacted: output,
            outputHash: hash("np.agent-changeset-result.v1", output),
            completedAt: time,
          })
          .where(eq(npAgentInvocations.id, invocationId));
        return output;
      },
    });
  }
  async function write(input: { actor: NpAgentChangeSetActorV1; command: unknown; id?: string }) {
    const mode = input.id === undefined ? "create" : "update";
    if (input.id !== undefined && !uuid.test(input.id)) throw missing();
    if (mode === "update" && input.actor.kind !== "staff") throw denied();
    const { request, draft } = await npVerifyAgentChangeSetAdminProposalV1(mode, input.command);
    const actor = await resolve(input.actor, true);
    let id: string | undefined;
    // Unique constraints and serializable isolation close concurrent acceptance without replaying effects.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (input.actor.kind === "staff") {
          const result = await admin({
            siteId: actor.siteId,
            actor: input.actor.actor,
            operationId:
              mode === "create" ? "agents.changesets.create" : "agents.changesets.update",
            targetId: input.id ?? null,
            command: request,
            mutate: async ({ db, now: time, invocationId }) => {
              const changeSetId = await mutate(
                db,
                time,
                actor,
                draft,
                request,
                input.id ?? null,
                invocationId,
              );
              await same(input.actor, actor, true);
              return { resourceId: changeSetId, output: { changeSetId } };
            },
          });
          id = result.resourceId;
        } else
          id = (
            await invokePrincipal(
              input.actor,
              actor,
              request,
              "create",
              async (db, time, invocationId) => ({
                changeSetId: await mutate(db, time, actor, draft, request, null, invocationId),
              }),
            )
          ).changeSetId;
        break;
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        if (attempt === 2 || !["40001", "23505"].includes(cause.cause?.code ?? cause.code ?? ""))
          throw error;
        await same(input.actor, actor, true);
      }
    }
    if (!id) throw conflict();
    await same(input.actor, actor, true);
    const [row] = await getDb()
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
      .limit(1);
    if (!row) throw missing();
    const result = await project(row, actor, true);
    await same(input.actor, actor, true);
    return result;
  }
  async function list(
    input: NpAgentChangeSetListFiltersV1 & {
      actor: NpAgentChangeSetActorV1;
      limit?: number;
      cursor?: string;
    },
  ) {
    const actor = await resolve(input.actor, false);
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new NpAgentGatewayError("CHANGESET_QUERY_INVALID", 400, "Invalid ChangeSet query.");
    const invalidQuery = () =>
      new NpAgentGatewayError("CHANGESET_QUERY_INVALID", 400, "Invalid ChangeSet query.");
    const states = input.states ?? [],
      actorKinds = input.actorKinds ?? [];
    for (const [values, inventory] of [
      [states, npAgentChangeSetStates],
      [actorKinds, ["runtime", "external", "staff"]],
    ] as const) {
      if (
        !Array.isArray(values) ||
        values.length > inventory.length ||
        values.some(
          (v, i) => !(inventory as readonly string[]).includes(v) || (i > 0 && values[i - 1] >= v),
        )
      )
        throw invalidQuery();
    }
    const parseTime = (v: string | null | undefined) => {
      if (v == null) return null;
      const d = new Date(v);
      if (!Number.isFinite(d.getTime()) || d.toISOString() !== v) throw invalidQuery();
      return d;
    };
    const after = parseTime(input.createdAfter),
      before = parseTime(input.createdBefore);
    if (after && before && after >= before) throw invalidQuery();
    const binding = cursor.mac(
      serializeAgentCanonicalJson({
        siteId: actor.siteId,
        actor: actor.fingerprint,
        authorization: actor.authorization,
        states,
        actorKinds,
        createdAfter: after?.toISOString() ?? null,
        createdBefore: before?.toISOString() ?? null,
        limit,
      }),
    );
    let position: { id: string; time: string } | null = null;
    if (input.cursor) {
      try {
        const value = cursor.open(input.cursor) as {
          binding: string;
          expires: number;
          position: { id: string; time: string };
        };
        if (
          value.binding !== binding ||
          !Number.isFinite(value.expires) ||
          value.expires <= now().getTime() ||
          !uuid.test(value.position.id) ||
          new Date(value.position.time).toISOString() !== value.position.time
        )
          throw missing();
        position = value.position;
      } catch {
        throw new NpAgentGatewayError(
          "CHANGESET_CURSOR_INVALID",
          400,
          "ChangeSet cursor is invalid.",
        );
      }
    }
    const items: NpAgentChangeSetWire[] = [];
    let more = false;
    let bytes = 4096;
    let pageFull = false;
    for (let scanned = 0; scanned < 500;) {
      const where: SQL[] = [eq(npAgentChangesets.siteId, actor.siteId)];
      if (states.length) where.push(inArray(npAgentChangesets.state, states));
      if (actorKinds.length) where.push(inArray(npAgentChangesets.creatorKind, actorKinds));
      if (after) where.push(gt(npAgentChangesets.createdAt, after));
      if (before) where.push(lt(npAgentChangesets.createdAt, before));
      if (position)
        where.push(
          or(
            lt(npAgentChangesets.createdAt, new Date(position.time)),
            and(
              eq(npAgentChangesets.createdAt, new Date(position.time)),
              lt(npAgentChangesets.id, position.id),
            ),
          )!,
        );
      const rows = await getDb()
        .select()
        .from(npAgentChangesets)
        .where(and(...where))
        .orderBy(desc(npAgentChangesets.createdAt), desc(npAgentChangesets.id))
        .limit(50);
      more = rows.length === 50;
      for (const row of rows) {
        scanned++;
        const previousPosition = position;
        position = { id: row.id, time: row.createdAt.toISOString() };
        let value: NpAgentChangeSetWire;
        try {
          value = await project(row, actor);
        } catch {
          continue;
        }
        const size = Buffer.byteLength(JSON.stringify(value));
        if (items.length && bytes + size > npAgentChangeSetLimits.wireBytes) {
          position = previousPosition;
          pageFull = true;
          more = true;
          break;
        }
        items.push(value);
        bytes += size;
        if (items.length === limit) {
          more = true;
          break;
        }
      }
      if (items.length === limit || pageFull || !more) break;
    }
    await same(input.actor, actor);
    return npRequireAgentContractResult(
      npAnalyzeAgentCursorPageV1(
        {
          schemaVersion: "np.agent-changesets.v1",
          items,
          nextCursor:
            more && position
              ? cursor.seal({ binding, position, expires: now().getTime() + 900000 })
              : null,
        },
        {
          schemaVersion: "np.agent-changesets.v1",
          analyzeItem: npAnalyzeAgentChangeSetWire,
          itemIssueRoot: "agent.changeset.wire",
          maximumBytes: npAgentChangeSetLimits.wireBytes,
          maximumDepth: 64,
        },
      ),
    );
  }
  const validationFailure = (
    code: "ACCESS_DENIED" | "VALIDATION_FAILED" = "VALIDATION_FAILED",
  ): NpAgentValidationIssueWire => ({
    code,
    severity: "error",
    operationOrdinal: null,
    path: "validation",
    message:
      code === "ACCESS_DENIED"
        ? "Validation authority is unavailable."
        : "Validation could not be completed.",
    evidenceRefs: [],
  });
  async function admitValidation(
    db: Db,
    actor: Actor,
    id: string,
    request: NpAgentChangeSetValidateRequestV1,
    invocationId: string,
    expectedDraftHash?: string,
  ) {
    const [row] = await db
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
      .for("update")
      .limit(1);
    const time = now();
    if (!row) throw missing();
    if (
      row.draftVersion !== request.expectedVersion ||
      (expectedDraftHash !== undefined && row.draftHash !== expectedDraftHash) ||
      !["draft", "invalid"].includes(row.state) ||
      row.expiresAt.getTime() - time.getTime() < 60000
    )
      throw conflict();
    const ops = await operations(db, row);
    for (const op of ops)
      requireScopes(
        actor,
        await resources.assertVisible({
          siteId: row.siteId,
          user: actor.user,
          operation: op.input,
          canonicalResourceKey: op.resourceKey,
          tx: db as unknown as NpTransaction,
        }),
      );
    const proposal = {
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    };
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== row.draftHash)
      throw conflict();
    const [invocation] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, row.siteId), eq(npAgentInvocations.id, invocationId)),
      )
      .limit(1);
    if (!invocation) throw missing();
    const context = npRequireAgentAuthorizationContextCanonical(
      invocation.authorizationContextBody,
    );
    const generation = row.validationGeneration + 1;
    const attemptId = randomUUID();
    await db.insert(npAgentChangesetValidationAttempts).values({
      id: attemptId,
      siteId: row.siteId,
      changesetId: row.id,
      generation,
      draftVersion: row.draftVersion,
      draftHash: row.draftHash,
      admittingInvocationId: invocationId,
      authorizationContextBody: context,
      authorizationContextFingerprint: invocation.authorizationContextFingerprint,
      authorityRef: context.authorityRef,
      requesterKind: context.actor.kind,
      requesterId:
        context.actor.kind === "staff" ? context.actor.userId : context.actor.principalId,
      requesterFingerprint: context.actor.actorFingerprint,
      createdAt: time,
      expiresAt: new Date(
        Math.min(row.expiresAt.getTime(), time.getTime() + validationLifetime * 1000),
      ),
    });
    await db
      .update(npAgentChangesets)
      .set({
        state: "validating",
        validationGeneration: generation,
        planHash: null,
        sealedPlanBody: null,
        baseFingerprint: null,
        riskSummary: null,
        policyRefs: [],
        rollbackWindowSeconds: null,
        updatedAt: time,
      })
      .where(eq(npAgentChangesets.id, id));
    await db
      .update(npAgentChangesetOperations)
      .set({
        state: "draft",
        beforeHash: null,
        beforeSnapshot: null,
        snapshotHash: null,
        afterHash: null,
        issues: [],
        resultDigest: null,
        updatedAt: time,
      })
      .where(
        and(
          eq(npAgentChangesetOperations.siteId, row.siteId),
          eq(npAgentChangesetOperations.changesetId, id),
        ),
      );
    return { changeSetId: id, attemptId };
  }
  async function storedStaff(
    db: Db,
    context: NpAgentAuthorizationContextCanonicalV1,
    fingerprint: string,
  ): Promise<Actor> {
    const checked = npRequireAgentAuthorizationContextCanonical(context);
    const ref = checked.authorityRef;
    if (
      ref.kind !== "staff-session" ||
      checked.actor.kind !== "staff" ||
      (await npDigestAgentAuthorizationContextCanonical(checked)) !== fingerprint
    )
      throw denied();
    const [user] = await db
      .select(staffUserProjection)
      .from(npUsers)
      .where(eq(npUsers.id, ref.userId))
      .for("update")
      .limit(1);
    await db
      .select({ id: npSessions.id })
      .from(npSessions)
      .where(eq(npSessions.id, ref.sessionId))
      .for("update");
    await db
      .select({ role: npSiteMemberships.role })
      .from(npSiteMemberships)
      .where(
        and(eq(npSiteMemberships.siteId, checked.siteId), eq(npSiteMemberships.userId, ref.userId)),
      )
      .for("update");
    if (!user || user.tokenVersion !== ref.userTokenVersion) throw denied();
    const authority = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      checked.siteId,
      { user, sessionId: ref.sessionId },
      now(),
    );
    if (
      (await npDigestAgentStaffSiteAuthorizationCanonical(authority)) !==
      ref.siteAuthorizationDigest
    )
      throw denied();
    const effectiveUser = {
      ...user,
      role:
        authority.authority.kind === "super-admin"
          ? ("admin" as const)
          : (authority.authority.role as NpAuthUser["role"]),
    };
    if (!can(effectiveUser, "site.access")) throw denied();
    return {
      siteId: checked.siteId,
      user: effectiveUser,
      scopes: null,
      principalId: null,
      fingerprint: checked.actor.actorFingerprint,
      authorization: serializeAgentCanonicalJson(authority),
    };
  }
  /** Shared durable requester authorization for validation and preview. Never substitutes creator authority. */
  async function withStoredActor<T>(
    seed: {
      siteId: string;
      authorizationContextBody: NpAgentAuthorizationContextCanonicalV1;
      authorizationContextFingerprint: string;
      requesterFingerprint: string;
    },
    run: (db: Db, actor: Actor) => Promise<T>,
  ): Promise<T> {
    const context = npRequireAgentAuthorizationContextCanonical(seed.authorizationContextBody);
    if (context.authorityRef.kind === "staff-session")
      return getDb().transaction(
        async (db) => {
          const actor = await storedStaff(db, context, seed.authorizationContextFingerprint);
          const result = await run(db, actor);
          await storedStaff(db, context, seed.authorizationContextFingerprint);
          return result;
        },
        { isolationLevel: "serializable" },
      );
    if (!options.admission || !options.gateway) throw denied();
    return options.admission.withStoredAuthority({
      authorizationContext: context,
      authorizationContextFingerprint: seed.authorizationContextFingerprint,
      requiredScopes: ["changeset:read"],
      minimumExposure: "propose",
      resolveTransportAudience: options.gateway.getTransportAudience,
      mutate: async (db, _time, authentication) => {
        const userId =
          authentication.principal.authority.kind === "user"
            ? authentication.principal.authority.userId
            : null;
        if (!userId) throw denied();
        const authority = await npResolveLiveAgentStaffAuthorizationV1(db, seed.siteId, userId);
        const [user] = await db
          .select(staffUserProjection)
          .from(npUsers)
          .where(eq(npUsers.id, userId))
          .limit(1);
        if (!user) throw denied();
        return run(db, {
          siteId: seed.siteId,
          user: {
            ...user,
            role:
              authority.authority.kind === "super-admin"
                ? "admin"
                : (authority.authority.role as NpAuthUser["role"]),
          },
          fingerprint: seed.requesterFingerprint,
          scopes: authentication.scopes,
          principalId: authentication.principal.id,
          authorization: serializeAgentCanonicalJson(authority),
        });
      },
    });
  }
  async function performValidation(
    db: Db,
    actor: Actor,
    seed: typeof npAgentChangesetValidationAttempts.$inferSelect,
  ) {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${seed.siteId}`}, 0))`,
    );
    const [row] = await db
      .select()
      .from(npAgentChangesets)
      .where(
        and(eq(npAgentChangesets.siteId, seed.siteId), eq(npAgentChangesets.id, seed.changesetId)),
      )
      .for("update")
      .limit(1);
    const [attempt] = await db
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, seed.siteId),
          eq(npAgentChangesetValidationAttempts.id, seed.id),
        ),
      )
      .for("update")
      .limit(1);
    if (!row || !attempt) return { state: "stale" as const };
    if (!["queued", "validating"].includes(attempt.state)) return { state: attempt.state };
    if (
      row.validationGeneration !== attempt.generation ||
      row.draftVersion !== attempt.draftVersion ||
      row.draftHash !== attempt.draftHash ||
      row.state !== "validating"
    )
      return { state: "stale" as const };
    if (attempt.expiresAt <= now() || row.expiresAt <= now())
      throw new NpAgentGatewayError("VALIDATION_EXPIRED", 409, "Validation expired.");
    if (
      serializeAgentCanonicalJson(attempt.authorizationContextBody) !==
        serializeAgentCanonicalJson(seed.authorizationContextBody) ||
      attempt.authorizationContextFingerprint !== seed.authorizationContextFingerprint ||
      actor.fingerprint !== attempt.requesterFingerprint ||
      actor.siteId !== attempt.siteId
    )
      throw denied();
    const [invocation] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, row.siteId),
          eq(npAgentInvocations.id, attempt.admittingInvocationId),
        ),
      )
      .limit(1);
    if (
      !invocation ||
      invocation.state !== "completed" ||
      !["agents.changesets.validate", "changeset.validate"].includes(invocation.operationId) ||
      invocation.resultId !== row.id ||
      invocation.outputRedacted?.attemptId !== attempt.id ||
      invocation.authorizationContextFingerprint !== attempt.authorizationContextFingerprint ||
      serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
        serializeAgentCanonicalJson(attempt.authorizationContextBody) ||
      serializeAgentCanonicalJson(invocation.authorityRef) !==
        serializeAgentCanonicalJson(attempt.authorityRef) ||
      (await npDigestAgentInvocationRequestCanonical(invocation.requestBody)) !==
        invocation.requestHash
    )
      throw missing();
    const ops = await operations(db, row);
    const proposal = npRequireAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    });
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== attempt.draftHash)
      throw missing();
    for (const op of ops) {
      try {
        requireScopes(
          actor,
          await resources.assertVisible({
            siteId: row.siteId,
            user: actor.user,
            operation: op.input,
            canonicalResourceKey: op.resourceKey,
            tx: db as unknown as NpTransaction,
          }),
        );
      } catch (error) {
        if (error instanceof NpAgentGatewayError) throw denied();
        throw error;
      }
    }
    await db
      .update(npAgentChangesetValidationAttempts)
      .set({ state: "validating", startedAt: now() })
      .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
    let checked: Awaited<ReturnType<typeof validationResources.validate>>;
    try {
      checked = await validationResources.validate({
        tx: db as unknown as NpTransaction,
        siteId: row.siteId,
        user: actor.user,
        changeSetId: row.id,
        operations: proposal.operations,
        now: now(),
      });
      requireScopes(actor, checked.requiredScopes);
    } catch (error) {
      if (!(error instanceof NpAgentChangeSetValidationResourceErrorV1)) throw error;
      if (attempt.expiresAt <= now() || row.expiresAt <= now())
        throw new NpAgentGatewayError("VALIDATION_EXPIRED", 409, "Validation expired.");
      const issues = error.issues;
      const resultDigest = hash("np.agent-changeset-validation-result.v1", {
        generation: attempt.generation,
        draftHash: attempt.draftHash,
        issues,
      });
      await db
        .update(npAgentChangesetValidationAttempts)
        .set({ state: "invalid", issues: issues.map(json), resultDigest, finishedAt: now() })
        .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
      await db
        .update(npAgentChangesets)
        .set({ state: "invalid", updatedAt: now() })
        .where(eq(npAgentChangesets.id, row.id));
      for (const op of ops) {
        const relevant = issues.filter(
          (issue) => issue.operationOrdinal === null || issue.operationOrdinal === op.ordinal,
        );
        await db
          .update(npAgentChangesetOperations)
          .set({
            state: relevant.length ? "invalid" : "draft",
            issues: relevant.map(json),
            updatedAt: now(),
          })
          .where(eq(npAgentChangesetOperations.id, op.id));
      }
      await db.insert(npAuditEvents).values({
        siteId: row.siteId,
        actorKind: "system",
        action: "agents.changesets.validation_finished",
        targetType: "agent-changeset",
        targetId: row.id,
        payload: {
          generation: attempt.generation,
          outcome: "invalid",
          issueCount: issues.length,
        },
        createdAt: now(),
      });
      return { state: "invalid" as const };
    }
    if (attempt.expiresAt <= now() || row.expiresAt <= now())
      throw new NpAgentGatewayError("VALIDATION_EXPIRED", 409, "Validation expired.");
    const requiredApplyScopes: NpAgentScope[] = [
      ...new Set<NpAgentScope>(["changeset:apply", ...checked.requiredApplyScopes]),
    ].sort();
    const plan = npRequireAgentChangeSetPlanCanonical({
      schemaVersion: "np.agent-changeset-plan.v1",
      planKind: "changeset",
      siteId: row.siteId,
      changeSetId: row.id,
      body: {
        draftVersion: row.draftVersion,
        draftHash: row.draftHash,
        validationGeneration: attempt.generation,
        baseFingerprint: checked.baseFingerprint,
        operations: checked.operations,
        risk: checked.risk,
        requiredScopes: requiredApplyScopes,
        requiredHumanCapabilities: [
          ...new Set(requiredApplyScopes.map((scope) => npAgentScopeStaffCapability[scope])),
        ].sort(),
        requiredHumanPredicates: [],
        policyHashes: checked.policyHashes,
        expiresAt: row.expiresAt.toISOString(),
        rollbackWindowSeconds: rollbackWindow,
      },
    });
    const planHash = await npDigestAgentChangeSetPlanCanonical(plan);
    const resultDigest = hash("np.agent-changeset-validation-result.v1", {
      generation: attempt.generation,
      draftHash: attempt.draftHash,
      planHash,
      issues: [],
    });
    for (const op of checked.operations) {
      const snapshot = checked.snapshots.find(
        (snapshot) => snapshot.operationOrdinal === op.ordinal,
      );
      if (
        !snapshot ||
        (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== op.snapshotHash
      )
        throw missing();
      await db
        .update(npAgentChangesetOperations)
        .set({
          state: "valid",
          beforeHash: op.beforeHash,
          beforeSnapshot: snapshot,
          snapshotHash: op.snapshotHash,
          issues: [],
          updatedAt: now(),
        })
        .where(
          and(
            eq(npAgentChangesetOperations.siteId, row.siteId),
            eq(npAgentChangesetOperations.changesetId, row.id),
            eq(npAgentChangesetOperations.ordinal, op.ordinal),
          ),
        );
    }
    await db
      .update(npAgentChangesets)
      .set({
        state: "ready",
        planHash,
        sealedPlanBody: plan,
        baseFingerprint: checked.baseFingerprint,
        riskSummary: checked.risk,
        rollbackWindowSeconds: rollbackWindow,
        updatedAt: now(),
      })
      .where(eq(npAgentChangesets.id, row.id));
    await db
      .update(npAgentChangesetValidationAttempts)
      .set({ state: "ready", riskSummary: checked.risk, resultDigest, finishedAt: now() })
      .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
    await db.insert(npAuditEvents).values({
      siteId: row.siteId,
      actorKind: "system",
      action: "agents.changesets.validation_finished",
      targetType: "agent-changeset",
      targetId: row.id,
      payload: { generation: attempt.generation, outcome: "ready" },
      createdAt: now(),
    });
    return { state: "ready" as const };
  }
  async function failValidation(
    seed: typeof npAgentChangesetValidationAttempts.$inferSelect,
    code: string,
  ) {
    return getDb().transaction(async (db) => {
      const [row] = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, seed.siteId),
            eq(npAgentChangesets.id, seed.changesetId),
          ),
        )
        .for("update")
        .limit(1);
      const [attempt] = await db
        .select()
        .from(npAgentChangesetValidationAttempts)
        .where(
          and(
            eq(npAgentChangesetValidationAttempts.siteId, seed.siteId),
            eq(npAgentChangesetValidationAttempts.id, seed.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!row || !attempt || !["queued", "validating"].includes(attempt.state))
        return { state: attempt?.state ?? "stale" };
      if (
        row.validationGeneration !== attempt.generation ||
        row.draftVersion !== attempt.draftVersion ||
        row.draftHash !== attempt.draftHash ||
        row.state !== "validating"
      )
        return { state: "stale" };
      await db
        .update(npAgentChangesetValidationAttempts)
        .set({
          state: "failed",
          errorCode: code,
          issues: [
            json(
              validationFailure(
                code === "AUTHORITY_REVOKED" ? "ACCESS_DENIED" : "VALIDATION_FAILED",
              ),
            ),
          ],
          finishedAt: now(),
        })
        .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
      await db
        .update(npAgentChangesets)
        .set({ state: "invalid", updatedAt: now() })
        .where(eq(npAgentChangesets.id, row.id));
      await db.insert(npAuditEvents).values({
        siteId: row.siteId,
        actorKind: "system",
        action: "agents.changesets.validation_finished",
        targetType: "agent-changeset",
        targetId: row.id,
        payload: { generation: attempt.generation, outcome: "failed", code },
        createdAt: now(),
      });
      return { state: "failed" };
    });
  }
  async function processValidationOnce(input: { siteId: string; attemptId: string }) {
    if (!uuid.test(input.attemptId)) throw missing();
    const [attempt] = await getDb()
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, input.siteId),
          eq(npAgentChangesetValidationAttempts.id, input.attemptId),
        ),
      )
      .limit(1);
    if (!attempt) throw missing();
    if (!["queued", "validating"].includes(attempt.state)) return { state: attempt.state };
    let admitted = false;
    try {
      return await withStoredActor(attempt, async (db, actor) => {
        admitted = true;
        return performValidation(db, actor, attempt);
      });
    } catch (error) {
      const dbError = error as { code?: string; cause?: { code?: string } };
      if (["40001", "40P01"].includes(dbError.cause?.code ?? dbError.code ?? "")) throw conflict();
      const code =
        error instanceof NpAgentGatewayError && error.code === "VALIDATION_EXPIRED"
          ? "VALIDATION_EXPIRED"
          : !admitted ||
              (error instanceof NpAgentGatewayError &&
                [
                  "AUTHORIZATION_CHANGED",
                  "CHANGESET_ACCESS_DENIED",
                  "STAFF_AUTHORIZATION_REQUIRED",
                  "SITE_ACCESS_DENIED",
                  "CAPABILITY_UNAVAILABLE",
                ].includes(error.code))
            ? "AUTHORITY_REVOKED"
            : "VALIDATION_FAILED";
      return failValidation(attempt, code);
    }
  }
  async function processValidation(input: { siteId: string; attemptId: string }) {
    for (let retry = 0; ; retry++) {
      try {
        return await processValidationOnce(input);
      } catch (error) {
        if (
          retry >= 2 ||
          !(error instanceof NpAgentGatewayError) ||
          error.code !== "CHANGESET_CONFLICT"
        )
          throw error;
      }
    }
  }
  async function validate(input: {
    expectedDraftHash?: string;
    actor: NpAgentChangeSetActorV1;
    id: string;
    command: unknown;
  }) {
    if (!uuid.test(input.id)) throw missing();
    const command = npRequireAgentChangeSetValidateRequestV1(input.command);
    const actor = await resolve(input.actor, false);
    let result: { changeSetId: string; attemptId?: string } | undefined;
    for (let retry = 0; retry < 3; retry++) {
      try {
        if (input.actor.kind === "staff") {
          const admission = await admin({
            siteId: actor.siteId,
            actor: input.actor.actor,
            operationId: "agents.changesets.validate",
            targetId: input.id,
            command,
            mutate: async ({ db, invocationId }) => {
              const output = await admitValidation(
                db,
                actor,
                input.id,
                command,
                invocationId,
                input.expectedDraftHash,
              );
              await same(input.actor, actor);
              return { resourceId: input.id, output };
            },
          });
          result = { changeSetId: admission.resourceId, attemptId: admission.output.attemptId };
        } else
          result = await invokePrincipal(
            input.actor,
            actor,
            command,
            "validate",
            (db, _time, invocationId) =>
              admitValidation(db, actor, input.id, command, invocationId, input.expectedDraftHash),
            input.id,
          );
        break;
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        if (retry === 2 || !["40001", "23505"].includes(cause.cause?.code ?? cause.code ?? ""))
          throw error;
        await same(input.actor, actor);
      }
    }
    if (!result?.attemptId) throw conflict();
    const [attempt] = await getDb()
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, actor.siteId),
          eq(npAgentChangesetValidationAttempts.id, result.attemptId),
        ),
      )
      .limit(1);
    if (!attempt) throw missing();
    if (attempt.state === "queued") {
      const [row] = await getDb()
        .select()
        .from(npAgentChangesets)
        .where(eq(npAgentChangesets.id, attempt.changesetId))
        .limit(1);
      if (!row) throw missing();
      if ((await operations(getDb(), row)).length <= inlineLimit)
        await processValidation({ siteId: actor.siteId, attemptId: attempt.id });
      else if (options.enqueueValidation) {
        try {
          await options.enqueueValidation({
            siteId: actor.siteId,
            attemptId: attempt.id,
            changeSetId: row.id,
            generation: attempt.generation,
            draftVersion: attempt.draftVersion,
            draftHash: attempt.draftHash,
          });
        } catch {
          /* Durable queued admission is retried by the explicit host processor. */
        }
      }
    }
    return get({ actor: input.actor, id: result.changeSetId });
  }
  /** Host-invoked recovery for queued admissions, including failed enqueue notifications. */
  async function reconcileValidations(input: { siteId: string; limit?: number }) {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Validation reconciliation limit must be 1..100.");
    const attempts = await getDb()
      .select({ id: npAgentChangesetValidationAttempts.id })
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, input.siteId),
          eq(npAgentChangesetValidationAttempts.state, "queued"),
        ),
      )
      .orderBy(
        asc(npAgentChangesetValidationAttempts.createdAt),
        asc(npAgentChangesetValidationAttempts.id),
      )
      .limit(limit);
    let completed = 0;
    for (const attempt of attempts) {
      try {
        const result = await processValidation({ siteId: input.siteId, attemptId: attempt.id });
        if (["ready", "invalid", "failed"].includes(result.state)) completed++;
      } catch (error) {
        if (!(error instanceof NpAgentGatewayError) || error.code !== "CHANGESET_CONFLICT")
          throw error;
      }
    }
    return { examined: attempts.length, completed };
  }
  const artifacts = createAgentPreviewArtifactServiceV1({
    storageAdapter: options.preview?.storageAdapter,
    resolveAdapter: options.preview?.resolveAdapter ?? (() => null),
    withPreviewAuthority,
    now,
  });
  async function readPreviewArtifact(input: {
    actor: NpAgentChangeSetActorV1;
    previewId: string;
    artifactId: string;
  }) {
    const actor = await resolve(input.actor, false);
    return artifacts.readArtifact({
      siteId: actor.siteId,
      previewId: input.previewId,
      artifactId: input.artifactId,
      authorize: async () => {
        const detail = await getPreviewInternal(
          { actor: input.actor, previewId: input.previewId },
          false,
        );
        if (detail.state !== "ready") throw missing();
      },
    });
  }
  async function processPreview(input: {
    siteId: string;
    previewId: string;
  }): Promise<{ state: string }> {
    let dispatch = false;
    try {
      const seed = await withPreviewAuthority({
        ...input,
        mutate: async (db, p) => {
          if (p.state === "ready") return p;
          if (p.state === "queued") {
            await db
              .update(npAgentChangesetPreviews)
              .set({ state: "rendering", renderingStartedAt: now() })
              .where(
                and(
                  eq(npAgentChangesetPreviews.id, p.id),
                  eq(npAgentChangesetPreviews.state, "queued"),
                ),
              );
            dispatch = true;
          }
          return p;
        },
      });
      if (seed.state === "ready") return { state: "ready" };
      if (dispatch) {
        const screenshot = options.preview?.screenshotAdapter;
        let output: readonly NpAgentPreviewArtifactInputV1[] = [];
        if (screenshot) {
          if (
            screenshot.id !== seed.previewContractBody.screenshotAdapterId ||
            screenshot.contractVersion !== seed.previewContractBody.screenshotAdapterVersion ||
            screenshot.fingerprint !== seed.previewContractBody.screenshotAdapterFingerprint
          )
            throw missing();
          const abort = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            output = await Promise.race([
              screenshot.capture({
                siteId: input.siteId,
                previewId: input.previewId,
                routes: seed.allowedRoutes,
                signal: abort.signal,
                render: (route, renderer) => renderPreview({ ...input, route, render: renderer }),
              }),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                  abort.abort();
                  reject(missing());
                }, 120_000);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
            abort.abort();
          }
          if (
            !Array.isArray(output) ||
            output.length > npAgentChangeSetLimits.previewArtifacts ||
            output.some(
              (a) =>
                a.kind === "screenshot" &&
                !seed.allowedRoutes.some((r) => r.route === a.route && r.locale === a.locale),
            )
          )
            throw missing();
        } else if (seed.previewContractBody.screenshotAdapterId !== null) throw missing();
        const checks = options.preview?.checks;
        if (checks) {
          if (
            checks.rendererId !== seed.previewContractBody.rendererId ||
            checks.rendererVersion !== seed.previewContractBody.rendererVersion ||
            checks.rendererFingerprint !== seed.previewContractBody.rendererFingerprint ||
            Object.entries(npAgentPreviewCheckVersionsV1).some(
              ([key, version]) =>
                seed.previewContractBody[key as keyof typeof npAgentPreviewCheckVersionsV1] !==
                version,
            )
          )
            throw missing();
          if (output.some((a) => a.kind === "report")) throw missing();
          const manifest = seed.allowedRoutes.length
            ? await renderPreview({
                ...input,
                route: seed.allowedRoutes[0],
                render: checks.resolveManifest,
              })
            : [];
          const reports = await runAgentPreviewChecksV1({
            identity: {
              siteId: seed.siteId,
              changeSetId: seed.changesetId,
              previewId: seed.id,
              generation: seed.generation,
              planHash: seed.planHash,
              previewContractFingerprint: seed.previewContractFingerprint,
              generatedAt: now().toISOString(),
            },
            routes: seed.allowedRoutes,
            render: (route) => renderPreview({ ...input, route, render: checks.render }),
            productionOrigins: checks.productionOrigins,
            routeManifest: manifest,
            resolveRoute: (route) =>
              Promise.resolve(
                manifest.filter((r) => r.route === route.route && r.locale === route.locale)
                  .length === 1,
              ),
            assertCurrentAuthority: () =>
              withPreviewAuthority({ ...input, mutate: () => Promise.resolve(undefined) }),
            linkAllowlistOrigins: seed.previewContractBody.linkAllowlistOrigins,
          });
          output = [
            ...output,
            ...reports.map((report) => ({
              kind: "report" as const,
              mime: "application/json" as const,
              route: null,
              locale: null,
              viewport: null,
              reportPart: report.part,
              reportTotalParts: report.totalParts,
              bytes: new TextEncoder().encode(serializeAgentCanonicalJson(report)),
            })),
          ];
          await withPreviewAuthority({
            ...input,
            mutate: async (db, p) => {
              await db
                .update(npAgentChangesetPreviews)
                .set({
                  checkSummary: {
                    checksRun: reports.reduce((sum, report) => sum + report.results.length, 0),
                    screenshots: 0,
                    warningCodes: [],
                  },
                })
                .where(
                  and(
                    eq(npAgentChangesetPreviews.siteId, p.siteId),
                    eq(npAgentChangesetPreviews.id, p.id),
                  ),
                );
            },
          });
        }
        // Complete a private bounded spool before reserving or writing any object.
        // Recovery only inspects the durable journal; it never replays this spool.
        const spool = await mkdtemp(join(tmpdir(), "nexpress-preview-"));
        const completed: NpAgentPreviewArtifactInputV1[] = [];
        try {
          await chmod(spool, 0o700);
          for (const [index, artifact] of output.entries()) {
            const max =
              artifact.kind === "screenshot"
                ? npAgentChangeSetLimits.screenshotBytes
                : npAgentChangeSetLimits.reportBytes;
            if (
              !(artifact.bytes instanceof Uint8Array) ||
              artifact.bytes.length < 1 ||
              artifact.bytes.length > max
            )
              throw missing();
            // Copy host-owned arrays so later adapter mutation cannot alter the frozen set.
            const bytes = Uint8Array.from(artifact.bytes);
            try {
              await writeFile(join(spool, String(index)), bytes, { mode: 0o600, flag: "wx" });
            } finally {
              bytes.fill(0);
            }
          }
          for (const [index, artifact] of output.entries())
            completed.push({ ...artifact, bytes: await readFile(join(spool, String(index))) });
          const reserved = await artifacts.reserve({ ...input, artifacts: completed });
          for (const [index, upload] of reserved.uploads.entries())
            await artifacts.dispatch({
              siteId: input.siteId,
              uploadId: upload.uploadId,
              bytes: completed[index].bytes,
            });
        } finally {
          for (const artifact of completed) artifact.bytes.fill(0);
          await rm(spool, { recursive: true, force: true });
        }
      } else {
        const [p] = await getDb()
          .select()
          .from(npAgentChangesetPreviews)
          .where(
            and(
              eq(npAgentChangesetPreviews.siteId, input.siteId),
              eq(npAgentChangesetPreviews.id, input.previewId),
            ),
          )
          .limit(1);
        if (!p) throw missing();
        if (p.expectedArtifactCount === null) {
          if (p.renderingStartedAt && now().getTime() - p.renderingStartedAt.getTime() < 180_000)
            return { state: "rendering" };
          throw missing();
        }
        const uploads = await getDb()
          .select({ id: npAgentPreviewArtifactUploads.id })
          .from(npAgentPreviewArtifactUploads)
          .innerJoin(
            npAgentPreviewArtifacts,
            and(
              eq(npAgentPreviewArtifacts.id, npAgentPreviewArtifactUploads.artifactId),
              eq(npAgentPreviewArtifacts.siteId, npAgentPreviewArtifactUploads.siteId),
            ),
          )
          .where(
            and(
              eq(npAgentPreviewArtifactUploads.siteId, input.siteId),
              eq(npAgentPreviewArtifactUploads.previewId, input.previewId),
            ),
          )
          .orderBy(asc(npAgentPreviewArtifacts.ordinal))
          .limit(25);
        if (uploads.length !== p.expectedArtifactCount) throw missing();
        for (const upload of uploads)
          await artifacts.reconcileUpload({ siteId: input.siteId, uploadId: upload.id });
      }
      await artifacts.finalize(input);
      return { state: "ready" };
    } catch {
      const [p] = await getDb()
        .select()
        .from(npAgentChangesetPreviews)
        .where(
          and(
            eq(npAgentChangesetPreviews.siteId, input.siteId),
            eq(npAgentChangesetPreviews.id, input.previewId),
          ),
        )
        .limit(1);
      if (!p) throw missing();
      let authorityLive = true;
      try {
        await withPreviewAuthority({ ...input, mutate: () => Promise.resolve() });
      } catch {
        authorityLive = false;
      }
      if (authorityLive && p.state === "rendering" && p.expectedArtifactCount !== null)
        return { state: "rendering" };
      let failureCode = "PREVIEW_FAILED";
      if (!authorityLive) {
        // Admission also rejects expired plans and changed contracts. Do not
        // describe those failures as a revoked requester without checking it.
        try {
          await withStoredActor(p, () => Promise.resolve());
          try {
            await assertPreviewContract(p);
          } catch {
            failureCode = "CONTRACT_CHANGED";
          }
        } catch (error) {
          if (error instanceof NpAgentGatewayError) failureCode = "AUTHORITY_REVOKED";
        }
      }
      if (["queued", "rendering"].includes(p.state))
        await getDb()
          .update(npAgentChangesetPreviews)
          .set({
            state: "failed",
            completedAt: now(),
            errorCode: failureCode,
          })
          .where(
            and(
              eq(npAgentChangesetPreviews.id, p.id),
              inArray(npAgentChangesetPreviews.state, ["queued", "rendering"]),
            ),
          );
      if (p.state !== "ready")
        try {
          await artifacts.reconcilePreviewCleanup(input);
        } catch {
          /* Ambiguous uploads remain fenced for explicit cleanup recovery. */
        }
      return { state: p.state === "ready" ? "ready" : "failed" };
    }
  }
  async function reconcilePreviews(input: {
    siteId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ examined: number; completed: number; nextCursor: string | null }> {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw conflict();
    const binding = cursor.mac(
      serializeAgentCanonicalJson({ purpose: "preview-maintenance", siteId: input.siteId, limit }),
    );
    let position: { id: string; time: string } | null = null;
    if (input.cursor) {
      try {
        const value = cursor.open(input.cursor) as {
          binding: string;
          expires: number;
          position: { id: string; time: string };
        };
        if (
          value.binding !== binding ||
          !Number.isFinite(value.expires) ||
          value.expires <= now().getTime() ||
          !uuid.test(value.position.id) ||
          new Date(value.position.time).toISOString() !== value.position.time
        )
          throw conflict();
        position = value.position;
      } catch {
        throw conflict();
      }
    }
    const rows = await getDb()
      .select()
      .from(npAgentChangesetPreviews)
      .where(
        and(
          eq(npAgentChangesetPreviews.siteId, input.siteId),
          ...(position
            ? [
                or(
                  gt(npAgentChangesetPreviews.createdAt, new Date(position.time)),
                  and(
                    eq(npAgentChangesetPreviews.createdAt, new Date(position.time)),
                    gt(npAgentChangesetPreviews.id, position.id),
                  ),
                )!,
              ]
            : []),
        ),
      )
      .orderBy(asc(npAgentChangesetPreviews.createdAt), asc(npAgentChangesetPreviews.id))
      .limit(limit);
    let completed = 0;
    for (const p of rows) {
      if (["failed", "expired"].includes(p.state)) {
        try {
          await artifacts.reconcilePreviewCleanup({ siteId: input.siteId, previewId: p.id });
          completed++;
        } catch {
          /* Inspection remains fenced; continue to the next bounded item. */
        }
        continue;
      }
      const [parent] = await getDb()
        .select()
        .from(npAgentChangesets)
        .where(
          and(eq(npAgentChangesets.siteId, input.siteId), eq(npAgentChangesets.id, p.changesetId)),
        )
        .limit(1);
      if (
        !parent ||
        !["ready", "approval_pending", "approved"].includes(parent.state) ||
        parent.planHash !== p.planHash ||
        parent.expiresAt <= now() ||
        (p.expiresAt !== null && p.expiresAt <= now())
      ) {
        await getDb()
          .update(npAgentChangesetPreviews)
          .set({
            state: "expired",
            completedAt: sql`coalesce(${npAgentChangesetPreviews.completedAt}, ${now()})`,
          })
          .where(
            and(
              eq(npAgentChangesetPreviews.id, p.id),
              inArray(npAgentChangesetPreviews.state, ["queued", "rendering", "ready"]),
            ),
          );
        try {
          await artifacts.reconcilePreviewCleanup({ siteId: input.siteId, previewId: p.id });
          completed++;
        } catch {
          /* Return the cursor even when storage still needs inspection. */
        }
      } else if (p.state !== "ready") {
        const result = await processPreview({ siteId: input.siteId, previewId: p.id });
        if (result.state !== "rendering") completed++;
      }
    }
    const last = rows.at(-1);
    return {
      examined: rows.length,
      completed,
      nextCursor:
        rows.length === limit && last
          ? cursor.seal({
              binding,
              position: { id: last.id, time: last.createdAt.toISOString() },
              expires: now().getTime() + 900000,
            })
          : null,
    };
  }
  const previewArtifacts = artifacts;
  async function assertPreviewContract(preview: PreviewRow) {
    const contract = npRequireAgentPreviewContractCanonical(preview.previewContractBody);
    if (
      !options.preview ||
      (await npDigestAgentPreviewContractCanonical(contract)) !==
        preview.previewContractFingerprint ||
      (await npDigestAgentPreviewContractCanonical(options.preview.contract)) !==
        preview.previewContractFingerprint
    )
      throw missing();
    if (
      (await npDigestAgentPreviewRoutesCanonical({
        schemaVersion: "np.agent-preview-routes.v1",
        siteId: preview.siteId,
        changeSetId: preview.changesetId,
        previewId: preview.id,
        generation: preview.generation,
        planHash: preview.planHash,
        routes: preview.allowedRoutes,
      })) !== preview.allowedRoutesDigest
    )
      throw missing();
  }
  async function previewProjection(
    db: Db,
    preview: PreviewRow,
    actor: Actor,
    verifyArtifacts = true,
    approvalChecks = false,
  ) {
    await assertPreviewContract(preview);
    const expired = preview.expiresAt !== null && preview.expiresAt <= now();
    const state = expired ? "expired" : preview.state;
    const artifacts = await db
      .select()
      .from(npAgentPreviewArtifacts)
      .where(
        and(
          eq(npAgentPreviewArtifacts.siteId, preview.siteId),
          eq(npAgentPreviewArtifacts.previewId, preview.id),
        ),
      )
      .orderBy(asc(npAgentPreviewArtifacts.ordinal));
    const manifest = {
      schemaVersion: "np.agent-preview-artifact-manifest.v1",
      siteId: preview.siteId,
      changeSetId: preview.changesetId,
      previewId: preview.id,
      generation: preview.generation,
      planHash: preview.planHash,
      previewContractFingerprint: preview.previewContractFingerprint,
      artifacts: artifacts.map((a) => ({
        artifactId: a.id,
        ordinal: a.ordinal,
        kind: a.kind,
        route: a.route,
        locale: a.locale,
        viewport: a.viewport,
        reportPart: a.reportPart,
        reportTotalParts: a.reportTotalParts,
        contentDigest: a.contentDigest,
        mime: a.mime,
        bytes: a.bytes,
        createdAt: a.createdAt.toISOString(),
        expiresAt: a.objectExpiresAt?.toISOString(),
      })),
    };
    if (
      state === "ready" &&
      (preview.expectedArtifactCount !== artifacts.length ||
        artifacts.some(
          (a) =>
            a.objectState !== "ready" ||
            a.previewContractFingerprint !== preview.previewContractFingerprint ||
            a.objectExpiresAt?.toISOString() !== preview.expiresAt?.toISOString(),
        ) ||
        (await npDigestAgentPreviewArtifactManifestCanonical(manifest)) !== preview.digest)
    )
      throw missing();
    if (state === "ready" && verifyArtifacts)
      for (const artifact of artifacts) {
        await artifactServiceRead(artifact.id);
      }
    async function artifactServiceRead(artifactId: string) {
      const content = await previewArtifacts.readArtifact({
        siteId: preview.siteId,
        previewId: preview.id,
        artifactId,
        authorize: async () => {
          if (!actor.source) throw missing();
          const current = await getPreviewInternal(
            { actor: actor.source, previewId: preview.id },
            false,
          );
          if (
            current.state !== "ready" ||
            current.digest !== preview.digest ||
            current.generation !== preview.generation
          )
            throw missing();
        },
      });
      if (approvalChecks && artifacts.find((a) => a.id === artifactId)?.kind === "report") {
        try {
          assertApprovalReport(content.bytes, preview.siteId);
        } finally {
          content.bytes.fill(0);
        }
      }
    }
    return npRequireAgentPreviewDetailWireV1(
      {
        schemaVersion: "np.agent-preview.v1",
        previewId: preview.id,
        state,
        generation: preview.generation,
        planHash: preview.planHash,
        previewContractFingerprint: preview.previewContractFingerprint,
        digest: preview.digest,
        artifactCount: preview.expectedArtifactCount ?? 0,
        artifactRefs:
          state === "ready"
            ? manifest.artifacts.map((a) => ({
                ...a,
                schemaVersion: "np.agent-preview-artifact-ref.v1",
                resourceUri: `nexpress://site/${preview.siteId}/agent-previews/${preview.id}/artifacts/${a.artifactId}`,
              }))
            : [],
        interactiveLaunch: null,
        expiresAt: preview.expiresAt?.toISOString() ?? null,
        changeSetId: preview.changesetId,
        allowedRoutes: preview.allowedRoutes,
        diffSummary: preview.diffSummary,
        checkSummary: preview.checkSummary,
        riskSummary: preview.riskSummary,
        createdAt: preview.createdAt.toISOString(),
        completedAt: preview.completedAt?.toISOString() ?? null,
        safeErrorCode: preview.errorCode,
      },
      preview.siteId,
    );
  }
  async function latestPreviewSummary(db: Db, row: Row, actor: Actor, approvalChecks = false) {
    if (
      !options.preview ||
      !row.planHash ||
      !["ready", "approval_pending", "approved", "rejected", "scheduled"].includes(row.state)
    )
      return null;
    const [latest] = await db
      .select()
      .from(npAgentChangesetPreviews)
      .where(
        and(
          eq(npAgentChangesetPreviews.siteId, row.siteId),
          eq(npAgentChangesetPreviews.changesetId, row.id),
          ...(row.planHash ? [eq(npAgentChangesetPreviews.planHash, row.planHash)] : []),
        ),
      )
      .orderBy(desc(npAgentChangesetPreviews.generation), desc(npAgentChangesetPreviews.createdAt))
      .limit(1);
    if (!latest) return null;
    const detail = await previewProjection(db, latest, actor, true, approvalChecks);
    const {
      changeSetId: _id,
      allowedRoutes: _routes,
      diffSummary: _diff,
      checkSummary: _checks,
      riskSummary: _risk,
      createdAt: _created,
      completedAt: _completed,
      safeErrorCode: _code,
      ...summary
    } = detail;
    return npRequireAgentPreviewSummaryV1(
      { ...summary, schemaVersion: "np.agent-preview-summary.v1" },
      { siteId: row.siteId, changeSetId: row.id },
    );
  }
  async function protectedPreview(
    db: Db,
    actor: Actor,
    previewId: string,
    requireReady: boolean,
    lock = true,
  ) {
    if (!uuid.test(previewId)) throw missing();
    const [seed] = await db
      .select()
      .from(npAgentChangesetPreviews)
      .where(
        and(
          eq(npAgentChangesetPreviews.siteId, actor.siteId),
          eq(npAgentChangesetPreviews.id, previewId),
        ),
      )
      .limit(1);
    if (!seed) throw missing();
    const parentQuery = db
      .select()
      .from(npAgentChangesets)
      .where(
        and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, seed.changesetId)),
      )
      .limit(1);
    const [parent] = await (lock ? parentQuery.for("update") : parentQuery);
    const previewQuery = db
      .select()
      .from(npAgentChangesetPreviews)
      .where(
        and(
          eq(npAgentChangesetPreviews.siteId, actor.siteId),
          eq(npAgentChangesetPreviews.id, previewId),
        ),
      )
      .limit(1);
    const [preview] = await (lock ? previewQuery.for("update") : previewQuery);
    if (!parent || !preview || parent.planHash !== preview.planHash) throw missing();
    await project(parent, actor, false, db, false);
    await assertPreviewContract(preview);
    if (
      requireReady &&
      (!["ready", "approval_pending", "approved", "rejected"].includes(parent.state) ||
        parent.expiresAt <= now() ||
        preview.state !== "ready" ||
        !preview.expiresAt ||
        preview.expiresAt <= now())
    )
      throw missing();
    return { preview, parent };
  }
  async function withPreviewRequester<T>(input: {
    siteId: string;
    previewId: string;
    mutate: (db: Db, preview: PreviewRow, actor: Actor) => Promise<T>;
  }): Promise<T> {
    if (!uuid.test(input.previewId)) throw missing();
    const [seed] = await getDb()
      .select()
      .from(npAgentChangesetPreviews)
      .where(
        and(
          eq(npAgentChangesetPreviews.siteId, input.siteId),
          eq(npAgentChangesetPreviews.id, input.previewId),
        ),
      )
      .limit(1);
    if (!seed) throw missing();
    return withStoredActor(seed, async (db, actor) => {
      const { preview, parent } = await protectedPreview(db, actor, input.previewId, false);
      if (
        !["ready", "approval_pending", "approved"].includes(parent.state) ||
        parent.expiresAt <= now() ||
        !["queued", "rendering", "ready"].includes(preview.state) ||
        (preview.state === "rendering" &&
          preview.expectedArtifactCount === null &&
          (!preview.renderingStartedAt ||
            now().getTime() - preview.renderingStartedAt.getTime() >= 180_000)) ||
        (preview.expiresAt !== null && preview.expiresAt <= now()) ||
        serializeAgentCanonicalJson(preview.authorizationContextBody) !==
          serializeAgentCanonicalJson(seed.authorizationContextBody) ||
        preview.authorizationContextFingerprint !== seed.authorizationContextFingerprint ||
        preview.requesterFingerprint !== actor.fingerprint
      )
        throw denied();
      const [invocation] = await db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, input.siteId),
            eq(npAgentInvocations.id, preview.admittingInvocationId),
          ),
        )
        .limit(1);
      if (
        !invocation ||
        invocation.state !== "completed" ||
        !["agents.changesets.preview", "changeset.preview"].includes(invocation.operationId) ||
        invocation.resultId !== parent.id ||
        invocation.outputRedacted?.previewId !== preview.id ||
        invocation.authorizationContextFingerprint !== preview.authorizationContextFingerprint ||
        serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
          serializeAgentCanonicalJson(preview.authorizationContextBody) ||
        serializeAgentCanonicalJson(invocation.authorityRef) !==
          serializeAgentCanonicalJson(preview.authorityRef) ||
        (await npDigestAgentInvocationRequestCanonical(invocation.requestBody)) !==
          invocation.requestHash
      )
        throw denied();
      return input.mutate(db, preview, actor);
    });
  }
  async function withPreviewAuthority<T>(input: {
    siteId: string;
    previewId: string;
    mutate: (db: Db, preview: PreviewRow) => Promise<T>;
  }): Promise<T> {
    return withPreviewRequester({ ...input, mutate: (db, preview) => input.mutate(db, preview) });
  }
  async function renderPreview<T>(input: {
    db?: Db;
    siteId: string;
    previewId: string;
    viewer?: { userId: string; sessionId: string };
    route: NpAgentPreviewRouteCanonicalV1;
    render: (context: NpAgentChangeSetPreviewContextV1) => Promise<T>;
  }): Promise<T> {
    const render = async (preview: PreviewRow, actor: Actor) => {
      if (
        !preview.allowedRoutes.some(
          (r) => serializeAgentCanonicalJson(r) === serializeAgentCanonicalJson(input.route),
        )
      )
        throw missing();
      return getDb().transaction(
        async (tx) => {
          const [parent] = await tx
            .select()
            .from(npAgentChangesets)
            .where(
              and(
                eq(npAgentChangesets.siteId, input.siteId),
                eq(npAgentChangesets.id, preview.changesetId),
              ),
            )
            .limit(1);
          if (
            !parent ||
            !["ready", "approval_pending", "approved"].includes(parent.state) ||
            parent.planHash !== preview.planHash ||
            parent.expiresAt <= now()
          )
            throw missing();
          const plan = npRequireAgentChangeSetPlanCanonical(parent.sealedPlanBody);
          if (
            plan.planKind !== "changeset" ||
            (await npDigestAgentChangeSetPlanCanonical(plan)) !== preview.planHash
          )
            throw missing();
          if (!options.preview) throw missing();
          const routes = await options.preview.resolveRoutes({
            tx: tx as unknown as NpTransaction,
            siteId: input.siteId,
            user: actor.user,
            plan,
          });
          if (
            !routes.some(
              (r) => serializeAgentCanonicalJson(r) === serializeAgentCanonicalJson(input.route),
            )
          )
            throw missing();
          const ops = await operations(tx, parent);
          const snapshots = [];
          const reserved = ops.flatMap((op) =>
            op.input.kind === "document" &&
            op.input.operation === "create" &&
            op.resourceKey.kind === "document"
              ? [op.resourceKey.documentId]
              : [],
          );
          for (const op of ops) {
            const current = await validationResources.readBase({
              tx: tx as unknown as NpTransaction,
              siteId: input.siteId,
              user: actor.user,
              changeSetId: parent.id,
              ordinal: op.ordinal,
              operation: op.input,
              canonicalResourceKey: op.resourceKey,
              reservedCreateDocumentIds: reserved,
            });
            const sealed = plan.body.operations.find((item) => item.ordinal === op.ordinal);
            if (
              !sealed ||
              current.snapshotHash !== sealed.snapshotHash ||
              (op.input.kind === "document" && op.input.operation === "create"
                ? sealed.beforeHash !== null
                : current.beforeHash !== sealed.beforeHash)
            )
              throw missing();
            snapshots.push(current.snapshot);
          }
          const context: NpAgentChangeSetPreviewContextV1 = {
            siteId: input.siteId,
            changeSetId: parent.id,
            previewId: preview.id,
            generation: preview.generation,
            planHash: preview.planHash,
            previewContractFingerprint: preview.previewContractFingerprint,
            route: input.route,
            createdAt: preview.createdAt.toISOString(),
            expiresAt: new Date(
              Math.min(
                (preview.expiresAt ?? parent.expiresAt).getTime(),
                parent.expiresAt.getTime(),
                now().getTime() + npAgentChangeSetLimits.renderLifetimeSeconds * 1000,
              ),
            ).toISOString(),
            plan,
            snapshots,
            tx: tx as unknown as NpTransaction,
            now: now(),
          };
          return withAgentChangeSetPreview(context, async () => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                input.render(context),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(
                    () => reject(missing()),
                    Math.max(1, new Date(context.expiresAt).getTime() - now().getTime()),
                  );
                }),
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    };
    const admit = async (): Promise<{ preview: PreviewRow; actor: Actor }> => {
      if (input.viewer)
        return withPreviewViewer({
          siteId: input.siteId,
          userId: input.viewer.userId,
          sessionId: input.viewer.sessionId,
          previewId: input.previewId,
          requireReady: true,
          mutate: async (db, preview, authority) => {
            const [user] = await db
              .select(staffUserProjection)
              .from(npUsers)
              .where(eq(npUsers.id, input.viewer!.userId))
              .limit(1);
            if (!user) throw missing();
            return {
              preview,
              actor: {
                siteId: input.siteId,
                user: {
                  ...user,
                  role:
                    authority.authority.kind === "super-admin"
                      ? "admin"
                      : (authority.authority.role as NpAuthUser["role"]),
                },
                fingerprint: hash("np.agent-staff-actor.v1", {
                  siteId: input.siteId,
                  userId: user.id,
                }),
                authorization: serializeAgentCanonicalJson(authority),
                principalId: null,
                scopes: null,
              },
            };
          },
        });
      return withPreviewRequester({
        siteId: input.siteId,
        previewId: input.previewId,
        mutate: (_db, preview, actor) => Promise.resolve({ preview, actor }),
      });
    };
    const admitted = await admit();
    const result = await render(admitted.preview, admitted.actor);
    const current = await admit();
    if (
      current.actor.authorization !== admitted.actor.authorization ||
      current.preview.state !== admitted.preview.state ||
      current.preview.generation !== admitted.preview.generation ||
      current.preview.planHash !== admitted.preview.planHash ||
      current.preview.digest !== admitted.preview.digest ||
      current.preview.previewContractFingerprint !== admitted.preview.previewContractFingerprint
    )
      throw missing();
    return result;
  }

  async function withPreviewViewer<T>(input: {
    db?: Db;
    siteId: string;
    userId: string;
    sessionId: string;
    previewId: string;
    changeSetId?: string;
    requireReady: boolean;
    mutate: (
      db: Db,
      preview: PreviewRow,
      authority: NpAgentStaffSiteAuthorizationCanonicalV1,
    ) => Promise<T>;
  }): Promise<T> {
    const run = async (db: Db) => {
      const [user] = await db
        .select(staffUserProjection)
        .from(npUsers)
        .where(eq(npUsers.id, input.userId))
        .for("update")
        .limit(1);
      if (!user) throw missing();
      await db
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(eq(npSessions.id, input.sessionId))
        .for("update");
      await db
        .select({ id: npSiteMemberships.userId })
        .from(npSiteMemberships)
        .where(
          and(
            eq(npSiteMemberships.siteId, input.siteId),
            eq(npSiteMemberships.userId, input.userId),
          ),
        )
        .for("update");
      const authority = await npResolveAgentStaffSessionAuthorizationV1(
        db,
        input.siteId,
        { user, sessionId: input.sessionId },
        now(),
      );
      if (!authority.authority.capabilities.includes("content.author")) throw missing();
      const actor: Actor = {
        siteId: input.siteId,
        user: {
          ...user,
          role:
            authority.authority.kind === "super-admin"
              ? "admin"
              : (authority.authority.role as NpAuthUser["role"]),
        },
        fingerprint: hash("np.agent-staff-actor.v1", { siteId: input.siteId, userId: user.id }),
        authorization: serializeAgentCanonicalJson(authority),
        principalId: null,
        scopes: null,
      };
      const { preview } = await protectedPreview(db, actor, input.previewId, input.requireReady);
      if (input.changeSetId !== undefined && preview.changesetId !== input.changeSetId)
        throw missing();
      const result = await input.mutate(db, preview, authority);
      if (
        serializeAgentCanonicalJson(
          await npResolveAgentStaffSessionAuthorizationV1(
            db,
            input.siteId,
            { user, sessionId: input.sessionId },
            now(),
          ),
        ) !== serializeAgentCanonicalJson(authority)
      )
        throw missing();
      return result;
    };
    return input.db ? run(input.db) : getDb().transaction(run, { isolationLevel: "serializable" });
  }
  async function getPreviewInternal(
    input: {
      actor: NpAgentChangeSetActorV1;
      previewId: string;
      changeSetId?: string;
    },
    verifyArtifacts = true,
  ): Promise<NpAgentPreviewDetailWireV1> {
    const actor = await resolve(input.actor, false);
    // Read projections perform provider I/O only outside row-locking transactions.
    const { preview } = await protectedPreview(getDb(), actor, input.previewId, false, false);
    if (input.changeSetId !== undefined && preview.changesetId !== input.changeSetId)
      throw missing();
    const result = await previewProjection(getDb(), preview, actor, verifyArtifacts);
    await same(input.actor, actor);
    const current = await protectedPreview(getDb(), actor, input.previewId, false, false);
    if (
      (result.state === "ready" && (!preview.expiresAt || preview.expiresAt <= now())) ||
      current.preview.state !== preview.state ||
      current.preview.digest !== preview.digest ||
      current.preview.planHash !== preview.planHash ||
      current.preview.previewContractFingerprint !== preview.previewContractFingerprint ||
      current.preview.generation !== preview.generation ||
      current.preview.expiresAt?.getTime() !== preview.expiresAt?.getTime()
    )
      throw missing();
    return result;
  }

  async function getPreview(input: {
    actor: NpAgentChangeSetActorV1;
    previewId: string;
    changeSetId?: string;
  }): Promise<NpAgentPreviewDetailWireV1> {
    return getPreviewInternal(input);
  }
  async function admitPreview(
    db: Db,
    actor: Actor,
    id: string,
    request: NpAgentChangeSetPreviewRequestV1,
    invocationId: string,
  ) {
    if (!options.preview) throw missing();
    const [parent] = await db
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
      .for("update")
      .limit(1);
    if (
      !parent ||
      parent.state !== "ready" ||
      parent.expiresAt.getTime() - now().getTime() < 60000 ||
      parent.draftVersion !== request.expectedVersion ||
      parent.planHash !== request.expectedPlanHash
    )
      throw conflict();
    await project(parent, actor, false, db, false);
    const plan = npRequireAgentChangeSetPlanCanonical(parent.sealedPlanBody);
    if (plan.planKind !== "changeset") throw missing();
    const contract = npRequireAgentPreviewContractCanonical(options.preview.contract);
    const fingerprint = await npDigestAgentPreviewContractCanonical(contract);
    const [invocation] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, actor.siteId), eq(npAgentInvocations.id, invocationId)),
      )
      .limit(1);
    if (!invocation) throw missing();
    const [latest] = await db
      .select({ generation: npAgentChangesetPreviews.generation })
      .from(npAgentChangesetPreviews)
      .where(
        and(
          eq(npAgentChangesetPreviews.siteId, actor.siteId),
          eq(npAgentChangesetPreviews.changesetId, id),
        ),
      )
      .orderBy(desc(npAgentChangesetPreviews.generation))
      .limit(1);
    const previewId = randomUUID(),
      generation = (latest?.generation ?? 0) + 1;
    const routes = npRequireAgentPreviewRoutesCanonical({
      schemaVersion: "np.agent-preview-routes.v1",
      siteId: actor.siteId,
      changeSetId: id,
      previewId,
      generation,
      planHash: parent.planHash,
      routes: await options.preview.resolveRoutes({
        tx: db as unknown as NpTransaction,
        siteId: actor.siteId,
        user: actor.user,
        plan,
      }),
    });
    if (routes.routes.length > 256) throw conflict();
    const context = npRequireAgentAuthorizationContextCanonical(
      invocation.authorizationContextBody,
    );
    await db.insert(npAgentChangesetPreviews).values({
      id: previewId,
      siteId: actor.siteId,
      changesetId: id,
      planHash: request.expectedPlanHash,
      generation,
      previewContractBody: contract,
      previewContractFingerprint: fingerprint,
      admittingInvocationId: invocationId,
      authorizationContextBody: context,
      authorizationContextFingerprint: invocation.authorizationContextFingerprint,
      authorityRef: context.authorityRef,
      requesterKind: context.actor.kind,
      requesterId:
        context.actor.kind === "staff" ? context.actor.userId : context.actor.principalId,
      requesterFingerprint: context.actor.actorFingerprint,
      allowedRoutes: routes.routes,
      allowedRoutesDigest: await npDigestAgentPreviewRoutesCanonical(routes),
      diffSummary: { operationCount: plan.body.operations.length },
      checkSummary: {
        checksRun: 0,
        screenshots: 0,
        warningCodes: ["SCREENSHOTS_UNAVAILABLE", "CHECKS_NOT_RUN"],
      },
      riskSummary: plan.body.risk,
      createdAt: now(),
    });
    return { changeSetId: id, previewId };
  }
  async function preview(input: {
    actor: NpAgentChangeSetActorV1;
    id: string;
    command: unknown;
  }): Promise<NpAgentPreviewDetailWireV1> {
    if (!uuid.test(input.id) || !options.preview) throw missing();
    const command = npRequireAgentChangeSetPreviewRequestV1(input.command),
      actor = await resolve(input.actor, false);
    let output: { changeSetId: string; previewId?: string };
    if (input.actor.kind === "staff") {
      const staff = input.actor.actor;
      const admitted = await admin({
        siteId: actor.siteId,
        actor: input.actor.actor,
        operationId: "agents.changesets.preview",
        targetId: input.id,
        command,
        mutate: async ({ db, invocationId }) => {
          const result = await admitPreview(db, actor, input.id, command, invocationId);
          const current = await npResolveAgentStaffSessionAuthorizationV1(
            db,
            actor.siteId,
            staff,
            now(),
          );
          if (serializeAgentCanonicalJson(current) !== actor.authorization) throw denied();
          return { resourceId: input.id, output: result };
        },
      });
      output = { changeSetId: admitted.resourceId, previewId: admitted.output.previewId };
    } else
      output = await invokePrincipal(
        input.actor,
        actor,
        command,
        "preview",
        (db, _time, invocationId) => admitPreview(db, actor, input.id, command, invocationId),
        input.id,
      );
    if (!output.previewId) throw conflict();
    if (options.preview.enqueue)
      try {
        await options.preview.enqueue({ siteId: actor.siteId, previewId: output.previewId });
      } catch {
        /* The queued generation remains recoverable by the explicit host. */
      }
    return getPreview({ actor: input.actor, previewId: output.previewId, changeSetId: input.id });
  }
  /** Host-invoked, bounded pre-execution expiry maintenance. No worker is registered. */
  async function reconcileExpired(input: { siteId: string; limit?: number }) {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("ChangeSet reconciliation limit must be 1..100.");
    return getDb().transaction(async (db) => {
      const time = now();
      const rows = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, input.siteId),
            inArray(npAgentChangesets.state, ["draft", "invalid", "ready"]),
            lte(npAgentChangesets.expiresAt, time),
          ),
        )
        .orderBy(asc(npAgentChangesets.expiresAt), asc(npAgentChangesets.id))
        .limit(limit)
        .for("update", { skipLocked: true });
      let cancelled = 0;
      for (const row of rows) {
        // Active/consumed authority stays fenced. Terminal approval history does not block eligibility expiry.
        const [approval] = await db
          .select({ id: npAgentApprovals.id })
          .from(npAgentApprovals)
          .where(
            and(
              eq(npAgentApprovals.siteId, row.siteId),
              eq(npAgentApprovals.targetId, row.id),
              inArray(npAgentApprovals.state, ["pending", "approved", "consumed"]),
            ),
          )
          .limit(1);
        if (approval) continue;
        await db
          .update(npAgentChangesets)
          .set({ state: "cancelled", cancellationCode: "CHANGESET_EXPIRED", updatedAt: time })
          .where(
            and(
              eq(npAgentChangesets.id, row.id),
              eq(npAgentChangesets.draftVersion, row.draftVersion),
            ),
          );
        await db.insert(npAuditEvents).values({
          siteId: row.siteId,
          actorKind: "system",
          action: "agents.changesets.expire",
          targetType: "agent-changeset",
          targetId: row.id,
          payload: { code: "CHANGESET_EXPIRED", draftVersion: row.draftVersion },
          createdAt: time,
        });
        cancelled++;
      }
      return { examined: rows.length, cancelled };
    });
  }
  async function invokeCapability(input: {
    authentication: NpAgentCapabilityAuthenticationV1;
    request: NpAgentChangeSetCapabilityInvocationRequestV1;
  }) {
    const request = npRequireAgentInstalledCapabilityInvocationRequestV1(input.request);
    if (!request.capabilityId.startsWith("changeset.") || !options.admission) throw missing();
    const projected = await options.admission.project({ authentication: input.authentication });
    if (!projected.entries.some((entry) => entry.definition.descriptor.id === request.capabilityId))
      throw missing();
    const actorInput: NpAgentChangeSetActorV1 = {
      kind: "principal",
      authentication: input.authentication,
    };
    return gatewayRequestContext.run(
      request as NpAgentChangeSetCapabilityInvocationRequestV1,
      async () => {
        let output: NpAgentChangeSetCapabilityOutputMapV1[NpAgentChangeSetCapabilityIdV1];
        switch (request.capabilityId) {
          case "changeset.create": {
            const draft = request.arguments.input;
            const changeSet = await write({
              actor: actorInput,
              command: {
                idempotencyKey: request.arguments.idempotencyKey,
                proposalJson: npBuildAgentChangeSetDraftInputJsonV1(draft),
                proposalHash: await npDigestAgentChangeSetDraftInputV1(draft),
              },
            });
            output = { schemaVersion: "np.agent-changeset-result.v1", changeSet };
            break;
          }
          case "changeset.validate": {
            const args = request.arguments.input;
            const changeSet = await validate({
              actor: actorInput,
              id: args.changeSetId,
              expectedDraftHash: args.draftHash,
              command: {
                idempotencyKey: request.arguments.idempotencyKey,
                expectedVersion: args.draftVersion,
              },
            });
            output = { schemaVersion: "np.agent-changeset-result.v1", changeSet };
            break;
          }
          case "changeset.preview": {
            const args = request.arguments.input;
            const current = await get({ actor: actorInput, id: args.changeSetId });
            await preview({
              actor: actorInput,
              id: args.changeSetId,
              command: {
                idempotencyKey: request.arguments.idempotencyKey,
                expectedVersion: current.draftVersion,
                expectedPlanHash: args.planHash,
              },
            });
            output = {
              schemaVersion: "np.agent-changeset-result.v1",
              changeSet: await get({ actor: actorInput, id: args.changeSetId }),
            };
            break;
          }
          case "changeset.get":
            output = {
              schemaVersion: "np.agent-changeset-result.v1",
              changeSet: await get({ actor: actorInput, id: request.arguments.input.changeSetId }),
            };
            break;
          case "changeset.list": {
            const args = request.arguments.input;
            const page = await list({
              actor: actorInput,
              ...args,
              cursor: args.cursor ?? undefined,
            });
            output = {
              schemaVersion: "np.agent-changeset-list.v1",
              items: page.items,
              nextCursor: page.nextCursor,
            };
            break;
          }
          default:
            throw missing();
        }
        npRequireAgentInstalledCapabilityOutputV1(request.capabilityId, output);
        const actor = await resolve(actorInput, request.capabilityId === "changeset.create");
        const authFingerprint = await npDigestAgentAuthorizationContextCanonical(
          input.authentication.authorizationContext,
        );
        if (request.arguments.idempotencyKey !== null) {
          const [invocation] = await getDb()
            .select({ id: npAgentInvocations.id })
            .from(npAgentInvocations)
            .where(
              and(
                eq(npAgentInvocations.siteId, actor.siteId),
                eq(npAgentInvocations.actorFingerprint, actor.fingerprint),
                eq(npAgentInvocations.authorizationContextFingerprint, authFingerprint),
                eq(npAgentInvocations.operationKind, "capability"),
                eq(npAgentInvocations.operationId, request.capabilityId),
                eq(npAgentInvocations.idempotencyKey, request.arguments.idempotencyKey),
                eq(npAgentInvocations.state, "completed"),
              ),
            )
            .limit(1);
          if (!invocation) throw missing();
          await same(actorInput, actor, request.capabilityId === "changeset.create");
          return { invocationId: invocation.id, output };
        }
        if (!options.admission) throw missing();
        const definitionBody = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(
          request.capabilityId,
        );
        const fingerprint = await npDigestAgentCapabilityRegistryCanonical(
          definitionBody,
          definitionBody.capabilities,
        );
        const body = npRequireAgentInvocationRequestCanonical({
          schemaVersion: "np.agent-idempotency-request.v1",
          siteId: actor.siteId,
          actorKind: "principal",
          actorFingerprint: actor.fingerprint,
          authorizationContextFingerprint: authFingerprint,
          operationKind: "capability",
          operationId: request.capabilityId,
          contractVersion: 1,
          contractFingerprint: fingerprint,
          effectProfile: { id: "domain.read", contractVersion: 1 },
          input: request.arguments.input,
        });
        const requestHash = await npDigestAgentInvocationRequestCanonical(body);
        const invocationId = await options.admission.withCurrentAuthority({
          authentication: input.authentication,
          requiredScopes: ["changeset:read"],
          minimumExposure: "read",
          mutate: async (db, time) => {
            const id = randomUUID();
            const [audit] = await db
              .insert(npAuditEvents)
              .values({
                siteId: actor.siteId,
                actorKind: "agent-principal",
                action: request.capabilityId,
                targetType: "agent-changeset",
                targetId: "changeSet" in output ? output.changeSet.id : null,
                payload: { operationId: request.capabilityId, outcome: "completed" },
                createdAt: time,
              })
              .returning({ id: npAuditEvents.id });
            if (!audit) throw missing();
            await db.insert(npAgentInvocations).values({
              id,
              siteId: actor.siteId,
              actorKind: "principal",
              principalId: actor.principalId,
              actorFingerprint: actor.fingerprint,
              authorizationContextBody: input.authentication.authorizationContext,
              authorizationContextFingerprint: authFingerprint,
              authorityRef: input.authentication.authorizationContext.authorityRef,
              operationKind: "capability",
              operationId: request.capabilityId,
              contractVersion: 1,
              contractFingerprint: fingerprint,
              capabilityDefinitionBody: definitionBody,
              effectProfileId: "domain.read",
              effectContractVersion: 1,
              transport: input.authentication.authorizationContext.transport,
              mcpExecutionMode: ["mcp-service", "mcp-oauth"].includes(
                input.authentication.authorizationContext.transport,
              )
                ? "normal"
                : null,
              idempotencyKey: null,
              requestBody: body,
              requestHash,
              state: "completed",
              auditEventId: audit.id,
              requestedAt: time,
              completedAt: time,
              expiresAt: new Date(time.getTime() + 86400_000),
              outputRedacted: { itemCount: "items" in output ? output.items.length : 1 },
              outputHash: hash("np.agent-changeset-result.v1", {
                itemCount: "items" in output ? output.items.length : 1,
              }),
            });
            return id;
          },
        });
        return { invocationId, output };
      },
    );
  }
  function assertApprovalReport(bytes: Uint8Array, siteId: string) {
    const report = npRequireAgentPreviewReportV1(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (
      report.siteId !== siteId ||
      report.results.some((result) => result.status === "fail") ||
      report.issues.some((issue) => issue.severity === "error")
    )
      throw new NpAgentGatewayError("PREVIEW_REQUIRED", 409, "Preview checks require attention.");
  }
  const approvalLifetime =
    options.approvals?.lifetimeSeconds ?? npAgentChangeSetLimits.approvalDefaultSeconds;
  if (
    !Number.isSafeInteger(approvalLifetime) ||
    approvalLifetime < 60 ||
    approvalLifetime > npAgentChangeSetLimits.approvalMaximumSeconds
  )
    throw new Error("Invalid approval lifetime.");
  async function latestApprovalSummary(db: Db, row: Row) {
    if (!approvals) return null;
    const [approval] = await db
      .select()
      .from(npAgentApprovals)
      .where(
        and(
          eq(npAgentApprovals.siteId, row.siteId),
          eq(npAgentApprovals.targetChangesetId, row.id),
        ),
      )
      .orderBy(desc(npAgentApprovals.generation))
      .limit(1);
    if (!approval) return null;
    return approvals.summary(approval);
  }
  async function approvalSeed(siteId: string, id: string) {
    const [row] = await getDb()
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, siteId), eq(npAgentChangesets.id, id)))
      .limit(1);
    if (!row) throw missing();
    const [attempt] = await getDb()
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, siteId),
          eq(npAgentChangesetValidationAttempts.changesetId, id),
          eq(npAgentChangesetValidationAttempts.generation, row.validationGeneration),
        ),
      )
      .limit(1);
    if (!attempt || attempt.state !== "ready") throw missing();
    return attempt;
  }
  async function lockApprovalTarget(db: Db, siteId: string, target: NpAgentApprovalTargetV1) {
    if (target.kind !== "changeset") throw missing();
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${siteId}`},0))`,
    );
    const [row] = await db
      .select()
      .from(npAgentChangesets)
      .where(
        and(eq(npAgentChangesets.siteId, siteId), eq(npAgentChangesets.id, target.changeSetId)),
      )
      .for("update")
      .limit(1);
    if (
      !row ||
      row.planHash !== target.planHash ||
      !["ready", "approval_pending", "approved", "rejected", "scheduled"].includes(row.state)
    )
      throw missing();
    return row;
  }
  async function approvalFacts(
    db: Db,
    row: Row,
    actor: Actor,
    intendedOperation: "apply" | "schedule",
    scheduledFor: string | null,
    verifiedPreview: NpAgentChangeSetWire["preview"],
    minimumPreviewSeconds: number,
    executing = false,
  ) {
    if (!options.approvals || !row.sealedPlanBody || row.expiresAt <= now()) throw conflict();
    await project(row, actor, false, db, false);
    const plan = npRequireAgentChangeSetPlanCanonical(row.sealedPlanBody);
    if (plan.planKind !== "changeset") throw missing();
    const ops = await operations(db, row);
    let checked: Awaited<ReturnType<typeof validationResources.validate>>;
    try {
      checked = await validationResources.validate({
        tx: db as unknown as NpTransaction,
        siteId: row.siteId,
        user: actor.user,
        changeSetId: row.id,
        operations: ops.map((op) => ({
          ordinal: op.ordinal,
          operation: op.input,
          canonicalResourceKey: op.resourceKey,
        })),
        now: now(),
      });
    } catch (error) {
      if (error instanceof NpAgentChangeSetValidationResourceErrorV1) {
        if (error.issues.some((issue) => issue.code === "ACCESS_DENIED")) throw denied();
        throw conflict();
      }
      throw error;
    }
    requireScopes(actor, checked.requiredScopes);
    const scopes = [
      ...new Set<NpAgentScope>(["changeset:apply", ...checked.requiredApplyScopes]),
    ].sort();
    if (
      checked.baseFingerprint !== plan.body.baseFingerprint ||
      !sameJson(checked.operations, plan.body.operations) ||
      !sameJson(checked.risk, plan.body.risk) ||
      !sameJson(scopes, plan.body.requiredScopes) ||
      !sameJson(checked.policyHashes, plan.body.policyHashes)
    )
      throw conflict();
    const binding = npRequireAgentCapabilityRegistryCanonical(
      await options.approvals.resolveExecutionBinding({ siteId: row.siteId, intendedOperation }),
    );
    if (binding.projection !== "definition" || binding.capabilities.length !== 1) throw missing();
    const capability = binding.capabilities[0];
    if (
      capability.descriptor.id !== `changeset.${intendedOperation}` ||
      capability.descriptor.source !== "core" ||
      capability.descriptor.approval !== "human" ||
      capability.descriptor.risk === "read" ||
      capability.descriptor.effectProfiles.length === 0 ||
      capability.descriptor.effectProfiles.some(
        (profile) =>
          profile.kind !== "mutation" || profile.minimumGatewayExposure !== "approved-execute",
      )
    )
      throw missing();
    const policy = await options.approvals.policy?.({ siteId: row.siteId, plan });
    const requiredScopes = [
      ...new Set<NpAgentScope>([...scopes, ...capability.descriptor.requiredScopes]),
    ].sort();
    const requiredHumanCapabilities = [
      ...new Set([
        ...plan.body.requiredHumanCapabilities,
        ...requiredScopes.map((scope) => npAgentScopeStaffCapability[scope]),
      ]),
    ].sort();
    // Requester must retain the complete execute authority; proposing scope never grants approval or execution.
    requireScopes(actor, requiredScopes);
    const destructive =
      !plan.body.risk.reversible ||
      plan.body.risk.level === "critical" ||
      capability.descriptor.risk === "destructive";
    const sensitive = plan.body.risk.level !== "low" || capability.descriptor.risk === "sensitive";
    const risk = destructive ? "destructive" : sensitive ? "sensitive" : "reversible";
    const age = policy?.reauthenticationMaxAgeSeconds ?? (risk === "reversible" ? null : 300);
    if (
      (age !== null && (!Number.isSafeInteger(age) || age < 1 || age > 300)) ||
      (risk !== "reversible" && age === null)
    )
      throw missing();
    const requiresLivePreview =
      Boolean(policy?.requiresLivePreview) ||
      risk !== "reversible" ||
      ops.some(
        (op) => op.input.kind === "document" && ["publish", "archive"].includes(op.input.operation),
      );
    let previewId: string | null = null,
      previewDigest: string | null = null;
    if (requiresLivePreview) {
      if (
        !verifiedPreview ||
        verifiedPreview.state !== "ready" ||
        !verifiedPreview.digest ||
        !verifiedPreview.expiresAt ||
        Date.parse(verifiedPreview.expiresAt) < now().getTime() + minimumPreviewSeconds * 1000
      )
        throw new NpAgentGatewayError(
          "PREVIEW_REQUIRED",
          409,
          "A current verified preview is required.",
        );
      const [preview] = await db
        .select()
        .from(npAgentChangesetPreviews)
        .where(
          and(
            eq(npAgentChangesetPreviews.siteId, row.siteId),
            eq(npAgentChangesetPreviews.id, verifiedPreview.previewId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !preview ||
        preview.changesetId !== row.id ||
        preview.planHash !== row.planHash ||
        preview.state !== "ready" ||
        preview.digest !== verifiedPreview.digest ||
        preview.generation !== verifiedPreview.generation ||
        !preview.expiresAt ||
        preview.expiresAt.toISOString() !== verifiedPreview.expiresAt
      )
        throw conflict();
      previewId = preview.id;
      previewDigest = preview.digest;
    }
    if (
      intendedOperation === "schedule" &&
      (!scheduledFor ||
        (!executing && Date.parse(scheduledFor) <= now().getTime()) ||
        Date.parse(scheduledFor) >= row.expiresAt.getTime())
    )
      throw conflict();
    return {
      target: {
        kind: "changeset" as const,
        changeSetId: row.id,
        planHash: row.planHash!,
        scheduledFor,
      },
      requester: actor.principalId
        ? {
            kind: "principal" as const,
            principalId: actor.principalId,
            fingerprint: actor.fingerprint,
          }
        : { kind: "staff" as const, userId: actor.user.id, fingerprint: actor.fingerprint },
      capabilityId: capability.descriptor.id,
      capabilityContractVersion: capability.descriptor.contractVersion,
      capabilityFingerprint: await npDigestAgentCapabilityRegistryCanonical(
        binding,
        binding.capabilities,
      ),
      requiredScopes,
      requiredHumanCapabilities,
      requiredHumanPredicates: plan.body.requiredHumanPredicates,
      policyHashes: [
        ...new Set([...plan.body.policyHashes, ...(policy?.policyHashes ?? [])]),
      ].sort(),
      requiresLivePreview,
      previewId,
      previewDigest,
      risk,
      reauthentication:
        age === null
          ? { mode: "none" as const }
          : { mode: "recent" as const, maxAgeSeconds: age, assurance: "staff-primary" as const },
    };
  }
  const sameJson = (left: unknown, right: unknown) =>
    serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
  function targetAccess(
    db: Db,
    row: Row,
    actor: Actor,
    preview: NpAgentChangeSetWire["preview"],
  ): NpAgentApprovalTargetAccessV1 {
    return {
      verify: async (statement, decision) => {
        await project(row, actor, false, db, false);
        if (decision !== "approve") return;
        const facts = await approvalFacts(
          db,
          row,
          actor,
          statement.capabilityId === "changeset.schedule" ? "schedule" : "apply",
          statement.target.kind === "changeset" ? statement.target.scheduledFor : null,
          preview,
          0,
        );
        const {
          version: _v,
          siteId: _s,
          approvalId: _id,
          createdAt: _c,
          expiresAt: _e,
          ...signed
        } = statement;
        if (!sameJson(facts, signed)) throw conflict();
      },
      transition: async (state) => {
        if (row.state === "scheduled" && state === "ready") {
          const [decision] = await db
            .select()
            .from(npAgentApprovals)
            .where(
              and(
                eq(npAgentApprovals.siteId, row.siteId),
                eq(npAgentApprovals.targetChangesetId, row.id),
              ),
            )
            .orderBy(desc(npAgentApprovals.generation))
            .limit(1);
          await failReservedExecution(
            db,
            row,
            decision?.state === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_REVOKED",
          );
          return;
        }
        if (!["approval_pending", "approved"].includes(row.state)) throw conflict();
        await db
          .update(npAgentChangesets)
          .set({ state, updatedAt: now() })
          .where(and(eq(npAgentChangesets.siteId, row.siteId), eq(npAgentChangesets.id, row.id)));
        row.state = state;
      },
    };
  }
  async function approvalViewer(db: Db, siteId: string, actor: NpAgentAdminActorV1, row: Row) {
    const authority = await npResolveAgentStaffSessionAuthorizationV1(db, siteId, actor, now());
    const viewer: Actor = {
      siteId,
      user: {
        ...actor.user,
        role:
          authority.authority.kind === "super-admin"
            ? "admin"
            : (authority.authority.role as NpAuthUser["role"]),
      },
      fingerprint: hash("np.agent-staff-actor.v1", { siteId, userId: actor.user.id }),
      authorization: serializeAgentCanonicalJson(authority),
      principalId: null,
      scopes: null,
    };
    await project(row, viewer, false, db, false);
    return viewer;
  }
  const approvals = options.approvals
    ? createAgentApprovalServiceV1({
        ...options,
        ...options.approvals,
        targets: {
          visible: async (input) => {
            if (input.target.kind !== "changeset") throw missing();
            const target = input.target;
            return getDb().transaction(
              async (tx) => {
                const db = tx as unknown as Db;
                const [row] = await db
                  .select()
                  .from(npAgentChangesets)
                  .where(
                    and(
                      eq(npAgentChangesets.siteId, input.siteId),
                      eq(npAgentChangesets.id, target.changeSetId),
                    ),
                  )
                  .limit(1);
                if (!row || row.planHash !== target.planHash) throw missing();
                const viewer = await approvalViewer(db, input.siteId, input.actor, row);
                const ops = await operations(db, row);
                const [preview] = options.preview
                  ? await db
                      .select()
                      .from(npAgentChangesetPreviews)
                      .where(
                        and(
                          eq(npAgentChangesetPreviews.siteId, row.siteId),
                          eq(npAgentChangesetPreviews.changesetId, row.id),
                          eq(npAgentChangesetPreviews.planHash, row.planHash),
                        ),
                      )
                      .orderBy(desc(npAgentChangesetPreviews.generation))
                      .limit(1)
                  : [];
                const detail = preview ? await previewProjection(db, preview, viewer, false) : null;
                return {
                  operationCount: ops.length,
                  targetCount: new Set(ops.map((op) => serializeAgentCanonicalJson(op.resourceKey)))
                    .size,
                  previewState: detail?.state ?? null,
                  checksRun:
                    typeof detail?.checkSummary.checksRun === "number"
                      ? detail.checkSummary.checksRun
                      : null,
                  rollbackPlan: "unavailable" as const,
                };
              },
              { isolationLevel: "repeatable read", accessMode: "read only" },
            );
          },
          revalidate: async (input) => {
            if (input.statement.target.kind !== "changeset") throw missing();
            const target = input.statement.target;
            if (options.execution && approvals) {
              const [approved] = await getDb()
                .select()
                .from(npAgentApprovals)
                .where(
                  and(
                    eq(npAgentApprovals.siteId, input.siteId),
                    eq(npAgentApprovals.id, input.statement.approvalId),
                  ),
                )
                .limit(1);
              if (approved?.state === "approved") {
                const { statement } = await approvals.verify(approved);
                if (!sameJson(statement, input.statement)) throw conflict();
                const preview = await executionPreview(approved);
                await withExecutionAuthority(approved, async (db, actor) => {
                  const row = await lockApprovalTarget(db, input.siteId, target);
                  const [current] = await db
                    .select()
                    .from(npAgentApprovals)
                    .where(
                      and(
                        eq(npAgentApprovals.siteId, input.siteId),
                        eq(npAgentApprovals.id, approved.id),
                      ),
                    )
                    .for("update")
                    .limit(1);
                  if (!current || current.statementHash !== approved.statementHash)
                    throw conflict();
                  await checkExecutionApproval(db, row, current, actor, preview, true);
                });
                return;
              }
            }
            const seed = await approvalSeed(input.siteId, target.changeSetId);
            let verifiedPreview: NpAgentChangeSetWire["preview"] = null;
            if (input.statement.requiresLivePreview && input.statement.previewId) {
              try {
                const detail = await withPreviewRequester({
                  siteId: input.siteId,
                  previewId: input.statement.previewId,
                  mutate: (db, preview, actor) => previewProjection(db, preview, actor, false),
                });
                if (detail.state !== "ready") throw missing();
                for (const artifact of detail.artifactRefs) {
                  const content = await previewArtifacts.readArtifact({
                    siteId: input.siteId,
                    previewId: detail.previewId,
                    artifactId: artifact.artifactId,
                    authorize: () =>
                      withPreviewAuthority({
                        siteId: input.siteId,
                        previewId: detail.previewId,
                        mutate: () => Promise.resolve(undefined),
                      }),
                  });
                  try {
                    if (artifact.kind === "report")
                      assertApprovalReport(content.bytes, input.siteId);
                  } finally {
                    content.bytes.fill(0);
                  }
                }
                verifiedPreview = npRequireAgentPreviewSummaryV1(
                  {
                    schemaVersion: "np.agent-preview-summary.v1",
                    previewId: detail.previewId,
                    state: detail.state,
                    generation: detail.generation,
                    planHash: detail.planHash,
                    previewContractFingerprint: detail.previewContractFingerprint,
                    digest: detail.digest,
                    artifactCount: detail.artifactCount,
                    artifactRefs: detail.artifactRefs,
                    interactiveLaunch: null,
                    expiresAt: detail.expiresAt,
                  },
                  { siteId: input.siteId, changeSetId: target.changeSetId },
                );
              } catch (error) {
                if (
                  error instanceof NpAgentGatewayError &&
                  [
                    "AUTHORIZATION_CHANGED",
                    "STAFF_AUTHORIZATION_REQUIRED",
                    "SITE_ACCESS_DENIED",
                    "CHANGESET_ACCESS_DENIED",
                    "CAPABILITY_UNAVAILABLE",
                    "TRANSPORT_UNAVAILABLE",
                  ].includes(error.code)
                )
                  throw error;
                throw new NpAgentGatewayError(
                  "PREVIEW_REQUIRED",
                  409,
                  "A current verified preview is required.",
                );
              }
            }
            await withStoredActor(seed, async (db, actor) => {
              const row = await lockApprovalTarget(db, input.siteId, target);
              await targetAccess(db, row, actor, verifiedPreview).verify(
                input.statement,
                "approve",
              );
            });
          },
          review: async (input) => {
            if (input.target.kind !== "changeset") throw missing();
            return getReview({
              actor: { kind: "staff", siteId: input.siteId, actor: input.actor },
              id: input.target.changeSetId,
            });
          },
          withAuthority: async (input) => {
            if (input.target.kind !== "changeset") throw missing();
            const staffInput = { kind: "staff" as const, siteId: input.siteId, actor: input.actor };
            const review = await getReview(
              { actor: staffInput, id: input.target.changeSetId },
              input.decision === "approve",
            );
            const seed = await approvalSeed(input.siteId, input.target.changeSetId);
            if (input.decision === "approve")
              return withStoredActor(seed, async (db, requester) => {
                const row = await lockApprovalTarget(db, input.siteId, input.target);
                await approvalViewer(db, input.siteId, input.actor, row);
                const result = await input.mutate(
                  db,
                  targetAccess(db, row, requester, review.changeSet.preview),
                );
                await approvalViewer(db, input.siteId, input.actor, row);
                return result;
              });
            return getDb().transaction(
              async (tx) => {
                const db = tx as unknown as Db;
                const row = await lockApprovalTarget(db, input.siteId, input.target);
                const viewer = await approvalViewer(db, input.siteId, input.actor, row);
                const result = await input.mutate(
                  db,
                  targetAccess(db, row, viewer, review.changeSet.preview),
                );
                await approvalViewer(db, input.siteId, input.actor, row);
                return result;
              },
              { isolationLevel: "serializable" },
            );
          },
          expire: async (input) =>
            getDb().transaction(
              async (tx) => {
                const db = tx as unknown as Db;
                const row = await lockApprovalTarget(db, input.siteId, input.target);
                return input.mutate(db, {
                  verify: () => Promise.reject(missing()),
                  transition: async (state) => {
                    if (state === "ready" && row.state === "scheduled") {
                      await failReservedExecution(db, row, "APPROVAL_EXPIRED");
                      return;
                    }
                    if (state !== "ready" || !["approval_pending", "approved"].includes(row.state))
                      throw conflict();
                    await db
                      .update(npAgentChangesets)
                      .set({ state: "ready", updatedAt: now() })
                      .where(eq(npAgentChangesets.id, row.id));
                  },
                });
              },
              { isolationLevel: "serializable" },
            ),
        },
      })
    : null;
  async function requestApproval(input: {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  }) {
    if (!approvals) throw missing();
    const command = npRequireAgentChangeSetRequestApprovalInputV1(input.command);
    const review = await getReview({ actor: input.actor, id: input.id }, true);
    const seed = await approvalSeed(input.actor.siteId, input.id);
    const result = await withStoredActor(seed, async (db, requester) => {
      const row = await lockApprovalTarget(db, input.actor.siteId, {
        kind: "changeset",
        changeSetId: input.id,
        planHash: command.planHash,
        scheduledFor: command.scheduledFor,
      });
      return admin({
        db,
        siteId: input.actor.siteId,
        actor: input.actor.actor,
        operationId: "agents.changesets.request_approval",
        targetId: row.id,
        command,
        mutate: async () => {
          if (
            row.draftVersion !== command.expectedDraftVersion ||
            row.planHash !== command.planHash ||
            !["ready", "approval_pending"].includes(row.state)
          )
            throw conflict();
          await approvalViewer(db, input.actor.siteId, input.actor.actor, row);
          const facts = await approvalFacts(
            db,
            row,
            requester,
            command.intendedOperation,
            command.scheduledFor,
            review.changeSet.preview,
            300,
          );
          const [previous] = await db
            .select()
            .from(npAgentApprovals)
            .where(
              and(
                eq(npAgentApprovals.siteId, row.siteId),
                eq(npAgentApprovals.targetChangesetId, row.id),
              ),
            )
            .orderBy(desc(npAgentApprovals.generation))
            .limit(1);
          if (previous && ["pending", "approved"].includes(previous.state)) {
            const checked = await approvals.verify(previous);
            const {
              version: _v,
              siteId: _s,
              approvalId: _id,
              createdAt: _c,
              expiresAt: _e,
              ...signed
            } = checked.statement;
            if (
              previous.state !== "pending" ||
              previous.expiresAt <= now() ||
              !sameJson(facts, signed)
            )
              throw conflict();
            return { resourceId: row.id, output: { approvalId: previous.id } };
          }
          const time = now();
          const expiresAt = new Date(
            Math.min(
              time.getTime() + approvalLifetime * 1000,
              row.expiresAt.getTime(),
              facts.requiresLivePreview && review.changeSet.preview?.expiresAt
                ? Date.parse(review.changeSet.preview.expiresAt)
                : Infinity,
            ),
          );
          if (command.scheduledFor && Date.parse(command.scheduledFor) >= expiresAt.getTime())
            throw conflict();
          const statement = npRequireAgentApprovalStatementCanonical({
            ...facts,
            version: "np.agent-approval-statement.v1",
            siteId: row.siteId,
            approvalId: randomUUID(),
            createdAt: time.toISOString(),
            expiresAt: expiresAt.toISOString(),
          });
          const approval = await approvals.create({
            db,
            statement,
            generation: (previous?.generation ?? 0) + 1,
          });
          await db
            .update(npAgentChangesets)
            .set({ state: "approval_pending", updatedAt: time })
            .where(eq(npAgentChangesets.id, row.id));
          return { resourceId: row.id, output: { approvalId: approval.id } };
        },
      });
    });
    return approvals.get({
      siteId: input.actor.siteId,
      actor: input.actor.actor,
      id: String(result.output.approvalId),
    });
  }
  type ExecutionRow = typeof npAgentChangesetExecutions.$inferSelect;
  type ApprovalRow = typeof npAgentApprovals.$inferSelect;
  const executionResources = createAgentChangeSetApplyResourceServiceV1();
  const executionWhere = (siteId: string, id: string) =>
    and(eq(npAgentChangesetExecutions.siteId, siteId), eq(npAgentChangesetExecutions.id, id));
  const parentWhere = (siteId: string, id: string) =>
    and(eq(npAgentChangesets.siteId, siteId), eq(npAgentChangesets.id, id));
  const executeError = (code: string) =>
    new NpAgentGatewayError(code, 409, "ChangeSet execution requires attention.");
  function executionSummary(e: ExecutionRow) {
    return {
      executionId: e.id,
      state: e.state,
      resultDigest: e.resultDigest,
      startedAt: e.reservedAt.toISOString(),
      finishedAt: e.finishedAt?.toISOString() ?? null,
    };
  }
  function verificationSummary(e: ExecutionRow) {
    if (!e.verificationState) return null;
    return {
      state: e.verificationState,
      requiredPassed: e.verificationBody.filter((c) => c.required && c.status === "passed").length,
      requiredFailed: e.verificationBody.filter(
        (c) => c.required && ["failed", "unavailable"].includes(c.status),
      ).length,
      advisoryWarnings: e.verificationBody.filter(
        (c) => !c.required && ["failed", "unavailable"].includes(c.status),
      ).length,
      digest: e.verificationDigest,
      completedAt: e.verificationCompletedAt?.toISOString() ?? null,
    };
  }
  function operationResult(row: Row, op: Pick<OpRow, "ordinal" | "afterHash">) {
    return hash("np.agent-changeset-operation-result.v1", {
      siteId: row.siteId,
      changeSetId: row.id,
      planHash: row.planHash,
      ordinal: op.ordinal,
      afterHash: op.afterHash,
    });
  }
  function executionResult(
    row: Row,
    e: Pick<ExecutionRow, "id" | "approvalId">,
    ops: readonly Pick<OpRow, "ordinal" | "afterHash" | "resultDigest">[],
    resultBody: ExecutionRow["resultBody"],
  ) {
    return hash("np.agent-changeset-execution-result.v1", {
      siteId: row.siteId,
      changeSetId: row.id,
      executionId: e.id,
      approvalId: e.approvalId,
      snapshots: resultBody?.operations.map((op) => ({
        ordinal: op.ordinal,
        snapshotHash: op.snapshotHash,
      })),
      planHash: row.planHash,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        afterHash: op.afterHash,
        resultDigest: op.resultDigest,
      })),
    });
  }
  async function executionEvidence(db: Db, row: Row, ops: OpRow[]) {
    const [e] = await db
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, row.siteId),
          eq(npAgentChangesetExecutions.changesetId, row.id),
        ),
      )
      .limit(1);
    if (!e) {
      if (
        [
          "scheduled",
          "applying",
          "applied",
          "verifying",
          "verified",
          "verification_failed",
          "apply_failed",
        ].includes(row.state)
      )
        throw missing();
      return null;
    }
    if (
      e.planHash !== row.planHash ||
      e.scheduledFor?.toISOString() !== row.scheduledFor?.toISOString()
    )
      throw missing();
    if (e.committedAt) {
      if (!e.resultBody || e.resultBody.operations.length !== ops.length) throw missing();
      let actualSnapshotBytes = 0;
      for (let i = 0; i < ops.length; i++) {
        const actual = e.resultBody.operations[i],
          op = ops[i];
        actualSnapshotBytes += Buffer.byteLength(serializeAgentCanonicalJson(actual.snapshot));
        if (actualSnapshotBytes > npAgentChangeSetLimits.aggregateSnapshotBytes) throw missing();
        if (
          actual.ordinal !== op.ordinal ||
          actual.afterHash !== op.afterHash ||
          actual.snapshot.siteId !== row.siteId ||
          actual.snapshot.changeSetId !== row.id ||
          actual.snapshot.operationOrdinal !== op.ordinal ||
          !sameJson(actual.snapshot.canonicalResourceKey, op.resourceKey) ||
          (await npDigestAgentChangeSetSnapshotCanonical(actual.snapshot)) !== actual.snapshotHash
        )
          throw missing();
      }
      if (
        !["applied", "verifying", "verified", "verification_failed"].includes(row.state) ||
        row.appliedAt?.toISOString() !== e.committedAt.toISOString() ||
        !row.rollbackEligibleUntil ||
        row.rollbackEligibleUntil.getTime() !==
          e.committedAt.getTime() + (row.rollbackWindowSeconds ?? 0) * 1000 ||
        ops.some(
          (op) =>
            op.state !== (row.state === "verified" ? "verified" : "applied") ||
            !op.afterHash ||
            op.resultDigest !== operationResult(row, op),
        ) ||
        e.resultDigest !== executionResult(row, e, ops, e.resultBody)
      )
        throw missing();
      const [a] = await db
        .select()
        .from(npAgentApprovals)
        .where(and(eq(npAgentApprovals.siteId, row.siteId), eq(npAgentApprovals.id, e.approvalId)))
        .limit(1);
      if (
        !a ||
        a.state !== "consumed" ||
        a.planHash !== row.planHash ||
        a.consumedAt?.toISOString() !== e.committedAt.toISOString()
      )
        throw missing();
      // Historical integrity-key retirement redacts approval evidence but does not invent a second apply.
      if (row.state === "verified" && (e.state !== "succeeded" || e.verificationState !== "passed"))
        throw missing();
    } else if (
      !["applying", "scheduled", "apply_failed", "cancelled"].includes(row.state) ||
      ops.some((op) => op.afterHash !== null || op.resultDigest !== null)
    )
      throw missing();
    return e;
  }
  async function executionDetail(db: Db, row: Row, ops: OpRow[]) {
    const e = await executionEvidence(db, row, ops);
    return e
      ? npRequireAgentChangeSetExecutionDetailV1({
          schemaVersion: "np.agent-changeset-execution.v1",
          changeSetId: row.id,
          execution: executionSummary(e),
          approvalId: e.approvalId,
          planHash: e.planHash,
          scheduledFor: e.scheduledFor?.toISOString() ?? null,
          committedAt: e.committedAt?.toISOString() ?? null,
          rollbackEligibleUntil: row.rollbackEligibleUntil?.toISOString() ?? null,
          errorCode: e.errorCode,
          verification: verificationSummary(e),
          checks: e.verificationBody,
        })
      : null;
  }
  async function executionActions(
    row: Row,
    actor: Actor,
  ): Promise<Array<"apply" | "schedule" | "cancel">> {
    if (!options.execution || !options.approvals || actor.principalId) return [];
    const result: Array<"apply" | "schedule" | "cancel"> = [];
    const intent = await options.execution.resolveIntent({ siteId: row.siteId });
    if (
      row.state === "approved" &&
      row.expiresAt > now() &&
      intent.enabled &&
      !intent.paused &&
      can(actor.user, "content.publish") &&
      approvals
    ) {
      const [a] = await getDb()
        .select()
        .from(npAgentApprovals)
        .where(
          and(
            eq(npAgentApprovals.siteId, row.siteId),
            eq(npAgentApprovals.targetChangesetId, row.id),
          ),
        )
        .orderBy(desc(npAgentApprovals.generation))
        .limit(1);
      if (a && a.state === "approved" && a.expiresAt > now()) {
        const { statement } = await approvals.verify(a);
        const authority = await npResolveLiveAgentStaffAuthorizationV1(
          getDb(),
          row.siteId,
          actor.user.id,
        );
        if (
          statement.requiredHumanCapabilities.every((c) =>
            authority.authority.capabilities.includes(c),
          ) &&
          (!statement.requiredHumanPredicates.includes("is-super-admin") ||
            authority.authority.kind === "super-admin")
        )
          result.push(statement.capabilityId === "changeset.schedule" ? "schedule" : "apply");
      }
    }
    if (
      ["draft", "invalid", "ready", "approval_pending", "approved", "scheduled"].includes(
        row.state,
      ) &&
      can(actor.user, "content.author")
    )
      result.push("cancel");
    return result;
  }
  async function liveApprover(db: Db, a: ApprovalRow, lock = true) {
    if (!a.decidedByUserId) throw executeError("AUTHORIZATION_CHANGED");
    const userQuery = db
      .select(staffUserProjection)
      .from(npUsers)
      .where(eq(npUsers.id, a.decidedByUserId))
      .limit(1);
    const [user] = await (lock ? userQuery.for("update") : userQuery);
    if (lock)
      await db
        .select({ role: npSiteMemberships.role })
        .from(npSiteMemberships)
        .where(
          and(
            eq(npSiteMemberships.siteId, a.siteId),
            eq(npSiteMemberships.userId, a.decidedByUserId),
          ),
        )
        .for("update");
    if (!user) throw executeError("AUTHORIZATION_CHANGED");
    const auth = await npResolveLiveAgentStaffAuthorizationV1(db, a.siteId, user.id);
    if (
      !auth.authority.capabilities.includes("site.access") ||
      a.requiredHumanCapabilities.some(
        (c) => !auth.authority.capabilities.some((allowed) => allowed === c),
      ) ||
      (a.requiredHumanPredicates.includes("is-super-admin") &&
        auth.authority.kind !== "super-admin")
    )
      throw executeError("AUTHORIZATION_CHANGED");
    return {
      user: {
        ...user,
        role:
          auth.authority.kind === "super-admin"
            ? ("admin" as const)
            : (auth.authority.role as NpAuthUser["role"]),
      },
      authorization: serializeAgentCanonicalJson(auth),
    };
  }
  async function withExecutionAuthority<T>(
    a: ApprovalRow,
    run: (db: Db, actor: Actor) => Promise<T>,
  ): Promise<T> {
    if (!approvals) throw missing();
    const { statement } = await approvals.verify(a);
    const seed = await approvalSeed(a.siteId, a.targetId);
    if (seed.requesterFingerprint !== statement.requester.fingerprint)
      throw executeError("AUTHORIZATION_CHANGED");
    async function human(db: Db, actor?: Actor) {
      const first = await liveApprover(db, a);
      const effective: Actor = actor ?? {
        siteId: a.siteId,
        user: first.user,
        authorization: first.authorization,
        fingerprint: statement.requester.fingerprint,
        principalId: null,
        scopes: null,
      };
      const result = await run(db, effective);
      if ((await liveApprover(db, a)).authorization !== first.authorization)
        throw executeError("AUTHORIZATION_CHANGED");
      return result;
    }
    if (statement.requester.kind === "staff")
      return getDb().transaction((db) => human(db), { isolationLevel: "serializable" });
    if (!options.admission || !options.gateway) throw executeError("AUTHORIZATION_CHANGED");
    return options.admission.withStoredAuthority({
      authorizationContext: seed.authorizationContextBody,
      authorizationContextFingerprint: seed.authorizationContextFingerprint,
      requiredScopes: statement.requiredScopes,
      minimumExposure: "approved-execute",
      resolveTransportAudience: options.gateway.getTransportAudience,
      mutate: async (db, _time, authentication) => {
        if (
          authentication.principal.id !== a.requestedByPrincipalId ||
          authentication.principal.authority.kind !== "user"
        )
          throw executeError("AUTHORIZATION_CHANGED");
        const userId = authentication.principal.authority.userId;
        if (!userId) throw executeError("AUTHORIZATION_CHANGED");
        const authority = await npResolveLiveAgentStaffAuthorizationV1(db, a.siteId, userId);
        const [user] = await db
          .select(staffUserProjection)
          .from(npUsers)
          .where(eq(npUsers.id, userId))
          .limit(1);
        if (!user) throw executeError("AUTHORIZATION_CHANGED");
        return human(db, {
          siteId: a.siteId,
          user: {
            ...user,
            role:
              authority.authority.kind === "super-admin"
                ? "admin"
                : (authority.authority.role as NpAuthUser["role"]),
          },
          authorization: serializeAgentCanonicalJson(authority),
          fingerprint: seed.requesterFingerprint,
          principalId: authentication.principal.id,
          scopes: authentication.scopes,
        });
      },
    });
  }
  async function executionPreview(a: ApprovalRow): Promise<NpAgentChangeSetWire["preview"]> {
    if (!a.requiresLivePreview) return null;
    if (!a.previewId) throw executeError("PREVIEW_REQUIRED");
    const read = () =>
      withExecutionAuthority(a, async (db, actor) => {
        const [p] = await db
          .select()
          .from(npAgentChangesetPreviews)
          .where(
            and(
              eq(npAgentChangesetPreviews.siteId, a.siteId),
              eq(npAgentChangesetPreviews.id, a.previewId!),
            ),
          )
          .limit(1);
        if (
          !p ||
          p.changesetId !== a.targetId ||
          p.planHash !== a.planHash ||
          p.digest !== a.previewDigest
        )
          throw executeError("PREVIEW_REQUIRED");
        const detail = await previewProjection(db, p, actor, false);
        if (detail.state !== "ready") throw executeError("PREVIEW_REQUIRED");
        return detail;
      });
    const detail = await read();
    for (const artifact of detail.artifactRefs) {
      const content = await previewArtifacts.readArtifact({
        siteId: a.siteId,
        previewId: detail.previewId,
        artifactId: artifact.artifactId,
        authorize: async () => {
          const current = await read();
          if (current.digest !== detail.digest) throw executeError("PREVIEW_REQUIRED");
        },
      });
      try {
        if (artifact.kind === "report") assertApprovalReport(content.bytes, a.siteId);
      } finally {
        content.bytes.fill(0);
      }
    }
    const {
      changeSetId: _id,
      allowedRoutes: _r,
      diffSummary: _d,
      checkSummary: _c,
      riskSummary: _risk,
      createdAt: _at,
      completedAt: _end,
      safeErrorCode: _error,
      ...summary
    } = detail;
    return npRequireAgentPreviewSummaryV1(
      { ...summary, schemaVersion: "np.agent-preview-summary.v1" },
      { siteId: a.siteId, changeSetId: a.targetId },
    );
  }
  async function checkExecutionApproval(
    db: Db,
    row: Row,
    a: ApprovalRow,
    actor: Actor,
    preview: NpAgentChangeSetWire["preview"],
    executing: boolean,
  ) {
    if (!options.execution || !approvals) throw missing();
    const intent = await options.execution.resolveIntent({ siteId: row.siteId });
    if (!intent.enabled || intent.paused) throw executeError("POLICY_CHANGED");
    const { statement } = await approvals.verify(a);
    if (a.expiresAt <= now()) throw executeError("APPROVAL_EXPIRED");
    if (a.state !== "approved")
      throw executeError(a.state === "revoked" ? "APPROVAL_REVOKED" : "APPROVAL_REQUIRED");
    if (
      statement.target.kind !== "changeset" ||
      statement.target.changeSetId !== row.id ||
      statement.target.planHash !== row.planHash
    )
      throw executeError("APPROVAL_INTEGRITY_INVALID");
    const facts = await approvalFacts(
      db,
      row,
      actor,
      statement.capabilityId === "changeset.schedule" ? "schedule" : "apply",
      statement.target.scheduledFor,
      preview,
      0,
      executing,
    );
    // Staff-origin execution is authorized by the approved human record, independent of the requester's old session.
    const {
      version: _v,
      siteId: _site,
      approvalId: _id,
      createdAt: _c,
      expiresAt: _e,
      ...signed
    } = statement;
    if (!sameJson({ ...facts, requester: statement.requester }, signed))
      throw executeError("POLICY_CHANGED");
    if (
      statement.target.scheduledFor &&
      (Date.parse(statement.target.scheduledFor) >= a.expiresAt.getTime() ||
        (preview?.expiresAt &&
          Date.parse(statement.target.scheduledFor) >= Date.parse(preview.expiresAt)))
    )
      throw executeError("APPROVAL_EXPIRED");
  }
  async function failReservedExecution(db: Db, row: Row, code: string) {
    const records = await db
      .update(npAgentChangesetExecutions)
      .set({
        state: "failed",
        errorCode: code,
        finishedAt: now(),
        leaseOwner: null,
        leaseToken: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, row.siteId),
          eq(npAgentChangesetExecutions.changesetId, row.id),
          eq(npAgentChangesetExecutions.state, "reserved"),
        ),
      )
      .returning({
        id: npAgentChangesetExecutions.id,
        approvalId: npAgentChangesetExecutions.approvalId,
      });
    if (records.length) {
      if (code === "EXECUTION_CANCELLED" && approvals) {
        await approvals.invalidateForExecution({
          db,
          siteId: row.siteId,
          id: records[0].approvalId,
          changeSetId: row.id,
          code: "EXECUTION_CANCELLED",
        });
      }
      await db
        .update(npAgentChangesets)
        .set({ state: "apply_failed", updatedAt: now() })
        .where(parentWhere(row.siteId, row.id));
      await db.insert(npAuditEvents).values({
        siteId: row.siteId,
        actorKind: "system",
        action: "agents.changesets.execution_failed",
        targetType: "agent-changeset",
        targetId: row.id,
        payload: { code },
        createdAt: now(),
      });
      row.state = "apply_failed";
    }
  }
  type StaffExecutionInput = {
    actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
    id: string;
    command: unknown;
  };
  async function admitExecution(input: StaffExecutionInput, kind: "apply" | "schedule") {
    if (!options.execution || !approvals || !uuid.test(input.id)) throw missing();
    if (!/^cj1:sha256:[A-Za-z0-9_-]{43}$/.test(options.execution.verificationFingerprint))
      throw missing();
    const command =
      kind === "apply"
        ? npRequireAgentChangeSetApplyInputV1(input.command)
        : npRequireAgentChangeSetScheduleInputV1(input.command);
    const actor = await resolve(input.actor, false);
    const [seed] = await getDb()
      .select()
      .from(npAgentApprovals)
      .where(
        and(eq(npAgentApprovals.siteId, actor.siteId), eq(npAgentApprovals.id, command.approvalId)),
      )
      .limit(1);
    if (!seed || seed.targetId !== input.id || seed.statementHash !== command.statementHash)
      throw missing();
    const preview = seed.state === "approved" ? await executionPreview(seed) : null;
    const admitted = await admin({
      siteId: actor.siteId,
      actor: input.actor.actor,
      operationId: kind === "apply" ? "agents.changesets.apply" : "agents.changesets.schedule",
      targetId: input.id,
      command,
      mutate: async ({ db, invocationId }) => {
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${actor.siteId}`},0))`,
        );
        const [row] = await db
          .select()
          .from(npAgentChangesets)
          .where(parentWhere(actor.siteId, input.id))
          .for("update")
          .limit(1);
        const [a] = await db
          .select()
          .from(npAgentApprovals)
          .where(
            and(
              eq(npAgentApprovals.siteId, actor.siteId),
              eq(npAgentApprovals.id, command.approvalId),
            ),
          )
          .for("update")
          .limit(1);
        if (
          !row ||
          !a ||
          row.state !== "approved" ||
          row.draftVersion !== command.expectedDraftVersion ||
          row.planHash !== command.planHash ||
          a.statementHash !== command.statementHash
        )
          throw conflict();
        const { statement } = await approvals.verify(a);
        const scheduledFor = "scheduledFor" in command ? command.scheduledFor : null;
        if (
          statement.capabilityId !== `changeset.${kind}` ||
          statement.target.kind !== "changeset" ||
          statement.target.scheduledFor !== scheduledFor
        )
          throw conflict();
        const submitterAuthority = await npResolveAgentStaffSessionAuthorizationV1(
          db,
          actor.siteId,
          input.actor.actor,
          now(),
        );
        if (
          a.requiredHumanCapabilities.some(
            (c) => !submitterAuthority.authority.capabilities.some((allowed) => allowed === c),
          ) ||
          (a.requiredHumanPredicates.includes("is-super-admin") &&
            submitterAuthority.authority.kind !== "super-admin")
        )
          throw denied();
        await checkExecutionApproval(db, row, a, actor, preview, false);
        const [invocation] = await db
          .select()
          .from(npAgentInvocations)
          .where(eq(npAgentInvocations.id, invocationId))
          .limit(1);
        if (!invocation) throw missing();
        const executionId = randomUUID();
        await db.insert(npAgentChangesetExecutions).values({
          id: executionId,
          siteId: row.siteId,
          changesetId: row.id,
          planHash: row.planHash,
          approvalId: a.id,
          invocationId,
          invocationFingerprint: invocation.requestHash,
          verificationContractFingerprint: options.execution!.verificationFingerprint,
          idempotencyKey: command.idempotencyKey,
          scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
          reservedAt: now(),
        });
        await db
          .update(npAgentChangesets)
          .set({
            state: kind === "schedule" ? "scheduled" : "applying",
            scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
            updatedAt: now(),
          })
          .where(parentWhere(row.siteId, row.id));
        return { resourceId: row.id, output: { executionId } };
      },
    });
    const [e] = await getDb()
      .select()
      .from(npAgentChangesetExecutions)
      .where(executionWhere(actor.siteId, String(admitted.output.executionId)))
      .limit(1);
    if (!e) throw missing();
    const job = executionJob(e);
    if (kind === "apply") await processExecution(job);
    else if (options.execution.enqueueApply)
      try {
        await options.execution.enqueueApply(job);
      } catch {
        /* Durable scheduled reservation remains available to host reconciliation. */
      }
    return getReview({ actor: input.actor, id: input.id });
  }
  const apply = (input: StaffExecutionInput) => admitExecution(input, "apply");
  const schedule = (input: StaffExecutionInput) => admitExecution(input, "schedule");
  async function cancel(input: StaffExecutionInput) {
    if (!options.execution || !uuid.test(input.id)) throw missing();
    const command = npRequireAgentChangeSetCancelInputV1(input.command),
      actor = await resolve(input.actor, false);
    await admin({
      siteId: actor.siteId,
      actor: input.actor.actor,
      operationId: "agents.changesets.cancel",
      targetId: input.id,
      command,
      mutate: async ({ db }) => {
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${actor.siteId}`},0))`,
        );
        const [row] = await db
          .select()
          .from(npAgentChangesets)
          .where(parentWhere(actor.siteId, input.id))
          .for("update")
          .limit(1);
        if (
          !row ||
          row.state !== command.expectedState ||
          row.draftVersion !== command.expectedDraftVersion ||
          row.planHash !== command.planHash
        )
          throw conflict();
        await project(row, actor, false, db, false);
        const pending = await db
          .select()
          .from(npAgentApprovals)
          .where(
            and(
              eq(npAgentApprovals.siteId, row.siteId),
              eq(npAgentApprovals.targetChangesetId, row.id),
              inArray(npAgentApprovals.state, ["pending", "approved"]),
            ),
          )
          .limit(2);
        if (pending.length > 1) throw missing();
        for (const a of pending) {
          if (!approvals) throw missing();
          await approvals.invalidateForExecution({
            db,
            siteId: row.siteId,
            id: a.id,
            changeSetId: row.id,
            code: "OPERATOR_CANCELLED",
          });
        }
        await failReservedExecution(db, row, "EXECUTION_CANCELLED");
        await db
          .update(npAgentChangesets)
          .set({ state: "cancelled", cancellationCode: "OPERATOR_CANCELLED", updatedAt: now() })
          .where(parentWhere(row.siteId, row.id));
        return { resourceId: row.id, output: { changeSetId: row.id } };
      },
    });
    return getReview({ actor: input.actor, id: input.id });
  }
  function executionJob(e: ExecutionRow): NpAgentChangeSetApplyJobPayload {
    return {
      siteId: e.siteId,
      changeSetId: e.changesetId,
      planHash: e.planHash,
      approvalId: e.approvalId,
      scheduledFor: e.scheduledFor?.toISOString() ?? null,
      idempotencyKey: e.idempotencyKey,
    };
  }
  async function processExecution(
    raw: NpAgentChangeSetApplyJobPayload,
    control?: { signal: AbortSignal },
  ): Promise<{ state: string }> {
    const input = npNormalizeJobPayload("agent:changesetApply", raw);
    if (!options.execution || !approvals) throw missing();
    const [seed] = await getDb()
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, input.siteId),
          eq(npAgentChangesetExecutions.changesetId, input.changeSetId),
          eq(npAgentChangesetExecutions.planHash, input.planHash),
        ),
      )
      .limit(1);
    if (!seed || !sameJson(executionJob(seed), input)) return { state: "stale" };
    if (seed.committedAt) {
      if (["committed", "verifying", "failed"].includes(seed.state))
        await processVerification({
          siteId: input.siteId,
          changeSetId: input.changeSetId,
          executionId: seed.id,
        });
      return { state: seed.state };
    }
    if (seed.state !== "reserved" || (seed.scheduledFor && seed.scheduledFor > now()))
      return { state: seed.state };
    const [a] = await getDb()
      .select()
      .from(npAgentApprovals)
      .where(
        and(eq(npAgentApprovals.siteId, input.siteId), eq(npAgentApprovals.id, seed.approvalId)),
      )
      .limit(1);
    if (!a) return { state: "stale" };
    const effects: NpAgentChangeSetExecutionEffectV1[] = [];
    const dispatchToken = randomUUID();
    let effectDeadline: number | null = null;
    try {
      if (control?.signal.aborted) throw executeError("EXECUTION_CANCELLED");
      if (a.expiresAt <= now()) throw executeError("APPROVAL_EXPIRED");
      const preview = await executionPreview(a);
      await withCurrentSite(input.siteId, () =>
        withDeferredPostCommit(
          () =>
            withExecutionAuthority(a, async (db, actor) => {
              await db.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${input.siteId}`},0))`,
              );
              const [row] = await db
                .select()
                .from(npAgentChangesets)
                .where(parentWhere(input.siteId, input.changeSetId))
                .for("update")
                .limit(1);
              const [e] = await db
                .select()
                .from(npAgentChangesetExecutions)
                .where(executionWhere(input.siteId, seed.id))
                .for("update")
                .limit(1);
              const [approval] = await db
                .select()
                .from(npAgentApprovals)
                .where(
                  and(eq(npAgentApprovals.siteId, input.siteId), eq(npAgentApprovals.id, a.id)),
                )
                .for("update")
                .limit(1);
              if (!row || !e || !approval) throw missing();
              if (e.committedAt || e.state !== "reserved") return;
              if (
                !["applying", "scheduled"].includes(row.state) ||
                row.planHash !== e.planHash ||
                e.verificationContractFingerprint !== options.execution!.verificationFingerprint
              )
                throw executeError("POLICY_CHANGED");
              await checkExecutionApproval(db, row, approval, actor, preview, true);
              const plan = npRequireAgentChangeSetPlanCanonical(row.sealedPlanBody);
              if (plan.planKind !== "changeset") throw missing();
              if (control?.signal.aborted) throw executeError("EXECUTION_CANCELLED");
              const applied = await executionResources.apply({
                tx: db as unknown as NpTransaction,
                siteId: row.siteId,
                user: actor.user,
                changeSetId: row.id,
                operations: plan.body.operations,
              });
              const results = applied.operations.map((op) => ({
                ordinal: op.ordinal,
                afterHash: op.afterHash,
                resultDigest: operationResult(row, op),
              }));
              for (const op of results)
                await db
                  .update(npAgentChangesetOperations)
                  .set({
                    state: "applied",
                    afterHash: op.afterHash,
                    resultDigest: op.resultDigest,
                    updatedAt: now(),
                  })
                  .where(
                    and(
                      eq(npAgentChangesetOperations.siteId, row.siteId),
                      eq(npAgentChangesetOperations.changesetId, row.id),
                      eq(npAgentChangesetOperations.ordinal, op.ordinal),
                    ),
                  );
              const time = now();
              await approvals.consume({
                db,
                siteId: row.siteId,
                id: approval.id,
                changeSetId: row.id,
                planHash: e.planHash,
                statementHash: approval.statementHash,
                consumedAt: time,
              });
              await db
                .update(npAgentChangesetExecutions)
                .set({
                  state: "committed",
                  committedAt: time,
                  resultDigest: executionResult(row, e, results, applied),
                  resultBody: applied,
                  verificationState: "queued",
                  effects,
                  leaseOwner: "changeset-post-commit",
                  leaseToken: dispatchToken,
                  leaseUntil: new Date(time.getTime() + 60_000),
                  attempts: e.attempts + 1,
                  version: e.version + 1,
                })
                .where(executionWhere(row.siteId, e.id));
              await db
                .update(npAgentChangesets)
                .set({
                  state: "applied",
                  appliedAt: time,
                  rollbackEligibleUntil: new Date(
                    time.getTime() + row.rollbackWindowSeconds! * 1000,
                  ),
                  updatedAt: time,
                })
                .where(parentWhere(row.siteId, row.id));
              await db.insert(npAuditEvents).values({
                siteId: row.siteId,
                actorKind: "system",
                action: "agents.changesets.execution_committed",
                targetType: "agent-changeset",
                targetId: row.id,
                payload: {
                  executionId: e.id,
                  resultDigest: executionResult(row, e, results, applied),
                },
                createdAt: time,
              });
            }),
          {
            observer: {
              register: (metadata: NpDeferredPostCommitMetadata) => {
                if (effects.length >= 4096) return Promise.reject(executeError("APPLY_FAILED"));
                effects.push({ ...metadata, state: "pending", errorCode: null });
                return Promise.resolve();
              },
              dispatch: async (metadata, fn) => {
                const claimed = await getDb().transaction(async (db) => {
                  const [e] = await db
                    .select()
                    .from(npAgentChangesetExecutions)
                    .where(executionWhere(input.siteId, seed.id))
                    .for("update")
                    .limit(1);
                  const effect = e?.effects.find((x) => x.ordinal === metadata.ordinal);
                  if (
                    !e?.committedAt ||
                    e.leaseToken !== dispatchToken ||
                    !e.leaseUntil ||
                    e.leaseUntil <= now() ||
                    !effect ||
                    effect.state !== "pending" ||
                    !sameJson(
                      { ordinal: effect.ordinal, label: effect.label, context: effect.context },
                      metadata,
                    )
                  )
                    return false;
                  effect.state = "running";
                  await db
                    .update(npAgentChangesetExecutions)
                    .set({ effects: e.effects })
                    .where(executionWhere(input.siteId, e.id));
                  return true;
                });
                if (!claimed) return;
                let errorCode: string | null = null;
                let timer: ReturnType<typeof setTimeout> | undefined;
                let timedOut = false;
                try {
                  effectDeadline ??= Date.now() + 30_000;
                  if (Date.now() >= effectDeadline) {
                    timedOut = true;
                    throw executeError("EFFECT_AMBIGUOUS");
                  }
                  const result = await Promise.race([
                    fn(),
                    new Promise<never>((_resolve, reject) => {
                      timer = setTimeout(
                        () => {
                          timedOut = true;
                          reject(executeError("EFFECT_AMBIGUOUS"));
                        },
                        Math.max(1, effectDeadline! - Date.now()),
                      );
                    }),
                  ]);
                  if (metadata.label.startsWith("enqueue:") && result === "")
                    errorCode = "DEPENDENCY_UNAVAILABLE";
                } catch {
                  errorCode = timedOut ? "EFFECT_AMBIGUOUS" : "VERIFICATION_FAILED";
                } finally {
                  if (timer) clearTimeout(timer);
                }
                await getDb().transaction(async (db) => {
                  const [e] = await db
                    .select()
                    .from(npAgentChangesetExecutions)
                    .where(executionWhere(input.siteId, seed.id))
                    .for("update")
                    .limit(1);
                  const effect = e?.effects.find((x) => x.ordinal === metadata.ordinal);
                  if (!e || e.leaseToken !== dispatchToken || effect?.state !== "running") return;
                  effect.state = timedOut ? "unknown" : errorCode ? "failed" : "succeeded";
                  effect.errorCode = errorCode;
                  await db
                    .update(npAgentChangesetExecutions)
                    .set({ effects: e.effects })
                    .where(executionWhere(input.siteId, e.id));
                });
              },
            },
          },
        ),
      );
    } catch (error) {
      const [current] = await getDb()
        .select()
        .from(npAgentChangesetExecutions)
        .where(executionWhere(input.siteId, seed.id))
        .limit(1);
      if (!current?.committedAt) {
        const direct = error as { code?: unknown; cause?: { code?: unknown } } | null;
        const sqlCode =
          typeof direct?.code === "string"
            ? direct.code
            : typeof direct?.cause?.code === "string"
              ? direct.cause.code
              : "";
        if (["40001", "40P01"].includes(sqlCode)) return { state: "reserved" };
        const safeCodes = [
          "EXECUTION_CANCELLED",
          "APPROVAL_EXPIRED",
          "APPROVAL_REVOKED",
          "APPROVAL_REQUIRED",
          "APPROVAL_INTEGRITY_INVALID",
          "PREVIEW_REQUIRED",
          "AUTHORIZATION_CHANGED",
          "POLICY_CHANGED",
        ];
        const code = safeCodes.includes(sqlCode)
          ? sqlCode
          : sqlCode === "CHANGESET_BASE_CONFLICT" || sqlCode === "CHANGESET_CONFLICT"
            ? "BASE_CONFLICT"
            : [
                  "AGENT_FORBIDDEN",
                  "CHANGESET_ACCESS_DENIED",
                  "AGENT_ACCESS_DENIED",
                  "INSUFFICIENT_SCOPE",
                  "CAPABILITY_UNAVAILABLE",
                  "TRANSPORT_UNAVAILABLE",
                ].includes(sqlCode)
              ? "AUTHORIZATION_CHANGED"
              : "APPLY_FAILED";
        await getDb().transaction(async (db) => {
          await db.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${input.siteId}`},0))`,
          );
          const [row] = await db
            .select()
            .from(npAgentChangesets)
            .where(parentWhere(input.siteId, input.changeSetId))
            .for("update")
            .limit(1);
          if (row) await failReservedExecution(db, row, code);
        });
        return { state: "failed" };
      }
    }
    // A duplicate processor cannot release another dispatcher or verifier's lease.
    await getDb()
      .update(npAgentChangesetExecutions)
      .set({ leaseOwner: null, leaseToken: null, leaseUntil: null })
      .where(
        and(
          executionWhere(input.siteId, seed.id),
          eq(npAgentChangesetExecutions.leaseToken, dispatchToken),
        ),
      );
    {
      const job = { siteId: input.siteId, changeSetId: input.changeSetId, executionId: seed.id };
      if (options.execution.enqueueVerify)
        try {
          await options.execution.enqueueVerify(job);
        } catch {
          /* Durable queued verification is reconciled by the host. */
        }
      else await processVerification(job);
    }
    const [current] = await getDb()
      .select({ state: npAgentChangesetExecutions.state })
      .from(npAgentChangesetExecutions)
      .where(executionWhere(input.siteId, seed.id))
      .limit(1);
    return { state: current?.state ?? "stale" };
  }
  async function processVerification(raw: NpAgentChangeSetVerifyJobPayload) {
    const input = npNormalizeJobPayload("agent:changesetVerify", raw);
    if (!options.execution) throw missing();
    await withCurrentSite(input.siteId, () =>
      npVerifyChangeSetExecutionV1({
        ...input,
        now,
        verificationFingerprint: options.execution!.verificationFingerprint,
        verifyConvergence: options.execution!.verifyConvergence,
        inspectPostCommitEffect: options.execution!.inspectPostCommitEffect,
        readResources: async (tx, row, ops) => {
          const db = tx as unknown as Db;
          const e = await executionEvidence(db, row, ops);
          if (!e?.committedAt) throw missing();
          const [a] = await db
            .select()
            .from(npAgentApprovals)
            .where(
              and(eq(npAgentApprovals.siteId, row.siteId), eq(npAgentApprovals.id, e.approvalId)),
            )
            .limit(1);
          if (!a || !approvals) throw missing();
          await approvals.verify(a);
          const actor = await liveApprover(db, a, false);
          let hashes = true,
            revisions = true;
          for (const op of ops) {
            const current = await validationResources.readCurrent({
              tx: db as unknown as NpTransaction,
              siteId: row.siteId,
              user: actor.user,
              changeSetId: row.id,
              ordinal: op.ordinal,
              operation: op.input,
              canonicalResourceKey: op.resourceKey,
            });
            if (current.beforeHash !== op.afterHash) hashes = false;
            if (op.input.kind === "document" && op.resourceKey.kind === "document") {
              const [revision] = await db
                .select({ id: npRevisions.id })
                .from(npRevisions)
                .where(
                  and(
                    eq(npRevisions.collection, op.input.resource.collection),
                    eq(npRevisions.documentId, op.resourceKey.documentId),
                    gte(npRevisions.createdAt, e.reservedAt),
                  ),
                )
                .limit(1);
              if (!revision) revisions = false;
            }
          }
          const [audit] = await db
            .select({ id: npAuditEvents.id })
            .from(npAuditEvents)
            .where(
              and(
                eq(npAuditEvents.siteId, row.siteId),
                eq(npAuditEvents.targetId, row.id),
                eq(npAuditEvents.action, "agents.changesets.execution_committed"),
                sql`${npAuditEvents.payload}->>'executionId'=${e.id}`,
              ),
            )
            .limit(1);
          const check = (
            checkId: "resource_after_hashes" | "revisions_audit",
            passed: boolean,
          ): NpAgentVerificationCheckV1 => ({
            checkId,
            required: true,
            severity: "error",
            status: passed ? "passed" : "failed",
            evidenceRefs: ops.map((op) => ({ kind: "operation", id: String(op.ordinal) })),
            nextAction: passed ? "none" : "refresh_plan",
          });
          if ((await liveApprover(db, a, false)).authorization !== actor.authorization)
            throw executeError("AUTHORIZATION_CHANGED");
          return [
            check("resource_after_hashes", hashes),
            check("revisions_audit", revisions && Boolean(audit)),
          ];
        },
      }),
    );
  }
  async function reconcileExecutions(input: { siteId: string; limit?: number; cursor?: string }) {
    const limit = input.limit ?? 25;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (input.cursor && !uuid.test(input.cursor))
    )
      throw conflict();
    const rows = await getDb()
      .select()
      .from(npAgentChangesetExecutions)
      .where(
        and(
          eq(npAgentChangesetExecutions.siteId, input.siteId),
          inArray(npAgentChangesetExecutions.state, [
            "reserved",
            "committed",
            "verifying",
            "failed",
          ]),
          ...(input.cursor ? [gt(npAgentChangesetExecutions.id, input.cursor)] : []),
        ),
      )
      .orderBy(asc(npAgentChangesetExecutions.id))
      .limit(limit);
    for (const e of rows) {
      if (e.committedAt)
        await processVerification({
          siteId: e.siteId,
          changeSetId: e.changesetId,
          executionId: e.id,
        });
      else if (e.state === "reserved") await processExecution(executionJob(e));
    }
    return { examined: rows.length, nextCursor: rows.length === limit ? rows.at(-1)!.id : null };
  }
  const applyHandler = async (job: NpAgentChangeSetApplyJobPayload) => {
    await processExecution(job);
  };
  const verifyHandler = async (job: NpAgentChangeSetVerifyJobPayload) => {
    await processVerification(job);
  };
  const executionSiteId = (payload: { siteId: string }) => payload.siteId;
  function registerExecutionJobs() {
    if (!options.execution) throw missing();
    registerJobHandler("agent:changesetApply", applyHandler, {
      resolveSiteId: executionSiteId,
      quota: "site",
    });
    registerJobHandler("agent:changesetVerify", verifyHandler, {
      resolveSiteId: executionSiteId,
      quota: "site",
    });
  }

  return {
    apply,
    schedule,
    cancel,
    processExecution,
    processVerification,
    reconcileExecutions,
    registerExecutionJobs,
    approvals,
    requestApproval,
    capabilityIds: Object.freeze(
      npAgentChangeSetCapabilityIdsV1.filter(
        (id) => id !== "changeset.preview" || options.preview !== undefined,
      ),
    ),
    create: (input: { actor: NpAgentChangeSetActorV1; command: unknown }) => write(input),
    update: (input: {
      actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
      id: string;
      command: unknown;
    }) => write(input),
    get,
    getReview,
    invokeCapability,
    list,
    reconcileExpired,
    validate,
    processValidation,
    reconcileValidations,
    preview,
    getPreview,
    withPreviewAuthority,
    withPreviewViewer,
    renderPreview,
    artifacts,
    processPreview,
    reconcilePreviews,
    readPreviewArtifact,
  };
}

/** Adapts the existing shared artifact read to the existing Agent HTTP injection seam. */
export function createAgentChangeSetHttpArtifactFacadeV1(
  service: Pick<NpAgentChangeSetServiceV1, "readPreviewArtifact">,
): NpAgentHttpArtifactFacadeV1 {
  return {
    async readArtifact(input) {
      try {
        const result = await service.readPreviewArtifact({
          actor: { kind: "principal", authentication: input.authentication },
          previewId: input.previewId,
          artifactId: input.artifactId,
        });
        if (
          result.mime !== "image/png" &&
          result.mime !== "image/webp" &&
          result.mime !== "application/json"
        )
          return { kind: "not_found" };
        return { ...result, mime: result.mime, kind: "ok" };
      } catch {
        return { kind: "not_found" };
      }
    },
  };
}
