import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentActionCanonicalExcludedKeysV1,
  npAgentActionCanonicalIncludedKeysV1,
  npAnalyzeAgentActionCanonical,
} from "./canonical-action.js";
import {
  npAgentApprovalDecisionCanonicalExcludedKeysV1,
  npAgentApprovalDecisionCanonicalIncludedKeysV1,
  npAgentApprovalRevocationCanonicalExcludedKeysV1,
  npAgentApprovalRevocationCanonicalIncludedKeysV1,
  npAgentApprovalStatementCanonicalExcludedKeysV1,
  npAgentApprovalStatementCanonicalIncludedKeysV1,
  npAnalyzeAgentApprovalDecisionCanonical,
  npAnalyzeAgentApprovalRevocationCanonical,
  npAnalyzeAgentApprovalStatementCanonical,
} from "./canonical-approval.js";
import {
  npAgentAuthorizationContextCanonicalExcludedKeysV1,
  npAgentAuthorizationContextCanonicalIncludedKeysV1,
  npAnalyzeAgentAuthorizationContextCanonical,
} from "./canonical-authorization-context.js";
import {
  npAgentEffectProfileCanonicalExcludedKeysV1,
  npAgentEffectProfileCanonicalIncludedKeysV1,
  npAgentStaffSiteAuthorizationCanonicalExcludedKeysV1,
  npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1,
  npAgentVaultAadCanonicalExcludedKeysV1,
  npAgentVaultAadCanonicalIncludedKeysV1,
  npAnalyzeAgentEffectProfileCanonical,
  npAnalyzeAgentRunLimitsCanonical,
  npAnalyzeAgentStaffSiteAuthorizationCanonical,
  npAnalyzeAgentVaultAadCanonical,
} from "./canonical-bodies.js";
import {
  npAgentBudgetSnapshotCanonicalExcludedKeysV1,
  npAgentBudgetSnapshotCanonicalIncludedKeysV1,
  npAnalyzeAgentBudgetSnapshotCanonical,
} from "./canonical-budget-snapshot.js";
import {
  npAgentCapabilityRegistryCanonicalExcludedKeysV1,
  npAgentCapabilityRegistryCanonicalIncludedKeysV1,
  npAnalyzeAgentCapabilityRegistryCanonical,
} from "./canonical-capability-registry.js";
import {
  npAgentChangeSetPlanCanonicalExcludedKeysV1,
  npAgentChangeSetPlanCanonicalIncludedKeysV1,
  npAgentChangeSetProposalCanonicalExcludedKeysV1,
  npAgentChangeSetProposalCanonicalIncludedKeysV1,
  npAgentChangeSetSnapshotCanonicalExcludedKeysV1,
  npAgentChangeSetSnapshotCanonicalIncludedKeysV1,
  npAnalyzeAgentChangeSetPlanCanonical,
  npAnalyzeAgentChangeSetProposalCanonical,
  npAnalyzeAgentChangeSetSnapshotCanonical,
} from "./canonical-changeset.js";
import {
  npAgentConnectionConfigCanonicalExcludedKeysV1,
  npAgentConnectionConfigCanonicalIncludedKeysV1,
  npAgentConnectionDestinationCanonicalExcludedKeysV1,
  npAgentConnectionDestinationCanonicalIncludedKeysV1,
  npAgentConnectionOperationCanonicalExcludedKeysV1,
  npAgentConnectionOperationCanonicalIncludedKeysV1,
  npAnalyzeAgentConnectionConfigCanonical,
  npAnalyzeAgentConnectionDestinationCanonical,
  npAnalyzeAgentConnectionOperationCanonical,
} from "./canonical-connections.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  npAgentEventCanonicalExcludedKeysV1,
  npAgentEventCanonicalIncludedKeysV1,
  npAgentSignalEvidenceCanonicalExcludedKeysV1,
  npAgentSignalEvidenceCanonicalIncludedKeysV1,
  npAnalyzeAgentEventCanonical,
  npAnalyzeAgentSignalEvidenceCanonical,
} from "./canonical-events.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  npAgentInvocationRequestCanonicalExcludedKeysV1,
  npAgentInvocationRequestCanonicalIncludedKeysV1,
  npAnalyzeAgentInvocationRequestCanonical,
} from "./canonical-idempotency-request.js";
import {
  npAgentMcpTaskResultCanonicalExcludedKeysV1,
  npAgentMcpTaskResultCanonicalIncludedKeysV1,
  npAnalyzeAgentMcpStoredTerminalResult,
} from "./canonical-mcp-task-result.js";
import {
  npAgentNotificationDeliveryCanonicalExcludedKeysV1,
  npAgentNotificationDeliveryCanonicalIncludedKeysV1,
  npAgentPolicyCanonicalExcludedKeysV1,
  npAgentPolicyCanonicalIncludedKeysV1,
  npAnalyzeAgentNotificationDeliveryCanonical,
  npAnalyzeAgentPolicyCanonical,
} from "./canonical-notification-policy.js";
import {
  npAgentPreviewArtifactManifestCanonicalExcludedKeysV1,
  npAgentPreviewArtifactManifestCanonicalIncludedKeysV1,
  npAnalyzeAgentPreviewArtifactManifestCanonical,
} from "./canonical-preview-artifact.js";
import {
  npAgentPreviewContractCanonicalExcludedKeysV1,
  npAgentPreviewContractCanonicalIncludedKeysV1,
  npAgentPreviewRoutesCanonicalExcludedKeysV1,
  npAgentPreviewRoutesCanonicalIncludedKeysV1,
  npAnalyzeAgentPreviewContractCanonical,
  npAnalyzeAgentPreviewRoutesCanonical,
} from "./canonical-preview.js";
import {
  npAgentProviderRequestCanonicalExcludedKeysV1,
  npAgentProviderRequestCanonicalIncludedKeysV1,
  npAgentProviderResponseCanonicalExcludedKeysV1,
  npAgentProviderResponseCanonicalIncludedKeysV1,
  npAnalyzeAgentProviderRequestCanonical,
  npAnalyzeAgentProviderResponseCanonical,
} from "./canonical-provider.js";
import {
  npAgentRecipeRegistryCanonicalExcludedKeysV1,
  npAgentRecipeRegistryCanonicalIncludedKeysV1,
  npAnalyzeAgentRecipeRegistryCanonical,
} from "./canonical-recipe-registry.js";
import {
  npAgentRestrictionCanonicalExcludedKeysV1,
  npAgentRestrictionCanonicalIncludedKeysV1,
  npAnalyzeAgentRestrictionCanonical,
} from "./canonical-restriction.js";
import {
  npAgentRunAdmissionCanonicalExcludedKeysV1,
  npAgentRunAdmissionCanonicalIncludedKeysV1,
  npAnalyzeAgentRunAdmissionCanonical,
} from "./canonical-run-admission.js";
import {
  npAgentRunLimitsCanonicalExcludedKeysV1,
  npAgentRunLimitsCanonicalIncludedKeysV1,
} from "./canonical-run-limits-values.js";
import {
  npAgentSiteDeletionPlanCanonicalExcludedKeysV1,
  npAgentSiteDeletionPlanCanonicalIncludedKeysV1,
  npAnalyzeAgentSiteDeletionPlanCanonical,
} from "./canonical-site-deletion-plan.js";
import {
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentCanonicalPurposeBodyMapV1,
  type NpAgentCanonicalPurposeV1,
  type NpAgentCanonicalShaPurposeV1,
  type NpAgentContractResult,
} from "./types.js";

