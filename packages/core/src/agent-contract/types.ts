import type { NpCapability } from "../auth/capabilities.js";
import type { NpNavigationItems } from "../navigation/types.js";
import type { NpThemeTokensOverlay } from "../theme/types.js";

export type NpAgentJsonPrimitive = string | number | boolean | null;
export type NpAgentJsonValue =
  NpAgentJsonPrimitive | NpAgentJsonValue[] | { [key: string]: NpAgentJsonValue };
export type NpAgentJsonObject = { [key: string]: NpAgentJsonValue };

export type NpAgentCanonicalJsonValueV1 = NpAgentJsonValue;
export type NpAgentCanonicalJsonObjectV1 = NpAgentJsonObject;
export type NpAgentCanonicalUtcV1 = string;
export type NpAgentCanonicalDigestV1 = string;
export type NpAgentCanonicalIdV1 = string;

export interface NpAgentCanonicalBodyBytesV1<
  P extends NpAgentCanonicalPurposeV1,
  B extends object,
> {
  purpose: P;
  body: B;
  canonicalJsonUtf8: Uint8Array;
  domainSeparatedUtf8: Uint8Array;
}

export type NpAgentInvocationAuthorityRefV1 =
  | {
      kind: "staff-session";
      userId: string;
      sessionId: string;
      userTokenVersion: number;
      siteAuthorizationDigest: string;
    }
  | {
      kind: "service-family";
      principalId: string;
      rotationFamilyId: string;
      familyAuthorityVersion: number;
      principalTokenVersion: number;
      exposureMode: NpAgentEnabledGatewayExposureMode;
      audience: string;
    }
  | {
      kind: "oauth-grant";
      principalId: string;
      clientId: string;
      grantId: string;
      grantVersion: number;
      principalTokenVersion: number;
      exposureMode: NpAgentEnabledGatewayExposureMode;
      audience: string;
    }
  | {
      kind: "runtime-run";
      principalId: string;
      runId: string;
      agentVersionId: string;
      deadlineAt: string;
    };

export interface NpAgentAuthorizationContextCanonicalV1 {
  schemaVersion: "np.agent-authorization-context.v1";
  siteId: string;
  actor:
    | {
        kind: "principal";
        principalId: string;
        actorFingerprint: string;
      }
    | {
        kind: "staff";
        userId: string;
        actorFingerprint: string;
      };
  transport: "mcp-oauth" | "mcp-service" | "stdio" | "agent-api" | "runtime" | "admin";
  gatewayExposure: NpAgentEnabledGatewayExposureMode | null;
  authorityRef: NpAgentInvocationAuthorityRefV1;
}

export const npAgentApprovalRisks = ["reversible", "sensitive", "destructive"] as const;
export type NpAgentApprovalRisk = (typeof npAgentApprovalRisks)[number];

export const npAgentApprovalDecisions = ["approve", "reject"] as const;
export type NpAgentApprovalDecision = (typeof npAgentApprovalDecisions)[number];

export const npAgentApprovalRevocationKinds = [
  "human",
  "authority_loss",
  "site_deleting",
  "integrity_key_retired",
  "target_invalidated",
] as const;
export type NpAgentApprovalRevocationKind = (typeof npAgentApprovalRevocationKinds)[number];

export type NpAgentApprovalRequesterV1 =
  | { kind: "principal"; principalId: string; fingerprint: string }
  | { kind: "staff"; userId: string | null; fingerprint: string };

export type NpAgentApprovalTargetV1 =
  | { kind: "changeset"; changeSetId: string; planHash: string }
  | {
      kind: "changeset_rollback";
      changeSetId: string;
      rollbackPlanId: string;
      planHash: string;
    }
  | {
      kind: "action";
      actionId: string;
      runId: string | null;
      agentId: string | null;
      proposalHash: string;
    };

export type NpAgentApprovalReauthenticationRequirementV1 =
  { mode: "none" } | { mode: "recent"; maxAgeSeconds: number; assurance: "staff-primary" };

export interface NpAgentApprovalStatementCanonicalV1 {
  version: "np.agent-approval-statement.v1";
  siteId: string;
  approvalId: string;
  requester: NpAgentApprovalRequesterV1;
  target: NpAgentApprovalTargetV1;
  capabilityId: NpAgentCapabilityId;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: NpAgentHumanPredicate[];
  policyHashes: string[];
  requiresLivePreview: boolean;
  previewId: string | null;
  previewDigest: string | null;
  risk: NpAgentApprovalRisk;
  reauthentication: NpAgentApprovalReauthenticationRequirementV1;
  createdAt: string;
  expiresAt: string;
}

/** Public approval projection and canonical integrity body are byte-identical in v1. */
export type NpAgentApprovalStatementV1 = NpAgentApprovalStatementCanonicalV1;

export type NpAgentApprovalDecisionReauthenticationV1 =
  | { mode: "none" }
  | {
      mode: "recent";
      assurance: "staff-primary";
      maxAgeSeconds: number;
      reauthenticatedAt: string;
      sessionFactFingerprint: string;
    };

