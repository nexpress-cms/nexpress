import { npAgentMcpTaskLimitsV1 } from "./mcp-task-contract.js";
import { npRequireAgentCursorPageV1 } from "./wire-contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyUuid,
  canonicalBodyInteger,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyEnum,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeText,
  parseSortedUniqueEnumArray,
} from "./canonical-runtime-primitives.js";
import { npRequireAgentCapabilityDescriptor, npRequireAgentContractResult } from "./contract.js";
import { npRequireAgentCapabilityRegistryCanonical } from "./canonical-capability-registry.js";
import {
  npAgentReadCapabilityDescriptorsV1,
  npAgentReadCapabilityIdsV1,
  npRequireAgentReadCapabilityInputV1,
  npRequireAgentReadCapabilityOutputV1,
  npRequireAgentReadCapabilityInvocationRequestV1,
  type NpAgentReadCapabilityInputMapV1,
  type NpAgentReadCapabilityOutputMapV1,
  type NpAgentReadCapabilityInvocationRequestV1,
} from "./read-capability-contract.js";
import {
  npAgentChangeSetLimits,
  npAgentChangeSetStates,
  npRequireAgentChangeSetDraftInputV1,
  npRequireAgentChangeSetWire,
  npAnalyzeAgentChangeSetWire,
  type NpAgentChangeSetState,
  type NpAgentChangeSetDraftInputV1,
  type NpAgentChangeSetWire,
} from "./changeset-wire-contract.js";
import {
  npAgentChangeSetExecutionPhasePoliciesV1,
  npAgentChangeSetRollbackModePoliciesV1,
  npAgentChangeSetApplyCapabilityInputSchemaV1,
  npAgentChangeSetScheduleCapabilityInputSchemaV1,
  npAgentChangeSetRollbackCapabilityInputSchemaV1,
  npAgentChangeSetExecutionOutputSchemaV1,
  npAgentChangeSetCreateInputSchemaV1,
  npAgentChangeSetOutputSchemaV1,
  npAgentChangeSetListOutputSchemaV1,
  npAgentSchemaObjectV1,
} from "./changeset-capability-schema.js";
import type { NpAgentJsonObject, NpAgentJsonValue, NpAgentCapabilityDescriptor } from "./types.js";

export const npAgentChangeSetCapabilityIdsV1 = [
  "changeset.apply",
  "changeset.create",
  "changeset.get",
  "changeset.list",
  "changeset.preview",
  "changeset.rollback",
  "changeset.schedule",
  "changeset.validate",
] as const;
export type NpAgentChangeSetCapabilityIdV1 = (typeof npAgentChangeSetCapabilityIdsV1)[number];
export const npAgentInstalledCapabilityIdsV1 = [
  ...npAgentChangeSetCapabilityIdsV1,
  ...npAgentReadCapabilityIdsV1,
] as const;
export type NpAgentInstalledCapabilityIdV1 = (typeof npAgentInstalledCapabilityIdsV1)[number];
export interface NpAgentChangeSetApplyCapabilityInputV1 {
  changeSetId: string;
  planHash: string;
  approvalId: string | null;
}
export interface NpAgentChangeSetScheduleCapabilityInputV1 extends NpAgentChangeSetApplyCapabilityInputV1 {
  scheduledFor: string;
}
export type NpAgentChangeSetRollbackCapabilityInputV1 =
  | { mode: "prepare"; changeSetId: string }
  | { mode: "request_approval"; changeSetId: string; rollbackPlanId: string; planHash: string }
  | {
      mode: "execute_approved";
      changeSetId: string;
      rollbackPlanId: string;
      planHash: string;
      approvalId: string;
    };
