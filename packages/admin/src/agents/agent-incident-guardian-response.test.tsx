import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAgentGuardianResponseV1 } from "@nexpress/core/agent-contract";
import { IncidentGuardianResponse } from "./agent-incident-guardian-response.js";
import { AgentStudioApiError } from "./agent-studio-api.js";

const state = vi.hoisted<{
  value: NpAgentGuardianResponseV1 | null;
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
  useRuntimeResource: () => ({
    value: state.value,
    failure: state.failure,
    error: state.error,
    loading: false,
    reload: vi.fn(),
  }),
}));
const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const expiry = "2026-10-18T01:00:00.000Z";
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
describe("Guardian request response review", () => {
  it("renders only installed scopes, exact limit lifecycle and separate approval/execution without dispatching", () => {
    state.value = {
      schemaVersion: "np.agent-guardian-response.v1",
      incidentId: id,
      incidentVersion: 1,
      targetVersionDigest: hash,
      maximumDurationSeconds: 600,
      allowedScopes: ["auth.staff"],
      canLimit: true,
      truncated: false,
      restrictions: [
        {
          restrictionId: id,
          sourceActionId: id,
          expiresAt: expiry,
          state: "removing",
          rowVersion: 2,
          lastErrorCode: "ADAPTER_UNAVAILABLE",
          canRemove: true,
        },
      ],
      plans: [
        {
          actionId: id,
          approvalId: id,
          proposalHash: hash,
          capabilityId: "security.limitActor",
          operation: { kind: "limit", durationSeconds: 600, actionScopes: ["auth.staff"] },
          state: "executing",
          approvalExpiresAt: expiry,
          canExecute: true,
        },
      ],
    };
    const html = renderToStaticMarkup(<IncidentGuardianResponse {...props} />);
    expect(html).toContain("Guardian temporary request limits");
    expect(html).toContain('min="60"');
    expect(html).toContain('max="600"');
    expect(html).toContain("auth.staff");
    expect(html).not.toContain("auth.member");
    expect(html).toContain("Shared networks may include innocent users");
    expect(html).toContain("Prepare early removal of this limit");
    expect(html).toContain("Awaiting verification");
    expect(html).toContain("Check result");
    expect(html).toContain("elapsed expiry does not prove cleanup completed");
    expect(html).toContain(`/admin/agents/approvals/${id}`);
    expect(state.request).not.toHaveBeenCalled();
  });
  it("keeps absent installation unavailable without response forms or automatic retries", () => {
    state.failure = new AgentStudioApiError("Unavailable", 503, "SERVICE_UNAVAILABLE");
    state.error = "Unavailable";
    const html = renderToStaticMarkup(<IncidentGuardianResponse {...props} />);
    expect(html).toContain("Guardian response is disabled or its current policy is unavailable");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Execute this");
    expect(state.request).not.toHaveBeenCalled();
  });
});
