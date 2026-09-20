import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { npRequireAgentHealthSummaryV1 } from "@nexpress/core/agent-contract";
import { AgentHealth } from "./agent-health.js";
import { formatAgentHealthDetail } from "../../../lib/agent-health-presentation.js";

function snapshot() {
  return npRequireAgentHealthSummaryV1({
    schemaVersion: "np.agent-health-summary.v1",
    generatedAt: "2026-09-20T12:00:00.000Z",
    state: "error",
    issueCount: 2,
    issues: [{ code: "AGENT_STALE_INVOCATION", count: 2, oldestAgeSeconds: 7201 }],
    states: [
      { entity: "approval", state: "pending", count: 0, oldestAgeSeconds: null },
      { entity: "run", state: "queued", count: 7, oldestAgeSeconds: 0 },
      { entity: "usage-reservation", state: "reserved", count: 2, oldestAgeSeconds: 45 },
    ],
    readiness: {
      providers: { state: "unknown", requiredCount: 2, availableCount: 0 },
      vault: { state: "unavailable", requiredCount: 2, availableCount: 1 },
    },
  });
}

describe("Agent Health presentation", () => {
  it("preserves exact issue/state evidence and unknown versus zero ages across UI and Doctor", () => {
    const summary = snapshot();
    const html = renderToStaticMarkup(<AgentHealth summary={summary} />);
    const cli = formatAgentHealthDetail(summary);
    for (const value of [
      "2026-09-20T12:00:00.000Z",
      "AGENT_STALE_INVOCATION",
      "7201 s",
      "No records",
      "0 s",
      "unknown",
      "unavailable",
      "approval / pending",
      "run / queued",
      "usage-reservation / reserved",
    ])
      for (const output of [html, cli]) expect(output).toContain(value);
    expect(html).toContain('aria-labelledby="agent-health-heading"');
    expect(html).toContain("Persisted state counts (3 groups)");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(cli).toContain("run / queued: 7");
    expect(cli).toContain("Providers: unknown · required 2 · available 0");
    expect(cli).toContain("Vault: unavailable · required 2 · available 1");
    for (const output of [html, cli]) {
      expect(output).toContain("Worker heartbeat and queue consumer liveness are not measured");
      expect(output).toContain(
        "Usage record counts do not measure token usage, spend or remaining budget",
      );
      expect(output).toContain(
        "Retention readiness and last maintenance completion are not measured",
      );
    }
  });

  it("does not turn missing schema counts into healthy empty work", () => {
    const summary = npRequireAgentHealthSummaryV1({
      ...snapshot(),
      issueCount: 1,
      issues: [{ code: "AGENT_SCHEMA_UNAVAILABLE", count: 1, oldestAgeSeconds: null }],
      states: [],
      readiness: {
        providers: { state: "unknown", requiredCount: 0, availableCount: 0 },
        vault: { state: "unknown", requiredCount: 0, availableCount: 0 },
      },
    });
    for (const output of [
      renderToStaticMarkup(<AgentHealth summary={summary} />),
      formatAgentHealthDetail(summary),
    ]) {
      expect(output).toContain("AGENT_SCHEMA_UNAVAILABLE");
      expect(output).toContain(
        "No state counts returned. This does not establish runtime availability.",
      );
      expect(output).not.toContain("No blocking issues reported");
    }
  });

  it("keeps ready and not-required distinct and rejects unvalidated extra evidence", () => {
    const summary = npRequireAgentHealthSummaryV1({
      ...snapshot(),
      state: "ok",
      issueCount: 0,
      issues: [],
      states: [],
      readiness: {
        providers: { state: "ready", requiredCount: 1, availableCount: 1 },
        vault: { state: "not-required", requiredCount: 0, availableCount: 0 },
      },
    });
    const cli = formatAgentHealthDetail(summary);
    expect(cli).toContain("Providers: ready");
    expect(cli).toContain("Vault: not-required");
    const malformed = { ...summary, secretRef: "must-never-render" };
    expect(() => formatAgentHealthDetail(malformed)).toThrow();
    const html = renderToStaticMarkup(<AgentHealth summary={malformed} />);
    expect(html).toContain("Agent diagnostic evidence is unavailable");
    expect(html).not.toContain("must-never-render");
    expect(html).not.toContain("Snapshot status: ok");
  });
});
