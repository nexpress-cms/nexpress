import { describe, expect, it } from "vitest";
import { npRequireAgentJsonSchema } from "./contract.js";
import {
  npRequireAgentIncidentV1,
  npRequireAgentIncidentGetInputV1,
  npRequireAgentIncidentListInputV1,
  npRequireAgentIncidentOutputV1,
  npRequireAgentIncidentListOutputV1,
  npAgentIncidentGetInputSchemaV1,
  npAgentIncidentListInputSchemaV1,
  npAgentIncidentOutputSchemaV1,
  npAgentIncidentListOutputSchemaV1,
  type NpAgentIncidentV1,
} from "./incident-contract.js";
const id = "00000000-0000-4000-8000-000000000001";
const time = "2026-09-27T00:00:00.000Z";
const incident = (): NpAgentIncidentV1 => ({
  version: "np.agent-incident.v1",
  id,
  siteId: "default",
  fingerprint: "detector.opaque-key",
  category: "availability",
  severity: "high",
  status: "open",
  title: "Job unavailable",
  summary: "A deterministic check failed.",
  primarySubject: { kind: "site", siteId: "default" },
  assignedAgentId: null,
  signalIds: [id],
  eventCount: 1,
  firstObservedAt: time,
  lastObservedAt: time,
  containedAt: null,
  resolvedAt: null,
  resolutionCode: null,
  versionNumber: 1,
  createdAt: time,
  updatedAt: time,
});
const list = () => ({
  statuses: [],
  categories: [],
  severities: [],
  updatedAfter: null,
  limit: 100,
  cursor: null,
});
describe("bounded incident read contracts", () => {
  it("accepts detached exact safe projections and terminal evidence", () => {
    const source = incident();
    const result = npRequireAgentIncidentOutputV1({
      schemaVersion: "np.agent-incident-result.v1",
      incident: source,
    });
    expect(result.incident).toEqual(source);
    expect(result.incident).not.toBe(source);
    expect(npRequireAgentIncidentV1({ ...source, status: "monitoring" }).containedAt).toBeNull();
    expect(
      npRequireAgentIncidentV1({
        ...source,
        status: "resolved",
        resolvedAt: time,
        resolutionCode: "VERIFIED",
      }).status,
    ).toBe("resolved");
    expect(
      npRequireAgentIncidentListOutputV1({
        schemaVersion: "np.agent-incident-list.v1",
        items: [source],
        nextCursor: null,
      }).items,
    ).toHaveLength(1);
  });
  it("rejects unknown keys, secret extensions and malformed nested subjects", () => {
    for (const unsafe of [
      { ...incident(), evidence: { token: "secret" } },
      { ...incident(), primarySubject: { kind: "site", siteId: "other" } },
      {
        ...incident(),
        primarySubject: { kind: "connection", connectionId: id, secretLocator: "vault:key" },
      },
      { ...incident(), primarySubject: { kind: "raw", body: "secret" } },
      { ...incident(), title: "bad\ncontrol" },
    ])
      expect(() => npRequireAgentIncidentV1(unsafe)).toThrow();
  });
  it("rejects oversized/duplicate references, invalid state and chronology instead of truncating", () => {
    for (const invalid of [
      { ...incident(), signalIds: Array.from({ length: 101 }, () => id) },
      { ...incident(), signalIds: [id, id] },
      { ...incident(), status: "contained" },
      { ...incident(), status: "resolved", resolvedAt: time },
      { ...incident(), resolvedAt: time },
      { ...incident(), firstObservedAt: "2026-09-28T00:00:00.000Z" },
      { ...incident(), eventCount: -1 },
      { ...incident(), summary: "x".repeat(2001) },
    ])
      expect(() => npRequireAgentIncidentV1(invalid)).toThrow();
    expect(() =>
      npRequireAgentIncidentListOutputV1({
        schemaVersion: "np.agent-incident-list.v1",
        items: [incident(), incident()],
        nextCursor: null,
      }),
    ).toThrow();
  });
  it("bounds filters and cursors without accepting aliases or caller authority", () => {
    expect(npRequireAgentIncidentGetInputV1({ incidentId: id })).toEqual({ incidentId: id });
    expect(npRequireAgentIncidentListInputV1(list())).toEqual(list());
    for (const invalid of [
      { ...list(), siteId: "other" },
      { ...list(), statuses: ["open", "open"] },
      { ...list(), severities: ["urgent"] },
      { ...list(), categories: ["security"] },
      { ...list(), limit: 101 },
      { ...list(), limit: 0 },
      { ...list(), limit: 1.5 },
      { ...list(), cursor: "x".repeat(2049) },
      { ...list(), updatedAfter: "2026-09-27" },
    ])
      expect(() => npRequireAgentIncidentListInputV1(invalid)).toThrow();
    expect(() => npRequireAgentIncidentGetInputV1({ incidentId: id, requester: id })).toThrow();
  });
  it("exposes supported bounded discovery schemas", () => {
    for (const schema of [
      npAgentIncidentGetInputSchemaV1,
      npAgentIncidentListInputSchemaV1,
      npAgentIncidentOutputSchemaV1,
      npAgentIncidentListOutputSchemaV1,
    ])
      expect(npRequireAgentJsonSchema(schema)).toEqual(schema);
  });
});
