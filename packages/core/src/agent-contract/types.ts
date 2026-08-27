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
] as const satisfies readonly (keyof NpAgentCanonicalPurposeBodyMapV1)[];

export type NpAgentCanonicalPurposeV1 = keyof NpAgentCanonicalPurposeBodyMapV1;
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

export const npAgentExecutableOpsActionIds = [
  "cache.revalidate",
  "agent.run.retry",
  "agent.run.cancel",
] as const;
export type NpAgentExecutableOpsActionId = (typeof npAgentExecutableOpsActionIds)[number];

export const npAgentPlanOnlyOpsActionIds = [
  "migration.plan",
  "restore.plan",
  "storage.migration.plan",
  "plugin.change.plan",
  "queue.global.plan",
] as const;
export type NpAgentPlanOnlyOpsActionId = (typeof npAgentPlanOnlyOpsActionIds)[number];
export type NpAgentOpsPlanActionId = NpAgentExecutableOpsActionId | NpAgentPlanOnlyOpsActionId;

export type NpAgentActorSubjectV1 =
  | {
      kind: "principal";
      principalKind: "staff" | "member" | "agent-gateway";
      principalId: string;
    }
  | ({ kind: "actor-bucket" } & NpAgentActorBucketRefV1);

export type NpAgentTargetRef =
  | { kind: "document"; collection: string; documentId: string }
  | { kind: "media"; mediaId: string }
  | { kind: "navigation"; location: string }
  | { kind: "theme_tokens"; themeId: string }
  | { kind: "setting"; key: string }
  | { kind: "actor"; subject: NpAgentActorSubjectV1 }
  | { kind: "incident"; incidentId: string }
  | { kind: "ops"; action: NpAgentOpsPlanActionId };

export interface NpAgentActionTargetVersionFactV1 {
  targetRef: NpAgentTargetRef;
  versionDigest: string;
}

export interface NpAgentActionCanonicalV1 {
  schemaVersion: "np.agent-action.v1";
  siteId: string;
  actionId: string;
  invocationFingerprint: string;
  runFingerprint: string | null;
  sequence: number;
  capabilityId: NpAgentCapabilityId;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  effectProfile: { id: string; contractVersion: number };
  risk: NpAgentCapabilityRisk;
  requiredScopes: NpAgentScope[];
  targetRefs: NpAgentTargetRef[];
  targetVersionFacts: NpAgentActionTargetVersionFactV1[];
  input: NpAgentJsonObject;
}

