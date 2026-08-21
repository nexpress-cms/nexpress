import type { NpCapability } from "../auth/capabilities.js";

export type NpAgentJsonPrimitive = string | number | boolean | null;
export type NpAgentJsonValue =
  NpAgentJsonPrimitive | NpAgentJsonValue[] | { [key: string]: NpAgentJsonValue };
export type NpAgentJsonObject = { [key: string]: NpAgentJsonValue };

export type NpAgentCanonicalJsonValueV1 = NpAgentJsonValue;
export type NpAgentCanonicalJsonObjectV1 = NpAgentJsonObject;
export type NpAgentCanonicalUtcV1 = string;
export type NpAgentCanonicalDigestV1 = string;
export type NpAgentCanonicalIdV1 = string;

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
