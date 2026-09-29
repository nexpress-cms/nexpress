import { npAuthUuidPattern } from "../auth-contract/index.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodySha256Digest,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npRequireAgentCapabilityDescriptor, npRequireAgentContractResult } from "./contract.js";
import { npRequireAgentCapabilityRegistryCanonical } from "./canonical-capability-registry.js";
import type {
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentJsonValue,
  NpAgentCapabilityDescriptor,
} from "./types.js";

export const npAgentAuditCheckFamilies = [
  "contracts",
  "content",
  "links",
  "seo",
  "accessibility",
  "jobs",
  "storage",
  "plugins",
  "security",
] as const;
export const npAgentOpsCheckFamilies = [
  "readiness",
  "jobs",
  "storage",
  "backup",
  "plugins",
  "cache",
  "agents",
] as const;
export type NpAgentAuditCheckFamily = (typeof npAgentAuditCheckFamilies)[number];
export type NpAgentOpsCheckFamily = (typeof npAgentOpsCheckFamilies)[number];
export interface NpAgentAuditRunInputV1 {
  families: NpAgentAuditCheckFamily[];
  collections: string[];
  maxTargets: number;
}
export interface NpAgentOpsStatusInputV1 {
  families: NpAgentOpsCheckFamily[];
}
/** The shipped np.ops.v1 structure, shared with the local CLI. */
export interface NpOpsStatusV1 {
  schemaVersion: "np.ops.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  summary: { total: number; errors: number; warnings: number };
  nextCommand: string | null;
  projectNextCommand: string | null;
  checks: Array<{
    id: string;
    state: "ok" | "warn" | "error";
    label: string;
    detail?: string;
    hint?: string;
    pluginIds?: string[];
  }>;
}
export interface NpAgentOpsStatusOutputV1 {
  schemaVersion: "np.agent-ops-status.v1";
  report: NpOpsStatusV1;
  digest: string;
}
export interface NpAgentAuditCheckV1 {
  id: string;
  family: NpAgentAuditCheckFamily;
  status: "pass" | "warn" | "fail" | "unknown";
  evidenceRefs: string[];
}
export type NpAgentAuditRunOutputV1 =
  | {
      schemaVersion: "np.agent-audit.v1";
      auditId: string;
      state: "queued";
      checks: [];
      digest: null;
    }
  | {
      schemaVersion: "np.agent-audit.v1";
      auditId: string;
      state: "completed";
      checks: NpAgentAuditCheckV1[];
      digest: string;
    };
export type NpAgentOpsPlanInputV1 =
  | {
      action: "cache.revalidate";
      target:
        | { kind: "site" }
        | { kind: "collection"; collection: string }
        | { kind: "document"; collection: string; documentSlug: string }
        | { kind: "navigation"; location: string };
    }
  | { action: "agent.run.retry" | "agent.run.cancel"; target: { kind: "run"; runId: string } }
  | { action: "migration.plan"; target: { kind: "site" } }
  | { action: "restore.plan"; target: { kind: "backup"; manifestId: string } }
  | { action: "storage.migration.plan"; target: { kind: "storage"; adapterId: string } }
  | {
      action: "plugin.change.plan";
      target: { kind: "plugin"; pluginId: string; operation: "enable" | "disable" | "upgrade" };
    }
  | {
      action: "queue.global.plan";
      target: {
        kind: "queue";
        operation: "pause" | "drain" | "retry-failed";
        jobName: string | null;
      };
    };
export type NpAgentExecutableOpsPlanInputV1 = Extract<
  NpAgentOpsPlanInputV1,
  { action: "cache.revalidate" | "agent.run.retry" | "agent.run.cancel" }
>;
export type NpAgentPlanOnlyOpsPlanInputV1 = Exclude<
  NpAgentOpsPlanInputV1,
  NpAgentExecutableOpsPlanInputV1
>;
export interface NpAgentOpsPlanOutputCommonV1 {
  schemaVersion: "np.agent-ops-plan.v1";
  planId: string;
  planDigest: string;
  checks: Array<{ id: string; status: "pass" | "warn" | "fail" }>;
  expiresAt: string;
}
export type NpAgentOpsPlanOutputV1 = NpAgentOpsPlanOutputCommonV1 &
  (
    | {
        operation: NpAgentExecutableOpsPlanInputV1;
        execution: { kind: "agent-executable"; approvalId: string; approvalResource: string };
      }
    | {
        operation: NpAgentPlanOnlyOpsPlanInputV1;
        execution: {
          kind: "local-cli-handoff";
          contractId: string;
          planArtifactId: string;
          projectCommand: string;
        };
      }
  );
