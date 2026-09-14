import { describe, expect, it, vi } from "vitest";
import {
  npNextAgentTriggerScheduleV1,
  npAnalyzeAgentTriggerV1,
  npAnalyzeAgentTriggerFilterV1,
  npDigestAgentTriggerV1,
  npMatchAgentTriggerEventV1,
  npRequireAgentTriggerV1,
} from "./runtime-trigger-contract.js";

const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const filter = () => ({ op: "eq", field: "privacy", value: "internal" });
const trigger = () => ({
  type: "event",
  id,
  eventKind: "jobs.handler.failed",
  filter: filter(),
  coalesceSeconds: 60,
});
const event = () => ({
  version: "np.agent-event.v1",
  siteId: "default",
  kind: "jobs.handler.failed",
  occurredAt: "2026-09-14T00:00:00.000Z",
  source: { kind: "jobs", component: "worker" },
  subject: null,
  actor: null,
  causation: null,
  correlationId: null,
  deduplicationKey: null,
  privacy: "internal",
  payload: {
    kind: "jobs.handler.failed",
    handlerName: "worker",
    jobId: "job-1",
    reasonCode: "FAILED",
  },
});
describe("Runtime trigger contract", () => {
  it("accepts exact event, manual and UTC schedule branches", () => {
    expect(npRequireAgentTriggerV1(trigger())).toEqual(trigger());
    expect(npRequireAgentTriggerV1({ type: "manual", id })).toEqual({ type: "manual", id });
    expect(
      npAnalyzeAgentTriggerV1({ type: "schedule", id, cron: "*/5 * * * *", catchUp: "once" }).ok,
    ).toBe(true);
  });
  it.each(["* * * * * *", "@daily", "60 * * * *", "*  * * * *", "invalid"])(
    "rejects invalid cron %s",
    (cron) => {
      expect(npAnalyzeAgentTriggerV1({ type: "schedule", id, cron, catchUp: "skip" }).ok).toBe(
        false,
      );
    },
  );
  it("rejects extra keys, invalid discriminators and coalescing bounds", () => {
    for (const row of [
      { ...trigger(), siteId: "foreign" },
      { ...trigger(), id: "name" },
      { ...trigger(), type: "code" },
      { ...trigger(), coalesceSeconds: -1 },
      { ...trigger(), coalesceSeconds: 86401 },
      { ...trigger(), eventKind: "plugin.custom" },
    ])
      expect(npAnalyzeAgentTriggerV1(row).ok).toBe(false);
  });
  it("rejects getters, cycles, prototypes, symbols and sparse arrays without evaluating getters", () => {
    const getter = vi.fn();
    const hostile = Object.defineProperty({}, "op", { get: getter, enumerable: true });
    const cyclic: Record<string, unknown> = { op: "all" };
    cyclic.terms = [cyclic];
    for (const value of [
      hostile,
      cyclic,
      Object.create({ op: "eq" }),
      { ...filter(), [Symbol()]: 1 },
      { op: "in", field: "privacy", values: new Array(2) },
    ])
      expect(npAnalyzeAgentTriggerFilterV1(value, "jobs.handler.failed").ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("enforces approved fields and event-kind applicability with typed operands", () => {
    for (const value of [
      { op: "eq", field: "payload.body", value: "x" },
      { op: "eq", field: "payload.count", value: 1 },
      { op: "gte", field: "privacy", value: 1 },
      { op: "eq", field: "privacy", value: true },
      { op: "regex", field: "privacy", value: ".*" },
      { op: "eq", field: "privacy", value: "x".repeat(129) },
    ])
      expect(npAnalyzeAgentTriggerFilterV1(value, "jobs.handler.failed").ok).toBe(false);
    expect(
      npAnalyzeAgentTriggerFilterV1(
        { op: "gte", field: "payload.count", value: 1 },
        "security.edge.signal",
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentTriggerFilterV1(
        { op: "gte", field: "payload.count", value: 1.2 },
        "security.edge.signal",
      ).ok,
    ).toBe(false);
  });
  it("bounds total nodes, depth and unique membership operands", () => {
    expect(
      npAnalyzeAgentTriggerFilterV1(
        { op: "all", terms: Array.from({ length: 31 }, filter) },
        "jobs.handler.failed",
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentTriggerFilterV1(
        { op: "all", terms: Array.from({ length: 32 }, filter) },
        "jobs.handler.failed",
      ).ok,
    ).toBe(false);
    let nested: unknown = filter();
    for (let level = 0; level < 3; level++) nested = { op: "all", terms: [nested] };
    expect(npAnalyzeAgentTriggerFilterV1(nested, "jobs.handler.failed").ok).toBe(true);
    expect(
      npAnalyzeAgentTriggerFilterV1({ op: "any", terms: [nested] }, "jobs.handler.failed").ok,
    ).toBe(false);
    for (const value of [
      { op: "all", terms: [] },
      { op: "any", terms: [] },
      { op: "in", field: "privacy", values: [] },
      { op: "in", field: "privacy", values: ["internal", "internal"] },
      { op: "in", field: "privacy", values: Array.from({ length: 21 }, (_, i) => i.toString()) },
    ])
      expect(npAnalyzeAgentTriggerFilterV1(value, "jobs.handler.failed").ok).toBe(false);
  });
  it("matches only validated canonical envelopes and exact predicates", () => {
    expect(npMatchAgentTriggerEventV1(trigger(), event())).toBe(true);
    expect(
      npMatchAgentTriggerEventV1(
        {
          ...trigger(),
          filter: {
            op: "all",
            terms: [filter(), { op: "in", field: "payload.reasonCode", values: ["FAILED"] }],
          },
        },
        event(),
      ),
    ).toBe(true);
    expect(
      npMatchAgentTriggerEventV1(
        { ...trigger(), filter: { op: "eq", field: "subject.kind", value: "document" } },
        event(),
      ),
    ).toBe(false);
    expect(npMatchAgentTriggerEventV1(trigger(), { ...event(), privacy: "public" })).toBe(false);
    expect(npMatchAgentTriggerEventV1({ type: "manual", id }, event())).toBe(false);
    expect(() =>
      npMatchAgentTriggerEventV1(trigger(), { ...event(), rawBody: "private" }),
    ).toThrow();
  });
  it("fingerprints exact definitions independently of object key order", async () => {
    const first = await npDigestAgentTriggerV1({ type: "manual", id });
    expect(first).toBe("cj1:sha256:Dgt9P4gh8I3p5iD6dk7TKYFTyLzYCuTLrt71w6rcOF0");
    expect(first).toBe(await npDigestAgentTriggerV1({ id, type: "manual" }));
    expect(first).not.toBe(await npDigestAgentTriggerV1(trigger()));
    expect(await npDigestAgentTriggerV1(trigger())).not.toBe(
      await npDigestAgentTriggerV1({ ...trigger(), coalesceSeconds: 61 }),
    );
  });
});

it("derives strict UTC schedule minutes and bounded leap-date occurrences", () => {
  expect(
    npNextAgentTriggerScheduleV1("*/5 * * * *", new Date("2026-09-14T00:05:00.000Z")).toISOString(),
  ).toBe("2026-09-14T00:10:00.000Z");
  expect(
    npNextAgentTriggerScheduleV1("0 0 29 2 *", new Date("2026-09-14T00:05:00.000Z")).toISOString(),
  ).toBe("2028-02-29T00:00:00.000Z");
  expect(() => npNextAgentTriggerScheduleV1("0 0 * * *", new Date(NaN))).toThrow();
  expect(() => npNextAgentTriggerScheduleV1("60 * * * *", new Date())).toThrow();
});
