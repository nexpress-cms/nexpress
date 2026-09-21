import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { npRequireAgentMaintenanceHealthV1 } from "@nexpress/core/agent-contract";
import { AgentMaintenance } from "./agent-maintenance.js";
import { formatAgentMaintenanceDetail } from "../../../lib/agent-maintenance-presentation.js";

function snapshot() {
  return npRequireAgentMaintenanceHealthV1({
    schemaVersion: "np.agent-maintenance-health.v1",
    generatedAt: "2026-09-21T12:00:00.000Z",
    registration: "registered",
    workers: {
      state: "observed",
      aliveCount: 1,
      totalCount: 2,
      newestHeartbeat: "2026-09-21T11:59:59.000Z",
    },
    queue: { state: "supported", retainedFailures: 0 },
    receipts: {
      state: "observed",
      sampledSites: 100,
      hasMore: true,
      completedSweepSites: 3,
      latestBatch: {
        startedAt: "2026-09-21T11:58:00.000Z",
        completedAt: "2026-09-21T11:59:00.000Z",
        examined: 42,
        pruned: 7,
      },
      latestSweepAt: "2026-09-21T11:57:00.000Z",
    },
  });
}

describe("Agent maintenance evidence presentation", () => {
  it("preserves sampled batch and sweep facts with scope limits in UI and Doctor", () => {
    const summary = snapshot();
    const html = renderToStaticMarkup(<AgentMaintenance summary={summary} />);
    const cli = formatAgentMaintenanceDetail(summary);
    for (const output of [html, cli]) {
      for (const value of [
        "registered",
        "42",
        "7",
        "100",
        "Yes",
        "2026-09-21T11:57:00.000Z",
        "2026-09-21T11:59:00.000Z",
        "host-wide",
        "not deletion of all eligible data",
        "do not confirm an Agent handler",
        "does not authorize activation",
      ])
        expect(output).toContain(value);
    }
    expect(cli).toContain("Host-wide retentionPrune failures: 0");
    expect(cli).toContain("Sampled sites with a completed sweep: 3");
    expect(html).toContain('aria-labelledby="agent-maintenance-heading"');
    expect(html).not.toMatch(/<button|<form/);
  });

  it("distinguishes absent receipts and unsupported queue from unavailable evidence", () => {
    const absent = npRequireAgentMaintenanceHealthV1({
      ...snapshot(),
      registration: "unknown",
      workers: { state: "unavailable", aliveCount: null, totalCount: null, newestHeartbeat: null },
      queue: { state: "unsupported", retainedFailures: null },
      receipts: {
        state: "never-recorded",
        sampledSites: 0,
        hasMore: false,
        completedSweepSites: 0,
        latestBatch: null,
        latestSweepAt: null,
      },
    });
    const unavailable = npRequireAgentMaintenanceHealthV1({
      ...absent,
      queue: { state: "unavailable", retainedFailures: null },
      receipts: {
        state: "unavailable",
        sampledSites: null,
        hasMore: false,
        completedSweepSites: null,
        latestBatch: null,
        latestSweepAt: null,
      },
    });
    const absentCli = formatAgentMaintenanceDetail(absent);
    expect(absentCli).toContain("Sampled sites: 0");
    expect(absentCli).toContain("never-recorded");
    expect(absentCli).toContain("unsupported");
    const unavailableCli = formatAgentMaintenanceDetail(unavailable);
    expect(unavailableCli).toContain("Sampled sites: Unknown");
    expect(unavailableCli).toContain("More receipts outside sample: Unknown");
    expect(unavailableCli).not.toContain("Sampled sites: 0");
    for (const value of [absent, unavailable]) {
      expect(formatAgentMaintenanceDetail(value)).toContain(
        "Host-wide retentionPrune failures: Unknown",
      );
      expect(renderToStaticMarkup(<AgentMaintenance summary={value} />)).toContain(
        value.receipts.state,
      );
    }
  });

  it("rejects malformed evidence without displaying injected fields", () => {
    const malformed = { ...snapshot(), cursor: "private-cursor-never-render" };
    expect(() => formatAgentMaintenanceDetail(malformed)).toThrow();
    const html = renderToStaticMarkup(<AgentMaintenance summary={malformed} />);
    expect(html).toContain("Maintenance evidence is unavailable");
    expect(html).not.toContain("private-cursor-never-render");
  });
});