export interface NpAgentModelPricingV1 {
  schemaVersion: "np.agent-model-pricing.v1";
  pricingId: string;
  version: number;
  fingerprint: string;
  modelId: string;
  currency: "USD";
  unitTokens: 1_000_000;
  inputMicrosPerUnit: number;
  cachedInputMicrosPerUnit: number;
  outputMicrosPerUnit: number;
  minimumRequestMicros: number;
  rounding: "ceil-each-component";
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface NpAgentConnectionConfigCanonicalV1 {
  schemaVersion: "np.agent-connection-config.v1";
  siteId: string;
  connectionId: string;
  kind: NpAgentConnectionKind;
  provider: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  authKind: "api_key" | "oauth";
  configVersion: number;
  config: NpAgentJsonObject;
  pricingCatalog: NpAgentModelPricingV1[];
  dataProcessingCeiling: NpAgentProviderDataClass;
}

export interface NpAgentConnectionDestinationDescriptorV1 {
  schemaVersion: "np.agent-connection-destination-descriptor.v1";
  kind: "notification";
  adapterId: string;
  descriptor: NpAgentJsonObject;
}

export interface NpAgentConnectionDestinationCanonicalV1 {
  schemaVersion: "np.agent-connection-destination.v1";
  siteId: string;
  connectionId: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  accountSubjectKeyId: string;
  accountSubjectDigest: string;
  destinationDescriptor: NpAgentConnectionDestinationDescriptorV1;
}

export interface NpAgentConnectionDestinationKeyV1 {
  owner: "connection-destination";
  id: string;
  bytes: Uint8Array;
}

export type NpAgentConnectionOperationAuthorityCanonicalV1 =
  | { kind: "admin-invocation"; invocationId: string }
  | { kind: "oauth-setup"; authRequestId: string }
  | { kind: "runtime-refresh"; runId: string };

export const npAgentConnectionOperationKinds = [
  "probe",
  "activate-secret",
  "activate-config",
  "oauth-exchange",
  "oauth-refresh",
  "destroy-secret",
] as const;
export type NpAgentConnectionOperationKind = (typeof npAgentConnectionOperationKinds)[number];

export interface NpAgentConnectionOperationRequestCanonicalV1 {
  schemaVersion: "np.agent-connection-operation.v1";
  siteId: string;
  operationId: string;
  connectionId: string;
  authority: NpAgentConnectionOperationAuthorityCanonicalV1;
  kind: NpAgentConnectionOperationKind;
  expectedConfigVersion: number;
  expectedConfigHash: string;
  configSnapshotId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  inputSecretVersionIds: string[];
  expectedSecretVersionId: string | null;
  expectedCredentialVersion: number | null;
  expectedRefreshGeneration: number | null;
  idempotencyKey: string;
}

export type NpAgentSubject =
  | { kind: "document"; collection: string; documentId: string }
  | { kind: "comment"; commentId: string; collection: string; documentId: string }
  | { kind: "member"; memberId: string }
  | { kind: "staff"; userId: string }
  | { kind: "session"; actorKind: "staff" | "member"; sessionFamilyId: string }
  | ({ kind: "actor-bucket" } & NpAgentActorBucketRefV1)
  | { kind: "job"; jobName: string; jobId: string }
  | { kind: "plugin"; pluginId: string }
  | { kind: "connection"; connectionId: string }
  | { kind: "agent"; agentId: string; agentVersionId: string | null }
  | { kind: "site"; siteId: string };

export type NpAgentActorProjection =
  | { kind: "staff"; userId: string }
  | { kind: "member"; memberId: string }
  | { kind: "agent-principal"; principalId: string }
  | { kind: "system"; component: string }
  | ({ kind: "anonymous" } & NpAgentActorBucketRefV1);

export interface NpAgentEventCausationV1 {
  rootRunId: string;
  sourceRunId: string;
  sourceActionId: string;
  depth: number;
}

export const npAgentRunStates = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_retry",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "policy_blocked",
  "budget_blocked",
] as const;
export type NpAgentRunState = (typeof npAgentRunStates)[number];

export const npAgentActionStates = [
  "proposed",
  "policy_blocked",
  "approval_pending",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "compensated",
] as const;
export type NpAgentActionState = (typeof npAgentActionStates)[number];

export const npAgentIncidentCategories = [
  "spam",
  "abuse",
  "authentication",
  "authorization",
  "traffic",
  "integrity",
  "availability",
  "cost",
  "agent-abuse",
] as const;
export type NpAgentIncidentCategory = (typeof npAgentIncidentCategories)[number];

export const npAgentIncidentSeverities = ["info", "low", "medium", "high", "critical"] as const;
export type NpAgentIncidentSeverity = (typeof npAgentIncidentSeverities)[number];
export const npAgentIncidentSeverityRank = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
} as const satisfies Record<NpAgentIncidentSeverity, number>;

