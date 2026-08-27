import type { NpCapability } from "../auth/capabilities.js";
import { npApiErrorCodePattern } from "../api-contract/contract.js";
import { npErrorStatusByCode } from "../api-contract/types.js";
import { npValidatePluginApiRoutePath } from "../plugins/api-route-contract.js";
import {
  npAnalyzeAgentEffectProfileDescriptor,
  npAnalyzeAgentJsonSchema,
  npRequireAgentContractResult,
} from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyCapabilities,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  canonicalRuntimeStableCode,
  requireNestedCanonicalResult,
} from "./canonical-runtime-primitives.js";
import {
  npAgentApprovalModes,
  npAgentCapabilityRisks,
  type NpAgentApprovalMode,
  type NpAgentCapabilityRisk,
  type NpAgentContractResult,
  type NpAgentEffectProfileDescriptor,
  type NpAgentJsonSchema,
} from "./types.js";

export const npAgentAdminOperationMethodsV1 = ["PATCH", "POST"] as const;
export type NpAgentAdminOperationMethodV1 = (typeof npAgentAdminOperationMethodsV1)[number];

export const npAgentAdminOperationPreconditionKindsV1 = [
  "row-version",
  "config-hash",
  "plan-hash",
] as const;
export type NpAgentAdminOperationPreconditionKindV1 =
  (typeof npAgentAdminOperationPreconditionKindsV1)[number];

export const npAgentAdminOperationReauthenticationFloorsV1 = [
  "none",
  "recent-staff-primary",
] as const;
export type NpAgentAdminOperationReauthenticationFloorV1 =
  (typeof npAgentAdminOperationReauthenticationFloorsV1)[number];

export const npAgentAdminOperationSecretBodyClassesV1 = ["none", "write-only"] as const;
export type NpAgentAdminOperationSecretBodyClassV1 =
  (typeof npAgentAdminOperationSecretBodyClassesV1)[number];

export const npAgentAdminOperationAuditRedactionsV1 = [
  "structured-safe",
  "secret-values",
  "one-time-values",
] as const;
export type NpAgentAdminOperationAuditRedactionV1 =
  (typeof npAgentAdminOperationAuditRedactionsV1)[number];

export const npAgentAdminOperationInputKindsV1 = [
  "empty",
  "approval-decision",
  "approval-request",
  "changeset",
  "connection",
  "credential",
  "definition",
  "gateway-settings",
  "incident-transition",
  "launch",
  "manual-run",
  "oauth-client",
  "principal",
  "reason",
  "schedule",
  "simulation",
  "token",
] as const;
export type NpAgentAdminOperationInputKindV1 = (typeof npAgentAdminOperationInputKindsV1)[number];

export const npAgentAdminOperationOutputKindsV1 = [
  "accepted",
  "decision",
  "one-time",
  "oauth-start",
  "plan",
  "preview",
  "resource",
  "test",
  "validation",
] as const;
export type NpAgentAdminOperationOutputKindV1 = (typeof npAgentAdminOperationOutputKindsV1)[number];

export interface NpAgentAdminOperationPreconditionV1 {
  kind: NpAgentAdminOperationPreconditionKindV1;
  location: "body";
  field: "expectedVersion" | "configHash" | "planHash";
}

export interface NpAgentAdminNamedSchemaV1 {
  name: string;
  contractVersion: number;
  schema: NpAgentJsonSchema;
}

export interface NpAgentAdminOperationErrorResponseV1 {
  code: string;
  status: number;
}

export interface NpAgentAdminOperationContractV1 {
  schemaVersion: "np.agent-admin-operation.v1";
  id: NpAgentAdminOperationIdV1;
  contractVersion: number;
  method: NpAgentAdminOperationMethodV1;
  pathTemplate: string;
  schemas: {
    input: NpAgentAdminNamedSchemaV1;
    output: NpAgentAdminNamedSchemaV1;
    error: NpAgentAdminNamedSchemaV1;
  };
  requiredCapability: NpCapability;
  idempotency: {
    required: true;
    location: "body";
    field: "idempotencyKey";
    oneTimeOutput: boolean;
    retryErrorCode: "ONE_TIME_VALUE_ALREADY_ISSUED" | null;
    recoveryOperationId: NpAgentAdminOperationIdV1 | null;
  };
  preconditions: NpAgentAdminOperationPreconditionV1[];
  secretBody: NpAgentAdminOperationSecretBodyClassV1;
  effect: NpAgentEffectProfileDescriptor;
  approval: {
    risk: NpAgentCapabilityRisk;
    mode: NpAgentApprovalMode;
    reauthenticationFloor: NpAgentAdminOperationReauthenticationFloorV1;
  };
  audit: {
    eventId: string;
    requestRedaction: NpAgentAdminOperationAuditRedactionV1;
    responseRedaction: NpAgentAdminOperationAuditRedactionV1;
    include: string[];
  };
  openApi: {
    operationId: string;
    tag: "Agent Studio";
    responseMediaType: "application/json" | "text/html";
    idempotencyExtension: true;
    oneTimeOutputExtension: boolean;
  };
  errorResponses: NpAgentAdminOperationErrorResponseV1[];
}

export interface NpAgentAdminOperationFingerprintsV1 {
  contract: `cj1:sha256:${string}`;
  input: `cj1:sha256:${string}`;
  output: `cj1:sha256:${string}`;
  error: `cj1:sha256:${string}`;
  effect: `cj1:sha256:${string}`;
}

interface OperationSeedOptions {
  contractVersion?: number;
  capability?: NpCapability;
  inputKind?: NpAgentAdminOperationInputKindV1;
  outputKind?: NpAgentAdminOperationOutputKindV1;
  preconditions?: readonly NpAgentAdminOperationPreconditionKindV1[];
  secretBody?: NpAgentAdminOperationSecretBodyClassV1;
  oneTimeRecovery?: string | null;
  risk?: NpAgentCapabilityRisk;
  approval?: NpAgentApprovalMode;
  reauthentication?: NpAgentAdminOperationReauthenticationFloorV1;
  reversibility?: NpAgentEffectProfileDescriptor["reversibility"];
  responseMediaType?: "application/json" | "text/html";
}

interface OperationSeed<I extends string = string> {
  id: I;
  contractVersion: number;
  method: NpAgentAdminOperationMethodV1;
  pathTemplate: string;
  capability: NpCapability;
  inputKind: NpAgentAdminOperationInputKindV1;
  outputKind: NpAgentAdminOperationOutputKindV1;
  preconditions: readonly NpAgentAdminOperationPreconditionKindV1[];
  secretBody: NpAgentAdminOperationSecretBodyClassV1;
  oneTimeRecovery: string | null;
  risk: NpAgentCapabilityRisk;
  approval: NpAgentApprovalMode;
  reauthentication: NpAgentAdminOperationReauthenticationFloorV1;
  reversibility: NpAgentEffectProfileDescriptor["reversibility"];
  responseMediaType: "application/json" | "text/html";
}