export interface NpAgentApprovalDecisionCanonicalV1 {
  schemaVersion: "np.agent-approval-decision.v1";
  siteId: string;
  approvalId: string;
  approvalGeneration: number;
  statementHash: string;
  decision: NpAgentApprovalDecision;
  deciderFingerprint: string;
  currentHumanCapabilities: NpCapability[];
  reason: string | null;
  reauthentication: NpAgentApprovalDecisionReauthenticationV1;
  decidedAt: string;
}

export interface NpAgentApprovalRevocationCanonicalV1 {
  schemaVersion: "np.agent-approval-revocation.v1";
  siteId: string;
  approvalId: string;
  approvalGeneration: number;
  statementHash: string;
  decisionHash: string | null;
  revocationKind: NpAgentApprovalRevocationKind;
  revokerFingerprint: string;
  revocationCode: string;
  revocationReason: string | null;
  revokedAt: string;
}

export interface NpAgentApprovalStatementBindingV1 {
  statement: NpAgentApprovalStatementCanonicalV1;
  statementHash: string;
  approvalGeneration: number;
}

export interface NpAgentApprovalDecisionBindingV1 {
  decision: NpAgentApprovalDecisionCanonicalV1;
  decisionHash: string;
}

export interface NpAgentApprovalIntegrityKeyV1 {
  owner: "approval-integrity";
  id: string;
  bytes: Uint8Array;
}

export const npAgentPreviewArtifactKinds = ["screenshot", "report"] as const;
export type NpAgentPreviewArtifactKind = (typeof npAgentPreviewArtifactKinds)[number];

export const npAgentPreviewArtifactMimes = ["image/png", "image/webp", "application/json"] as const;
export type NpAgentPreviewArtifactMime = (typeof npAgentPreviewArtifactMimes)[number];

export interface NpAgentPreviewArtifactViewportV1 {
  name: "desktop" | "mobile";
  width: number;
  height: number;
  deviceScaleFactor: 1 | 2;
}

export interface NpAgentPreviewArtifactManifestEntryV1 {
  ordinal: number;
  artifactId: string;
  kind: NpAgentPreviewArtifactKind;
  route: string | null;
  locale: string | null;
  viewport: NpAgentPreviewArtifactViewportV1 | null;
  reportPart: number | null;
  reportTotalParts: number | null;
  contentDigest: string;
  mime: NpAgentPreviewArtifactMime;
  bytes: number;
  createdAt: string;
  expiresAt: string;
}

export interface NpAgentPreviewArtifactManifestV1 {
  schemaVersion: "np.agent-preview-artifact-manifest.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  artifacts: NpAgentPreviewArtifactManifestEntryV1[];
}

export interface NpAgentPreviewContractCanonicalV1 {
  schemaVersion: "np.agent-preview-contract.v1";
  overlayResolverVersion: number;
  rendererId: string;
  rendererVersion: number;
  rendererFingerprint: string;
  screenshotAdapterId: string | null;
  screenshotAdapterVersion: number | null;
  screenshotAdapterFingerprint: string | null;
  routeParserVersion: number;
  checkRegistryVersion: number;
  linkAllowlistVersion: number;
  linkAllowlistOrigins: string[];
  networkPolicyVersion: number;
  artifactLimitsVersion: number;
  reportSchemaVersion: number;
  responseHeaderBuilderVersion: number;
  cspBuilderVersion: number;
}

export interface NpAgentPreviewRouteCanonicalV1 {
  route: string;
  locale: string | null;
  audience: "public";
}

export interface NpAgentPreviewRoutesCanonicalV1 {
  schemaVersion: "np.agent-preview-routes.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  routes: NpAgentPreviewRouteCanonicalV1[];
}

export const npAgentCanonicalPurposes = [
  "np.agent-action.v1",
  "np.agent-approval-decision.v1",
  "np.agent-approval-revocation.v1",
  "np.agent-approval-statement.v1",
  "np.agent-artifact.v1",
  "np.agent-authorization-context.v1",
  "np.agent-budget-snapshot.v1",
  "np.agent-capability-registry.v1",
  "np.agent-changeset-plan.v1",
  "np.agent-changeset-proposal.v1",
  "np.agent-changeset-snapshot.v1",
  "np.agent-connection-config.v1",
  "np.agent-connection-destination.v1",
  "np.agent-connection-operation.v1",
  "np.agent-effect-profile.v1",
  "np.agent-event.v1",
  "np.agent-idempotency-request.v1",
  "np.agent-mcp-task-result.v1",
  "np.agent-notification-delivery.v1",
  "np.agent-policy.v1",
  "np.agent-preview-contract.v1",
  "np.agent-preview-routes.v1",
  "np.agent-provider-request.v1",
  "np.agent-provider-response.v1",
  "np.agent-recipe-registry.v1",
  "np.agent-restriction.v1",
  "np.agent-run-admission.v1",
  "np.agent-run-limits.v1",
  "np.agent-signal-evidence.v1",
  "np.agent-site-deletion-plan.v1",
  "np.agent-staff-site-authorization.v1",
  "np.agent-vault-aad.v1",
] as const;

export type NpAgentCanonicalPurposeV1 = (typeof npAgentCanonicalPurposes)[number];
export type NpAgentCanonicalShaPurposeV1 = Exclude<
  NpAgentCanonicalPurposeV1,
  "np.agent-connection-destination.v1"
>;

