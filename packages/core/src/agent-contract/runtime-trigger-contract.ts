import { CronExpressionParser } from "cron-parser";
import { npValidatePluginCronExpression } from "../plugins/scheduled-task-contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  parseCanonicalInteger,
  parseCanonicalUuid,
} from "./canonical-runtime-primitives.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { npRequireAgentEventCanonical } from "./canonical-events.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentEventKinds,
  type NpAgentContractResult,
  type NpAgentEventCanonicalV1,
  type NpAgentEventKind,
} from "./types.js";

export const npAgentTriggerFieldsV1 = [
  "privacy",
  "source.kind",
  "subject.kind",
  "payload.outcome",
  "payload.reasonCode",
  "payload.status",
  "payload.category",
  "payload.severity",
  "payload.count",
] as const;
export type NpAgentTriggerField = (typeof npAgentTriggerFieldsV1)[number];
export type NpAgentTriggerScalar = string | number | boolean;
export type NpAgentTriggerFilter =
  | { op: "eq"; field: NpAgentTriggerField; value: NpAgentTriggerScalar }
  | { op: "in"; field: NpAgentTriggerField; values: NpAgentTriggerScalar[] }
  | { op: "gte" | "lte"; field: "payload.count"; value: number }
  | { op: "all" | "any"; terms: NpAgentTriggerFilter[] };
export type NpAgentTrigger =
  | {
      type: "event";
      id: string;
      eventKind: NpAgentEventKind;
      filter: NpAgentTriggerFilter;
      coalesceSeconds: number;
    }
  | { type: "schedule"; id: string; cron: string; catchUp: "skip" | "once" }
  | { type: "manual"; id: string };