export type NpAgentEventPayload =
  | {
      kind: "auth.login.failed";
      audience: "staff" | "member";
      outcome: "failed";
      reasonCode: NpAgentStableCode;
      sessionFamilyId: string | null;
      ipBucket: NpAgentActorBucketRefV1 & { purpose: "network-address" };
      userAgentFamily: string | null;
    }
  | {
      kind: "auth.login.succeeded";
      audience: "staff" | "member";
      outcome: "succeeded";
      reasonCode: NpAgentStableCode;
      sessionFamilyId: string;
      ipBucket: NpAgentActorBucketRefV1 & { purpose: "network-address" };
      userAgentFamily: string | null;
    }
  | {
      kind: "auth.session.revoked";
      audience: "staff" | "member";
      sessionFamilyId: string;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "authz.denied";
      capabilityCode: string;
      resourceKind: string;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "authz.role.changed";
      actorKind: "staff" | "member";
      actorId: string;
      previousRole: string;
      currentRole: string;
    }
  | {
      kind:
        "community.content.created" | "community.content.reported" | "community.content.moderated";
      targetKind: "comment" | "document";
      targetId: string;
      collection: string;
      authorMemberId: string | null;
      verdictCode: NpAgentStableCode | null;
      status: "visible" | "quarantined" | "hidden" | "deleted";
    }
  | {
      kind: "content.document.changed" | "content.document.published";
      collection: string;
      documentId: string;
      transition: NpAgentStableCode;
      revisionId: string;
    }
  | {
      kind: "jobs.handler.failed";
      handlerName: string;
      jobId: string;
      reasonCode: NpAgentStableCode;
    }
  | { kind: "jobs.worker.stale"; workerId: string; lastHeartbeatAt: string }
  | { kind: "jobs.backlog.threshold"; handlerName: string; countBucket: number; threshold: number }
  | {
      kind: "ops.check.changed";
      checkId: string;
      previousStatus: "pass" | "warn" | "fail" | "unknown";
      currentStatus: "pass" | "warn" | "fail" | "unknown";
    }
  | {
      kind: "ops.backup.failed" | "ops.backup.stale";
      artifactId: string | null;
      reasonCode: NpAgentStableCode;
    }
  | {
      kind: "security.edge.signal" | "security.error.signal";
      adapterId: string;
      externalSignalId: string;
      category: NpAgentIncidentCategory;
      severity: NpAgentIncidentSeverity;
      count: number;
    }
  | {
      kind: "agent.run.changed";
      agentId: string | null;
      runId: string;
      previousState: NpAgentRunState | null;
      currentState: NpAgentRunState;
      reasonCode: NpAgentStableCode | null;
    }
  | {
      kind: "agent.action.changed";
      runId: string | null;
      actionId: string;
      previousState: NpAgentActionState | null;
      currentState: NpAgentActionState;
      reasonCode: NpAgentStableCode | null;
    }
  | {
      kind: "agent.policy.blocked";
      agentId: string | null;
      runId: string | null;
      capabilityId: NpAgentCapabilityId | null;
      reasonCode: NpAgentStableCode;
    };

export type NpAgentEventKind = NpAgentEventPayload["kind"];
export const npAgentEventKinds = [
  "agent.action.changed",
  "agent.policy.blocked",
  "agent.run.changed",
  "auth.login.failed",
  "auth.login.succeeded",
  "auth.session.revoked",
  "authz.denied",
  "authz.role.changed",
  "community.content.created",
  "community.content.moderated",
  "community.content.reported",
  "content.document.changed",
  "content.document.published",
  "jobs.backlog.threshold",
  "jobs.handler.failed",
  "jobs.worker.stale",
  "ops.backup.failed",
  "ops.backup.stale",
  "ops.check.changed",
  "security.edge.signal",
  "security.error.signal",
] as const satisfies readonly NpAgentEventKind[];

export interface NpAgentEventCanonicalV1 {
  version: "np.agent-event.v1";
  siteId: string;
  kind: NpAgentEventKind;
  occurredAt: string;
  source: {
    kind:
      | "auth"
      | "api"
      | "community"
      | "content"
      | "jobs"
      | "ops"
      | "storage"
      | "plugin"
      | "integration"
      | "agent";
    component: string;
  };
  subject: NpAgentSubject | null;
  actor: NpAgentActorProjection | null;
  causation: NpAgentEventCausationV1 | null;
  correlationId: string | null;
  deduplicationKey: string | null;
  privacy: "public" | "internal" | "sensitive";
  payload: NpAgentEventPayload;
}