function operation<const I extends string>(
  id: I,
  method: NpAgentAdminOperationMethodV1,
  pathTemplate: string,
  options: OperationSeedOptions = {},
): OperationSeed<I> {
  return {
    id,
    contractVersion: options.contractVersion ?? 1,
    method,
    pathTemplate,
    capability: options.capability ?? "admin.manage",
    inputKind: options.inputKind ?? "empty",
    outputKind: options.outputKind ?? "resource",
    preconditions: options.preconditions ?? [],
    secretBody: options.secretBody ?? "none",
    oneTimeRecovery: options.oneTimeRecovery ?? null,
    risk: options.risk ?? "reversible",
    approval: options.approval ?? "none",
    reauthentication: options.reauthentication ?? "none",
    reversibility: options.reversibility ?? "compensatable",
    responseMediaType: options.responseMediaType ?? "application/json",
  };
}

const ROW = ["row-version"] as const;
const ROW_CONFIG = ["row-version", "config-hash"] as const;
const ROW_PLAN = ["row-version", "plan-hash"] as const;
const SENSITIVE = {
  risk: "sensitive",
  approval: "human",
  reauthentication: "recent-staff-primary",
} as const;
const DESTRUCTIVE = {
  risk: "destructive",
  approval: "human",
  reauthentication: "recent-staff-primary",
  reversibility: "none",
} as const;

/** Product route inventory from Agent Studio §15.2. Order is a locked fixture. */
export const npAgentAdminOperationRouteInventoryV1 = deepFreeze([
  operation("agents.connections.create", "POST", "/api/admin/agents/connections", {
    inputKind: "connection",
    secretBody: "write-only",
    ...SENSITIVE,
  }),
  operation("agents.connections.update", "PATCH", "/api/admin/agents/connections/{id}", {
    inputKind: "definition",
    preconditions: ROW_CONFIG,
  }),
  operation(
    "agents.connections.oauth_start",
    "POST",
    "/api/admin/agents/connections/{id}/oauth/start",
    { outputKind: "oauth-start", preconditions: ROW_CONFIG },
  ),
  operation("agents.connections.test", "POST", "/api/admin/agents/connections/{id}/test", {
    outputKind: "test",
    preconditions: ROW_CONFIG,
  }),
  operation("agents.connections.rotate", "POST", "/api/admin/agents/connections/{id}/rotate", {
    inputKind: "credential",
    preconditions: ROW_CONFIG,
    secretBody: "write-only",
    ...SENSITIVE,
  }),
  operation("agents.connections.disable", "POST", "/api/admin/agents/connections/{id}/disable", {
    inputKind: "reason",
    preconditions: ROW,
  }),
  operation("agents.connections.enable", "POST", "/api/admin/agents/connections/{id}/enable", {
    preconditions: ROW_CONFIG,
  }),
  operation("agents.connections.revoke", "POST", "/api/admin/agents/connections/{id}/revoke", {
    inputKind: "reason",
    preconditions: ROW,
    ...DESTRUCTIVE,
  }),
  operation("agents.gateway.settings.update", "PATCH", "/api/admin/agents/gateway/settings", {
    inputKind: "gateway-settings",
    preconditions: ROW,
  }),
  operation(
    "agents.gateway.oauth_clients.create",
    "POST",
    "/api/admin/agents/gateway/oauth-clients",
    { inputKind: "oauth-client" },
  ),
  operation(
    "agents.gateway.oauth_clients.revoke",
    "POST",
    "/api/admin/agents/gateway/oauth-clients/{id}/revoke",
    { inputKind: "reason", preconditions: ROW, ...DESTRUCTIVE },
  ),
  operation("agents.gateway.principals.create", "POST", "/api/admin/agents/gateway/principals", {
    inputKind: "principal",
  }),
  operation(
    "agents.gateway.principals.update",
    "PATCH",
    "/api/admin/agents/gateway/principals/{id}",
    { inputKind: "principal", preconditions: ROW },
  ),
  operation(
    "agents.gateway.principal_tokens.create",
    "POST",
    "/api/admin/agents/gateway/principals/{id}/tokens",
    {
      inputKind: "token",
      outputKind: "one-time",
      preconditions: ROW,
      oneTimeRecovery: "agents.gateway.principal_tokens.rotate",
      ...SENSITIVE,
    },
  ),
  operation(
    "agents.gateway.principal_tokens.rotate",
    "POST",
    "/api/admin/agents/gateway/principals/{id}/tokens/{tokenId}/rotate",
    {
      inputKind: "token",
      outputKind: "one-time",
      preconditions: ROW,
      oneTimeRecovery: "agents.gateway.principal_tokens.rotate",
      ...SENSITIVE,
    },
  ),
  operation(
    "agents.gateway.principal_tokens.revoke",
    "POST",
    "/api/admin/agents/gateway/principals/{id}/tokens/{tokenId}/revoke",
    { inputKind: "reason", preconditions: ROW, ...DESTRUCTIVE },
  ),
  operation(
    "agents.gateway.principals.suspend",
    "POST",
    "/api/admin/agents/gateway/principals/{id}/suspend",
    { inputKind: "reason", preconditions: ROW },
  ),
  operation(
    "agents.gateway.principals.resume",
    "POST",
    "/api/admin/agents/gateway/principals/{id}/resume",
    { preconditions: ROW },
  ),
  operation(
    "agents.gateway.principals.revoke",
    "POST",
    "/api/admin/agents/gateway/principals/{id}/revoke",
    { inputKind: "reason", preconditions: ROW, ...DESTRUCTIVE },
  ),
  operation("agents.configurations.create", "POST", "/api/admin/agents/configurations", {
    inputKind: "definition",
  }),
  operation("agents.configurations.update", "PATCH", "/api/admin/agents/configurations/{id}", {
    inputKind: "definition",
    preconditions: ROW_CONFIG,
  }),
  operation(
    "agents.configurations.activate",
    "POST",
    "/api/admin/agents/configurations/{id}/activate",
    { preconditions: ROW_CONFIG, ...SENSITIVE },
  ),
  operation("agents.configurations.pause", "POST", "/api/admin/agents/configurations/{id}/pause", {
    inputKind: "reason",
    preconditions: ROW,
  }),
  operation(
    "agents.configurations.resume",
    "POST",
    "/api/admin/agents/configurations/{id}/resume",
    { preconditions: ROW_CONFIG },
  ),
  operation("agents.configurations.run", "POST", "/api/admin/agents/configurations/{id}/runs", {
    inputKind: "manual-run",
    outputKind: "accepted",
    preconditions: ROW_CONFIG,
  }),
  operation(
    "agents.configurations.archive",
    "POST",
    "/api/admin/agents/configurations/{id}/archive",
    { inputKind: "reason", preconditions: ROW, ...DESTRUCTIVE },
  ),
  operation("agents.policies.create", "POST", "/api/admin/agents/policies", {
    inputKind: "definition",
  }),
  operation("agents.policies.update", "PATCH", "/api/admin/agents/policies/{id}", {
    inputKind: "definition",
    preconditions: ROW_CONFIG,
  }),
  operation("agents.policies.validate", "POST", "/api/admin/agents/policies/{id}/validate", {
    outputKind: "validation",
    preconditions: ROW_CONFIG,
  }),
  operation("agents.policies.simulate", "POST", "/api/admin/agents/policies/{id}/simulate", {
    inputKind: "simulation",
    outputKind: "validation",
    preconditions: ROW_CONFIG,
  }),
  operation("agents.policies.activate", "POST", "/api/admin/agents/policies/{id}/activate", {
    preconditions: ROW_CONFIG,
    ...SENSITIVE,
  }),
  operation("agents.activity.cancel", "POST", "/api/admin/agents/activity/{id}/cancel", {
    inputKind: "reason",
    preconditions: ROW,
  }),
  operation("agents.activity.retry_plan", "POST", "/api/admin/agents/activity/{id}/retry-plan", {
    inputKind: "reason",
    outputKind: "plan",
    preconditions: ROW,
  }),
  operation(
    "agents.approvals.decision_challenge",
    "POST",
    "/api/admin/agents/approvals/{id}/decision-challenge",
    {
      outputKind: "one-time",
      preconditions: ROW_PLAN,
      oneTimeRecovery: "agents.approvals.decision_challenge",
      ...SENSITIVE,
    },
  ),
  operation("agents.approvals.approve", "POST", "/api/admin/agents/approvals/{id}/approve", {
    inputKind: "approval-decision",
    outputKind: "decision",
    preconditions: ROW_PLAN,
    ...SENSITIVE,
  }),
  operation("agents.approvals.reject", "POST", "/api/admin/agents/approvals/{id}/reject", {
    inputKind: "approval-decision",
    outputKind: "decision",
    preconditions: ROW_PLAN,
  }),
  operation("agents.approvals.revoke", "POST", "/api/admin/agents/approvals/{id}/revoke", {
    inputKind: "reason",
    outputKind: "decision",
    preconditions: ROW_PLAN,
  }),
  operation("agents.changesets.create", "POST", "/api/admin/agents/changesets", {
    capability: "content.author",
    inputKind: "changeset",
  }),
  operation("agents.changesets.update", "PATCH", "/api/admin/agents/changesets/{id}", {
    capability: "content.author",
    inputKind: "changeset",
    preconditions: ROW,
  }),
  operation("agents.changesets.validate", "POST", "/api/admin/agents/changesets/{id}/validate", {
    capability: "content.author",
    outputKind: "validation",
    preconditions: ROW,
  }),
  operation("agents.changesets.preview", "POST", "/api/admin/agents/changesets/{id}/preview", {
    capability: "content.author",
    outputKind: "preview",
    preconditions: ROW_PLAN,
  }),
  operation(
    "agents.changesets.preview_launch",
    "POST",
    "/api/admin/agents/changesets/{id}/previews/{previewId}/launch",
    {
      capability: "content.author",
      inputKind: "launch",
      outputKind: "one-time",
      preconditions: ROW_PLAN,
      oneTimeRecovery: "agents.changesets.preview_launch",
      responseMediaType: "text/html",
    },
  ),
  operation(
    "agents.changesets.request_approval",
    "POST",
    "/api/admin/agents/changesets/{id}/request-approval",
    {
      capability: "content.author",
      inputKind: "approval-request",
      outputKind: "decision",
      preconditions: ROW_PLAN,
    },
  ),
  operation("agents.changesets.cancel", "POST", "/api/admin/agents/changesets/{id}/cancel", {
    capability: "content.author",
    inputKind: "reason",
    preconditions: ROW_PLAN,
  }),
  operation("agents.changesets.schedule", "POST", "/api/admin/agents/changesets/{id}/schedule", {
    capability: "content.publish",
    inputKind: "schedule",
    outputKind: "accepted",
    preconditions: ROW_PLAN,
    ...SENSITIVE,
  }),
  operation("agents.changesets.apply", "POST", "/api/admin/agents/changesets/{id}/apply", {
    capability: "content.publish",
    inputKind: "approval-request",
    outputKind: "accepted",
    preconditions: ROW_PLAN,
    ...DESTRUCTIVE,
  }),
  operation(
    "agents.changesets.rollback_plans.create",
    "POST",
    "/api/admin/agents/changesets/{id}/rollback-plans",
    { capability: "content.author", outputKind: "plan", preconditions: ROW_PLAN },
  ),
  operation(
    "agents.changesets.rollback_plans.request_approval",
    "POST",
    "/api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/request-approval",
    {
      capability: "content.publish",
      inputKind: "approval-request",
      outputKind: "decision",
      preconditions: ROW_PLAN,
    },
  ),
  operation(
    "agents.changesets.rollback_plans.execute",
    "POST",
    "/api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/execute",
    {
      capability: "content.publish",
      inputKind: "approval-request",
      outputKind: "accepted",
      preconditions: ROW_PLAN,
      ...DESTRUCTIVE,
    },
  ),
  operation("agents.incidents.transition", "POST", "/api/admin/agents/incidents/{id}/transitions", {
    inputKind: "incident-transition",
    preconditions: ROW,
  }),
  operation(
    "agents.incidents.response_plan",
    "POST",
    "/api/admin/agents/incidents/{id}/response-plan",
    { inputKind: "reason", outputKind: "plan", preconditions: ROW },
  ),
  operation("agents.incidents.restore", "POST", "/api/admin/agents/incidents/{id}/restore", {
    inputKind: "approval-request",
    outputKind: "accepted",
    preconditions: ROW_PLAN,
    ...SENSITIVE,
  }),
  operation("agents.budgets.update", "PATCH", "/api/admin/agents/budgets", {
    inputKind: "definition",
    preconditions: ROW,
  }),
  operation("agents.runtime.pause", "POST", "/api/admin/agents/runtime/pause", {
    inputKind: "reason",
    preconditions: ROW,
  }),
  operation("agents.runtime.resume", "POST", "/api/admin/agents/runtime/resume", {
    inputKind: "reason",
    preconditions: ROW,
    ...SENSITIVE,
  }),
] as const);