function executionInput(
  id: "changeset.apply" | "changeset.schedule" | "changeset.rollback",
  value: unknown,
):
  | NpAgentChangeSetApplyCapabilityInputV1
  | NpAgentChangeSetScheduleCapabilityInputV1
  | NpAgentChangeSetRollbackCapabilityInputV1 {
  const p = "agent.capability.input";
  if (id !== "changeset.rollback") {
    const keys = [
      "changeSetId",
      "planHash",
      "approvalId",
      ...(id === "changeset.schedule" ? ["scheduledFor"] : []),
    ];
    const r = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
    return {
      changeSetId: canonicalBodyUuid(r.changeSetId, p + ".changeSetId"),
      planHash: canonicalBodySha256Digest(r.planHash, p + ".planHash"),
      approvalId: r.approvalId === null ? null : canonicalBodyUuid(r.approvalId, p + ".approvalId"),
      ...(id === "changeset.schedule"
        ? { scheduledFor: canonicalBodyUtc(r.scheduledFor, p + ".scheduledFor") }
        : {}),
    };
  }
  const r = canonicalBodyRecord(
    value,
    p,
    ["mode", "changeSetId", "rollbackPlanId", "planHash", "approvalId"],
    ["mode", "changeSetId"],
    { seen: new WeakSet<object>() },
  );
  const mode = canonicalBodyEnum<"prepare" | "request_approval" | "execute_approved">(
    r.mode,
    p + ".mode",
    new Set(["prepare", "request_approval", "execute_approved"]),
  );
  const keys = [
    "mode",
    "changeSetId",
    ...(mode === "prepare" ? [] : ["rollbackPlanId", "planHash"]),
    ...(mode === "execute_approved" ? ["approvalId"] : []),
  ];
  canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
  const changeSetId = canonicalBodyUuid(r.changeSetId, p + ".changeSetId");
  if (mode === "prepare") return { mode, changeSetId };
  const target = {
    changeSetId,
    rollbackPlanId: canonicalBodyUuid(r.rollbackPlanId, p + ".rollbackPlanId"),
    planHash: canonicalBodySha256Digest(r.planHash, p + ".planHash"),
  };
  return mode === "request_approval"
    ? { mode, ...target }
    : { mode, ...target, approvalId: canonicalBodyUuid(r.approvalId, p + ".approvalId") };
}
export function npRequireAgentChangeSetApplyCapabilityInputV1(
  value: unknown,
): NpAgentChangeSetApplyCapabilityInputV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.input", () => executionInput("changeset.apply", value)),
    "Invalid ChangeSet apply input",
  ) as NpAgentChangeSetApplyCapabilityInputV1;
}
export function npRequireAgentChangeSetScheduleCapabilityInputV1(
  value: unknown,
): NpAgentChangeSetScheduleCapabilityInputV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.input", () =>
      executionInput("changeset.schedule", value),
    ),
    "Invalid ChangeSet schedule input",
  ) as NpAgentChangeSetScheduleCapabilityInputV1;
}
export function npRequireAgentChangeSetRollbackCapabilityInputV1(
  value: unknown,
): NpAgentChangeSetRollbackCapabilityInputV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.input", () =>
      executionInput("changeset.rollback", value),
    ),
    "Invalid ChangeSet rollback input",
  ) as NpAgentChangeSetRollbackCapabilityInputV1;
}
export interface NpAgentChangeSetCapabilityInputMapV1 {
  "changeset.apply": NpAgentChangeSetApplyCapabilityInputV1;
  "changeset.schedule": NpAgentChangeSetScheduleCapabilityInputV1;
  "changeset.rollback": NpAgentChangeSetRollbackCapabilityInputV1;
  "changeset.create": NpAgentChangeSetDraftInputV1;
  "changeset.get": { changeSetId: string };
  "changeset.list": {
    states: NpAgentChangeSetState[];
    actorKinds: Array<"runtime" | "external" | "staff">;
    createdAfter: string | null;
    createdBefore: string | null;
    limit: number;
    cursor: string | null;
  };
  "changeset.validate": { changeSetId: string; draftVersion: number; draftHash: string };
  "changeset.preview": { changeSetId: string; planHash: string };
}
export interface NpAgentChangeSetOutputV1 {
  schemaVersion: "np.agent-changeset-result.v1";
  changeSet: NpAgentChangeSetWire;
}
export interface NpAgentChangeSetListOutputV1 {
  schemaVersion: "np.agent-changeset-list.v1";
  items: NpAgentChangeSetWire[];
  nextCursor: string | null;
}
export type NpAgentChangeSetExecutionOutputV1 = {
  schemaVersion: "np.agent-changeset-execution-result.v1";
  changeSet: NpAgentChangeSetWire;
  runId: string;
} & (
  | { state: "completed" }
  | { state: "accepted"; statusResource: string; pollAfterMs: number }
  | {
      state: "approval_required";
      actionId: string;
      approvalId: string;
      proposalHash: string;
      approvalResource: string;
      expiresAt: string;
    }
);
export interface NpAgentChangeSetCapabilityOutputMapV1 {
  "changeset.apply": NpAgentChangeSetExecutionOutputV1;
  "changeset.schedule": NpAgentChangeSetExecutionOutputV1;
  "changeset.rollback": NpAgentChangeSetExecutionOutputV1;
  "changeset.create": NpAgentChangeSetOutputV1;
  "changeset.get": NpAgentChangeSetOutputV1;
  "changeset.list": NpAgentChangeSetListOutputV1;
  "changeset.validate": NpAgentChangeSetOutputV1;
  "changeset.preview": NpAgentChangeSetOutputV1;
}
export interface NpAgentInstalledCapabilityInputMapV1
  extends NpAgentReadCapabilityInputMapV1, NpAgentChangeSetCapabilityInputMapV1 {}