export type NpAgentEvidenceRef = {
  observedAt: string;
  digest: string;
  excerpt: string | null;
} & (
  | { kind: "event"; eventId: string; eventKind: NpAgentEventKind }
  | { kind: "revision"; collection: string; documentId: string; revisionId: string }
  | { kind: "job"; jobName: string; jobId: string }
  | { kind: "ops-check"; checkId: string }
  | { kind: "external-signal"; adapterId: string; externalSignalId: string }
);

export interface NpAgentSignalEvidenceCanonicalV1 {
  schemaVersion: "np.agent-signal-evidence.v1";
  siteId: string;
  detectorId: string;
  detectorVersion: number;
  category: NpAgentIncidentCategory;
  window: { startedAt: string; endedAt: string };
  subject: NpAgentSubject | null;
  evidence: NpAgentEvidenceRef[];
}

export type NpAgentNotificationChannel = "admin" | "email" | "slack" | "webhook" | "siem";
export interface NpAgentNotificationSourceV1 {
  incidentId: string | null;
  runId: string | null;
  actionId: string | null;
  transitionVersion: number;
}

export type NpAgentNotificationDeliveryCanonicalV1 =
  | {
      schemaVersion: "np.agent-notification-delivery.v1";
      siteId: string;
      notificationId: string;
      channel: "admin";
      source: NpAgentNotificationSourceV1;
      deduplicationKey: string;
      payloadRedacted: NpAgentJsonObject;
      attempt: 0;
      result: { state: "confirmed_local" };
      observedAt: string;
    }
  | {
      schemaVersion: "np.agent-notification-delivery.v1";
      siteId: string;
      notificationId: string;
      channel: Exclude<NpAgentNotificationChannel, "admin">;
      source: NpAgentNotificationSourceV1;
      deduplicationKey: string;
      payloadRedacted: NpAgentJsonObject;
      attempt: number;
      adapter: {
        id: string;
        contractVersion: number;
        fingerprint: string;
        idempotency: "enforced" | "none";
      };
      connection: {
        id: string;
        configSnapshotId: string;
        configVersion: number;
        configHash: string;
        accountSubjectKeyId: string;
        accountSubjectDigest: string;
        destinationKeyId: string;
        destinationFingerprint: string;
      };
      result:
        | { state: "confirmed" }
        | { state: "retryable_not_sent"; errorCode: string }
        | { state: "permanent_failure"; errorCode: string }
        | { state: "ambiguous"; errorCode: string };
      observedAt: string;
    };

export const npAgentAutonomyModes = ["observe", "advise", "guarded", "approved"] as const;
export type NpAgentAutonomyMode = (typeof npAgentAutonomyModes)[number];
export interface NpAgentCapabilityModeV1 {
  capabilityId: NpAgentCapabilityId;
  mode: NpAgentAutonomyMode;
}

export interface NpAgentPolicyRulesV1 {
  schemaVersion: "np.agent-policy-rules.v1";
  capabilityModes: NpAgentCapabilityModeV1[];
  resources: {
    collections: string[] | null;
    navigationLocations: string[] | null;
    themeIds: string[] | null;
    settingKeys: string[] | null;
    incidentCategories: NpAgentIncidentCategory[] | null;
    actorRestrictionScopes: NpAgentActorRestrictionScope[] | null;
  };
  risk: {
    automaticActionMaximum: "read" | "reversible";
    requirePreviewAtOrAbove: "reversible" | "sensitive" | "destructive" | null;
    requireRecentAuthAtOrAbove: "reversible" | "sensitive" | "destructive" | null;
  };
  providerDataMaximum: NpAgentProviderDataClass;
  automation: {
    quietHoursUtc: Array<{ startMinute: number; endMinute: number }>;
    moderationAutoQuarantineMinBasisPoints: number | null;
    moderationTargetsPerRun: number;
    guardianLimitActorMinSeverity: "high" | "critical" | null;
    guardianRestrictionTtlSeconds: number;
  };
  escalation: {
    minimumSeverity: NpAgentIncidentSeverity;
    channels: NpAgentNotificationChannel[];
  };
  retentionDays: {
    events: number;
    signals: number;
    runDetails: number;
    incidentsAndActions: number;
  };
}