export type NpAgentAdminOperationIdV1 =
  (typeof npAgentAdminOperationRouteInventoryV1)[number]["id"];

export const npAgentAdminOperationIdsV1 = Object.freeze(
  npAgentAdminOperationRouteInventoryV1.map(({ id }) => id),
);

const OPERATION_ID_SET = new Set<string>(npAgentAdminOperationIdsV1);
const OPERATION_SEED_BY_ID = new Map<string, OperationSeed>(
  npAgentAdminOperationRouteInventoryV1.map((seed) => [seed.id, seed]),
);
const METHOD_SET = new Set<string>(npAgentAdminOperationMethodsV1);
const PRECONDITION_SET = new Set<string>(npAgentAdminOperationPreconditionKindsV1);
const REAUTHENTICATION_SET = new Set<string>(npAgentAdminOperationReauthenticationFloorsV1);
const SECRET_BODY_SET = new Set<string>(npAgentAdminOperationSecretBodyClassesV1);
const AUDIT_REDACTION_SET = new Set<string>(npAgentAdminOperationAuditRedactionsV1);
const RISK_SET = new Set<string>(npAgentCapabilityRisks);
const APPROVAL_SET = new Set<string>(npAgentApprovalModes);
const PARAMETER_PATTERN = /\{([a-z][A-Za-z0-9]{0,39})\}/gu;
const IDEMPOTENCY_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$";
const DIGEST_PATTERN = "^cj1:sha256:[A-Za-z0-9_-]{43}$";
const SAFE_CODE_PATTERN = npApiErrorCodePattern;
const SAFE_ID_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$";
const SAFE_STATE_PATTERN = "^[a-z][a-z0-9_-]{0,63}$";
const COMMON_ERROR_RESPONSES = [
  { code: "VALIDATION_ERROR", status: npErrorStatusByCode.VALIDATION_ERROR },
  { code: "UNAUTHORIZED", status: npErrorStatusByCode.UNAUTHORIZED },
  { code: "CSRF_INVALID", status: npErrorStatusByCode.CSRF_INVALID },
  { code: "FORBIDDEN", status: npErrorStatusByCode.FORBIDDEN },
  { code: "NOT_FOUND", status: npErrorStatusByCode.NOT_FOUND },
  { code: "CONFLICT", status: npErrorStatusByCode.CONFLICT },
  { code: "RATE_LIMITED", status: npErrorStatusByCode.RATE_LIMITED },
  { code: "SERVICE_UNAVAILABLE", status: npErrorStatusByCode.SERVICE_UNAVAILABLE },
] as const;
const AUDIT_FIELDS = [
  "idempotencyFingerprint",
  "operationId",
  "outcome",
  "siteId",
  "staffUserId",
] as const;