type NpAgentCanonicalPurposeAnalyzerMapV1 = {
  [P in NpAgentCanonicalPurposeV1]: (
    value: unknown,
  ) => NpAgentContractResult<NpAgentCanonicalPurposeBodyMapV1[P]>;
};

export const npAgentCanonicalPurposeAnalyzersV1 = {
  "np.agent-action.v1": npAnalyzeAgentActionCanonical,
  "np.agent-approval-decision.v1": npAnalyzeAgentApprovalDecisionCanonical,
  "np.agent-approval-revocation.v1": npAnalyzeAgentApprovalRevocationCanonical,
  "np.agent-approval-statement.v1": npAnalyzeAgentApprovalStatementCanonical,
  "np.agent-artifact.v1": npAnalyzeAgentPreviewArtifactManifestCanonical,
  "np.agent-authorization-context.v1": npAnalyzeAgentAuthorizationContextCanonical,
  "np.agent-budget-snapshot.v1": npAnalyzeAgentBudgetSnapshotCanonical,
  "np.agent-capability-registry.v1": npAnalyzeAgentCapabilityRegistryCanonical,
  "np.agent-changeset-plan.v1": npAnalyzeAgentChangeSetPlanCanonical,
  "np.agent-changeset-proposal.v1": npAnalyzeAgentChangeSetProposalCanonical,
  "np.agent-changeset-snapshot.v1": npAnalyzeAgentChangeSetSnapshotCanonical,
  "np.agent-connection-config.v1": npAnalyzeAgentConnectionConfigCanonical,
  "np.agent-connection-destination.v1": npAnalyzeAgentConnectionDestinationCanonical,
  "np.agent-connection-operation.v1": npAnalyzeAgentConnectionOperationCanonical,
  "np.agent-effect-profile.v1": npAnalyzeAgentEffectProfileCanonical,
  "np.agent-event.v1": npAnalyzeAgentEventCanonical,
  "np.agent-idempotency-request.v1": npAnalyzeAgentInvocationRequestCanonical,
  "np.agent-mcp-task-result.v1": npAnalyzeAgentMcpStoredTerminalResult,
  "np.agent-notification-delivery.v1": npAnalyzeAgentNotificationDeliveryCanonical,
  "np.agent-policy.v1": npAnalyzeAgentPolicyCanonical,
  "np.agent-preview-contract.v1": npAnalyzeAgentPreviewContractCanonical,
  "np.agent-preview-routes.v1": npAnalyzeAgentPreviewRoutesCanonical,
  "np.agent-provider-request.v1": npAnalyzeAgentProviderRequestCanonical,
  "np.agent-provider-response.v1": npAnalyzeAgentProviderResponseCanonical,
  "np.agent-recipe-registry.v1": npAnalyzeAgentRecipeRegistryCanonical,
  "np.agent-restriction.v1": npAnalyzeAgentRestrictionCanonical,
  "np.agent-run-admission.v1": npAnalyzeAgentRunAdmissionCanonical,
  "np.agent-run-limits.v1": npAnalyzeAgentRunLimitsCanonical,
  "np.agent-signal-evidence.v1": npAnalyzeAgentSignalEvidenceCanonical,
  "np.agent-site-deletion-plan.v1": npAnalyzeAgentSiteDeletionPlanCanonical,
  "np.agent-staff-site-authorization.v1": npAnalyzeAgentStaffSiteAuthorizationCanonical,
  "np.agent-vault-aad.v1": npAnalyzeAgentVaultAadCanonical,
} as const satisfies NpAgentCanonicalPurposeAnalyzerMapV1;

