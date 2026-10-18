import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  NpAgentGuardianEvidenceV1,
  NpAgentIncidentStudioDetailV1,
} from "@nexpress/core/agent-contract";
import { IncidentGuardianEvidence } from "./agent-incident-guardian-evidence.js";
import { AgentIncidentDetailView } from "./agent-incident-view.js";

const state = vi.hoisted(() => ({ value: null as NpAgentIncidentStudioDetailV1 | null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./agent-runtime-api.js", () => ({
  runtimeAccessLost: () => false,
  runtimeRequest: vi.fn(),
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
const at = "2026-10-17T00:00:00.000Z";
const evidence: NpAgentGuardianEvidenceV1 = {
  schemaVersion: "np.agent-guardian-evidence.v1",
  signalId,
  detectorId: "guardian.login-failures",
  audience: "staff",
  routeFamily: null,
  window: { startedAt: at, endedAt: "2026-10-17T00:09:59.000Z" },
  observedCount: 5,
  threshold: 5,
  countBasis: "at-least",
};

function detail(): NpAgentIncidentStudioDetailV1 {
  return {
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id: incidentId,
      siteId: "default",
      fingerprint: "fixture",
      category: "spam",
      severity: "low",
      status: "open",
      title: "Review observed activity",
      summary: "An observation requires review.",
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
        detectorId: "moderator.comment-flood",
        detectorVersion: 1,
        category: "spam",
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        createdAt: at,
      },
    ],
    timeline: [],
    nextTimelineCursor: null,
    feedback: [],
    feedbackAvailable: true,
    workflow: null,
  };
}

describe("Guardian Incident observations", () => {
  it("presents verified lower bounds, fixed rules and source windows without response controls", () => {
    const html = renderToStaticMarkup(
      <IncidentGuardianEvidence
        evidence={[
          evidence,
          {
            ...evidence,
            signalId: "20000000-0000-4000-8000-000000000002",
            detectorId: "guardian.rate-limits",
            audience: null,
            routeFamily: "media-upload",
          },
        ]}
      />,
    );
    expect(html).toContain("Failed sign-ins");
    expect(html).toContain("Account audience: Staff");
    expect(html).toContain("Requests limited");
    expect(html).toContain("Route family: media upload");
    expect(html).toContain("At least 5 observations · Rule threshold: 5");
    expect(html).toContain("lower bound, not the total activity");
    expect(html).toContain("not proof of an attack");
    expect(html).toContain(`dateTime="${evidence.window.startedAt}"`);
    expect(html).toContain(`dateTime="${evidence.window.endedAt}"`);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });

  it("distinguishes unavailable evidence from an empty visible list without invented counts", () => {
    const unavailable = renderToStaticMarkup(<IncidentGuardianEvidence evidence={null} />);
    const empty = renderToStaticMarkup(<IncidentGuardianEvidence evidence={[]} />);
    expect(unavailable).toContain("Verified Guardian observations are unavailable");
    expect(empty).toContain("No visible Guardian observations");
    expect(unavailable).not.toContain("At least");
    expect(unavailable).not.toContain("Rule threshold:");
  });

  it("uses the Guardian branch even when evidence is unavailable and keeps common Incident tools", () => {
    state.value = {
      ...detail(),
      incident: { ...detail().incident, category: "authentication" },
      guardianEvidence: null,
      feedbackAvailable: false,
      signals: [
        { ...detail().signals[0], detectorId: evidence.detectorId, category: "authentication" },
      ],
    };
    const html = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
    expect(html).toContain("Guardian observations");
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Moderator content evidence");
    expect(html).not.toContain("Quarantine or restore content");
    expect(html).not.toContain("Restrict member");
    expect(html).not.toContain("Deterministic score");
    expect(html).toContain("Incident assignment");
    expect(html).toContain("Incident handling");
    expect(html).toContain("Incident severity");
    expect(html).toContain("Incident notification deliveries");
    expect(html).toContain("Feedback is unavailable for this incident");
    expect(html).not.toContain("Record feedback");
  });

  it("preserves the Moderator branch and derives feedback availability from the existing response", () => {
    state.value = detail();
    const html = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
    expect(html).toContain("Moderator content evidence");
    expect(html).toContain("Quarantine or restore content");
    expect(html).not.toContain("Guardian observations");
    expect(html).toContain("Record feedback");
    state.value = { ...detail(), feedbackAvailable: false };
    const denied = renderToStaticMarkup(<AgentIncidentDetailView id={incidentId} />);
    expect(denied).not.toContain("Record feedback");
  });
});