export interface NpAgentInstalledCapabilityOutputMapV1
  extends NpAgentReadCapabilityOutputMapV1, NpAgentChangeSetCapabilityOutputMapV1 {}
export type NpAgentChangeSetCapabilityInvocationRequestV1 = {
  [C in NpAgentChangeSetCapabilityIdV1]: {
    schemaVersion: "np.agent-invocation-request.v1";
    capabilityId: C;
    arguments: {
      input: NpAgentChangeSetCapabilityInputMapV1[C];
      idempotencyKey: C extends "changeset.get" | "changeset.list" ? null : string;
    };
  };
}[NpAgentChangeSetCapabilityIdV1];
export type NpAgentInstalledCapabilityInvocationRequestV1 =
  NpAgentReadCapabilityInvocationRequestV1 | NpAgentChangeSetCapabilityInvocationRequestV1;
export interface NpAgentChangeSetCapabilityInvocationResultV1 {
  schemaVersion: "np.agent-changeset-invocation-result.v1";
  invocationId: string;
  capabilityId: NpAgentChangeSetCapabilityIdV1;
  output: NpAgentChangeSetCapabilityOutputMapV1[NpAgentChangeSetCapabilityIdV1];
}
const obj = npAgentSchemaObjectV1;
const uuid = { type: "string", format: "uuid", maxLength: 36 };
const digest = { type: "string", maxLength: 54, pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$" };
const nullable = (schema: NpAgentJsonValue) => ({ anyOf: [schema, { type: "null" }] });
const date = { type: "string", format: "date-time", maxLength: 24 };
const schemas: Record<NpAgentChangeSetCapabilityIdV1, NpAgentJsonObject> = {
  "changeset.apply": npAgentChangeSetApplyCapabilityInputSchemaV1,
  "changeset.schedule": npAgentChangeSetScheduleCapabilityInputSchemaV1,
  "changeset.rollback": npAgentChangeSetRollbackCapabilityInputSchemaV1,
  "changeset.create": npAgentChangeSetCreateInputSchemaV1,
  "changeset.get": obj({ changeSetId: uuid }),
  "changeset.validate": obj({
    changeSetId: uuid,
    draftVersion: { type: "integer", minimum: 1, maximum: 2147483647 },
    draftHash: digest,
  }),
  "changeset.preview": obj({ changeSetId: uuid, planHash: digest }),
  "changeset.list": obj({
    states: {
      type: "array",
      items: { type: "string", maxLength: 32, enum: [...npAgentChangeSetStates] },
      uniqueItems: true,
      maxItems: npAgentChangeSetStates.length,
    },
    actorKinds: {
      type: "array",
      items: { type: "string", maxLength: 8, enum: ["external", "runtime", "staff"] },
      uniqueItems: true,
      maxItems: 3,
    },
    createdAfter: nullable(date),
    createdBefore: nullable(date),
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: nullable({ type: "string", maxLength: 2048 }),
  }),
};
function descriptor(id: NpAgentChangeSetCapabilityIdV1): NpAgentCapabilityDescriptor {
  const execute = id === "changeset.apply" || id === "changeset.schedule";
  const rollback = id === "changeset.rollback";
  const create = id === "changeset.create";
  const read = id === "changeset.get" || id === "changeset.list";
  return npRequireAgentCapabilityDescriptor(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-capability.v1",
        id,
        contractVersion: 1,
        source: "core",
        title: {
          "changeset.apply": "Apply ChangeSet",
          "changeset.schedule": "Schedule ChangeSet",
          "changeset.rollback": "Rollback ChangeSet",
          "changeset.create": "Create ChangeSet",
          "changeset.get": "Get ChangeSet",
          "changeset.list": "List ChangeSets",
          "changeset.validate": "Validate ChangeSet",
          "changeset.preview": "Preview ChangeSet",
        }[id],
        description:
          execute || rollback
            ? "Request human approval or execute an exact approved ChangeSet under current authority and resource checks."
            : "Use current authority to prepare or read bounded ChangeSet evidence without applying production content.",
        requiredScopes: [
          execute || rollback ? "changeset:apply" : create ? "changeset:write" : "changeset:read",
        ],
        scopeDerivation: "changeset-resources",
        risk: execute ? "sensitive" : create ? "reversible" : "read",
        approval: execute ? "human" : "none",
        effectProfiles: execute
          ? [
              {
                id,
                kind: "mutation",
                reversibility: "none",
                minimumGatewayExposure: "approved-execute",
                verifierId: "changeset.verify",
                compensatorId: null,
              },
              {
                id: npAgentChangeSetExecutionPhasePoliciesV1[id].request_approval.effectProfileId,
                kind: "read",
                reversibility: "none",
                minimumGatewayExposure:
                  npAgentChangeSetExecutionPhasePoliciesV1[id].request_approval
                    .minimumGatewayExposure,
                verifierId: null,
                compensatorId: null,
              },
            ]
          : rollback
            ? [
                {
                  id: npAgentChangeSetRollbackModePoliciesV1.execute_approved.effectProfileId,
                  kind: "mutation",
                  reversibility: "none",
                  minimumGatewayExposure: "approved-execute",
                  verifierId: "changeset.verify",
                  compensatorId: null,
                },
                {
                  id: "domain.read",
                  kind: "read",
                  reversibility: "none",
                  minimumGatewayExposure: "propose",
                  verifierId: null,
                  compensatorId: null,
                },
              ]
            : [
                {
                  id: create ? "changeset.draft-create" : "domain.read",
                  kind: create ? "mutation" : "read",
                  reversibility: "none",
                  minimumGatewayExposure: read ? "read" : "propose",
                  verifierId: create ? "changeset.draft.verify" : null,
                  compensatorId: null,
                },
              ],
        bootstrapIntent: read ? "plugins" : "write",
        execution:
          execute || rollback || id === "changeset.preview"
            ? "durable"
            : id === "changeset.validate"
              ? "either"
              : "inline",
        idempotency: read ? "none" : "required",
        gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
        inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", ...schemas[id] },
        outputSchema:
          execute || rollback
            ? npAgentChangeSetExecutionOutputSchemaV1
            : id === "changeset.list"
              ? npAgentChangeSetListOutputSchemaV1
              : npAgentChangeSetOutputSchemaV1,
      }),
    ),
  );
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const npAgentChangeSetCapabilityDescriptorsV1: Readonly<
  Record<NpAgentChangeSetCapabilityIdV1, NpAgentCapabilityDescriptor>