export const npAgentCanonicalHmacOwnersV1 = {
  "np.agent-approval-statement.v1": "approval-integrity",
  "np.agent-approval-decision.v1": "approval-integrity",
  "np.agent-approval-revocation.v1": "approval-integrity",
  "np.agent-connection-destination.v1": "connection-destination",
} as const satisfies Partial<
  Record<NpAgentCanonicalPurposeV1, "approval-integrity" | "connection-destination">
>;

export type NpAgentCanonicalHmacPurposeV1 = keyof typeof npAgentCanonicalHmacOwnersV1;
export type NpAgentCanonicalHmacOwnerV1 =
  (typeof npAgentCanonicalHmacOwnersV1)[NpAgentCanonicalHmacPurposeV1];

export type NpAgentConnectionKind = "model" | "notification";
export type NpAgentConnectionSecretPurpose =
  "connection-credential" | "provider-oauth-pkce" | "provider-oauth-code";
export type NpAgentVaultAlgorithm = "AES-256-GCM" | `custom:${string}`;

export interface NpAgentEffectProfileCanonicalV1 {
  schemaVersion: "np.agent-effect-profile.v1";
  capabilityId: NpAgentCapabilityId;
  capabilityContractVersion: number;
  implementationVersion: number;
  profileId: string;
  kind: "read" | "mutation";
  reversibility: "none" | "compensatable";
  minimumGatewayExposure: NpAgentEnabledGatewayExposureMode | null;
  effectContractVersion: number;
  verifierId: string | null;
  compensatorId: string | null;
}

export interface NpAgentCapabilityRegistryEntryCanonicalV1 {
  descriptor: NpAgentCapabilityDescriptor;
  implementationVersion: number;
  effectProfiles: NpAgentEffectProfileCanonicalV1[];
}

export interface NpAgentCapabilityRegistryCanonicalV1 {
  schemaVersion: "np.agent-capability-registry.v1";
  projection: "definition" | "registry";
  capabilities: NpAgentCapabilityRegistryEntryCanonicalV1[];
}

export interface NpAgentRecipeInstructionCanonicalV1 {
  templateId: string;
  templateVersion: number;
  digest: string;
  text: string;
}

export interface NpAgentRecipeDefinitionCanonicalV1 {
  id: NpAgentRecipeId;
  version: 1;
  allowedTemplates: NpAgentRecipeTemplate[];
  task: NpAgentRecipeTask;
  providerMode: NpAgentRecipeProviderMode;
  triggerKinds: NpAgentRecipeTriggerKind[];
  capabilityIds: NpAgentCapabilityId[];
  settingsSchema: NpAgentJsonSchema;
  manualInputSchema: NpAgentJsonSchema | null;
  responseSchema: NpAgentJsonSchema;
  instruction: NpAgentRecipeInstructionCanonicalV1 | null;
}

export interface NpAgentRecipeRegistryCanonicalV1 {
  schemaVersion: "np.agent-recipe-registry.v1";
  projection: "definition" | "registry";
  recipes: NpAgentRecipeDefinitionCanonicalV1[];
}

export interface NpAgentVersionBaseV1 {
  version: string;
  digest: string;
}

export interface NpAgentChangeSetOperationCommonV1 {
  clientOperationId: string;
  reason: string | null;
}

export type NpAgentChangeSetOperationInput =
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "document";
      operation: "create";
      resource: { collection: string; documentId: null };
      base: null;
      input: {
        document: NpAgentJsonObject;
        targetStatus: "draft" | "published";
      };
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "document";
      operation: "update";
      resource: { collection: string; documentId: string };
      base: NpAgentVersionBaseV1;
      input: {
        patch: NpAgentJsonObject;
        targetStatus: "draft" | "published" | null;
      };
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "document";
      operation: "publish" | "archive";
      resource: { collection: string; documentId: string };
      base: NpAgentVersionBaseV1;
      input: Record<string, never>;
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "document";
      operation: "schedule";
      resource: { collection: string; documentId: string };
      base: NpAgentVersionBaseV1;
      input: { publishAt: string };
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "navigation";
      operation: "replace";
      resource: { location: string };
      base: NpAgentVersionBaseV1;
      input: { items: NpNavigationItems };
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "theme_tokens";
      operation: "replace";
      resource: { themeId: string };
      base: NpAgentVersionBaseV1;
      input: { tokens: NpThemeTokensOverlay };
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "setting";
      operation: "replace";
      resource: { key: NpAgentMutableSettingKey };
      base: NpAgentVersionBaseV1 | null;
      input: { value: NpAgentJsonValue };
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "setting";
      operation: "remove";
      resource: { key: NpAgentMutableSettingKey };
      base: NpAgentVersionBaseV1;
      input: Record<string, never>;
    })
  | (NpAgentChangeSetOperationCommonV1 & {
      kind: "media_ref";
      operation: "attach" | "detach";
      resource: {
        mediaId: string;
        collection: string;
        documentId: string;
        field: string;
      };
      base: NpAgentVersionBaseV1;
      input: Record<string, never>;
    });

export type NpAgentChangeSetResourceKeyV1 =
  | { kind: "document"; collection: string; documentId: string }
  | { kind: "navigation"; location: string }
  | { kind: "theme_tokens"; themeId: string }
  | { kind: "setting"; key: NpAgentMutableSettingKey }
  | {
      kind: "media_ref";
      mediaId: string;
      collection: string;
      documentId: string;
      field: string;
    };

