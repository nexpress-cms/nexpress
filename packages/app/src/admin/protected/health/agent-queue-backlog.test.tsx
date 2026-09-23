import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "@nexpress/core/jobs-contract";
import { AgentQueueBacklog } from "./agent-queue-backlog.js";
import { formatAgentQueueBacklogDetail } from "../../../lib/agent-queue-backlog-presentation.js";

function snapshot() {
  return {
    schemaVersion: "np.agent-queue-backlog.v1",
    source: "pg-boss",
    generatedAt: "2026-09-23T00:00:00.000Z",
    state: "observed",
    queues: NP_AGENT_WORKER_QUEUE_NAMES.map((queue) => ({
      queue,
      createdReady: 0,
      createdScheduled: 0,
      retryReady: 0,
      retryScheduled: 0,
      active: 0,
      oldestReadyAgeSeconds: null as number | null,
      oldestActiveAgeSeconds: null as number | null,
    })),
  };
}

describe("Agent queue backlog presentation", () => {
  it("shares due, scheduled and active observations and their meanings in Health and Doctor", () => {
    const evidence = snapshot();
    evidence.queues[0] = {
      ...evidence.queues[0],
      createdReady: 2,
      createdScheduled: 5,
      retryReady: 1,
      retryScheduled: 3,
      active: 1,
      oldestReadyAgeSeconds: 0,
      oldestActiveAgeSeconds: 180,
    };
    const cli = formatAgentQueueBacklogDetail(evidence);
    const html = renderToStaticMarkup(<AgentQueueBacklog summary={evidence} />);
    expect(cli).toContain(
      "Created due: 2; Created scheduled: 5; Retry due: 1; Retry scheduled: 3; Active: 1; Oldest due age: 0 s; Oldest active age: 180 s",
    );
    expect(cli).toContain("Oldest due age: No matching jobs");
    for (const output of [html, cli]) {
      expect(output).toContain("scheduled work is not overdue work");
      expect(output).toContain("Ages do not prove progress or a stuck job");
      expect(output).toContain("not tenant-specific");
    }
    for (const queue of NP_AGENT_WORKER_QUEUE_NAMES)
      expect(html).toContain(`aria-label="${queue} backlog"`);
    expect(html).not.toMatch(/<button|<form/);
  });

  it("keeps unsupported and unavailable observations distinct from empty queues and rejects private malformed data", () => {
    for (const state of ["unsupported", "unavailable"]) {
      const evidence = snapshot();
      const unknown = {
        ...evidence,
        state,
        queues: evidence.queues.map(({ queue }) => ({
          queue,
          createdReady: null,
          createdScheduled: null,
          retryReady: null,
          retryScheduled: null,
          active: null,
          oldestReadyAgeSeconds: null,
          oldestActiveAgeSeconds: null,
        })),
      };
      const cli = formatAgentQueueBacklogDetail(unknown);
      expect(cli).toContain(`Observation: ${state}`);
      expect(cli).toContain("Created due: Unknown");
      expect(cli).toContain("Oldest active age: Unknown");
      expect(cli).not.toContain("No matching jobs");
      expect(renderToStaticMarkup(<AgentQueueBacklog summary={unknown} />)).toContain("Unknown");
    }
    const malformed = { ...snapshot(), payload: "private-payload-never-render" };
    expect(() => formatAgentQueueBacklogDetail(malformed)).toThrow();
    for (const summary of [malformed, undefined]) {
      const html = renderToStaticMarkup(<AgentQueueBacklog summary={summary} />);
      expect(html).toContain("Queue backlog evidence is unavailable");
      expect(html).not.toContain("private-payload-never-render");
    }
  });
});
