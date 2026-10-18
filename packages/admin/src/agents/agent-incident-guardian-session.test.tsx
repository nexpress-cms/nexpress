import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAgentGuardianSessionV1 } from "@nexpress/core/agent-contract";
import { IncidentGuardianSession } from "./agent-incident-guardian-session.js";
import { AgentStudioApiError } from "./agent-studio-api.js";
const state = vi.hoisted<{
  value: NpAgentGuardianSessionV1 | null;
  failure: unknown;
  error: string | null;
  request: ReturnType<typeof vi.fn>;
}>(() => ({ value: null, failure: null, error: null, request: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./agent-runtime-api.js", () => ({
  runtimeRequest: state.request,
  runtimeAccessLost: () => false,
  useRuntimeResource: () => ({ ...state, loading: false, reload: vi.fn() }),
}));
const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const props = {
  incidentId: id,
  incidentVersion: 1,
  refreshGeneration: 1,
  disabled: false,
  onWriting: vi.fn(),
  onSuccess: vi.fn(),
  onAccessLost: vi.fn(),
  onConflict: vi.fn(),
};
beforeEach(() => {
  state.value = null;
  state.failure = null;
  state.error = null;
  state.request.mockReset();
});
describe("Guardian exact session review", () => {
  it("shows exact deployment impact, separate approval and irreversible result without dispatching", () => {
    state.value = {
      schemaVersion: "np.agent-guardian-session.v1",
      incidentId: id,
      incidentVersion: 1,
      targetVersionDigest: hash,
      target: {
        actorKind: "member",
        sessionFamilyId: id,
        createdAt: "2026-10-18T00:00:00.000Z",
        impact: "deployment",
        affectedSiteCount: 2,
        impactDigest: hash,
      },
      canPlan: true,
      plans: [],
      truncated: false,
    };
    let html = renderToStaticMarkup(<IncidentGuardianSession {...props} />);
    expect(html).toContain("Deployment · 2 sites");
    expect(html).toContain("Super administrator");
    expect(html).toContain("cannot be undone");
    expect(html).toContain("Prepare session revocation plan");
    expect(html).not.toContain("Execute approved session revocation");
    state.value = {
      ...state.value,
      canPlan: false,
      plans: [
        {
          actionId: id,
          approvalId: id,
          proposalHash: hash,
          state: "succeeded",
          approvalExpiresAt: "2026-10-18T01:00:00.000Z",
          canExecute: false,
        },
      ],
    };
    html = renderToStaticMarkup(<IncidentGuardianSession {...props} />);
    expect(html).toContain("Session revoked. Its access and refresh tokens are invalid.");
    expect(html).not.toContain("Execute approved session revocation");
    expect(html).not.toContain("Undo");
    expect(state.request).not.toHaveBeenCalled();
  });
  it("keeps an absent owner unavailable and exposes no invented target or action", () => {
    state.failure = new AgentStudioApiError("Disabled", 503, "GUARDIAN_SESSION_UNAVAILABLE");
    state.error = "Disabled";
    const html = renderToStaticMarkup(<IncidentGuardianSession {...props} />);
    expect(html).toContain("Session revocation is disabled");
    expect(html).not.toContain("Prepare session revocation plan");
    expect(html).not.toContain(id);
    expect(state.request).not.toHaveBeenCalled();
  });
});