export interface NpAgentPolicyCanonicalV1 {
  schemaVersion: "np.agent-policy.v1";
  instructions: string;
  rules: NpAgentPolicyRulesV1;
}

export interface NpAgentProviderContextClassificationV1 {
  dataClass: NpAgentProviderDataClass;
  classifierId: string;
  classifierVersion: number;
  sourceDigest: string;
}

export interface NpAgentProviderUsageV1 {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  tokenSource: "provider" | "adapter-estimate";
  costMicros: number;
  costSource: "provider" | "adapter-estimate";
}

export type NpAgentProviderInvokeOutcomeV1 =
  | {
      schemaVersion: "np.agent-provider-invoke-outcome.v1";
      status: "succeeded";
      provider: string;
      model: string;
      providerRequestId: string | null;
      output: NpAgentJsonValue;
      usage: NpAgentProviderUsageV1;
      finishReason: "stop" | "length" | "tool";
      latencyMs: number;
    }
  | {
      schemaVersion: "np.agent-provider-invoke-outcome.v1";
      status: "failed";
      provider: string;
      model: string;
      providerRequestId: string | null;
      output: null;
      errorClass:
        | "authentication"
        | "rate-limited"
        | "transient"
        | "timeout"
        | "invalid-request"
        | "invalid-output"
        | "content-policy"
        | "cancelled"
        | "unknown";
      safeCode: string;
      retryable: boolean;
      dispatchState: "not-dispatched" | "dispatched";
      usage: NpAgentProviderUsageV1 | null;
      finishReason: "content-filter" | "cancelled" | null;
      latencyMs: number;
    }
  | {
      schemaVersion: "np.agent-provider-invoke-outcome.v1";
      status: "ambiguous";
      provider: string;
      model: string;
      providerRequestId: string | null;
      output: null;
      errorClass: "timeout" | "unknown";
      safeCode: string;
      retryable: false;
      dispatchState: "unknown";
      usage: null;
      finishReason: null;
      latencyMs: number;
    };

export type NpAgentEvidenceRequest =
  | {
      kind: "document";
      collection: string;
      documentId: string;
      projection: "metadata" | "bounded-text" | "schema";
    }
  | {
      kind: "incident";
      incidentId: string;
      projection: "signals" | "timeline" | "subject-state";
    }
  | { kind: "run"; runId: string; projection: "summary" | "actions" | "checks" }
  | { kind: "ops-check"; checkId: string };

export type NpAgentInteractiveDecisionV1 =
  | { kind: "complete"; summary: string }
  | {
      kind: "propose-capability";
      capabilityId: NpAgentCapabilityId;
      arguments: NpAgentJsonObject;
      rationale: string;
    }
  | { kind: "request-evidence"; resource: NpAgentEvidenceRequest };

export const npAgentModerationReasonCodes = [
  "duplicate-link-burst",
  "repeated-template",
  "malicious-destination",
  "account-velocity",
  "coordinated-pattern",
  "abusive-language",
  "policy-evasion",
  "insufficient-evidence",
] as const;
export type NpAgentModerationReasonCode = (typeof npAgentModerationReasonCodes)[number];

export type NpAgentModerationDecisionV1 =
  | { kind: "request-evidence"; resource: NpAgentEvidenceRequest }
  | {
      kind: "classification";
      label: "spam" | "abuse" | "benign" | "uncertain";
      confidenceBasisPoints: number;
      reasonCodes: NpAgentModerationReasonCode[];
      evidenceDigests: string[];
      summary: string;
    };

export const npAgentGuardianAssessmentCodes = [
  "credential-stuffing-pattern",
  "authorization-probing",
  "traffic-anomaly",
  "content-integrity-anomaly",
  "availability-degradation",
  "agent-policy-abuse",
  "inconclusive",
] as const;
export type NpAgentGuardianAssessmentCode = (typeof npAgentGuardianAssessmentCodes)[number];

