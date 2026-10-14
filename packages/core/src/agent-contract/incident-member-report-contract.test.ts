import { describe, expect, it } from "vitest";
import { npRequireAgentIncidentMemberReportEvidenceV1 } from "./incident-member-report-contract.js";
import { npRequireAgentIncidentEvidenceV1 } from "./incident-evidence-contract.js";
import { npRequireAgentQuarantineInputV1 } from "./moderator-contract.js";

const id = "10000000-0000-4000-8000-000000000001";
const signalId = "20000000-0000-4000-8000-000000000002";
const memberId = "30000000-0000-4000-8000-000000000003";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const item = {
  eventId: id,
  signalIds: [signalId],
  availability: "available",
  target: { kind: "member", id: memberId },
  observed: {
    occurredAt: "2026-10-14T00:00:00.000Z",
    retentionExpiresAt: "2026-10-28T00:00:00.000Z",
    status: "active",
    claim: "unverified",
  },
  current: {
    state: "unchanged",
    status: "active",
    updatedAt: "2026-10-14T00:00:00.000Z",
    versionDigest: digest,
    report: { status: "unresolved", resolvedAt: null },
  },
  responseEligible: false,
};
const page = {
  schemaVersion: "np.agent-incident-member-report-evidence.v1",
  incidentId: id,
  incidentVersion: 1,
  items: [item],
  nextCursor: null,
};

describe("Incident member report evidence projection", () => {
  it("keeps unverified filing facts separate from current global account and report state", () => {
    expect(npRequireAgentIncidentMemberReportEvidenceV1(page)).toEqual(page);
    for (const status of ["active", "pending", "suspended", "deleted", "imported"]) {
      const current = {
        ...item.current,
        state: "changed",
        status,
        updatedAt: "2026-10-14T01:00:00.000Z",
        report: { status: "resolved", resolvedAt: "2026-10-14T02:00:00.000Z" },
      };
      const changed = { ...page, items: [{ ...item, current }] };
      expect(npRequireAgentIncidentMemberReportEvidenceV1(changed)).toEqual(changed);
    }
    // Retention eligibility alone does not erase a retained source projection.
    const retained = {
      ...page,
      items: [
        { ...item, observed: { ...item.observed, retentionExpiresAt: "2026-10-15T00:00:00.000Z" } },
      ],
    };
    expect(npRequireAgentIncidentMemberReportEvidenceV1(retained)).toEqual(retained);
  });

  it("redacts every member and filing fact when a bound source is unavailable", () => {
    const unavailable = {
      ...item,
      availability: "unavailable",
      target: null,
      observed: null,
      current: null,
    };
    expect(
      npRequireAgentIncidentMemberReportEvidenceV1({ ...page, items: [unavailable] }).items[0],
    ).toEqual(unavailable);
    for (const privateValue of [
      { target: item.target },
      { observed: item.observed },
      { current: item.current },
      { responseEligible: true },
    ])
      expect(() =>
        npRequireAgentIncidentMemberReportEvidenceV1({
          ...page,
          items: [{ ...unavailable, ...privateValue }],
        }),
      ).toThrow();
  });

  it("rejects private attribution, classifier verdicts and contradictory claim or resolution facts", () => {
    for (const change of [
      { reason: "Private allegation" },
      { reporterId: signalId },
      { target: { ...item.target, handle: "private-handle" } },
      { observed: { ...item.observed, claim: "confirmed" } },
      { observed: { ...item.observed, status: "suspended" } },
      { observed: { ...item.observed, spamVerdict: "flag" } },
      { current: { ...item.current, email: "private@example.com" } },
      { current: { ...item.current, status: "suspended" } },
      { current: { ...item.current, versionDigest: "raw-member-record" } },
      { current: { ...item.current, report: { status: "resolved", resolvedAt: null } } },
      {
        current: {
          ...item.current,
          report: { status: "resolved", resolvedAt: "2026-10-13T23:59:59.999Z" },
        },
      },
      {
        current: {
          ...item.current,
          report: { status: "unresolved", resolvedAt: "2026-10-14T02:00:00.000Z" },
        },
      },
      { current: { ...item.current, report: { ...item.current.report, reportId: id } } },
      { responseEligible: true },
      { availability: "expired" },
    ])
      expect(() =>
        npRequireAgentIncidentMemberReportEvidenceV1({ ...page, items: [{ ...item, ...change }] }),
      ).toThrow();
    expect(() =>
      npRequireAgentIncidentMemberReportEvidenceV1({ ...page, rawSource: item }),
    ).toThrow();
  });

  it("bounds reference pagination and rejects duplicate, malformed and executable objects", () => {
    const signalIds = Array.from(
      { length: 100 },
      (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    expect(
      npRequireAgentIncidentMemberReportEvidenceV1({ ...page, items: [{ ...item, signalIds }] })
        .items[0].signalIds,
    ).toHaveLength(100);
    const continued = { ...page, items: [], nextCursor: "opaque-signed-continuation" };
    expect(npRequireAgentIncidentMemberReportEvidenceV1(continued)).toEqual(continued);
    for (const change of [
      { incidentVersion: 0 },
      { incidentVersion: 2147483648 },
      { incidentId: "not-a-member-uuid" },
      { nextCursor: "A".repeat(2049) },
      { items: [item, item] },
      { items: [{ ...item, signalIds: [] }] },
      { items: [{ ...item, signalIds: [signalId, signalId] }] },
      { items: [{ ...item, signalIds: [...signalIds, memberId] }] },
      { items: [{ ...item, target: { kind: "member", id: "opaque-member-id" } }] },
      {
        items: Array.from({ length: 11 }, (_, index) => ({
          ...item,
          eventId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        })),
      },
    ])
      expect(() => npRequireAgentIncidentMemberReportEvidenceV1({ ...page, ...change })).toThrow();
    let accessed = false;
    const getter = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        accessed = true;
        return page.schemaVersion;
      },
    });
    expect(() => npRequireAgentIncidentMemberReportEvidenceV1(getter)).toThrow();
    expect(accessed).toBe(false);
    const parsed = npRequireAgentIncidentMemberReportEvidenceV1(page);
    parsed.items[0].signalIds.push(memberId);
    expect(item.signalIds).toEqual([signalId]);
  });

  it("never promotes a member report into content evidence or a quarantine target", () => {
    expect(() =>
      npRequireAgentIncidentEvidenceV1({ ...page, schemaVersion: "np.agent-incident-evidence.v1" }),
    ).toThrow();
    expect(() =>
      npRequireAgentQuarantineInputV1({
        mode: "propose",
        proposal: {
          incidentId: id,
          target: item.target,
          expectedVersionDigest: digest,
          reasonCode: "MEMBER_REPORT",
        },
      }),
    ).toThrow();
  });
});