export const npAgentCanonicalPurposeIncludedKeysV1 = {
  "np.agent-action.v1": npAgentActionCanonicalIncludedKeysV1,
  "np.agent-approval-decision.v1": npAgentApprovalDecisionCanonicalIncludedKeysV1,
  "np.agent-approval-revocation.v1": npAgentApprovalRevocationCanonicalIncludedKeysV1,
  "np.agent-approval-statement.v1": npAgentApprovalStatementCanonicalIncludedKeysV1,
  "np.agent-artifact.v1": npAgentPreviewArtifactManifestCanonicalIncludedKeysV1,
  "np.agent-authorization-context.v1": npAgentAuthorizationContextCanonicalIncludedKeysV1,
  "np.agent-budget-snapshot.v1": npAgentBudgetSnapshotCanonicalIncludedKeysV1,
  "np.agent-capability-registry.v1": npAgentCapabilityRegistryCanonicalIncludedKeysV1,
  "np.agent-changeset-plan.v1": npAgentChangeSetPlanCanonicalIncludedKeysV1,
  "np.agent-changeset-proposal.v1": npAgentChangeSetProposalCanonicalIncludedKeysV1,
  "np.agent-changeset-snapshot.v1": npAgentChangeSetSnapshotCanonicalIncludedKeysV1,
  "np.agent-connection-config.v1": npAgentConnectionConfigCanonicalIncludedKeysV1,
  "np.agent-connection-destination.v1": npAgentConnectionDestinationCanonicalIncludedKeysV1,
  "np.agent-connection-operation.v1": npAgentConnectionOperationCanonicalIncludedKeysV1,
  "np.agent-effect-profile.v1": npAgentEffectProfileCanonicalIncludedKeysV1,
  "np.agent-event.v1": npAgentEventCanonicalIncludedKeysV1,
  "np.agent-idempotency-request.v1": npAgentInvocationRequestCanonicalIncludedKeysV1,
  "np.agent-mcp-task-result.v1": npAgentMcpTaskResultCanonicalIncludedKeysV1,
  "np.agent-notification-delivery.v1": npAgentNotificationDeliveryCanonicalIncludedKeysV1,
  "np.agent-policy.v1": npAgentPolicyCanonicalIncludedKeysV1,
  "np.agent-preview-contract.v1": npAgentPreviewContractCanonicalIncludedKeysV1,
  "np.agent-preview-routes.v1": npAgentPreviewRoutesCanonicalIncludedKeysV1,
  "np.agent-provider-request.v1": npAgentProviderRequestCanonicalIncludedKeysV1,
  "np.agent-provider-response.v1": npAgentProviderResponseCanonicalIncludedKeysV1,
  "np.agent-recipe-registry.v1": npAgentRecipeRegistryCanonicalIncludedKeysV1,
  "np.agent-restriction.v1": npAgentRestrictionCanonicalIncludedKeysV1,
  "np.agent-run-admission.v1": npAgentRunAdmissionCanonicalIncludedKeysV1,
  "np.agent-run-limits.v1": npAgentRunLimitsCanonicalIncludedKeysV1,
  "np.agent-signal-evidence.v1": npAgentSignalEvidenceCanonicalIncludedKeysV1,
  "np.agent-site-deletion-plan.v1": npAgentSiteDeletionPlanCanonicalIncludedKeysV1,
  "np.agent-staff-site-authorization.v1": npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1,
  "np.agent-vault-aad.v1": npAgentVaultAadCanonicalIncludedKeysV1,
} as const satisfies Record<NpAgentCanonicalPurposeV1, readonly string[]>;