function stringSchema(maxLength: number, pattern?: string): Record<string, unknown> {
  return pattern === undefined
    ? { type: "string", maxLength }
    : { type: "string", maxLength, pattern };
}

function stringArraySchema(maxItems: number, maxLength = 128): Record<string, unknown> {
  return {
    type: "array",
    maxItems,
    items: stringSchema(maxLength),
  };
}

function commandShape(kind: NpAgentAdminOperationInputKindV1): {
  properties: Record<string, unknown>;
  required: string[];
} {
  switch (kind) {
    case "empty":
      return { properties: {}, required: [] };
    case "approval-decision":
      return {
        properties: {
          challenge: stringSchema(256),
          comment: stringSchema(2_000),
          statementHash: stringSchema(60, DIGEST_PATTERN),
        },
        required: ["challenge", "comment", "statementHash"],
      };
    case "approval-request":
      return {
        properties: {
          approvalId: stringSchema(128, SAFE_ID_PATTERN),
          statementHash: stringSchema(60, DIGEST_PATTERN),
        },
        required: ["approvalId", "statementHash"],
      };
    case "changeset":
      return {
        properties: {
          proposalJson: stringSchema(262_144),
          proposalHash: stringSchema(60, DIGEST_PATTERN),
        },
        required: ["proposalJson", "proposalHash"],
      };
    case "connection":
      return {
        properties: {
          credential: stringSchema(65_536),
          definitionHash: stringSchema(60, DIGEST_PATTERN),
          definitionJson: stringSchema(262_144),
          vaultOperationId: stringSchema(128, SAFE_ID_PATTERN),
        },
        required: ["credential", "definitionHash", "definitionJson", "vaultOperationId"],
      };
    case "credential":
      return {
        properties: {
          credential: stringSchema(65_536),
          vaultOperationId: stringSchema(128, SAFE_ID_PATTERN),
        },
        required: ["credential", "vaultOperationId"],
      };
    case "definition":
      return {
        properties: {
          definitionJson: stringSchema(262_144),
          definitionHash: stringSchema(60, DIGEST_PATTERN),
        },
        required: ["definitionJson", "definitionHash"],
      };
    case "gateway-settings":
      return {
        properties: {
          agentHttp: { enum: ["disabled", "read", "propose", "approved-execute"] },
          mcpHttp: { enum: ["disabled", "read", "propose", "approved-execute"] },
          stdio: { enum: ["disabled", "read", "propose", "approved-execute"] },
        },
        required: ["agentHttp", "mcpHttp", "stdio"],
      };
    case "incident-transition":
      return {
        properties: {
          note: stringSchema(2_000),
          transition: stringSchema(64, SAFE_CODE_PATTERN),
        },
        required: ["note", "transition"],
      };
    case "launch":
      return {
        properties: { route: stringSchema(2_048) },
        required: ["route"],
      };
    case "manual-run":
      return {
        properties: {
          inputJson: stringSchema(262_144),
          triggerId: stringSchema(128, SAFE_ID_PATTERN),
        },
        required: ["inputJson", "triggerId"],
      };
    case "oauth-client":
      return {
        properties: {
          name: stringSchema(120),
          redirectUris: stringArraySchema(16, 2_048),
          transports: {
            type: "array",
            maxItems: 2,
            items: { enum: ["agent-http", "mcp-http"] },
          },
        },
        required: ["name", "redirectUris", "transports"],
      };
    case "principal":
      return {
        properties: {
          name: stringSchema(120),
          scopes: stringArraySchema(23),
        },
        required: ["name", "scopes"],
      };
    case "reason":
      return {
        properties: { reason: stringSchema(2_000) },
        required: ["reason"],
      };
    case "schedule":
      return {
        properties: {
          approvalId: stringSchema(128, SAFE_ID_PATTERN),
          scheduledFor: stringSchema(32),
          statementHash: stringSchema(60, DIGEST_PATTERN),
        },
        required: ["approvalId", "scheduledFor", "statementHash"],
      };
    case "simulation":
      return {
        properties: {
          fixtureJson: stringSchema(262_144),
          fixtureHash: stringSchema(60, DIGEST_PATTERN),
        },
        required: ["fixtureJson", "fixtureHash"],
      };
    case "token":
      return {
        properties: {
          audience: stringSchema(2_048),
          expiresAt: stringSchema(32),
          exposure: { enum: ["read", "propose", "approved-execute"] },
        },
        required: ["audience", "expiresAt", "exposure"],
      };
  }
}

const PRECONDITION_FIELDS = {
  "row-version": { field: "expectedVersion", schema: { type: "integer", minimum: 1 } },
  "config-hash": { field: "configHash", schema: stringSchema(60, DIGEST_PATTERN) },
  "plan-hash": { field: "planHash", schema: stringSchema(60, DIGEST_PATTERN) },
} as const;

function buildInputSchema(seed: OperationSeed): NpAgentJsonSchema {
  const command = commandShape(seed.inputKind);
  const properties: Record<string, unknown> = {
    idempotencyKey: stringSchema(256, IDEMPOTENCY_PATTERN),
    ...command.properties,
  };
  const required = ["idempotencyKey", ...command.required];
  for (const kind of seed.preconditions) {
    const precondition = PRECONDITION_FIELDS[kind];
    properties[precondition.field] = precondition.schema;
    required.push(precondition.field);
  }
  return requireSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties,
    required,
  });
}