const kinds = new Set<string>(npAgentEventKinds);
const fields = new Set<string>(npAgentTriggerFieldsV1);
const reasonKinds = new Set<NpAgentEventKind>([
  "auth.login.failed",
  "auth.login.succeeded",
  "auth.session.revoked",
  "authz.denied",
  "jobs.handler.failed",
  "ops.backup.failed",
  "ops.backup.stale",
  "agent.run.changed",
  "agent.action.changed",
  "agent.policy.blocked",
]);
function applicable(field: NpAgentTriggerField, kind: NpAgentEventKind): boolean {
  switch (field) {
    case "privacy":
    case "source.kind":
    case "subject.kind":
      return true;
    case "payload.outcome":
      return kind === "auth.login.failed" || kind === "auth.login.succeeded";
    case "payload.reasonCode":
      return reasonKinds.has(kind);
    case "payload.status":
      return kind.startsWith("community.content.");
    case "payload.category":
    case "payload.severity":
    case "payload.count":
      return kind === "security.edge.signal" || kind === "security.error.signal";
  }
}
function operand(value: unknown, field: NpAgentTriggerField, path: string): string | number {
  if (field === "payload.count")
    return parseCanonicalInteger(value, path, 0, Number.MAX_SAFE_INTEGER);
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    failCanonicalBody("invalid-field", path, "must be a bounded nonempty string");
  return value;
}
function parseFilter(
  value: unknown,
  kind: NpAgentEventKind,
  path: string,
  state: CanonicalBodyInspectionState,
  budget: { terms: number },
  depth: number,
): NpAgentTriggerFilter {
  if (++budget.terms > 32 || depth > 4)
    failCanonicalBody("invalid-field", path, "exceeds the filter depth or term bound");
  const op =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "op")?.value as unknown)
      : undefined;
  const keys =
    op === "all" || op === "any"
      ? ["op", "terms"]
      : op === "in"
        ? ["op", "field", "values"]
        : ["op", "field", "value"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  if (op === "all" || op === "any") {
    const terms = canonicalBodyArray(row.terms, `${path}.terms`, 32, state);
    if (!terms.length) failCanonicalBody("invalid-field", path, "must contain a term");
    return {
      op,
      terms: terms.map((term, index) =>
        parseFilter(term, kind, `${path}.terms[${index.toString()}]`, state, budget, depth + 1),
      ),
    };
  }
  const field = canonicalBodyEnum<NpAgentTriggerField>(row.field, `${path}.field`, fields);
  if (!applicable(field, kind))
    failCanonicalBody("invalid-field", `${path}.field`, "is absent from this event kind");
  if (op === "in") {
    const values = canonicalBodyArray(row.values, `${path}.values`, 20, state).map((entry) =>
      operand(entry, field, `${path}.values`),
    );
    if (!values.length || new Set(values).size !== values.length)
      failCanonicalBody("invalid-field", `${path}.values`, "must contain 1-20 unique values");
    return { op, field, values };
  }
  if (op === "eq") return { op, field, value: operand(row.value, field, `${path}.value`) };
  if ((op === "gte" || op === "lte") && field === "payload.count")
    return {
      op,
      field,
      value: parseCanonicalInteger(row.value, `${path}.value`, 0, Number.MAX_SAFE_INTEGER),
    };
  return failCanonicalBody(
    "invalid-field",
    `${path}.op`,
    "must be an approved operator for this field",
  );
}
function clone(value: unknown): unknown {
  return cloneCanonicalRuntimeInput(value, "agent.trigger", 32_768, {
    maximumDepth: 12,
    maximumNodes: 1024,
    maximumArrayItems: 32,
  });
}
export function npAnalyzeAgentTriggerFilterV1(
  value: unknown,
  eventKind: NpAgentEventKind,
): NpAgentContractResult<NpAgentTriggerFilter> {
  return analyzeCanonicalBody("agent.trigger.filter", () =>
    parseFilter(
      clone(value),
      canonicalBodyEnum(eventKind, "agent.trigger.eventKind", kinds),
      "agent.trigger.filter",
      { seen: new WeakSet() },
      { terms: 0 },
      1,
    ),
  );
}
export function npRequireAgentTriggerFilterV1(
  value: unknown,
  eventKind: NpAgentEventKind,
): NpAgentTriggerFilter {
  return npRequireAgentContractResult(
    npAnalyzeAgentTriggerFilterV1(value, eventKind),
    "Invalid Agent trigger filter",
  );
}
export function npAnalyzeAgentTriggerV1(value: unknown): NpAgentContractResult<NpAgentTrigger> {
  return analyzeCanonicalBody("agent.trigger", () => {
    const input = clone(value);
    const type =
      typeof input === "object" && input !== null
        ? (Object.getOwnPropertyDescriptor(input, "type")?.value as unknown)
        : undefined;
    const keys =
      type === "event"
        ? ["type", "id", "eventKind", "filter", "coalesceSeconds"]
        : type === "schedule"
          ? ["type", "id", "cron", "catchUp"]
          : ["type", "id"];
    const row = canonicalBodyRecord(input, "agent.trigger", keys, keys, { seen: new WeakSet() });
    const id = parseCanonicalUuid(row.id, "agent.trigger.id");
    if (type === "manual") return { type, id };
    if (type === "event") {
      const eventKind = canonicalBodyEnum<NpAgentEventKind>(
        row.eventKind,
        "agent.trigger.eventKind",
        kinds,
      );
      return {
        type,
        id,
        eventKind,
        filter: npRequireAgentTriggerFilterV1(row.filter, eventKind),
        coalesceSeconds: parseCanonicalInteger(
          row.coalesceSeconds,
          "agent.trigger.coalesceSeconds",
          0,
          86_400,
        ),
      };
    }
    if (type === "schedule") {
      if (typeof row.cron !== "string" || !npValidatePluginCronExpression(row.cron).ok)
        failCanonicalBody(
          "invalid-field",
          "agent.trigger.cron",
          "must be a valid five-field UTC cron",
        );
      return {
        type,
        id,
        cron: row.cron,
        catchUp: canonicalBodyEnum(row.catchUp, "agent.trigger.catchUp", new Set(["skip", "once"])),
      };
    }
    return failCanonicalBody(
      "invalid-field",
      "agent.trigger.type",
      "must be a supported trigger type",
    );
  });
}
export function npRequireAgentTriggerV1(value: unknown): NpAgentTrigger {
  return npRequireAgentContractResult(npAnalyzeAgentTriggerV1(value), "Invalid Agent trigger");
}
function matches(filter: NpAgentTriggerFilter, event: NpAgentEventCanonicalV1): boolean {
  if (filter.op === "all") return filter.terms.every((term) => matches(term, event));
  if (filter.op === "any") return filter.terms.some((term) => matches(term, event));
  if ("terms" in filter) return false;
  let actual: unknown;
  switch (filter.field) {
    case "privacy":
      actual = event.privacy;
      break;
    case "source.kind":
      actual = event.source.kind;
      break;
    case "subject.kind":
      actual = event.subject?.kind;
      break;
    default:
      actual = (event.payload as unknown as Record<string, unknown>)[filter.field.slice(8)];
  }
  if (filter.op === "in") return filter.values.some((value) => value === actual);
  if (filter.op === "eq") return actual === filter.value;
  return (
    typeof actual === "number" &&
    (filter.op === "gte" ? actual >= filter.value : actual <= filter.value)
  );
}
export function npMatchAgentTriggerEventV1(trigger: unknown, event: unknown): boolean {
  const definition = npRequireAgentTriggerV1(trigger);
  const envelope = npRequireAgentEventCanonical(event);
  return (
    definition.type === "event" &&
    definition.eventKind === envelope.kind &&
    matches(definition.filter, envelope)
  );
}
export async function npDigestAgentTriggerV1(value: unknown): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-trigger-definition.v1\0${serializeAgentCanonicalJson(npRequireAgentTriggerV1(value))}`,
    ),
  );
}

/** Next UTC minute strictly after the supplied instant; the existing cron parser owns syntax. */
export function npNextAgentTriggerScheduleV1(cron: string, after: Date): Date {
  if (
    !npValidatePluginCronExpression(cron).ok ||
    !(after instanceof Date) ||
    !Number.isFinite(after.getTime())
  ) {
    return failCanonicalBody(
      "invalid-field",
      "agent.trigger.schedule",
      "must use a valid UTC cron and instant",
    );
  }
  const endDate = new Date(after.getTime());
  endDate.setUTCFullYear(endDate.getUTCFullYear() + 8);
  try {
    return CronExpressionParser.parse(cron, { tz: "UTC", currentDate: after, endDate })
      .next()
      .toDate();
  } catch {
    return failCanonicalBody(
      "invalid-field",
      "agent.trigger.schedule",
      "has no bounded next occurrence",
    );
  }
}