export type NpAgentGuardianDecisionV1 =
  | { kind: "request-evidence"; resource: NpAgentEvidenceRequest }
  | {
      kind: "assessment";
      disposition: "consistent" | "inconclusive" | "unlikely";
      confidenceBasisPoints: number;
      assessmentCodes: NpAgentGuardianAssessmentCode[];
      evidenceDigests: string[];
      summary: string;
    };

export type NpAgentProviderTaskOutputV1 =
  | { task: "interactive-capability"; decision: NpAgentInteractiveDecisionV1 }
  | { task: "moderation-classification"; decision: NpAgentModerationDecisionV1 }
  | { task: "guardian-assessment"; decision: NpAgentGuardianDecisionV1 };

export interface NpAgentProviderRequestCanonicalV1 {
  schemaVersion: "np.agent-provider-request.v1";
  siteId: string;
  providerCallId: string;
  runId: string;
  sequence: number;
  retryOfId: string | null;
  idempotencyKey: string;
  connection: {
    id: string;
    configSnapshotId: string;
    configVersion: number;
    configHash: string;
    secretVersionId: string;
    credentialVersion: number;
    adapterId: string;
    adapterContractVersion: number;
    adapterFingerprint: string;
  };
  provider: string;
  model: string;
  recipe: { id: NpAgentRecipeId; version: number; fingerprint: string };
  task: NpAgentRecipeTask;
  instruction: {
    templateId: string;
    templateVersion: number;
    digest: string;
    classification: NpAgentProviderContextClassificationV1;
    text: string;
  };
  trustedContext: Array<{
    id: string;
    kind: "policy" | "schema" | "capability" | "server-fact";
    digest: string;
    classification: NpAgentProviderContextClassificationV1;
    text: string;
  }>;
  untrustedEvidence: Array<{
    id: string;
    kind: "content" | "event" | "signal" | "incident" | "ops-check";
    digest: string;
    observedAt: string;
    classification: NpAgentProviderContextClassificationV1;
    text: string;
  }>;
  classificationManifestDigest: string;
  responseSchema: NpAgentJsonSchema;
  responseSchemaDigest: string;
  responseSchemaClassification: NpAgentProviderContextClassificationV1;
  tools: Array<{
    capabilityId: NpAgentCapabilityId;
    descriptorFingerprint: string;
    classification: NpAgentProviderContextClassificationV1;
    inputSchema: NpAgentJsonSchema;
  }>;
  limits: { maxInputTokens: number; maxOutputTokens: number; timeoutSeconds: number };
  pricing: NpAgentModelPricingV1;
  dataClass: NpAgentProviderDataClass;
  dataClassCeiling: NpAgentProviderDataClass;
}

export interface NpAgentProviderResponseCanonicalV1 {
  schemaVersion: "np.agent-provider-response.v1";
  siteId: string;
  providerCallId: string;
  runId: string;
  requestDigest: string;
  dispatchState: "not-dispatched" | "dispatched" | "unknown";
  outcome: NpAgentProviderInvokeOutcomeV1;
  decision: NpAgentProviderTaskOutputV1 | null;
  observedAt: string;
}

export const npAgentSiteDeletionExternalTargetKinds = [
  "restriction",
  "vault-operation",
  "connection-operation",
  "preview-artifact-upload",
  "preview-artifact-delete",
] as const;
export type NpAgentSiteDeletionExternalTargetKind =
  (typeof npAgentSiteDeletionExternalTargetKinds)[number];

export interface NpAgentSiteDeletionRowInventoryCanonicalV1 {
  table: string;
  count: number;
  identityDigest: string;
}

export type NpAgentSiteDeletionExternalTargetCanonicalV1 =
  | {
      kind: "restriction";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "vault-operation";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "connection-operation";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "preview-artifact-upload";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    }
  | {
      kind: "preview-artifact-delete";
      targetId: string;
      requestDigest: string;
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      idempotencyKey: string;
    };