export const npAgentCanonicalPurposeExcludedKeysV1 = {
  "np.agent-action.v1": npAgentActionCanonicalExcludedKeysV1,
  "np.agent-approval-decision.v1": npAgentApprovalDecisionCanonicalExcludedKeysV1,
  "np.agent-approval-revocation.v1": npAgentApprovalRevocationCanonicalExcludedKeysV1,
  "np.agent-approval-statement.v1": npAgentApprovalStatementCanonicalExcludedKeysV1,
  "np.agent-artifact.v1": npAgentPreviewArtifactManifestCanonicalExcludedKeysV1,
  "np.agent-authorization-context.v1": npAgentAuthorizationContextCanonicalExcludedKeysV1,
  "np.agent-budget-snapshot.v1": npAgentBudgetSnapshotCanonicalExcludedKeysV1,
  "np.agent-capability-registry.v1": npAgentCapabilityRegistryCanonicalExcludedKeysV1,
  "np.agent-changeset-plan.v1": npAgentChangeSetPlanCanonicalExcludedKeysV1,
  "np.agent-changeset-proposal.v1": npAgentChangeSetProposalCanonicalExcludedKeysV1,
  "np.agent-changeset-snapshot.v1": npAgentChangeSetSnapshotCanonicalExcludedKeysV1,
  "np.agent-connection-config.v1": npAgentConnectionConfigCanonicalExcludedKeysV1,
  "np.agent-connection-destination.v1": npAgentConnectionDestinationCanonicalExcludedKeysV1,
  "np.agent-connection-operation.v1": npAgentConnectionOperationCanonicalExcludedKeysV1,
  "np.agent-effect-profile.v1": npAgentEffectProfileCanonicalExcludedKeysV1,
  "np.agent-event.v1": npAgentEventCanonicalExcludedKeysV1,
  "np.agent-idempotency-request.v1": npAgentInvocationRequestCanonicalExcludedKeysV1,
  "np.agent-mcp-task-result.v1": npAgentMcpTaskResultCanonicalExcludedKeysV1,
  "np.agent-notification-delivery.v1": npAgentNotificationDeliveryCanonicalExcludedKeysV1,
  "np.agent-policy.v1": npAgentPolicyCanonicalExcludedKeysV1,
  "np.agent-preview-contract.v1": npAgentPreviewContractCanonicalExcludedKeysV1,
  "np.agent-preview-routes.v1": npAgentPreviewRoutesCanonicalExcludedKeysV1,
  "np.agent-provider-request.v1": npAgentProviderRequestCanonicalExcludedKeysV1,
  "np.agent-provider-response.v1": npAgentProviderResponseCanonicalExcludedKeysV1,
  "np.agent-recipe-registry.v1": npAgentRecipeRegistryCanonicalExcludedKeysV1,
  "np.agent-restriction.v1": npAgentRestrictionCanonicalExcludedKeysV1,
  "np.agent-run-admission.v1": npAgentRunAdmissionCanonicalExcludedKeysV1,
  "np.agent-run-limits.v1": npAgentRunLimitsCanonicalExcludedKeysV1,
  "np.agent-signal-evidence.v1": npAgentSignalEvidenceCanonicalExcludedKeysV1,
  "np.agent-site-deletion-plan.v1": npAgentSiteDeletionPlanCanonicalExcludedKeysV1,
  "np.agent-staff-site-authorization.v1": npAgentStaffSiteAuthorizationCanonicalExcludedKeysV1,
  "np.agent-vault-aad.v1": npAgentVaultAadCanonicalExcludedKeysV1,
} as const satisfies Record<NpAgentCanonicalPurposeV1, readonly string[]>;

