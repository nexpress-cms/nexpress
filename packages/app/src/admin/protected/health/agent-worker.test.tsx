import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { npRequireAgentWorkerHealthV1 } from "@nexpress/core/agent-contract";
import { AgentWorker } from "./agent-worker.js";
import { formatAgentWorkerDetail } from "../../../lib/agent-worker-presentation.js";

function snapshot() {
  return npRequireAgentWorkerHealthV1({
    schemaVersion: "np.agent-worker-health.v1",
    generatedAt: "2026-09-21T12:00:00.000Z",
    state: "observed",
    sampledWorkers: 100,
    hasMore: true,
    subscribedWorkers: 70,
    pausedWorkers: 10,
    inactiveWorkers: 5,
    staleWorkers: 8,
    stoppedWorkers: 4,
    unknownWorkers: 3,
  });
}

describe("Agent worker subscription presentation", () => {
  it("distinguishes subscription and lifecycle evidence with the same limits in UI and Doctor", () => {
    const summary = snapshot();
    const html = renderToStaticMarkup(<AgentWorker summary={summary} />);
    const cli = formatAgentWorkerDetail(summary);
    for (const output of [html, cli]) {
      for (const text of [
        "100 most recent worker heartbeats",
        "do not prove job progress",
        "provider readiness",
        "next heartbeat",
        "legacy or unsupported adapters",
        "not an empty sample",
      ])
        expect(output).toContain(text);
    }
    for (const row of [
      "Workers with fresh Agent subscriptions: 70",
      "Paused Agent workers: 10",
      "Inactive workers: 5",
      "Stale worker evidence: 8",
      "Workers marked stopped: 4",
      "Workers with unknown evidence: 3",
      "More workers outside sample: Yes",
    ])
      expect(cli).toContain(row);
    expect(html).toContain('aria-labelledby="agent-worker-heading"');
    expect(html).not.toMatch(/<button|<form/);
  });

  it("distinguishes unavailable counts from an observed empty sample", () => {
    const counts = {
      sampledWorkers: 0,
      subscribedWorkers: 0,
      pausedWorkers: 0,
      inactiveWorkers: 0,
      staleWorkers: 0,
      stoppedWorkers: 0,
      unknownWorkers: 0,
    };
    const empty = npRequireAgentWorkerHealthV1({ ...snapshot(), ...counts, hasMore: false });
    const unavailable = npRequireAgentWorkerHealthV1({
      ...empty,
      state: "unavailable",
      hasMore: null,
      ...Object.fromEntries(Object.keys(counts).map((key) => [key, null])),
    });
    expect(formatAgentWorkerDetail(empty)).toContain("Sampled workers: 0");
    expect(formatAgentWorkerDetail(unavailable)).toContain("Sampled workers: Unknown");
    expect(formatAgentWorkerDetail(unavailable)).not.toContain("subscriptions: 0");
    expect(renderToStaticMarkup(<AgentWorker summary={unavailable} />)).toContain("Unknown");
  });

  it("contains malformed summaries without exposing injected identities", () => {
    const malformed = {
      ...snapshot(),
      subscribedWorkers: 100,
      workerId: "private-worker-never-render",
    };
    expect(() => formatAgentWorkerDetail(malformed)).toThrow();
    const html = renderToStaticMarkup(<AgentWorker summary={malformed} />);
    expect(html).toContain("Worker subscription evidence is unavailable");
    expect(html).not.toContain("private-worker-never-render");
  });
});
