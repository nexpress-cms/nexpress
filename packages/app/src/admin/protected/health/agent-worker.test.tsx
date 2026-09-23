import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "@nexpress/core/jobs-contract";
import {
  npRequireAgentWorkerHealthV1,
  npRequireAgentWorkerHealthV2,
} from "@nexpress/core/agent-contract";
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
    expect(cli).toContain("Queue details are unavailable in this legacy aggregate snapshot.");
    expect(cli).not.toContain("agent.runExecute:");
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

  it("shares bounded per-queue observations without assigning unknown workers or implying readiness", () => {
    const evidence = npRequireAgentWorkerHealthV2({
      schemaVersion: "np.agent-worker-health.v2",
      summary: { ...snapshot(), subscribedWorkers: 2, pausedWorkers: 1, inactiveWorkers: 82 },
      queues: NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
        queue,
        subscribedWorkers: queue === "agent.runExecute" ? 2 : 0,
        pausedRegisteredWorkers: queue === "agent.runExecute" ? 1 : 0,
        staleRegisteredWorkers: queue === "agent.eventDispatch" ? 3 : 0,
        stoppedRegisteredWorkers: queue === "agent.retentionPrune" ? 1 : 0,
      })),
    });
    const html = renderToStaticMarkup(<AgentWorker summary={evidence} />);
    const cli = formatAgentWorkerDetail(evidence);
    expect(cli).toContain("agent.runExecute: Fresh subscriptions: 2; Paused registrations: 1");
    expect(cli).toContain(
      "agent.eventDispatch: Fresh subscriptions: 0; Paused registrations: 0; Stale registrations: 3",
    );
    expect(cli).toContain(
      "agent.retentionPrune: Fresh subscriptions: 0; Paused registrations: 0; Stale registrations: 0; Stopped registrations: 1",
    );
    for (const output of [html, cli]) {
      expect(output).toContain(
        "unknown workers and workers outside the sample cannot be assigned to individual queues",
      );
      expect(output).toContain("registrations, not current subscriptions");
      expect(output).not.toContain("No worker available");
    }
    for (const queue of NP_AGENT_WORKER_QUEUE_NAMES)
      expect(html).toContain(`aria-label="${queue}"`);

    const unavailable = npRequireAgentWorkerHealthV2({
      ...evidence,
      summary: {
        ...snapshot(),
        state: "unavailable",
        hasMore: null,
        ...Object.fromEntries(
          Object.keys(snapshot())
            .filter((key) => key.endsWith("Workers"))
            .map((key) => [key, null]),
        ),
      },
      queues: evidence.queues.map((queue) => ({
        queue: queue.queue,
        subscribedWorkers: null,
        pausedRegisteredWorkers: null,
        staleRegisteredWorkers: null,
        stoppedRegisteredWorkers: null,
      })),
    });
    for (const output of [
      renderToStaticMarkup(<AgentWorker summary={unavailable} />),
      formatAgentWorkerDetail(unavailable),
    ]) {
      expect(output).toContain("Queue observation is unavailable; counts are unknown.");
      expect(output).toContain("Unknown");
    }
    expect(formatAgentWorkerDetail(unavailable)).not.toContain("subscriptions: 0");

    const malformed = {
      ...evidence,
      queues: [
        { ...evidence.queues[0], workerId: "private-queue-worker" },
        ...evidence.queues.slice(1),
      ],
    };
    expect(() => formatAgentWorkerDetail(malformed)).toThrow();
    expect(renderToStaticMarkup(<AgentWorker summary={malformed} />)).not.toContain(
      "private-queue-worker",
    );
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
