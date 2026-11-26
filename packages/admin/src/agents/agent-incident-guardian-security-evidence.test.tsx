import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NpAgentGuardianSecurityEvidenceV1,
  NpAgentIncidentStudioDetailV1,
} from "@nexpress/core/agent-contract";
import { IncidentGuardianSecurityEvidence } from "./agent-incident-guardian-security-evidence.js";
import { AgentIncidentDetailView } from "./agent-incident-view.js";

const state = vi.hoisted(() => ({
  value: null as NpAgentIncidentStudioDetailV1 | null,
  request: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./agent-runtime-api.js", () => ({
  runtimeAccessLost: () => false,
  runtimeRequest: state.request,
  useRuntimeResource: () => ({
    value: state.value,
    loading: false,
    refreshing: false,
    generation: 1,
    observedAt: null,
    failure: null,
    reload: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock("./use-agent-polling.js", () => ({ useAgentPolling: vi.fn() }));
vi.mock("./agent-studio-frame.js", () => ({
  AgentStudioFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("./agent-incident-evidence.js", () => ({
  IncidentEvidence: () => <p>Moderator content evidence</p>,
}));
vi.mock("./agent-incident-response.js", () => ({
  IncidentResponse: () => <button>Quarantine or restore content</button>,
}));
vi.mock("./agent-incident-guardian-response.js", () => ({
  IncidentGuardianResponse: () => <button>Limit requests</button>,
}));
vi.mock("./agent-incident-guardian-session.js", () => ({
  IncidentGuardianSession: () => <button>Revoke session</button>,
}));
vi.mock("./agent-incident-member-response.js", () => ({
  IncidentMemberResponse: () => <button>Restrict member</button>,
}));
vi.mock("./agent-incident-assignment.js", () => ({
  IncidentAssignment: () => <p>Incident assignment</p>,
}));
vi.mock("./agent-incident-workflow.js", () => ({
  IncidentWorkflow: () => <p>Incident handling</p>,
}));
vi.mock("./agent-incident-severity.js", () => ({
  IncidentSeverity: () => <p>Incident severity</p>,
}));
vi.mock("./agent-incident-notification-deliveries.js", () => ({
  IncidentNotificationDeliveries: () => <p>Incident notification deliveries</p>,
}));

const incidentId = "10000000-0000-4000-8000-000000000001";
const signalId = "20000000-0000-4000-8000-000000000001";
const at = "2026-10-18T00:00:00.000Z";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const evidence: NpAgentGuardianSecurityEvidenceV1 = {
  schemaVersion: "np.agent-guardian-security-evidence.v1",
  signalId,
  detectorId: "guardian.authority-escalated",
  detectorVersion: 1,
  basis: "committed-transition",
  targetKind: "site-role",
  observedAt: at,
  sourceDigest: digest,
  impact: { scope: "site", affectedSiteCount: 1, siteCatalogDigest: digest },
};

function detail(): NpAgentIncidentStudioDetailV1 {
  return {
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id: incidentId,
      siteId: "default",
      fingerprint: "fixture",
      category: "authorization",
      severity: "medium",
      status: "open",
      title: "Review a committed security transition",
      summary: "A committed authority increase was observed.",
      primarySubject: null,
      assignedAgentId: null,
      signalIds: [signalId],
      eventCount: 1,
      firstObservedAt: at,
      lastObservedAt: at,
      containedAt: null,
      resolvedAt: null,
      resolutionCode: null,
      versionNumber: 1,
      createdAt: at,
      updatedAt: at,
    },
    signals: [
      {
        id: signalId,
        detectorId: evidence.detectorId,
        detectorVersion: 1,
        category: "authorization",
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        createdAt: at,
      },
    ],
    timeline: [],
    nextTimelineCursor: null,
    feedback: [],
    feedbackAvailable: false,
    workflow: null,
  };
}

beforeEach(() => {
  state.value = null;
  state.request.mockReset();
});

describe("Guardian committed security evidence", () => {
  it("shows committed transition facts, observation times and recorded impact without private references", () => {
    const html = renderToStaticMarkup(
      <IncidentGuardianSecurityEvidence
        evidence={[
          evidence,
          {
            ...evidence,
            signalId: "20000000-0000-4000-8000-000000000002",
            targetKind: "super-admin",
            impact: { ...evidence.impact, scope: "deployment", affectedSiteCount: 3 },
          },
          {
            ...evidence,
            signalId: "20000000-0000-4000-8000-000000000003",
            detectorId: "guardian.policy-activated",
            targetKind: "agent-policy",
          },
        ]}
      />,
    );
    expect(html).toContain("Site authority elevated");
    expect(html).toContain("Super administrator granted");
    expect(html).toContain("Agent policy activated");
    expect(html).toContain("Evidence: Committed transition");
    expect(html).toContain("Recorded impact: This site · 1 affected site");
    expect(html).toContain("Recorded impact: Deployment · 3 affected sites");
    expect(html).toContain(`dateTime="${at}"`);
    expect(html).toContain("does not establish abuse");
    expect(html).not.toContain(signalId);
    expect(html).not.toContain(digest);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("href=");
  });

  it("keeps unavailable and empty visible evidence distinct without inventing transition facts", () => {
    const unavailable = renderToStaticMarkup(<IncidentGuardianSecurityEvidence evidence={null} />);
    const empty = renderToStaticMarkup(<IncidentGuardianSecurityEvidence evidence={[]} />);
    expect(unavailable).toContain("Verified security transition evidence is unavailable");
    expect(empty).toContain("No verified security transitions are visible");
    expect(unavailable).not.toContain("affected site");
    expect(empty).not.toContain("Evidence: Committed transition");
  });

  it.each([null, []])("keeps the security branch read-only when facts are %j", (facts) => {
    state.value = {
      ...detail(),
      guardianSecurityEvidence: facts,
      guardianEvidence: null,
      incident: {
        ...detail().incident,
        primarySubject: { kind: "session", actorKind: "staff", sessionFamilyId: incidentId },
      },
    };
    const html = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
    expect(html).toContain("Guardian security transitions");
    expect(html).not.toContain("Guardian observations");
    expect(html).not.toContain("Moderator content evidence");
    expect(html).not.toContain("Quarantine or restore content");
    expect(html).not.toContain("Limit requests");
    expect(html).not.toContain("Revoke session");
    expect(html).not.toContain("Restrict member");
    expect(html).not.toContain("Human feedback");
    expect(html).toContain("Incident assignment");
    expect(html).toContain("Incident handling");
    expect(html).toContain("Incident severity");
    expect(html).toContain("Incident notification deliveries");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("clears security facts when the existing detail resource is removed", () => {
    state.value = { ...detail(), guardianSecurityEvidence: [evidence] };
    const html = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
    expect(html).toContain("Site authority elevated");
    expect(html).not.toContain("Moderator content evidence");
    expect(html).not.toContain("Quarantine or restore content");
    state.value = null;
    const unavailable = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
    expect(unavailable).not.toContain("Guardian security transitions");
    expect(unavailable).not.toContain("Site authority elevated");
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each(["guardianContentEvidence", "guardianExternalEvidence"] as const)(
    "keeps unavailable %s read-only",
    (key) => {
      state.value = { ...detail(), [key]: null };
      const html = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
      expect(html).toContain(
        key === "guardianContentEvidence"
          ? "Verified content activity evidence is unavailable"
          : "Verified external source evidence is unavailable",
      );
      expect(html).not.toMatch(
        /Quarantine or restore content|Limit requests|Revoke session|Restrict member|Human feedback/,
      );
      expect(state.request).not.toHaveBeenCalled();
    },
  );
});