> = freeze(
  Object.fromEntries(npAgentChangeSetCapabilityIdsV1.map((id) => [id, descriptor(id)])) as Record<
    NpAgentChangeSetCapabilityIdV1,
    NpAgentCapabilityDescriptor
  >,
);
export const npAgentInstalledCapabilityDescriptorsV1 = Object.freeze({
  ...npAgentReadCapabilityDescriptorsV1,
  ...npAgentChangeSetCapabilityDescriptorsV1,
});
export function npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(
  id: NpAgentChangeSetCapabilityIdV1,
) {
  const d = npAgentChangeSetCapabilityDescriptorsV1[id];
  return npRequireAgentCapabilityRegistryCanonical(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-capability-registry.v1",
        projection: "definition",
        capabilities: [
          {
            descriptor: d,
            implementationVersion: 1,
            effectProfiles: d.effectProfiles.map((p) => ({
              schemaVersion: "np.agent-effect-profile.v1",
              capabilityId: id,
              capabilityContractVersion: d.contractVersion,
              implementationVersion: 1,
              profileId: p.id,
              kind: p.kind,
              reversibility: p.reversibility,
              minimumGatewayExposure: p.minimumGatewayExposure,
              effectContractVersion: 1,
              verifierId: p.verifierId,
              compensatorId: p.compensatorId,
            })),
          },
        ],
      }),
    ),
  );
}
export function npIsAgentChangeSetCapabilityIdV1(id: string): id is NpAgentChangeSetCapabilityIdV1 {
  return (npAgentChangeSetCapabilityIdsV1 as readonly string[]).includes(id);
}
function input<C extends NpAgentChangeSetCapabilityIdV1>(
  id: C,
  value: unknown,
): NpAgentChangeSetCapabilityInputMapV1[C] {
  if (id === "changeset.apply" || id === "changeset.schedule" || id === "changeset.rollback")
    return executionInput(id, value) as NpAgentChangeSetCapabilityInputMapV1[C];
  if (id === "changeset.create")
    return npRequireAgentChangeSetDraftInputV1(value) as NpAgentChangeSetCapabilityInputMapV1[C];
  const p = "agent.capability.input";
  const state = { seen: new WeakSet<object>() };
  const keys = Object.keys(schemas[id].properties as object);
  const r = canonicalBodyRecord(value, p, keys, keys, state);
  if (id === "changeset.list") {
    const createdAfter =
      r.createdAfter === null ? null : canonicalBodyUtc(r.createdAfter, p + ".createdAfter");
    const createdBefore =
      r.createdBefore === null ? null : canonicalBodyUtc(r.createdBefore, p + ".createdBefore");
    if (createdAfter !== null && createdBefore !== null && createdAfter > createdBefore)
      failCanonicalBody("invalid-field", p, "dates must be ordered");
    return {
      states: parseSortedUniqueEnumArray(
        r.states,
        p + ".states",
        new Set(npAgentChangeSetStates),
        npAgentChangeSetStates.length,
        state,
      ),
      actorKinds: parseSortedUniqueEnumArray(
        r.actorKinds,
        p + ".actorKinds",
        new Set(["external", "runtime", "staff"] as const),
        3,
        state,
      ),
      createdAfter,
      createdBefore,
      limit: canonicalBodyInteger(r.limit, p + ".limit", 1, 100),
      cursor: r.cursor === null ? null : canonicalRuntimeText(r.cursor, p + ".cursor", 2048),
    } as NpAgentChangeSetCapabilityInputMapV1[C];
  }
  const changeSetId = canonicalBodyUuid(r.changeSetId, p + ".changeSetId");
  return (
    id === "changeset.get"
      ? { changeSetId }
      : id === "changeset.preview"
        ? { changeSetId, planHash: canonicalBodySha256Digest(r.planHash, p + ".planHash") }
        : {
            changeSetId,
            draftVersion: canonicalBodyInteger(r.draftVersion, p + ".draftVersion", 1, 2147483647),
            draftHash: canonicalBodySha256Digest(r.draftHash, p + ".draftHash"),
          }
  ) as NpAgentChangeSetCapabilityInputMapV1[C];
}
export function npRequireAgentInstalledCapabilityInputV1<C extends NpAgentInstalledCapabilityIdV1>(
  id: C,
  value: unknown,
): NpAgentInstalledCapabilityInputMapV1[C] {
  return (
    npIsAgentChangeSetCapabilityIdV1(id)
      ? npRequireAgentContractResult(
          analyzeCanonicalBody("agent.capability.input", () => input(id, value)),
          "Invalid capability input",
        )
      : npRequireAgentReadCapabilityInputV1(id, value)
  ) as NpAgentInstalledCapabilityInputMapV1[C];
}
export function npRequireAgentInstalledCapabilityInvocationRequestV1(
  value: unknown,
): NpAgentInstalledCapabilityInvocationRequestV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.request", () => {
      const p = "agent.capability.request";
      const r = canonicalBodyRecord(
        value,
        p,
        ["schemaVersion", "capabilityId", "arguments"],
        ["schemaVersion", "capabilityId", "arguments"],
        { seen: new WeakSet<object>() },
      );
      const id = canonicalBodyEnum<NpAgentInstalledCapabilityIdV1>(
        r.capabilityId,
        p + ".capabilityId",
        new Set(npAgentInstalledCapabilityIdsV1),
      );
      if (!npIsAgentChangeSetCapabilityIdV1(id))
        return npRequireAgentReadCapabilityInvocationRequestV1(value);
      if (r.schemaVersion !== "np.agent-invocation-request.v1")
        failCanonicalBody("invalid-field", p, "invalid schema version");
      const args = canonicalBodyRecord(
        r.arguments,
        p + ".arguments",
        ["input", "idempotencyKey"],
        ["input", "idempotencyKey"],
        { seen: new WeakSet<object>() },
      );
      const key = args.idempotencyKey;
      const read = id === "changeset.get" || id === "changeset.list";
      if (
        read
          ? key !== null
          : typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(key)
      )
        failCanonicalBody(
          "invalid-field",
          p + ".arguments.idempotencyKey",
          "must match capability idempotency",
        );
      return {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: id,
        arguments: { input: input(id, args.input), idempotencyKey: key },
      } as NpAgentChangeSetCapabilityInvocationRequestV1;
    }),
    "Invalid capability invocation",
  );
}
export function npRequireAgentChangeSetExecutionOutputV1(
  value: unknown,
): NpAgentChangeSetExecutionOutputV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.output", () => {
      const p = "agent.capability.output";
      const commonKeys = ["schemaVersion", "state", "changeSet", "runId"];
      const r = canonicalBodyRecord(
        value,
        p,
        [
          ...commonKeys,
          "statusResource",
          "pollAfterMs",
          "actionId",
          "approvalId",
          "proposalHash",
          "approvalResource",
          "expiresAt",
        ],
        commonKeys,
        { seen: new WeakSet<object>() },
      );
      if (r.schemaVersion !== "np.agent-changeset-execution-result.v1")
        failCanonicalBody("invalid-field", p, "invalid schema version");
      const state = canonicalBodyEnum<"completed" | "accepted" | "approval_required">(
        r.state,
        p + ".state",
        new Set(["completed", "accepted", "approval_required"]),
      );
      const keys = [
        ...commonKeys,
        ...(state === "accepted"
          ? ["statusResource", "pollAfterMs"]
          : state === "approval_required"
            ? ["actionId", "approvalId", "proposalHash", "approvalResource", "expiresAt"]
            : []),
      ];
      canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
      const base = {
        schemaVersion: "np.agent-changeset-execution-result.v1" as const,
        changeSet: npRequireAgentChangeSetWire(r.changeSet),
        runId: canonicalBodyUuid(r.runId, p + ".runId"),
      };
      let result: NpAgentChangeSetExecutionOutputV1;
      if (state === "accepted") {
        const statusResource = `/api/agent/v1/runs/${base.runId}`;
        if (r.statusResource !== statusResource)
          failCanonicalBody("invalid-field", p + ".statusResource", "must reference this run");
        result = {
          ...base,
          state,
          statusResource,
          pollAfterMs: canonicalBodyInteger(
            r.pollAfterMs,
            p + ".pollAfterMs",
            npAgentMcpTaskLimitsV1.pollIntervalMinMs,
            npAgentMcpTaskLimitsV1.pollIntervalMaxMs,
          ),
        };
      } else if (state === "approval_required") {
        const approvalId = canonicalBodyUuid(r.approvalId, p + ".approvalId");
        const approvalResource = `/admin/agents/approvals/${approvalId}`;
        if (r.approvalResource !== approvalResource)
          failCanonicalBody(
            "invalid-field",
            p + ".approvalResource",
            "must reference this approval",
          );
        result = {
          ...base,
          state,
          approvalId,
          approvalResource,
          actionId: canonicalBodyUuid(r.actionId, p + ".actionId"),
          proposalHash: canonicalBodySha256Digest(r.proposalHash, p + ".proposalHash"),
          expiresAt: canonicalBodyUtc(r.expiresAt, p + ".expiresAt"),
        };
        const rollback = base.changeSet.rollback;
        const approval = base.changeSet.approval;
        if (!(
          (approval?.id === approvalId && base.changeSet.planHash === result.proposalHash) ||
          (rollback?.approvalId === approvalId && rollback.planHash === result.proposalHash)
        ))
          failCanonicalBody(
            "invalid-field",
            p,
            "approval must match the projected ChangeSet or rollback target",
          );
      } else result = { ...base, state };
      if (
        new TextEncoder().encode(JSON.stringify(result)).byteLength >
        npAgentChangeSetLimits.wireBytes
      )
        failCanonicalBody("limit", p, "output exceeds aggregate wire limit");
      return result;
    }),
    "Invalid ChangeSet execution output",
  );
}
export function npRequireAgentInstalledCapabilityOutputV1<C extends NpAgentInstalledCapabilityIdV1>(
  id: C,
  value: unknown,
): NpAgentInstalledCapabilityOutputMapV1[C] {
  if (id === "changeset.apply" || id === "changeset.schedule" || id === "changeset.rollback")
    return npRequireAgentChangeSetExecutionOutputV1(
      value,
    ) as NpAgentInstalledCapabilityOutputMapV1[C];
  if (!npIsAgentChangeSetCapabilityIdV1(id))
    return npRequireAgentReadCapabilityOutputV1(
      id,
      value,
    ) as NpAgentInstalledCapabilityOutputMapV1[C];
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.output", () => {
      const p = "agent.capability.output";
      const list = id === "changeset.list";
      const keys = list ? ["schemaVersion", "items", "nextCursor"] : ["schemaVersion", "changeSet"];
      const r = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
      const schemaVersion = list ? "np.agent-changeset-list.v1" : "np.agent-changeset-result.v1";
      if (r.schemaVersion !== schemaVersion)
        failCanonicalBody("invalid-field", p, "invalid schema version");
      const result = list
        ? npRequireAgentCursorPageV1(value, {
            schemaVersion: "np.agent-changeset-list.v1",
            analyzeItem: npAnalyzeAgentChangeSetWire,
            itemIssueRoot: "agent.changeset.wire",
            maximumItems: 100,
            maximumBytes: npAgentChangeSetLimits.wireBytes,
            maximumDepth: 64,
          })
        : { schemaVersion, changeSet: npRequireAgentChangeSetWire(r.changeSet) };
      if (
        new TextEncoder().encode(JSON.stringify(result)).byteLength >
        npAgentChangeSetLimits.wireBytes
      )
        failCanonicalBody("limit", p, "output exceeds aggregate wire limit");
      return result;
    }),
    "Invalid capability output",
  ) as NpAgentInstalledCapabilityOutputMapV1[C];
}
export function npRequireAgentChangeSetCapabilityInvocationResultV1(
  value: unknown,
): NpAgentChangeSetCapabilityInvocationResultV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.capability.result", () => {
      const p = "agent.capability.result";
      const keys = ["schemaVersion", "invocationId", "capabilityId", "output"];
      const r = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
      if (r.schemaVersion !== "np.agent-changeset-invocation-result.v1")
        failCanonicalBody("invalid-field", p, "invalid schema version");
      const capabilityId = canonicalBodyEnum<NpAgentChangeSetCapabilityIdV1>(
        r.capabilityId,
        p + ".capabilityId",
        new Set(npAgentChangeSetCapabilityIdsV1),
      );
      return {
        schemaVersion: "np.agent-changeset-invocation-result.v1",
        invocationId: canonicalBodyUuid(r.invocationId, p + ".invocationId"),
        capabilityId,
        output: npRequireAgentInstalledCapabilityOutputV1(capabilityId, r.output),
      };
    }),
    "Invalid capability result",
  );
}