export interface NpAgentChangeSetProposalOperationCanonicalV1 {
  ordinal: number;
  operation: NpAgentChangeSetOperationInput;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
}

export interface NpAgentChangeSetProposalCanonicalV1 {
  schemaVersion: "np.agent-changeset-proposal.v1";
  siteId: string;
  changeSetId: string;
  draftVersion: number;
  title: string;
  summary: string | null;
  operations: NpAgentChangeSetProposalOperationCanonicalV1[];
}

export interface NpAgentChangeSetSnapshotCanonicalV1 {
  schemaVersion: "np.agent-changeset-snapshot.v1";
  siteId: string;
  changeSetId: string;
  operationOrdinal: number;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  presence: "present" | "absent";
  base: NpAgentVersionBaseV1 | null;
  value: NpAgentJsonValue | null;
}

export interface NpAgentRiskSummary {
  level: "low" | "medium" | "high" | "critical";
  reasonCodes: NpAgentRiskReasonCode[];
  approvalMode: "human";
  reversible: boolean;
}

export interface NpAgentInitialChangeSetPlanOperationCanonicalV1 {
  ordinal: number;
  operation: NpAgentChangeSetOperationInput;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  beforeHash: string | null;
  proposedAfterHash: string;
  snapshotHash: string;
  rollbackClass: NpAgentChangeSetRollbackClass;
  residualCodes: string[];
}

export interface NpAgentInitialChangeSetPlanBodyV1 {
  draftVersion: number;
  draftHash: string;
  validationGeneration: number;
  baseFingerprint: string;
  operations: NpAgentInitialChangeSetPlanOperationCanonicalV1[];
  risk: NpAgentRiskSummary;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: NpAgentHumanPredicate[];
  policyHashes: string[];
  expiresAt: string;
  rollbackWindowSeconds: number;
}

export interface NpAgentRollbackChangeSetPlanOperationCanonicalV1 {
  ordinal: number;
  originalOperationOrdinal: number;
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1;
  originalSnapshotHash: string;
  expectedCurrentHash: string;
  expectedCurrentVersion: string;
  compensationOperation: NpAgentChangeSetOperationInput;
  proposedAfterHash: string;
  rollbackClass: NpAgentChangeSetRollbackClass;
  residualCodes: string[];
}

export interface NpAgentRollbackChangeSetPlanBodyV1 {
  rollbackPlanId: string;
  generation: number;
  compensatesExecutionId: string;
  originalPlanHash: string;
  appliedResultDigest: string;
  baseFingerprint: string;
  operations: NpAgentRollbackChangeSetPlanOperationCanonicalV1[];
  risk: NpAgentRiskSummary;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: NpAgentHumanPredicate[];
  policyHashes: string[];
  expiresAt: string;
}

export type NpAgentChangeSetPlanCanonicalV1 =
  | {
      schemaVersion: "np.agent-changeset-plan.v1";
      planKind: "changeset";
      siteId: string;
      changeSetId: string;
      body: NpAgentInitialChangeSetPlanBodyV1;
    }
  | {
      schemaVersion: "np.agent-changeset-plan.v1";
      planKind: "rollback";
      siteId: string;
      changeSetId: string;
      body: NpAgentRollbackChangeSetPlanBodyV1;
    };

export const npAgentBudgetSourceKinds = [
  "agent",
  "deployment",
  "policy",
  "recipe",
  "site",
] as const;
export type NpAgentBudgetSourceKind = (typeof npAgentBudgetSourceKinds)[number];

export interface NpAgentBudgetSnapshotRecipeV1 {
  id: NpAgentRecipeId;
  version: number;
  fingerprint: string;
}

export interface NpAgentBudgetSnapshotSourceRefV1 {
  kind: NpAgentBudgetSourceKind;
  id: string | null;
  version: number;
  digest: string;
}

export interface NpAgentBudgetSnapshotCountersV1 {
  concurrentRuns: number;
  concurrentProviderCalls: number;
  runsRollingHour: number;
  providerCallsRollingHour: number;
  inputTokensUtcDay: number;
  outputTokensUtcDay: number;
  inputTokensUtcMonth: number;
  outputTokensUtcMonth: number;
  costMicrosUtcDay: number;
  costMicrosUtcMonth: number;
  incidentAnalysesFingerprintUtcDay: number;
  directActionsRollingHour: number;
  directActionsSubjectRollingHour: number;
}

export interface NpAgentBudgetSnapshotWindowsV1 {
  rollingHourStartedAt: string;
  utcDay: string;
  utcMonth: string;
}