export function npAnalyzeAgentCanonicalBodyV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  value: unknown,
): NpAgentContractResult<NpAgentCanonicalPurposeBodyMapV1[P]> {
  if (!Object.hasOwn(npAgentCanonicalPurposeAnalyzersV1, purpose)) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.canonical.purpose",
          message: "must select one registered canonical v1 purpose",
        },
      ],
    };
  }
  const analyzer = npAgentCanonicalPurposeAnalyzersV1[purpose] as (
    candidate: unknown,
  ) => NpAgentContractResult<NpAgentCanonicalPurposeBodyMapV1[P]>;
  return analyzer(value);
}

export function npRequireAgentCanonicalBodyV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  value: unknown,
): NpAgentCanonicalPurposeBodyMapV1[P] {
  return npRequireAgentContractResult(
    npAnalyzeAgentCanonicalBodyV1(purpose, value),
    `Invalid Agent canonical body for ${purpose}`,
  );
}

export function npBuildAgentCanonicalBytesV1<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  value: NpAgentCanonicalPurposeBodyMapV1[P],
): NpAgentCanonicalBodyBytesV1<P, NpAgentCanonicalPurposeBodyMapV1[P]> {
  return buildAgentCanonicalFoundationBytes(
    purpose,
    npRequireAgentCanonicalBodyV1(purpose, value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<P, NpAgentCanonicalPurposeBodyMapV1[P]>;
}

export async function npDigestAgentCanonicalBodyV1<P extends NpAgentCanonicalShaPurposeV1>(
  purpose: P,
  value: NpAgentCanonicalPurposeBodyMapV1[P],
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentCanonicalBytesV1(purpose, value).domainSeparatedUtf8,
  );
}
