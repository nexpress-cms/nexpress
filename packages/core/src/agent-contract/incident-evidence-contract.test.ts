import { describe, expect, it } from "vitest";
import { npRequireAgentIncidentEvidenceV1 } from "./incident-evidence-contract.js";

const id = "10000000-0000-4000-8000-000000000001";
const signalId = "20000000-0000-4000-8000-000000000002";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const item = {
  eventId: id,
  signalIds: [signalId],
  availability: "available",
  target: { kind: "comment", collection: "community.posts", id: "opaque-comment-id" },
  observed: {
    occurredAt: "2026-09-01T00:00:00.000Z",
    retentionExpiresAt: "2026-09-15T00:00:00.000Z",
    status: "visible",
    spamVerdict: "flag",
    profanityVerdict: "pass",
  },
  current: { state: "unchanged", status: "visible", editedAt: null, versionDigest: hash },
  responseEligible: true,
};
const page = {
  schemaVersion: "np.agent-incident-evidence.v1",
  incidentId: id,
  incidentVersion: 3,
  items: [item],
  nextCursor: null,
};
describe("Incident comment evidence projection", () => {
  it("keeps observed facts separate from current state without inferring expiry", () => {
    expect(npRequireAgentIncidentEvidenceV1(page)).toEqual(page);
    for (const [state, status] of [
      ["changed", "pending"],
      ["hidden", "hidden"],
      ["deleted", "deleted"],
    ]) {
      const currentPage = {
        ...page,
        items: [{ ...item, current: { ...item.current, state, status }, responseEligible: false }],
      };
      expect(npRequireAgentIncidentEvidenceV1(currentPage)).toEqual(currentPage);
    }
    const unavailable = {
      ...page,
      items: [
        {
          eventId: id,
          signalIds: [signalId],
          availability: "unavailable",
          target: null,
          observed: null,
          current: null,
          responseEligible: false,
        },
      ],
    };
    expect(npRequireAgentIncidentEvidenceV1(unavailable)).toEqual(unavailable);
    const continued = { ...page, items: [], nextCursor: `opaque-cursor.${"A".repeat(43)}` };
    expect(npRequireAgentIncidentEvidenceV1(continued)).toEqual(continued);
  });
  it("rejects private fields and contradictory availability or execution facts", () => {
    for (const changed of [
      { bodyText: "private-comment" },
      { target: { ...item.target, memberId: signalId } },
      { observed: { ...item.observed, rawEvent: "private" } },
      { current: { ...item.current, bodyHtml: "<script>private</script>" } },
      { availability: "unavailable" },
      { availability: "expired" },
      { current: { ...item.current, state: "changed" } },
      { current: { ...item.current, state: "hidden", status: "visible" }, responseEligible: false },
      { current: { ...item.current, status: "pending" } },
      { current: { ...item.current, versionDigest: "bad-hash" } },
      { observed: { ...item.observed, spamVerdict: "model-confidence" } },
    ])
      expect(() =>
        npRequireAgentIncidentEvidenceV1({ ...page, items: [{ ...item, ...changed }] }),
      ).toThrow();
    expect(() => npRequireAgentIncidentEvidenceV1({ ...page, rawSource: "private" })).toThrow();
  });
  it("bounds pages, identities and continuation while rejecting duplicate references", () => {
    for (const changed of [
      { incidentVersion: 0 },
      { incidentId: "invalid" },
      { items: Array.from({ length: 11 }, () => structuredClone(item)) },
      { items: [structuredClone(item), structuredClone(item)] },
      { items: [{ ...item, signalIds: [] }] },
      { items: [{ ...item, signalIds: [signalId, signalId] }] },
      { items: [{ ...item, signalIds: Array.from({ length: 101 }, () => signalId) }] },
      { nextCursor: "" },
      { nextCursor: "x".repeat(2049) },
      { nextCursor: "unsigned" },
    ])
      expect(() => npRequireAgentIncidentEvidenceV1({ ...page, ...changed })).toThrow();
  });
});