function outputShape(kind: NpAgentAdminOperationOutputKindV1): {
  properties: Record<string, unknown>;
  required: string[];
} {
  const resourceId = stringSchema(128, SAFE_ID_PATTERN);
  const state = stringSchema(64, SAFE_STATE_PATTERN);
  const version = { type: "integer", minimum: 1 };
  switch (kind) {
    case "accepted":
      return {
        properties: { resourceId, state, version },
        required: ["resourceId", "state", "version"],
      };
    case "decision":
      return {
        properties: { resourceId, state, statementHash: stringSchema(60, DIGEST_PATTERN), version },
        required: ["resourceId", "state", "statementHash", "version"],
      };
    case "one-time":
      return {
        properties: {
          expiresAt: stringSchema(32),
          oneTimeValue: stringSchema(65_536),
          recoveryOperationId: stringSchema(128),
          resourceId,
          version,
        },
        required: ["expiresAt", "oneTimeValue", "recoveryOperationId", "resourceId", "version"],
      };
    case "oauth-start":
      return {
        properties: {
          authorizationUrl: stringSchema(8_192),
          expiresAt: stringSchema(32),
          resourceId,
        },
        required: ["authorizationUrl", "expiresAt", "resourceId"],
      };
    case "plan":
      return {
        properties: { planHash: stringSchema(60, DIGEST_PATTERN), resourceId, state, version },
        required: ["planHash", "resourceId", "state", "version"],
      };
    case "preview":
      return {
        properties: {
          expiresAt: stringSchema(32),
          generation: { type: "integer", minimum: 1 },
          resourceId,
          state,
        },
        required: ["expiresAt", "generation", "resourceId", "state"],
      };
    case "resource":
      return {
        properties: { resourceId, state, version },
        required: ["resourceId", "state", "version"],
      };
    case "test":
      return {
        properties: {
          checkedAt: stringSchema(32),
          reasonCode: stringSchema(64, SAFE_CODE_PATTERN),
          resourceId,
          state,
        },
        required: ["checkedAt", "reasonCode", "resourceId", "state"],
      };
    case "validation":
      return {
        properties: {
          issues: stringArraySchema(100, 2_000),
          resourceId,
          valid: { type: "boolean" },
          version,
        },
        required: ["issues", "resourceId", "valid", "version"],
      };
  }
}

function buildOutputSchema(seed: OperationSeed): NpAgentJsonSchema {
  const output = outputShape(seed.outputKind);
  return requireSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: output.properties,
    required: output.required,
  });
}

function operationErrors(seed: OperationSeed): NpAgentAdminOperationErrorResponseV1[] {
  const errors: NpAgentAdminOperationErrorResponseV1[] = COMMON_ERROR_RESPONSES.map((entry) => ({
    ...entry,
  }));
  if (seed.oneTimeRecovery !== null) {
    errors.splice(6, 0, {
      code: "ONE_TIME_VALUE_ALREADY_ISSUED",
      status: npErrorStatusByCode.ONE_TIME_VALUE_ALREADY_ISSUED,
    });
  }
  return errors;
}

function buildErrorSchema(
  errors: readonly NpAgentAdminOperationErrorResponseV1[],
  oneTimeOutput: boolean,
): NpAgentJsonSchema {
  const codes = errors.map(({ code }) => code);
  const statuses = [...new Set(errors.map(({ status }) => status))];
  const detailProperties = {
    reasonCode: stringSchema(64, SAFE_CODE_PATTERN),
    ...(oneTimeOutput && {
      recoveryOperationId: stringSchema(128),
      resourceId: stringSchema(128, SAFE_ID_PATTERN),
    }),
  };
  return requireSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { enum: codes },
          details: {
            type: "object",
            additionalProperties: false,
            properties: detailProperties,
          },
          message: stringSchema(2_000),
        },
        required: ["code", "message"],
      },
      status: { enum: statuses },
    },
    required: ["error", "status"],
    oneOf: errors.map(({ code, status }) => ({
      properties: {
        error: { properties: { code: { const: code } } },
        status: { const: status },
      },
    })),
  });
}

function requireSchema(value: unknown): NpAgentJsonSchema {
  return npRequireAgentContractResult(
    npAnalyzeAgentJsonSchema(value),
    "Invalid Agent Admin operation JSON Schema",
  );
}

function schemaName(id: string, kind: "error" | "input" | "output"): string {
  return `np.agent-admin.${id}.${kind}`;
}

function openApiOperationId(id: string): string {
  return `agentAdmin_${id.replaceAll(".", "_")}`;
}

function effectId(id: string): string {
  return `${id}.effect`;
}

function verifierId(id: string): string {
  return `verify.${id}`;
}

function compensatorId(id: string): string {
  return `compensate.${id}`;
}

function buildOperation(seed: OperationSeed): NpAgentAdminOperationContractV1 {
  const oneTimeOutput = seed.oneTimeRecovery !== null;
  const errors = operationErrors(seed);
  return {
    schemaVersion: "np.agent-admin-operation.v1",
    id: seed.id as NpAgentAdminOperationIdV1,
    contractVersion: seed.contractVersion,
    method: seed.method,
    pathTemplate: seed.pathTemplate,
    schemas: {
      input: {
        name: schemaName(seed.id, "input"),
        contractVersion: seed.contractVersion,
        schema: buildInputSchema(seed),
      },
      output: {
        name: schemaName(seed.id, "output"),
        contractVersion: seed.contractVersion,
        schema: buildOutputSchema(seed),
      },
      error: {
        name: schemaName(seed.id, "error"),
        contractVersion: seed.contractVersion,
        schema: buildErrorSchema(errors, oneTimeOutput),
      },
    },
    requiredCapability: seed.capability,
    idempotency: {
      required: true,
      location: "body",
      field: "idempotencyKey",
      oneTimeOutput,
      retryErrorCode: oneTimeOutput ? "ONE_TIME_VALUE_ALREADY_ISSUED" : null,
      recoveryOperationId: seed.oneTimeRecovery as NpAgentAdminOperationIdV1 | null,
    },
    preconditions: seed.preconditions.map((kind) => ({
      kind,
      location: "body",
      field: PRECONDITION_FIELDS[kind].field,
    })),
    secretBody: seed.secretBody,
    effect: {
      id: effectId(seed.id),
      kind: "mutation",
      reversibility: seed.reversibility,
      minimumGatewayExposure: null,
      verifierId: verifierId(seed.id),
      compensatorId: seed.reversibility === "compensatable" ? compensatorId(seed.id) : null,
    },
    approval: {
      risk: seed.risk,
      mode: seed.approval,
      reauthenticationFloor: seed.reauthentication,
    },
    audit: {
      eventId: seed.id,
      requestRedaction: seed.secretBody === "write-only" ? "secret-values" : "structured-safe",
      responseRedaction: oneTimeOutput ? "one-time-values" : "structured-safe",
      include: [...AUDIT_FIELDS],
    },
    openApi: {
      operationId: openApiOperationId(seed.id),
      tag: "Agent Studio",
      responseMediaType: seed.responseMediaType,
      idempotencyExtension: true,
      oneTimeOutputExtension: oneTimeOutput,
    },
    errorResponses: errors,
  };
}

