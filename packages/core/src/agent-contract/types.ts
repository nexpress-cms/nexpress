import type { NpCapability } from "../auth/capabilities.js";

export type NpAgentJsonPrimitive = string | number | boolean | null;
export type NpAgentJsonValue =
  NpAgentJsonPrimitive | NpAgentJsonValue[] | { [key: string]: NpAgentJsonValue };
export type NpAgentJsonObject = { [key: string]: NpAgentJsonValue };

export type NpAgentJsonSchema = NpAgentJsonObject & {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  type: "object";
  additionalProperties: false;
};

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