const actions = [
  "cache.revalidate",
  "agent.run.retry",
  "agent.run.cancel",
  "migration.plan",
  "restore.plan",
  "storage.migration.plan",
  "plugin.change.plan",
  "queue.global.plan",
] as const;
const path = "agent.operator";
const bad = (): never =>
  failCanonicalBody("invalid-field", path, "Invalid bounded Operator contract");
function record(value: unknown, keys: string[], optional: string[] = []) {
  return canonicalBodyRecord(value, path, [...keys, ...optional], keys, {
    seen: new WeakSet<object>(),
  });
}
function token(value: unknown, maximum = 128): string {
  const result = canonicalBodyAscii(value, path, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u.test(result)) bad();
  return result;
}
function textValue(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maximum ||
    value !== value.trim() ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return bad();
  return value;
}
function list(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return bad();
  return value;
}
function unique<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum: number,
  minimum = 0,
): T[] {
  const result = list(value, maximum, minimum).map((v) =>
    canonicalBodyEnum<T>(v, path, new Set(allowed)),
  );
  if (new Set(result).size !== result.length) bad();
  return result;
}
function tokens(value: unknown, maximum: number): string[] {
  const result = list(value, maximum).map((v) => token(v));
  if (new Set(result).size !== result.length) bad();
  return result;
}
function clone(value: unknown) {
  return cloneCanonicalRuntimeInput(value, path, 262144);
}
function analyze<T>(value: unknown, parser: (value: unknown) => T) {
  return analyzeCanonicalBody(path, () => parser(clone(value)));
}
function auditInput(value: unknown): NpAgentAuditRunInputV1 {
  const r = record(value, ["families", "collections", "maxTargets"]);
  return {
    families: unique(r.families, npAgentAuditCheckFamilies, 9, 1),
    collections: tokens(r.collections, 64),
    maxTargets: canonicalBodyInteger(r.maxTargets, path, 1, 1000),
  };
}
function statusInput(value: unknown): NpAgentOpsStatusInputV1 {
  const r = record(value, ["families"]);
  return { families: unique(r.families, npAgentOpsCheckFamilies, 7, 1) };
}
function statusReport(value: unknown): NpOpsStatusV1 {
  const report = record(value, [
    "schemaVersion",
    "ok",
    "status",
    "summary",
    "nextCommand",
    "projectNextCommand",
    "checks",
  ]);
  if (
    report.schemaVersion !== "np.ops.v1" ||
    report.nextCommand !== null ||
    report.projectNextCommand !== null
  )
    bad();
  const ids = new Set<string>();
  const checks = list(report.checks, 128, 1).map((value) => {
    const check = record(value, ["id", "state", "label"], ["detail", "hint", "pluginIds"]);
    const id = token(check.id);
    if (ids.has(id)) bad();
    ids.add(id);
    return {
      id,
      state: canonicalBodyEnum<"ok" | "warn" | "error">(
        check.state,
        path,
        new Set(["ok", "warn", "error"]),
      ),
      label: textValue(check.label, 160),
      ...(check.detail === undefined ? {} : { detail: textValue(check.detail, 500) }),
      ...(check.hint === undefined ? {} : { hint: textValue(check.hint, 500) }),
      ...(check.pluginIds === undefined ? {} : { pluginIds: tokens(check.pluginIds, 32) }),
    };
  });
  const summary = record(report.summary, ["total", "errors", "warnings"]);
  const errors = checks.filter((c) => c.state === "error").length;
  const warnings = checks.filter((c) => c.state === "warn").length;
  const status = errors ? "blocked" : warnings ? "attention" : "ready";
  if (
    summary.total !== checks.length ||
    summary.errors !== errors ||
    summary.warnings !== warnings ||
    report.ok !== (errors === 0) ||
    report.status !== status
  )
    bad();
  return {
    schemaVersion: "np.ops.v1",
    ok: errors === 0,
    status,
    summary: { total: checks.length, errors, warnings },
    nextCommand: null,
    projectNextCommand: null,
    checks,
  };
}
function statusOutput(value: unknown): NpAgentOpsStatusOutputV1 {
  const r = record(value, ["schemaVersion", "report", "digest"]);
  if (r.schemaVersion !== "np.agent-ops-status.v1") bad();
  return {
    schemaVersion: "np.agent-ops-status.v1",
    report: statusReport(r.report),
    digest: canonicalBodySha256Digest(r.digest, path),
  };
}
export async function npDigestAgentOpsStatusReportV1(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  const report = npRequireAgentContractResult(analyze(value, statusReport));
  return digestAgentCanonicalSha256(
    new TextEncoder().encode("np.agent-ops-status.v1\0" + serializeAgentCanonicalJson(report)),
  );
}
function auditOutput(value: unknown): NpAgentAuditRunOutputV1 {
  const r = record(value, ["schemaVersion", "auditId", "state", "checks", "digest"]);
  if (r.schemaVersion !== "np.agent-audit.v1") bad();
  const auditId = canonicalBodyUuid(r.auditId, path);
  if (r.state === "queued") {
    if (r.digest !== null || list(r.checks, 0).length) bad();
    return {
      schemaVersion: "np.agent-audit.v1",
      auditId,
      state: "queued",
      checks: [],
      digest: null,
    };
  }
  if (r.state !== "completed") bad();
  const ids = new Set<string>();
  const checks = list(r.checks, 128, 1).map((value) => {
    const c = record(value, ["id", "family", "status", "evidenceRefs"]);
    const id = token(c.id);
    if (ids.has(id)) bad();
    ids.add(id);
    return {
      id,
      family: canonicalBodyEnum<NpAgentAuditCheckFamily>(
        c.family,
        path,
        new Set(npAgentAuditCheckFamilies),
      ),
      status: canonicalBodyEnum<NpAgentAuditCheckV1["status"]>(
        c.status,
        path,
        new Set(["pass", "warn", "fail", "unknown"]),
      ),
      evidenceRefs: tokens(c.evidenceRefs, 32),
    };
  });
  return {
    schemaVersion: "np.agent-audit.v1",
    auditId,
    state: "completed",
    checks,
    digest: canonicalBodySha256Digest(r.digest, path),
  };
}
function planInput(value: unknown): NpAgentOpsPlanInputV1 {
  const r = record(value, ["action", "target"]);
  const action = canonicalBodyEnum<NpAgentOpsPlanInputV1["action"]>(
    r.action,
    path,
    new Set(actions),
  );
  if (action === "cache.revalidate") {
    const t = record(r.target, ["kind"], ["collection", "documentSlug", "location"]);
    if (t.kind === "site") {
      record(t, ["kind"]);
      return { action, target: { kind: "site" } };
    }
    if (t.kind === "collection") {
      record(t, ["kind", "collection"]);
      return { action, target: { kind: "collection", collection: token(t.collection) } };
    }
    if (t.kind === "document") {
      record(t, ["kind", "collection", "documentSlug"]);
      return {
        action,
        target: {
          kind: "document",
          collection: token(t.collection),
          documentSlug: token(t.documentSlug),
        },
      };
    }
    if (t.kind === "navigation") {
      record(t, ["kind", "location"]);
      return { action, target: { kind: "navigation", location: token(t.location) } };
    }
    return bad();
  }
  if (action === "agent.run.retry" || action === "agent.run.cancel") {
    const t = record(r.target, ["kind", "runId"]);
    if (t.kind !== "run") bad();
    return { action, target: { kind: "run", runId: canonicalBodyUuid(t.runId, path) } };
  }
  if (action === "migration.plan") {
    const t = record(r.target, ["kind"]);
    if (t.kind !== "site") bad();
    return { action, target: { kind: "site" } };
  }
  if (action === "restore.plan") {
    const t = record(r.target, ["kind", "manifestId"]);
    if (t.kind !== "backup") bad();
    return { action, target: { kind: "backup", manifestId: token(t.manifestId) } };
  }
  if (action === "storage.migration.plan") {
    const t = record(r.target, ["kind", "adapterId"]);
    if (t.kind !== "storage") bad();
    return { action, target: { kind: "storage", adapterId: token(t.adapterId) } };
  }
  if (action === "plugin.change.plan") {
    const t = record(r.target, ["kind", "pluginId", "operation"]);
    if (t.kind !== "plugin") bad();
    return {
      action,
      target: {
        kind: "plugin",
        pluginId: token(t.pluginId),
        operation: canonicalBodyEnum(
          t.operation,
          path,
          new Set(["enable", "disable", "upgrade"] as const),
        ),
      },
    };
  }
  const t = record(r.target, ["kind", "operation", "jobName"]);
  if (t.kind !== "queue") bad();
  return {
    action,
    target: {
      kind: "queue",
      operation: canonicalBodyEnum(
        t.operation,
        path,
        new Set(["pause", "drain", "retry-failed"] as const),
      ),
      jobName: t.jobName === null ? null : token(t.jobName),
    },
  };
}
function executablePlan(value: NpAgentOpsPlanInputV1): value is NpAgentExecutableOpsPlanInputV1 {
  return (
    value.action === "cache.revalidate" ||
    value.action === "agent.run.retry" ||
    value.action === "agent.run.cancel"
  );
}
function planOutput(value: unknown): NpAgentOpsPlanOutputV1 {
  const r = record(value, [
    "schemaVersion",
    "planId",
    "planDigest",
    "checks",
    "expiresAt",
    "operation",
    "execution",
  ]);
  if (r.schemaVersion !== "np.agent-ops-plan.v1") bad();
  const ids = new Set<string>();
  const common: NpAgentOpsPlanOutputCommonV1 = {
    schemaVersion: "np.agent-ops-plan.v1",
    planId: canonicalBodyUuid(r.planId, path),
    planDigest: canonicalBodySha256Digest(r.planDigest, path),
    expiresAt: canonicalBodyUtc(r.expiresAt, path),
    checks: list(r.checks, 128, 1).map((v) => {
      const c = record(v, ["id", "status"]);
      const id = token(c.id);
      if (ids.has(id)) bad();
      ids.add(id);
      return {
        id,
        status: canonicalBodyEnum(c.status, path, new Set(["pass", "warn", "fail"] as const)),
      };
    }),
  };
  const operation = planInput(r.operation);
  if (executablePlan(operation)) {
    const e = record(r.execution, ["kind", "approvalId", "approvalResource"]);
    if (e.kind !== "agent-executable") bad();
    return {
      ...common,
      operation,
      execution: {
        kind: "agent-executable",
        approvalId: canonicalBodyUuid(e.approvalId, path),
        approvalResource: token(e.approvalResource, 512),
      },
    };
  }
  const e = record(r.execution, ["kind", "contractId", "planArtifactId", "projectCommand"]);
  if (e.kind !== "local-cli-handoff") bad();
  return {
    ...common,
    operation,
    execution: {
      kind: "local-cli-handoff",
      contractId: token(e.contractId),
      planArtifactId: canonicalBodyUuid(e.planArtifactId, path),
      projectCommand: textValue(e.projectCommand, 512),
    },
  };
}
export const npAnalyzeAgentOpsStatusInputV1 = (v: unknown) => analyze(v, statusInput);
export const npAnalyzeAgentOpsStatusOutputV1 = (v: unknown) => analyze(v, statusOutput);
export const npRequireAgentOpsStatusInputV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentOpsStatusInputV1(v));
export const npRequireAgentOpsStatusOutputV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentOpsStatusOutputV1(v));
export const npRequireAgentAuditRunInputV1 = (v: unknown) =>
  npRequireAgentContractResult(analyze(v, auditInput));