const OPERATION_KEYS = [
  "schemaVersion",
  "id",
  "contractVersion",
  "method",
  "pathTemplate",
  "schemas",
  "requiredCapability",
  "idempotency",
  "preconditions",
  "secretBody",
  "effect",
  "approval",
  "audit",
  "openApi",
  "errorResponses",
] as const;
const NAMED_SCHEMA_KEYS = ["name", "contractVersion", "schema"] as const;
const SCHEMAS_KEYS = ["input", "output", "error"] as const;
const IDEMPOTENCY_KEYS = [
  "required",
  "location",
  "field",
  "oneTimeOutput",
  "retryErrorCode",
  "recoveryOperationId",
] as const;
const PRECONDITION_KEYS = ["kind", "location", "field"] as const;
const APPROVAL_KEYS = ["risk", "mode", "reauthenticationFloor"] as const;
const AUDIT_KEYS = ["eventId", "requestRedaction", "responseRedaction", "include"] as const;
const OPENAPI_KEYS = [
  "operationId",
  "tag",
  "responseMediaType",
  "idempotencyExtension",
  "oneTimeOutputExtension",
] as const;
const ERROR_RESPONSE_KEYS = ["code", "status"] as const;

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    failCanonicalBody("invalid-field", path, "must be a boolean");
  }
  return value;
}

function parseOperationId(value: unknown, path: string): NpAgentAdminOperationIdV1 {
  const id = canonicalBodyIdentifier(value, path);
  if (!OPERATION_ID_SET.has(id)) {
    failCanonicalBody("invalid-field", path, "must select one closed Admin operation id");
  }
  return id as NpAgentAdminOperationIdV1;
}

function validatePathTemplate(value: unknown, path: string): string {
  const template = canonicalBodyAscii(value, path, 256);
  if (!template.startsWith("/api/admin/agents/")) {
    failCanonicalBody("invalid-field", path, "must stay under /api/admin/agents/");
  }
  const names: string[] = [];
  const concretePath = template.replace(PARAMETER_PATTERN, (_match, name: string) => {
    names.push(name);
    return `parameter-${names.length.toString()}`;
  });
  if (concretePath.includes("{") || concretePath.includes("}")) {
    failCanonicalBody("invalid-field", path, "contains a malformed path parameter");
  }
  if (new Set(names).size !== names.length) {
    failCanonicalBody("duplicate", path, "must not repeat a path parameter name");
  }
  const result = npValidatePluginApiRoutePath(concretePath);
  if (!result.ok) {
    failCanonicalBody("invalid-field", path, result.message);
  }
  return template;
}