export interface NpAgentBudgetSnapshotReservationV1 {
  runs: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface NpAgentBudgetSnapshotCanonicalV1 {
  schemaVersion: "np.agent-budget-snapshot.v1";
  siteId: string;
  principalId: string;
  agentId: string | null;
  recipe: NpAgentBudgetSnapshotRecipeV1 | null;
  capturedAt: string;
  sourceRefs: NpAgentBudgetSnapshotSourceRefV1[];
  limits: NpAgentRunLimitsV1;
  counters: NpAgentBudgetSnapshotCountersV1;
  windows: NpAgentBudgetSnapshotWindowsV1;
  reservation: NpAgentBudgetSnapshotReservationV1;
}

export const npAgentActorBucketPurposesV1 = ["login-identifier", "network-address"] as const;
export type NpAgentActorBucketPurposeV1 = (typeof npAgentActorBucketPurposesV1)[number];

export const npAgentActorRestrictionScopes = [
  "auth.staff",
  "auth.member",
  "agent.gateway",
  "community.write",
  "content.write",
] as const;
export type NpAgentActorRestrictionScope = (typeof npAgentActorRestrictionScopes)[number];

export const NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS = 60;
export const NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS = 900;
export const NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS = 3_600;

export interface NpAgentActorBucketRefV1 {
  purpose: NpAgentActorBucketPurposeV1;
  projectionVersion: number;
  projectionFingerprint: string;
  keyId: string;
  bucket: string;
}

export type NpAgentStableCode = string;

export const npAgentRestrictionPrincipalKinds = ["agent-gateway", "member", "staff"] as const;
export type NpAgentRestrictionPrincipalKind = (typeof npAgentRestrictionPrincipalKinds)[number];

export interface NpAgentRestrictionAuthenticatedPrincipalSubjectV1 {
  kind: "authenticated_principal";
  principalKind: NpAgentRestrictionPrincipalKind;
  principalId: string;
}

export interface NpAgentRestrictionOpaqueActorBucketSubjectV1 extends NpAgentActorBucketRefV1 {
  kind: "opaque_actor_bucket";
}

export type NpAgentRestrictionSubjectV1 =
  NpAgentRestrictionAuthenticatedPrincipalSubjectV1 | NpAgentRestrictionOpaqueActorBucketSubjectV1;

export interface NpAgentRestrictionCanonicalV1 {
  schemaVersion: "np.agent-restriction.v1";
  restrictionId: string;
  siteId: string;
  subject: NpAgentRestrictionSubjectV1;
  actionScopes: NpAgentActorRestrictionScope[];
  startsAt: string;
  expiresAt: string;
  reasonCode: NpAgentStableCode;
  targetVersionDigest: string;
}

export type NpAgentRestrictionDescriptorV1 = NpAgentRestrictionCanonicalV1;

export const npAgentProviderDataClasses = [
  "public-only",
  "internal-redacted",
  "sensitive-approved",
] as const;
export type NpAgentProviderDataClass = (typeof npAgentProviderDataClasses)[number];
export const npAgentProviderDataClassRank = {
  "public-only": 0,
  "internal-redacted": 1,
  "sensitive-approved": 2,
} as const satisfies Record<NpAgentProviderDataClass, number>;

export const npAgentRunAdmissionOrigins = ["gateway", "runtime"] as const;
export type NpAgentRunAdmissionOrigin = (typeof npAgentRunAdmissionOrigins)[number];

export const npAgentRunAdmissionPolicyKinds = [
  "agent-policy",
  "feature-setting",
  "framework",
  "site-policy",
] as const;
export type NpAgentRunAdmissionPolicyKind = (typeof npAgentRunAdmissionPolicyKinds)[number];

export const npAgentCausalDepthMaximumV1 = 4;

export interface NpAgentRunAdmissionAgentV1 {
  id: string;
  versionId: string;
  configHash: string;
}

export interface NpAgentRunAdmissionLineageV1 {
  rootRunId: string;
  parentRunId: string | null;
  causalDepth: number;
  causalEventId: string | null;
  causalActionId: string | null;
}

export interface NpAgentRunAdmissionRecipeV1 {
  id: NpAgentRecipeId;
  version: number;
  fingerprint: string;
  instructionTemplateId: string | null;
  instructionTemplateVersion: number | null;
  instructionDigest: string | null;
  responseSchemaDigest: string;
  manualInputSchemaDigest: string | null;
}

export interface NpAgentRunAdmissionPolicyRefV1 {
  kind: NpAgentRunAdmissionPolicyKind;
  id: string | null;
  version: number;
  digest: string;
}

export interface NpAgentRunAdmissionConnectionV1 {
  id: string;
  configSnapshotId: string;
  configVersion: number;
  configHash: string;
  dataClassCeiling: NpAgentProviderDataClass;
  pricingId: string;
  pricingVersion: number;
  pricingFingerprint: string;
  pricingEffectiveAt: string;
}

export interface NpAgentRunAdmissionCanonicalV1 {
  schemaVersion: "np.agent-run-admission.v1";
  siteId: string;
  origin: NpAgentRunAdmissionOrigin;
  principalId: string;
  invocationId: string | null;
  triggerId: string | null;
  agent: NpAgentRunAdmissionAgentV1 | null;
  lineage: NpAgentRunAdmissionLineageV1;
  recipe: NpAgentRunAdmissionRecipeV1 | null;
  goal: string;
  eventRef: NpAgentJsonObject | null;
  policyRefs: NpAgentRunAdmissionPolicyRefV1[];
  runLimitsHash: string;
  budgetSnapshotHash: string;
  idempotencyKey: string;
  connection: NpAgentRunAdmissionConnectionV1 | null;
  admittedAt: string;
  deadlineAt: string;
}

export interface NpAgentRunLimitsV1 {
  schemaVersion: "np.agent-run-limits.v1";
  maxAttempts: number;
  maxProviderCalls: number;
  maxCapabilityCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostMicros: number;
  maxWallClockSeconds: number;
}

export type NpAgentRunLimitsCanonicalV1 = NpAgentRunLimitsV1;

export interface NpAgentStaffSiteAuthorizationCanonicalV1 {
  schemaVersion: "np.agent-staff-site-authorization.v1";
  siteId: string;
  userId: string;
  userTokenVersion: number;
  authority:
    | {
        kind: "super-admin";
        capabilities: NpCapability[];
      }
    | {
        kind: "site-role";
        source: "membership" | "default-site-fallback";
        role: string;
        capabilities: NpCapability[];
      };
}

export interface NpAgentVaultAadCanonicalV1 {
  schemaVersion: "np.agent-vault-aad.v1";
  siteId: string;
  connectionId: string;
  connectionKind: NpAgentConnectionKind;
  purpose: NpAgentConnectionSecretPurpose;
  secretVersionId: string;
  secretVersion: number;
  vaultAdapterId: string;
  vaultAdapterContractVersion: number;
  vaultAdapterFingerprint: string;
  credentialEnvelopeVersion: 1;
  algorithm: NpAgentVaultAlgorithm;
}

export const npAgentCanonicalBodyMaxBytesV1 = {
  "np.agent-action.v1": 4 * 1024 * 1024,
  "np.agent-approval-decision.v1": 64 * 1024,
  "np.agent-approval-revocation.v1": 64 * 1024,
  "np.agent-approval-statement.v1": 256 * 1024,
  "np.agent-artifact.v1": 256 * 1024,
  "np.agent-authorization-context.v1": 64 * 1024,
  "np.agent-budget-snapshot.v1": 256 * 1024,
  "np.agent-capability-registry.v1": 16 * 1024 * 1024,
  "np.agent-changeset-plan.v1": 4 * 1024 * 1024,
  "np.agent-changeset-proposal.v1": 4 * 1024 * 1024,
  "np.agent-changeset-snapshot.v1": 256 * 1024,
  "np.agent-connection-config.v1": 512 * 1024,
  "np.agent-connection-destination.v1": 32 * 1024,
  "np.agent-connection-operation.v1": 64 * 1024,
  "np.agent-effect-profile.v1": 16 * 1024,
  "np.agent-event.v1": 16 * 1024,
  "np.agent-idempotency-request.v1": 4 * 1024 * 1024,
  "np.agent-mcp-task-result.v1": 4 * 1024 * 1024,
  "np.agent-notification-delivery.v1": 256 * 1024,
  "np.agent-policy.v1": 1024 * 1024,
  "np.agent-preview-contract.v1": 64 * 1024,
  "np.agent-preview-routes.v1": 256 * 1024,
  "np.agent-provider-request.v1": 4 * 1024 * 1024,
  "np.agent-provider-response.v1": 4 * 1024 * 1024,
  "np.agent-recipe-registry.v1": 8 * 1024 * 1024,
  "np.agent-restriction.v1": 64 * 1024,
  "np.agent-run-admission.v1": 512 * 1024,
  "np.agent-run-limits.v1": 16 * 1024,
  "np.agent-signal-evidence.v1": 512 * 1024,
  "np.agent-site-deletion-plan.v1": 16 * 1024 * 1024,
  "np.agent-staff-site-authorization.v1": 64 * 1024,
  "np.agent-vault-aad.v1": 16 * 1024,
} as const satisfies Record<NpAgentCanonicalPurposeV1, number>;

export type NpAgentJsonSchema = NpAgentJsonObject & {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  type: "object";
  additionalProperties: false;
};

export type NpAgentCanonicalJsonSchemaV1 = NpAgentJsonSchema;

export const npAgentScopes = [
  "site:read",
  "schema:read",
  "changeset:read",
  "changeset:write",
  "changeset:apply",
  "content:read",
  "content:draft",
  "content:publish",
  "media:read",
  "media:write",
  "navigation:read",
  "navigation:write",
  "theme:read",
  "theme:write",
  "settings:read",
  "settings:write",
  "audit:run",
  "ops:read",
  "ops:plan",
  "ops:execute",
  "incident:read",
  "moderation:execute",
  "security:execute",
] as const;

export type NpAgentScope = (typeof npAgentScopes)[number];

export const npAgentScopeStaffCapability = {
  "site:read": "site.access",
  "schema:read": "site.access",
  "changeset:read": "content.author",
  "changeset:write": "content.author",
  "changeset:apply": "content.publish",
  "content:read": "site.access",
  "content:draft": "content.author",
  "content:publish": "content.publish",
  "media:read": "site.access",
  "media:write": "content.author",
  "navigation:read": "site.access",
  "navigation:write": "admin.manage",
  "theme:read": "site.access",
  "theme:write": "admin.manage",
  "settings:read": "admin.manage",
  "settings:write": "admin.manage",
  "audit:run": "admin.manage",
  "ops:read": "admin.manage",
  "ops:plan": "admin.manage",
  "ops:execute": "admin.manage",
  "incident:read": "admin.manage",
  "moderation:execute": "community.moderate",
  "security:execute": "admin.manage",
} as const satisfies Record<NpAgentScope, NpCapability>;

export const npAgentCapabilityIds = [
  "site.inspect",
  "schema.get",
  "content.query",
  "changeset.create",
  "changeset.validate",
  "changeset.preview",
  "changeset.schedule",
  "changeset.apply",
  "changeset.rollback",
  "changeset.get",
  "changeset.list",
  "audit.run",
  "ops.status",
  "ops.plan",
  "ops.execute",
  "incident.get",
  "incident.list",
  "moderation.quarantine",
  "moderation.restore",
  "security.limitActor",
  "security.revokeSessions",
] as const;

export type NpCoreAgentCapabilityId = (typeof npAgentCapabilityIds)[number];
export type NpAgentCapabilityId = NpCoreAgentCapabilityId;

export const npAgentRecipeIds = [
  "publisher.stale-content",
  "moderator.repeated-link-spam",
  "operator.worker-not-draining",
  "guardian.credential-stuffing",
  "guardian.agent-abuse",
] as const;
export type NpAgentRecipeId = (typeof npAgentRecipeIds)[number];

export const npAgentRecipeTemplates = [
  "publisher",
  "moderator",
  "operator",
  "guardian",
  "custom",
] as const;
export type NpAgentRecipeTemplate = (typeof npAgentRecipeTemplates)[number];

export const npAgentRecipeTasks = [
  "interactive-capability",
  "moderation-classification",
  "guardian-assessment",
] as const;
export type NpAgentRecipeTask = (typeof npAgentRecipeTasks)[number];

export const npAgentRecipeProviderModes = ["required", "optional", "forbidden"] as const;
export type NpAgentRecipeProviderMode = (typeof npAgentRecipeProviderModes)[number];

export const npAgentRecipeTriggerKinds = ["manual", "event", "schedule"] as const;
export type NpAgentRecipeTriggerKind = (typeof npAgentRecipeTriggerKinds)[number];

export const npAgentChangeSetResourceKinds = [
  "document",
  "navigation",
  "theme_tokens",
  "setting",
  "media_ref",
] as const;
export type NpAgentChangeSetResourceKind = (typeof npAgentChangeSetResourceKinds)[number];

export const npAgentMutableSettingKeys = ["seo"] as const;
export type NpAgentMutableSettingKey = (typeof npAgentMutableSettingKeys)[number];

export const npAgentDocumentChangeSetOperations = [
  "create",
  "update",
  "publish",
  "schedule",
  "archive",
] as const;
export type NpAgentDocumentChangeSetOperation = (typeof npAgentDocumentChangeSetOperations)[number];

export const npAgentChangeSetSnapshotPresences = ["present", "absent"] as const;
export type NpAgentChangeSetSnapshotPresence = (typeof npAgentChangeSetSnapshotPresences)[number];

export const npAgentChangeSetPlanKinds = ["changeset", "rollback"] as const;
export type NpAgentChangeSetPlanKind = (typeof npAgentChangeSetPlanKinds)[number];

export const npAgentChangeSetRollbackClasses = ["full", "residual"] as const;
export type NpAgentChangeSetRollbackClass = (typeof npAgentChangeSetRollbackClasses)[number];

export const npAgentRiskLevels = ["low", "medium", "high", "critical"] as const;
export type NpAgentRiskLevel = (typeof npAgentRiskLevels)[number];

export const npAgentRiskReasonCodes = [
  "PUBLIC_WRITE",
  "ARCHIVE",
  "PROTECTED_RESOURCE",
  "MULTI_RESOURCE",
  "OPERATION_VOLUME",
  "NAVIGATION_WRITE",
  "THEME_WRITE",
  "SETTING_WRITE",
  "NON_ATOMIC_SIDE_EFFECT",
  "ROLLBACK_PARTIAL",
] as const;
export type NpAgentRiskReasonCode = (typeof npAgentRiskReasonCodes)[number];

export const npAgentHumanPredicates = ["is-super-admin"] as const;
export type NpAgentHumanPredicate = (typeof npAgentHumanPredicates)[number];

interface NpAgentInvocationRequestCanonicalCommonV1 {
  schemaVersion: "np.agent-idempotency-request.v1";
  siteId: string;
  actorKind: "principal" | "staff";
  actorFingerprint: string;
  authorizationContextFingerprint: string;
  contractVersion: number;
  contractFingerprint: string;
  input: NpAgentJsonObject;
}

export type NpAgentInvocationRequestCanonicalV1 =
  | (NpAgentInvocationRequestCanonicalCommonV1 & {
      operationKind: "capability";
      operationId: NpAgentCapabilityId;
      effectProfile: {
        id: string;
        contractVersion: number;
      };
    })
  | (NpAgentInvocationRequestCanonicalCommonV1 & {
      operationKind: "admin";
      operationId: string;
      effectProfile: null;
    });

export type NpAgentMcpStoredTerminalResultV1 =
  | {
      schemaVersion: "np.agent-mcp-stored-task-result.v1";
      kind: "tool_result";
      result: NpAgentJsonObject;
    }
  | {
      schemaVersion: "np.agent-mcp-stored-task-result.v1";
      kind: "jsonrpc_error";
      error: {
        code: number;
        message: string;
        data?: NpAgentJsonValue;
      };
    };

export const npAgentCapabilityRisks = ["read", "reversible", "sensitive", "destructive"] as const;
export type NpAgentCapabilityRisk = (typeof npAgentCapabilityRisks)[number];

export const npAgentApprovalModes = ["none", "policy", "human"] as const;
export type NpAgentApprovalMode = (typeof npAgentApprovalModes)[number];

export const npAgentGatewayExposureModes = [
  "disabled",
  "read",
  "propose",
  "approved-execute",
] as const;
export type NpAgentGatewayExposureMode = (typeof npAgentGatewayExposureModes)[number];
export type NpAgentEnabledGatewayExposureMode = Exclude<NpAgentGatewayExposureMode, "disabled">;

export const npAgentGatewayTransports = ["stdio", "mcp-http", "agent-http"] as const;
export type NpAgentGatewayTransport = (typeof npAgentGatewayTransports)[number];

export const npAgentGatewayExposureRank = {
  disabled: 0,
  read: 1,
  propose: 2,
  "approved-execute": 3,
} as const satisfies Record<NpAgentGatewayExposureMode, number>;

export const npAgentExecutionModes = ["inline", "durable", "either"] as const;
export type NpAgentExecutionMode = (typeof npAgentExecutionModes)[number];

export const npAgentIdempotencyModes = ["none", "required"] as const;
export type NpAgentIdempotencyMode = (typeof npAgentIdempotencyModes)[number];

export const npAgentScopeDerivations = [
  "none",
  "schema-resource",
  "content-query",
  "changeset-resources",
  "audit-selection",
  "ops-selection",
  "ops-action",
  "incident-target",
  "moderation-target",
  "security-target",
] as const;
export type NpAgentScopeDerivation = (typeof npAgentScopeDerivations)[number];

export const npAgentCapabilityScopeDerivations = {
  "site.inspect": "none",
  "schema.get": "schema-resource",
  "content.query": "content-query",
  "changeset.create": "changeset-resources",
  "changeset.validate": "changeset-resources",
  "changeset.preview": "changeset-resources",
  "changeset.schedule": "changeset-resources",
  "changeset.apply": "changeset-resources",
  "changeset.rollback": "changeset-resources",
  "changeset.get": "changeset-resources",
  "changeset.list": "changeset-resources",
  "audit.run": "audit-selection",
  "ops.status": "ops-selection",
  "ops.plan": "ops-action",
  "ops.execute": "ops-action",
  "incident.get": "incident-target",
  "incident.list": "incident-target",
  "moderation.quarantine": "moderation-target",
  "moderation.restore": "moderation-target",
  "security.limitActor": "security-target",
  "security.revokeSessions": "security-target",
} as const satisfies Record<NpAgentCapabilityId, NpAgentScopeDerivation>;

export interface NpAgentEffectProfileDescriptor {
  id: string;
  kind: "read" | "mutation";
  reversibility: "none" | "compensatable";
  minimumGatewayExposure: NpAgentEnabledGatewayExposureMode | null;
  verifierId: string | null;
  compensatorId: string | null;
}

export interface NpAgentCapabilityDescriptor {
  schemaVersion: "np.agent-capability.v1";
  id: NpAgentCapabilityId;
  contractVersion: 1;
  source: "core" | `app:${string}`;
  title: string;
  description: string;
  requiredScopes: NpAgentScope[];
  scopeDerivation: NpAgentScopeDerivation;
  risk: NpAgentCapabilityRisk;
  approval: NpAgentApprovalMode;
  effectProfiles: NpAgentEffectProfileDescriptor[];
  bootstrapIntent: "plugins" | "write";
  execution: NpAgentExecutionMode;
  idempotency: NpAgentIdempotencyMode;
  gateway: {
    transports: NpAgentGatewayTransport[];
  } | null;
  inputSchema: NpAgentJsonSchema;
  outputSchema: NpAgentJsonSchema;
}

export interface NpAgentGatewaySettingsV1 {
  schemaVersion: "np.agent-gateway-settings.v1";
  stdio: NpAgentGatewayExposureMode;
  mcpHttp: NpAgentGatewayExposureMode;
  agentHttp: NpAgentGatewayExposureMode;
}

export const npAgentMcpToolNames = [
  "inspect_site",
  "query_content",
  "create_changeset",
  "validate_changeset",
  "preview_changeset",
  "schedule_changeset",
  "apply_changeset",
  "rollback_changeset",
  "query_changesets",
  "run_site_audit",
  "get_ops_status",
  "plan_ops_action",
  "execute_approved_action",
  "query_incidents",
  "quarantine_content",
  "restore_content",
  "temporarily_limit_actor",
  "revoke_sessions",
] as const;

export type NpAgentMcpToolName = (typeof npAgentMcpToolNames)[number];

export interface NpAgentMcpToolDefinitionV1 {
  name: NpAgentMcpToolName;
  capabilityIds: NpAgentCapabilityId[];
  listedFrom: NpAgentEnabledGatewayExposureMode;
}

export type NpAgentContractIssueCode =
  | "shape"
  | "unknown-field"
  | "missing-field"
  | "invalid-field"
  | "unsafe-value"
  | "limit"
  | "order"
  | "duplicate";

export interface NpAgentContractIssue {
  code: NpAgentContractIssueCode;
  path: string;
  message: string;
}

export type NpAgentContractResult<T> =
  { ok: true; value: T } | { ok: false; issues: NpAgentContractIssue[] };