export const npRequireAgentAuditRunOutputV1 = (v: unknown) =>
  npRequireAgentContractResult(analyze(v, auditOutput));
export const npRequireAgentOpsPlanInputV1 = (v: unknown) =>
  npRequireAgentContractResult(analyze(v, planInput));
export const npRequireAgentOpsPlanOutputV1 = (v: unknown) =>
  npRequireAgentContractResult(analyze(v, planOutput));

const meta = "https://json-schema.org/draft/2020-12/schema";
const obj = (
  properties: NpAgentJsonObject,
  required = Object.keys(properties),
): NpAgentJsonSchema =>
  JSON.parse(
    JSON.stringify({
      $schema: meta,
      type: "object",
      additionalProperties: false,
      properties,
      required,
    }),
  ) as NpAgentJsonSchema;
const str = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: "^(?![\\s\\S]*[\\u0000-\\u001f\\u007f])\\S(?:[\\s\\S]*\\S)?$",
});
const tok = { ...str(128), pattern: "^[A-Za-z0-9][A-Za-z0-9._:/@-]*$" };
const uuid = { type: "string", pattern: npAuthUuidPattern, minLength: 36, maxLength: 36 };
const hash = { type: "string", maxLength: 54, pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$" };
const arr = (items: NpAgentJsonValue, maxItems: number, minItems = 0) => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
const choices = (values: readonly string[]) => ({
  type: "string",
  enum: [...values],
  maxLength: Math.max(...values.map((v) => v.length)),
});
const familyArray = (values: readonly string[]) => ({
  ...arr(choices(values), values.length, 1),
  uniqueItems: true,
});
export const npAgentOpsStatusInputSchemaV1 = obj({
  families: familyArray(npAgentOpsCheckFamilies),
});
export const npAgentAuditRunInputSchemaV1 = obj({
  families: familyArray(npAgentAuditCheckFamilies),
  collections: { ...arr(tok, 64), uniqueItems: true },
  maxTargets: { type: "integer", minimum: 1, maximum: 1000 },
});
const checkSchema = obj(
  {
    id: tok,
    state: choices(["ok", "warn", "error"]),
    label: str(160),
    detail: str(500),
    hint: str(500),
    pluginIds: { ...arr(tok, 32), uniqueItems: true },
  },
  ["id", "state", "label"],
);
export const npAgentOpsStatusOutputSchemaV1 = obj({
  schemaVersion: { const: "np.agent-ops-status.v1" },
  report: obj({
    schemaVersion: { const: "np.ops.v1" },
    ok: { type: "boolean" },
    status: choices(["ready", "attention", "blocked"]),
    summary: obj({
      total: { type: "integer", minimum: 1, maximum: 128 },
      errors: { type: "integer", minimum: 0, maximum: 128 },
      warnings: { type: "integer", minimum: 0, maximum: 128 },
    }),
    nextCommand: { type: "null" },
    projectNextCommand: { type: "null" },
    checks: arr(checkSchema, 128, 1),
  }),
  digest: hash,
});
const auditCheck = obj({
  id: tok,
  family: choices(npAgentAuditCheckFamilies),
  status: choices(["pass", "warn", "fail", "unknown"]),
  evidenceRefs: { ...arr(tok, 32), uniqueItems: true },
});
export const npAgentAuditRunOutputSchemaV1: NpAgentJsonSchema = {
  ...obj({
    schemaVersion: { const: "np.agent-audit.v1" },
    auditId: uuid,
    state: choices(["queued", "completed"]),
    checks: arr(auditCheck, 128),
    digest: { anyOf: [hash, { type: "null" }] },
  }),
  oneOf: [
    {
      properties: {
        state: { const: "queued" },
        checks: arr(auditCheck, 0),
        digest: { type: "null" },
      },
    },
    {
      properties: { state: { const: "completed" }, checks: arr(auditCheck, 128, 1), digest: hash },
    },
  ],
};
const target = (kind: string, fields: NpAgentJsonObject = {}) =>
  obj({ kind: { const: kind }, ...fields });
const planBranches = [
  obj({
    action: { const: "cache.revalidate" },
    target: {
      oneOf: [
        target("site"),
        target("collection", { collection: tok }),
        target("document", { collection: tok, documentSlug: tok }),
        target("navigation", { location: tok }),
      ],
    },
  }),
  ...["agent.run.retry", "agent.run.cancel"].map((action) =>
    obj({ action: { const: action }, target: target("run", { runId: uuid }) }),
  ),
  obj({ action: { const: "migration.plan" }, target: target("site") }),
  obj({ action: { const: "restore.plan" }, target: target("backup", { manifestId: tok }) }),
  obj({
    action: { const: "storage.migration.plan" },
    target: target("storage", { adapterId: tok }),
  }),
  obj({
    action: { const: "plugin.change.plan" },
    target: target("plugin", {
      pluginId: tok,
      operation: choices(["enable", "disable", "upgrade"]),
    }),
  }),
  obj({
    action: { const: "queue.global.plan" },
    target: target("queue", {
      operation: choices(["pause", "drain", "retry-failed"]),
      jobName: { anyOf: [tok, { type: "null" }] },
    }),
  }),
];
export const npAgentOpsPlanInputSchemaV1: NpAgentJsonSchema = {
  ...obj({
    action: choices(actions),
    target: {
      anyOf: planBranches.map((branch) => (branch.properties as NpAgentJsonObject).target),
    },
  }),
  oneOf: planBranches,
};
const planCommon = {
  schemaVersion: { const: "np.agent-ops-plan.v1" },
  planId: uuid,
  planDigest: hash,
  checks: arr(obj({ id: tok, status: choices(["pass", "warn", "fail"]) }), 128, 1),
  expiresAt: { type: "string", format: "date-time", maxLength: 24 },
};
const executable = obj({
  ...planCommon,
  operation: { oneOf: planBranches.slice(0, 3) },
  execution: obj({
    kind: { const: "agent-executable" },
    approvalId: uuid,
    approvalResource: { ...tok, maxLength: 512 },
  }),
});
const handoff = obj({
  ...planCommon,
  operation: { oneOf: planBranches.slice(3) },
  execution: obj({
    kind: { const: "local-cli-handoff" },
    contractId: tok,
    planArtifactId: uuid,
    projectCommand: str(512),
  }),
});
export const npAgentOpsPlanOutputSchemaV1: NpAgentJsonSchema = {
  ...obj({
    ...planCommon,
    operation: npAgentOpsPlanInputSchemaV1,
    execution: {
      anyOf: [
        (executable.properties as NpAgentJsonObject).execution,
        (handoff.properties as NpAgentJsonObject).execution,
      ],
    },
  }),
  oneOf: [executable, handoff],
};

/** ops.status is installed by the existing read registry; these two require durable identity. */
export const npAgentOperatorCapabilityIdsV1 = ["audit.run", "ops.plan"] as const;
export type NpAgentOperatorCapabilityIdV1 = (typeof npAgentOperatorCapabilityIdsV1)[number];
export interface NpAgentOperatorCapabilityInputMapV1 {
  "audit.run": NpAgentAuditRunInputV1;
  "ops.plan": NpAgentOpsPlanInputV1;
}
export interface NpAgentOperatorCapabilityOutputMapV1 {
  "audit.run": NpAgentAuditRunOutputV1;
  "ops.plan": NpAgentOpsPlanOutputV1;
}
export type NpAgentOperatorCapabilityInvocationRequestV1 = {
  [C in NpAgentOperatorCapabilityIdV1]: {
    schemaVersion: "np.agent-invocation-request.v1";
    capabilityId: C;
    arguments: { input: NpAgentOperatorCapabilityInputMapV1[C]; idempotencyKey: string };
  };
}[NpAgentOperatorCapabilityIdV1];
export interface NpAgentOperatorCapabilityInvocationResultV1 {
  schemaVersion: "np.agent-operator-invocation-result.v1";
  invocationId: string;
  capabilityId: NpAgentOperatorCapabilityIdV1;
  output: NpAgentOperatorCapabilityOutputMapV1[NpAgentOperatorCapabilityIdV1];
}
export const npIsAgentOperatorCapabilityIdV1 = (id: string): id is NpAgentOperatorCapabilityIdV1 =>
  (npAgentOperatorCapabilityIdsV1 as readonly string[]).includes(id);
export function npRequireAgentOperatorCapabilityInputV1<C extends NpAgentOperatorCapabilityIdV1>(
  id: C,
  value: unknown,
): NpAgentOperatorCapabilityInputMapV1[C] {
  if (!npIsAgentOperatorCapabilityIdV1(id)) bad();
  return (
    id === "audit.run" ? npRequireAgentAuditRunInputV1(value) : npRequireAgentOpsPlanInputV1(value)
  ) as NpAgentOperatorCapabilityInputMapV1[C];
}
export function npRequireAgentOperatorCapabilityOutputV1<C extends NpAgentOperatorCapabilityIdV1>(
  id: C,
  value: unknown,
): NpAgentOperatorCapabilityOutputMapV1[C] {
  if (!npIsAgentOperatorCapabilityIdV1(id)) bad();
  return (
    id === "audit.run"
      ? npRequireAgentAuditRunOutputV1(value)
      : npRequireAgentOpsPlanOutputV1(value)
  ) as NpAgentOperatorCapabilityOutputMapV1[C];
}
export function npRequireAgentOperatorCapabilityInvocationRequestV1(
  value: unknown,
): NpAgentOperatorCapabilityInvocationRequestV1 {
  return npRequireAgentContractResult(
    analyze(value, (v) => {
      const r = record(v, ["schemaVersion", "capabilityId", "arguments"]);
      if (r.schemaVersion !== "np.agent-invocation-request.v1") bad();
      const capabilityId = canonicalBodyEnum<NpAgentOperatorCapabilityIdV1>(
        r.capabilityId,
        path,
        new Set(npAgentOperatorCapabilityIdsV1),
      );
      const a = record(r.arguments, ["input", "idempotencyKey"]);
      if (
        typeof a.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(a.idempotencyKey)
      )
        bad();
      return {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId,
        arguments: {
          input: npRequireAgentOperatorCapabilityInputV1(capabilityId, a.input),
          idempotencyKey: a.idempotencyKey,
        },
      } as NpAgentOperatorCapabilityInvocationRequestV1;
    }),
  );
}
export function npRequireAgentOperatorCapabilityInvocationResultV1(
  value: unknown,
): NpAgentOperatorCapabilityInvocationResultV1 {
  return npRequireAgentContractResult(
    analyze(value, (v) => {
      const r = record(v, ["schemaVersion", "invocationId", "capabilityId", "output"]);
      if (r.schemaVersion !== "np.agent-operator-invocation-result.v1") bad();
      const capabilityId = canonicalBodyEnum<NpAgentOperatorCapabilityIdV1>(
        r.capabilityId,
        path,
        new Set(npAgentOperatorCapabilityIdsV1),
      );
      return {
        schemaVersion: "np.agent-operator-invocation-result.v1",
        invocationId: canonicalBodyUuid(r.invocationId, path),
        capabilityId,
        output: npRequireAgentOperatorCapabilityOutputV1(capabilityId, r.output),
      };
    }),
  );
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function descriptor(id: NpAgentOperatorCapabilityIdV1): NpAgentCapabilityDescriptor {
  return npRequireAgentCapabilityDescriptor(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-capability.v1",
        id,
        contractVersion: 1,
        source: "core",
        title: id === "audit.run" ? "Run bounded site audit" : "Prepare operations plan",
        description:
          "Read authorized operations evidence and retain an exact audit or owner-generated plan without executing its effects.",
        requiredScopes: [id === "audit.run" ? "audit:run" : "ops:plan"],
        scopeDerivation: id === "audit.run" ? "audit-selection" : "ops-action",
        risk: "read",
        approval: "none",
        effectProfiles: [
          {
            id: "domain.read",
            kind: "read",
            reversibility: "none",
            minimumGatewayExposure: id === "audit.run" ? "read" : "propose",
            verifierId: null,
            compensatorId: null,
          },
        ],
        bootstrapIntent: "write",
        execution: id === "audit.run" ? "durable" : "either",
        idempotency: "required",
        gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
        inputSchema:
          id === "audit.run" ? npAgentAuditRunInputSchemaV1 : npAgentOpsPlanInputSchemaV1,
        outputSchema:
          id === "audit.run" ? npAgentAuditRunOutputSchemaV1 : npAgentOpsPlanOutputSchemaV1,
      }),
    ),
  );
}
export const npAgentOperatorCapabilityDescriptorsV1 = freeze({
  "audit.run": descriptor("audit.run"),
  "ops.plan": descriptor("ops.plan"),
});
export function npBuildAgentOperatorCapabilityDefinitionCanonicalV1(
  id: NpAgentOperatorCapabilityIdV1,
) {
  const descriptor = npAgentOperatorCapabilityDescriptorsV1[id];
  return npRequireAgentCapabilityRegistryCanonical(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-capability-registry.v1",
        projection: "definition",
        capabilities: [
          {
            descriptor,
            implementationVersion: 1,
            effectProfiles: descriptor.effectProfiles.map((p) => ({
              schemaVersion: "np.agent-effect-profile.v1",
              capabilityId: id,
              capabilityContractVersion: 1,
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