function parseNamedSchema(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentAdminNamedSchemaV1 {
  const record = canonicalBodyRecord(value, path, NAMED_SCHEMA_KEYS, NAMED_SCHEMA_KEYS, state);
  return {
    name: canonicalBodyIdentifier(record.name, `${path}.name`),
    contractVersion: canonicalBodyInteger(
      record.contractVersion,
      `${path}.contractVersion`,
      1,
      2_147_483_647,
    ),
    schema: requireNestedCanonicalResult(
      npAnalyzeAgentJsonSchema(record.schema),
      "agent.schema",
      `${path}.schema`,
      "Invalid Agent Admin named schema",
    ),
  };
}

function parseSchemas(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentAdminOperationContractV1["schemas"] {
  const record = canonicalBodyRecord(value, path, SCHEMAS_KEYS, SCHEMAS_KEYS, state);
  return {
    input: parseNamedSchema(record.input, `${path}.input`, state),
    output: parseNamedSchema(record.output, `${path}.output`, state),
    error: parseNamedSchema(record.error, `${path}.error`, state),
  };
}

function parsePreconditions(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentAdminOperationPreconditionV1[] {
  const entries = canonicalBodyArray(value, path, 3, state);
  const result: NpAgentAdminOperationPreconditionV1[] = [];
  for (const [index, entry] of entries.entries()) {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      PRECONDITION_KEYS,
      PRECONDITION_KEYS,
      state,
    );
    const kind = canonicalBodyEnum<NpAgentAdminOperationPreconditionKindV1>(
      record.kind,
      `${entryPath}.kind`,
      PRECONDITION_SET,
    );
    const expectedField = PRECONDITION_FIELDS[kind].field;
    if (record.location !== "body" || record.field !== expectedField) {
      failCanonicalBody("invalid-field", entryPath, `must bind ${kind} to body.${expectedField}`);
    }
    if (result.some((candidate) => candidate.kind === kind)) {
      failCanonicalBody("duplicate", `${entryPath}.kind`, "must be unique");
    }
    result.push({ kind, location: "body", field: expectedField });
  }
  return result;
}

function parseErrorResponses(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentAdminOperationErrorResponseV1[] {
  const entries = canonicalBodyArray(value, path, 16, state);
  const result = entries.map((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      ERROR_RESPONSE_KEYS,
      ERROR_RESPONSE_KEYS,
      state,
    );
    const code = canonicalRuntimeStableCode(record.code, `${entryPath}.code`);
    if (!Object.hasOwn(npErrorStatusByCode, code)) {
      failCanonicalBody(
        "invalid-field",
        `${entryPath}.code`,
        "must select one framework error code",
      );
    }
    const status = canonicalBodyInteger(record.status, `${entryPath}.status`, 400, 599);
    const expectedStatus = npErrorStatusByCode[code as keyof typeof npErrorStatusByCode];
    if (status !== expectedStatus) {
      failCanonicalBody(
        "invalid-field",
        `${entryPath}.status`,
        `${code} must use HTTP ${expectedStatus.toString()}`,
      );
    }
    return { code, status };
  });
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (
      previous &&
      current &&
      (current.status < previous.status ||
        (current.status === previous.status && current.code <= previous.code))
    ) {
      failCanonicalBody(
        current.status === previous.status && current.code === previous.code
          ? "duplicate"
          : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by status then code",
      );
    }
  }
  return result;
}

function schemaRequiredFields(schema: NpAgentJsonSchema, path: string): Set<string> {
  if (!Array.isArray(schema.required)) {
    failCanonicalBody("invalid-field", `${path}.required`, "must declare required fields");
  }
  return new Set(
    schema.required.map((value, index) =>
      canonicalBodyAscii(value, `${path}.required[${index.toString()}]`, 128),
    ),
  );
}

function parseOperation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentAdminOperationContractV1 {
  const record = canonicalBodyRecord(value, path, OPERATION_KEYS, OPERATION_KEYS, state);
  if (record.schemaVersion !== "np.agent-admin-operation.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-admin-operation.v1",
    );
  }
  const id = parseOperationId(record.id, `${path}.id`);
  const seed = OPERATION_SEED_BY_ID.get(id);
  if (!seed) {
    failCanonicalBody("invalid-field", `${path}.id`, "is not present in the operation seed map");
  }
  const contractVersion = canonicalBodyInteger(
    record.contractVersion,
    `${path}.contractVersion`,
    1,
    2_147_483_647,
  );
  const method = canonicalBodyEnum<NpAgentAdminOperationMethodV1>(
    record.method,
    `${path}.method`,
    METHOD_SET,
  );
  const pathTemplate = validatePathTemplate(record.pathTemplate, `${path}.pathTemplate`);
  const schemas = parseSchemas(record.schemas, `${path}.schemas`, state);
  const requiredCapability = canonicalBodyCapabilities(
    [record.requiredCapability],
    `${path}.requiredCapability`,
    state,
  )[0];
  if (requiredCapability === undefined) {
    failCanonicalBody("missing-field", `${path}.requiredCapability`, "is required");
  }

  const idempotencyRecord = canonicalBodyRecord(
    record.idempotency,
    `${path}.idempotency`,
    IDEMPOTENCY_KEYS,
    IDEMPOTENCY_KEYS,
    state,
  );
  const oneTimeOutput = booleanValue(
    idempotencyRecord.oneTimeOutput,
    `${path}.idempotency.oneTimeOutput`,
  );
  if (
    idempotencyRecord.required !== true ||
    idempotencyRecord.location !== "body" ||
    idempotencyRecord.field !== "idempotencyKey"
  ) {
    failCanonicalBody("invalid-field", `${path}.idempotency`, "must require body.idempotencyKey");
  }
  const retryErrorCode =
    idempotencyRecord.retryErrorCode === null
      ? null
      : canonicalBodyAscii(
          idempotencyRecord.retryErrorCode,
          `${path}.idempotency.retryErrorCode`,
          64,
        );
  const recoveryOperationId =
    idempotencyRecord.recoveryOperationId === null
      ? null
      : parseOperationId(
          idempotencyRecord.recoveryOperationId,
          `${path}.idempotency.recoveryOperationId`,
        );
  if (
    oneTimeOutput !==
    (retryErrorCode === "ONE_TIME_VALUE_ALREADY_ISSUED" && recoveryOperationId !== null)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.idempotency`,
      "one-time output requires its typed retry error and closed recovery operation",
    );
  }

  const preconditions = parsePreconditions(record.preconditions, `${path}.preconditions`, state);
  const secretBody = canonicalBodyEnum<NpAgentAdminOperationSecretBodyClassV1>(
    record.secretBody,
    `${path}.secretBody`,
    SECRET_BODY_SET,
  );
  const effect = requireNestedCanonicalResult(
    npAnalyzeAgentEffectProfileDescriptor(record.effect),
    "agent.effectProfile",
    `${path}.effect`,
    "Invalid Agent Admin effect profile",
  );
  if (
    effect.kind !== "mutation" ||
    effect.minimumGatewayExposure !== null ||
    effect.verifierId === null
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.effect`,
      "Admin operations require an internal mutation effect with a verifier",
    );
  }

  const approvalRecord = canonicalBodyRecord(
    record.approval,
    `${path}.approval`,
    APPROVAL_KEYS,
    APPROVAL_KEYS,
    state,
  );
  const risk = canonicalBodyEnum<NpAgentCapabilityRisk>(
    approvalRecord.risk,
    `${path}.approval.risk`,
    RISK_SET,
  );
  const approvalMode = canonicalBodyEnum<NpAgentApprovalMode>(
    approvalRecord.mode,
    `${path}.approval.mode`,
    APPROVAL_SET,
  );
  const reauthenticationFloor = canonicalBodyEnum<NpAgentAdminOperationReauthenticationFloorV1>(
    approvalRecord.reauthenticationFloor,
    `${path}.approval.reauthenticationFloor`,
    REAUTHENTICATION_SET,
  );
  if (
    (risk === "sensitive" || risk === "destructive") &&
    (approvalMode !== "human" || reauthenticationFloor !== "recent-staff-primary")
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.approval`,
      "sensitive and destructive operations require human approval and recent staff-primary reauthentication",
    );
  }

  const auditRecord = canonicalBodyRecord(
    record.audit,
    `${path}.audit`,
    AUDIT_KEYS,
    AUDIT_KEYS,
    state,
  );
  const requestRedaction = canonicalBodyEnum<NpAgentAdminOperationAuditRedactionV1>(
    auditRecord.requestRedaction,
    `${path}.audit.requestRedaction`,
    AUDIT_REDACTION_SET,
  );
  const responseRedaction = canonicalBodyEnum<NpAgentAdminOperationAuditRedactionV1>(
    auditRecord.responseRedaction,
    `${path}.audit.responseRedaction`,
    AUDIT_REDACTION_SET,
  );
  const include = canonicalBodyArray(auditRecord.include, `${path}.audit.include`, 16, state).map(
    (entry, index) => canonicalBodyAscii(entry, `${path}.audit.include[${index.toString()}]`, 64),
  );
  if (
    include.length !== AUDIT_FIELDS.length ||
    include.some((entry, index) => entry !== AUDIT_FIELDS[index])
  ) {
    failCanonicalBody("invalid-field", `${path}.audit.include`, "must use the locked safe fields");
  }
  if (secretBody === "write-only" && requestRedaction !== "secret-values") {
    failCanonicalBody(
      "invalid-field",
      `${path}.audit.requestRedaction`,
      "write-only bodies require secret-value redaction",
    );
  }
  if (oneTimeOutput !== (responseRedaction === "one-time-values")) {
    failCanonicalBody(
      "invalid-field",
      `${path}.audit.responseRedaction`,
      "must match one-time output behavior",
    );
  }

  const openApiRecord = canonicalBodyRecord(
    record.openApi,
    `${path}.openApi`,
    OPENAPI_KEYS,
    OPENAPI_KEYS,
    state,
  );
  const openApiOneTime = booleanValue(
    openApiRecord.oneTimeOutputExtension,
    `${path}.openApi.oneTimeOutputExtension`,
  );
  if (
    openApiRecord.tag !== "Agent Studio" ||
    (openApiRecord.responseMediaType !== "application/json" &&
      openApiRecord.responseMediaType !== "text/html") ||
    openApiRecord.idempotencyExtension !== true ||
    openApiOneTime !== oneTimeOutput
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.openApi`,
      "must expose the locked Agent Studio idempotency metadata",
    );
  }
  const openApiId = canonicalBodyAscii(
    openApiRecord.operationId,
    `${path}.openApi.operationId`,
    160,
  );
  if (openApiId !== openApiOperationId(id)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.openApi.operationId`,
      "does not match the operation id",
    );
  }

  const errorResponses = parseErrorResponses(
    record.errorResponses,
    `${path}.errorResponses`,
    state,
  );
  if (
    oneTimeOutput !==
    errorResponses.some(
      ({ code, status }) => code === "ONE_TIME_VALUE_ALREADY_ISSUED" && status === 409,
    )
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.errorResponses`,
      "must match one-time retry behavior",
    );
  }

  const expectedNames = {
    input: schemaName(id, "input"),
    output: schemaName(id, "output"),
    error: schemaName(id, "error"),
  };
  for (const kind of ["input", "output", "error"] as const) {
    if (schemas[kind].name !== expectedNames[kind]) {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemas.${kind}.name`,
        "does not match the operation id",
      );
    }
  }
  const requiredInputFields = schemaRequiredFields(
    schemas.input.schema,
    `${path}.schemas.input.schema`,
  );
  if (!requiredInputFields.has("idempotencyKey")) {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemas.input.schema.required`,
      "must include idempotencyKey",
    );
  }
  for (const precondition of preconditions) {
    if (!requiredInputFields.has(precondition.field)) {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemas.input.schema.required`,
        `must include ${precondition.field}`,
      );
    }
  }
  if (effect.id !== effectId(id) || effect.verifierId !== verifierId(id)) {
    failCanonicalBody("invalid-field", `${path}.effect`, "must use operation-bound effect ids");
  }
  if (auditRecord.eventId !== id) {
    failCanonicalBody("invalid-field", `${path}.audit.eventId`, "must equal the operation id");
  }

  const result: NpAgentAdminOperationContractV1 = {
    schemaVersion: "np.agent-admin-operation.v1",
    id,
    contractVersion,
    method,
    pathTemplate,
    schemas,
    requiredCapability,
    idempotency: {
      required: true,
      location: "body",
      field: "idempotencyKey",
      oneTimeOutput,
      retryErrorCode: retryErrorCode as "ONE_TIME_VALUE_ALREADY_ISSUED" | null,
      recoveryOperationId,
    },
    preconditions,
    secretBody,
    effect,
    approval: { risk, mode: approvalMode, reauthenticationFloor },
    audit: {
      eventId: id,
      requestRedaction,
      responseRedaction,
      include,
    },
    openApi: {
      operationId: openApiId,
      tag: "Agent Studio",
      responseMediaType: openApiRecord.responseMediaType,
      idempotencyExtension: true,
      oneTimeOutputExtension: openApiOneTime,
    },
    errorResponses,
  };
  const expected = buildOperation(seed);
  if (serializeAgentCanonicalJson(result) !== serializeAgentCanonicalJson(expected)) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must match the locked route, schema, authorization, effect, and projection seed",
    );
  }
  return result;
}

export function npAnalyzeAgentAdminOperationContractV1(
  value: unknown,
): NpAgentContractResult<NpAgentAdminOperationContractV1> {
  return analyzeCanonicalBody("agent.adminOperation", () =>
    parseOperation(value, "agent.adminOperation", { seen: new WeakSet<object>() }),
  );
}

export function npRequireAgentAdminOperationContractV1(
  value: unknown,
): NpAgentAdminOperationContractV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentAdminOperationContractV1(value),
    "Invalid Agent Admin operation contract",
  );
}

export function npAnalyzeAgentAdminOperationRegistryV1(
  value: unknown,
): NpAgentContractResult<NpAgentAdminOperationContractV1[]> {
  return analyzeCanonicalBody("agent.adminOperationRegistry", () => {
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    const entries = canonicalBodyArray(
      value,
      "agent.adminOperationRegistry",
      npAgentAdminOperationIdsV1.length,
      state,
    );
    if (entries.length !== npAgentAdminOperationIdsV1.length) {
      failCanonicalBody(
        "invalid-field",
        "agent.adminOperationRegistry",
        `must contain all ${npAgentAdminOperationIdsV1.length.toString()} operations`,
      );
    }
    const result = entries.map((entry, index) =>
      parseOperation(entry, `agent.adminOperationRegistry[${index.toString()}]`, state),
    );
    for (const [index, operationContract] of result.entries()) {
      if (operationContract.id !== npAgentAdminOperationIdsV1[index]) {
        failCanonicalBody(
          index > 0 && operationContract.id === result[index - 1]?.id ? "duplicate" : "order",
          `agent.adminOperationRegistry[${index.toString()}].id`,
          "must match the locked route inventory order",
        );
      }
    }
    const routeKeys = new Set<string>();
    const openApiIds = new Set<string>();
    for (const [index, operationContract] of result.entries()) {
      const routeKey = `${operationContract.method} ${operationContract.pathTemplate}`;
      if (routeKeys.has(routeKey)) {
        failCanonicalBody(
          "duplicate",
          `agent.adminOperationRegistry[${index.toString()}].pathTemplate`,
          "duplicates a method/path pair",
        );
      }
      routeKeys.add(routeKey);
      if (openApiIds.has(operationContract.openApi.operationId)) {
        failCanonicalBody(
          "duplicate",
          `agent.adminOperationRegistry[${index.toString()}].openApi.operationId`,
          "must be unique",
        );
      }
      openApiIds.add(operationContract.openApi.operationId);
    }
    return result;
  });
}

export function npRequireAgentAdminOperationRegistryV1(
  value: unknown,
): NpAgentAdminOperationContractV1[] {
  return npRequireAgentContractResult(
    npAnalyzeAgentAdminOperationRegistryV1(value),
    "Invalid Agent Admin operation registry",
  );
}

function concatenateBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.byteLength + second.byteLength);
  result.set(first);
  result.set(second, first.byteLength);
  return result;
}

function buildFingerprintBytes(domain: string, value: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return concatenateBytes(
    encoder.encode(`${domain}\0`),
    encoder.encode(serializeAgentCanonicalJson(value)),
  );
}

/** Deterministic contract fingerprint consumed by invocation admission and OpenAPI. */
export async function npDigestAgentAdminOperationContractV1(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    buildFingerprintBytes(
      "np.agent-admin-operation-contract.v1",
      npRequireAgentAdminOperationContractV1(value),
    ),
  );
}

/** Resolves the exact component fingerprints registered by one future route. */
export async function npResolveAgentAdminOperationFingerprintsV1(
  value: unknown,
): Promise<NpAgentAdminOperationFingerprintsV1> {
  const operationContract = npRequireAgentAdminOperationContractV1(value);
  const [contract, input, output, error, effect] = await Promise.all([
    npDigestAgentAdminOperationContractV1(operationContract),
    digestAgentCanonicalSha256(
      buildFingerprintBytes("np.agent-admin-operation-input-schema.v1", {
        name: operationContract.schemas.input.name,
        contractVersion: operationContract.schemas.input.contractVersion,
        schema: operationContract.schemas.input.schema,
      }),
    ),
    digestAgentCanonicalSha256(
      buildFingerprintBytes("np.agent-admin-operation-output-schema.v1", {
        name: operationContract.schemas.output.name,
        contractVersion: operationContract.schemas.output.contractVersion,
        schema: operationContract.schemas.output.schema,
      }),
    ),
    digestAgentCanonicalSha256(
      buildFingerprintBytes("np.agent-admin-operation-error-schema.v1", {
        name: operationContract.schemas.error.name,
        contractVersion: operationContract.schemas.error.contractVersion,
        schema: operationContract.schemas.error.schema,
      }),
    ),
    digestAgentCanonicalSha256(
      buildFingerprintBytes("np.agent-admin-operation-effect.v1", operationContract.effect),
    ),
  ]);
  return { contract, input, output, error, effect };
}

/** Aggregate fixture fingerprint; any route/schema/policy drift changes this value. */
export async function npDigestAgentAdminOperationRegistryV1(
  value: unknown = npAgentAdminOperationRegistryV1,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    buildFingerprintBytes(
      "np.agent-admin-operation-registry.v1",
      npRequireAgentAdminOperationRegistryV1(value),
    ),
  );
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

const builtOperations = npAgentAdminOperationRouteInventoryV1.map((seed) =>
  deepFreeze(npRequireAgentAdminOperationContractV1(buildOperation(seed))),
);

export const npAgentAdminOperationsV1 = Object.freeze(
  Object.fromEntries(builtOperations.map((entry) => [entry.id, entry])) as Readonly<
    Record<NpAgentAdminOperationIdV1, NpAgentAdminOperationContractV1>
  >,
);

export const npAgentAdminOperationRegistryV1 = Object.freeze(
  npAgentAdminOperationIdsV1.map((id) => npAgentAdminOperationsV1[id]),
);

export function npGetAgentAdminOperationV1(
  id: NpAgentAdminOperationIdV1,
): NpAgentAdminOperationContractV1 {
  return npAgentAdminOperationsV1[id];
}
