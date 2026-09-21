import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { AgentRecoveryBoundary } from "./agent-recovery.js";

const supportReference = "12345678-1234-4234-8234-123456789abc";
function failure(
  status: number,
  recovery: "retry-read" | "reauthenticate" | "reconcile" | "check-outcome" | "none",
) {
  return new AgentStudioApiError("Safe failure", status, "FAILURE", undefined, {
    version: 1,
    status,
    code: "FAILURE",
    supportReference,
    recovery,
  });
}
function render(error: AgentStudioApiError) {
  return renderToStaticMarkup(
    <AgentRecoveryBoundary error={error} retry={() => {}}>
      <p>Retained draft</p>
    </AgentRecoveryBoundary>,
  );
}

describe("Agent Studio diagnostic recovery boundary", () => {
  it("clears sensitive children on authentication loss while preserving safe support evidence", () => {
    const html = render(failure(401, "reauthenticate"));
    expect(html).not.toContain("Retained draft");
    expect(html).toContain(supportReference);
    expect(html).toContain("/admin/login");
  });
  it("preserves draft text and declares reconciliation without adding a retry action", () => {
    const html = render(failure(409, "reconcile"));
    expect(html).toContain("Retained draft");
    expect(html).toContain("reconcile your changes");
    expect(html).not.toContain(">Retry<");
  });
  it("does not treat a rate limit or missing metadata as retry eligibility", () => {
    expect(render(new AgentStudioApiError("Wait", 429, "RATE_LIMITED"))).not.toContain(">Retry<");
    expect(render(failure(429, "none"))).not.toContain(">Retry<");
    expect(render(failure(429, "retry-read"))).toContain(">Retry<");
  });
  it("keeps a declared read retry disabled until the server deadline", () => {
    const declared = failure(429, "retry-read");
    const error = new AgentStudioApiError(
      declared.message,
      declared.status,
      declared.code,
      Date.now() + 60_000,
      declared.diagnostics,
    );
    const html = render(error);
    expect(html).toContain("Server wait ends:");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });
  it("keeps unknown mutation outcomes separate from read retries", () => {
    const html = render(failure(503, "check-outcome"));
    expect(html).toContain("preserve the original request identity");
    expect(html).not.toContain(">Retry<");
  });
  it("reports unavailable evidence for local contract and opaque failures", () => {
    const html = render(new AgentStudioApiError("Invalid response", 502, "STUDIO_CONTRACT_ERROR"));
    expect(html).toContain("Support reference: Unavailable");
    expect(html).toContain("Recovery guidance is unavailable");
    expect(html).not.toContain(supportReference);
  });
});
