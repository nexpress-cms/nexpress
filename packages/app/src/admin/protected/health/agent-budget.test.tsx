import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { npRequireAgentBudgetHealthV1 } from "@nexpress/core/agent-contract";
import { AgentBudget } from "./agent-budget.js";
import { formatAgentBudgetDetail } from "../../../lib/agent-budget-presentation.js";

function snapshot() {
  return npRequireAgentBudgetHealthV1({
    schemaVersion: "np.agent-budget-health.v1",
    generatedAt: "2026-09-21T12:00:00.000Z",
    state: "observed",
    sampledSites: 25,
    hasMore: true,
    measuredSites: 20,
    unresolvedUsageSites: 3,
    unavailableSites: 2,
  });
}

describe("Agent budget measurement presentation", () => {
  it("preserves measured, unresolved and unavailable sample counts in UI and Doctor", () => {
    const summary = snapshot();
    const html = renderToStaticMarkup(<AgentBudget summary={summary} />);
    const cli = formatAgentBudgetDetail(summary);
    for (const output of [html, cli]) {
      for (const value of [
        "2026-09-21T12:00:00.000Z",
        "20",
        "25",
        "Yes",
        "first 25 configured sites",
        "not token usage, spend or remaining budget",
        "does not establish remaining capacity or admission readiness",
        "neither is a zero-usage result",
      ])
        expect(output).toContain(value);
    }
    expect(cli).toContain("Successfully measured sites: 20");
    expect(cli).toContain("Sites with unresolved usage: 3");
    expect(cli).toContain("Sites with unavailable measurement: 2");
    expect(html).toContain('aria-labelledby="agent-budget-heading"');
    expect(html).not.toMatch(/<button|<form/);
  });

  it("does not turn unavailable observation into a successful empty sample", () => {
    const empty = npRequireAgentBudgetHealthV1({
      ...snapshot(),
      sampledSites: 0,
      hasMore: false,
      measuredSites: 0,
      unresolvedUsageSites: 0,
      unavailableSites: 0,
    });
    const unavailable = npRequireAgentBudgetHealthV1({
      ...snapshot(),
      state: "unavailable",
      sampledSites: null,
      hasMore: null,
      measuredSites: null,
      unresolvedUsageSites: null,
      unavailableSites: null,
    });
    expect(formatAgentBudgetDetail(empty)).toContain("Sampled configured sites: 0");
    expect(formatAgentBudgetDetail(empty)).toContain("Observation: observed");
    expect(formatAgentBudgetDetail(unavailable)).toContain("Sampled configured sites: Unknown");
    expect(formatAgentBudgetDetail(unavailable)).toContain(
      "More configured sites outside sample: Unknown",
    );
    expect(formatAgentBudgetDetail(unavailable)).not.toContain("Successfully measured sites: 0");
    expect(renderToStaticMarkup(<AgentBudget summary={unavailable} />)).toContain("Unknown");
  });

  it("rejects malformed totals and injected identities without rendering them", () => {
    const malformed = { ...snapshot(), measuredSites: 25, siteId: "private-site-never-render" };
    expect(() => formatAgentBudgetDetail(malformed)).toThrow();
    const html = renderToStaticMarkup(<AgentBudget summary={malformed} />);
    expect(html).toContain("Budget measurement evidence is unavailable");
    expect(html).not.toContain("private-site-never-render");
  });
});
