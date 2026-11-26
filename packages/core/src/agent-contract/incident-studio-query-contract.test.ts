import { describe, it, expect } from "vitest";
import { npRequireAgentIncidentStudioListQueryV1 } from "./incident-studio-query-contract.js";
const base = {
  statuses: [],
  categories: [],
  severities: [],
  updatedAfter: null,
  limit: 25,
  cursor: null,
};
describe("staff Incident search boundary", () => {
  it("retains the original empty search projection and accepts bounded literal search", () => {
    expect(npRequireAgentIncidentStudioListQueryV1(base)).toEqual(base);
    const query = {
      ...base,
      source: "moderator.repeated-link-spam",
      assignedAgentId: "00000000-0000-4000-8000-000000000001",
      containment: "inactive",
      observedAfter: "2026-01-01T00:00:00.000Z",
      observedBefore: "2026-01-02T00:00:00.000Z",
      query: "100%_ matches ' literally",
      includeSummaries: true,
    };
    expect(npRequireAgentIncidentStudioListQueryV1(query)).toEqual(query);
  });
  it("rejects reversed dates and source/query attempts to expand the search surface", () => {
    for (const extra of [
      { observedAfter: "2026-02-01T00:00:00.000Z", observedBefore: "2026-01-01T00:00:00.000Z" },
      { source: "source; SELECT 1" },
      { query: "x".repeat(201) },
      { query: " padded " },
      { assignedAgentId: "other-site" },
      { rawLogs: true },
      { includeSummaries: "true" },
    ])
      expect(() => npRequireAgentIncidentStudioListQueryV1({ ...base, ...extra })).toThrow();
  });
});