export interface NpAgentSiteDeletionPlanCanonicalV1 {
  schemaVersion: "np.agent-site-deletion-plan.v1";
  inventoryVersion: 1;
  sagaId: string;
  siteId: string;
  siteVersionDigest: string;
  preparedAt: string;
  rowInventory: NpAgentSiteDeletionRowInventoryCanonicalV1[];
  externalTargets: NpAgentSiteDeletionExternalTargetCanonicalV1[];
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

export interface NpAgentCanonicalPurposeBodyMapV1 {
  "np.agent-action.v1": NpAgentActionCanonicalV1;
  "np.agent-approval-decision.v1": NpAgentApprovalDecisionCanonicalV1;
  "np.agent-approval-revocation.v1": NpAgentApprovalRevocationCanonicalV1;
  "np.agent-approval-statement.v1": NpAgentApprovalStatementCanonicalV1;
  "np.agent-artifact.v1": NpAgentPreviewArtifactManifestV1;
  "np.agent-authorization-context.v1": NpAgentAuthorizationContextCanonicalV1;
  "np.agent-budget-snapshot.v1": NpAgentBudgetSnapshotCanonicalV1;
  "np.agent-capability-registry.v1": NpAgentCapabilityRegistryCanonicalV1;
  "np.agent-changeset-plan.v1": NpAgentChangeSetPlanCanonicalV1;
  "np.agent-changeset-proposal.v1": NpAgentChangeSetProposalCanonicalV1;
  "np.agent-changeset-snapshot.v1": NpAgentChangeSetSnapshotCanonicalV1;
  "np.agent-connection-config.v1": NpAgentConnectionConfigCanonicalV1;
  "np.agent-connection-destination.v1": NpAgentConnectionDestinationCanonicalV1;
  "np.agent-connection-operation.v1": NpAgentConnectionOperationRequestCanonicalV1;
  "np.agent-effect-profile.v1": NpAgentEffectProfileCanonicalV1;
  "np.agent-event.v1": NpAgentEventCanonicalV1;
  "np.agent-idempotency-request.v1": NpAgentInvocationRequestCanonicalV1;
  "np.agent-mcp-task-result.v1": NpAgentMcpStoredTerminalResultV1;
  "np.agent-notification-delivery.v1": NpAgentNotificationDeliveryCanonicalV1;
  "np.agent-policy.v1": NpAgentPolicyCanonicalV1;
  "np.agent-preview-contract.v1": NpAgentPreviewContractCanonicalV1;
  "np.agent-preview-routes.v1": NpAgentPreviewRoutesCanonicalV1;
  "np.agent-provider-request.v1": NpAgentProviderRequestCanonicalV1;
  "np.agent-provider-response.v1": NpAgentProviderResponseCanonicalV1;
  "np.agent-recipe-registry.v1": NpAgentRecipeRegistryCanonicalV1;
  "np.agent-restriction.v1": NpAgentRestrictionCanonicalV1;
  "np.agent-run-admission.v1": NpAgentRunAdmissionCanonicalV1;
  "np.agent-run-limits.v1": NpAgentRunLimitsCanonicalV1;
  "np.agent-signal-evidence.v1": NpAgentSignalEvidenceCanonicalV1;
  "np.agent-site-deletion-plan.v1": NpAgentSiteDeletionPlanCanonicalV1;
  "np.agent-staff-site-authorization.v1": NpAgentStaffSiteAuthorizationCanonicalV1;
  "np.agent-vault-aad.v1": NpAgentVaultAadCanonicalV1;
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

/** Missing site intent resolves to this dark-launch posture. */
export const npAgentDisabledGatewaySettingsV1: NpAgentGatewaySettingsV1 = Object.freeze({
  schemaVersion: "np.agent-gateway-settings.v1",
  stdio: "disabled",
  mcpHttp: "disabled",
  agentHttp: "disabled",
});

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
