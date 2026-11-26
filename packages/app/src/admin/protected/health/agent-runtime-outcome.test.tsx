import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentRuntimeOutcome } from "./agent-runtime-outcome.js";
import { formatAgentRuntimeOutcomeDetail } from "../../../lib/agent-runtime-outcome-presentation.js";

function snapshot() {
  return {
    schemaVersion: "np.agent-runtime-outcome.v1",
    source: "runtime-records",
    generatedAt: "2026-09-25T00:00:00.000Z",
    windowStart: "2026-09-24T00:00:00.000Z",
    state: "observed",
    outcomes: ["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"].map(
      (state) => ({ state, count: 0, lastFinishedAt: null as string | null }),
    ),
    active: {
      unfinished: 4,
      deadlineElapsed: 2,
      executing: 3,
      leaseElapsed: 1,
      leaseMissing: 1,
    },
  };
}

describe("Agent Runtime outcome presentation", () => {
  it("shares retained terminal results, unfinished facts and their limits in Health and Doctor", () => {
    const evidence = snapshot();
    evidence.outcomes[0] = {
      state: "succeeded",
      count: 3,
      lastFinishedAt: "2026-09-24T23:30:00.000Z",
    };
    const cli = formatAgentRuntimeOutcomeDetail(evidence);
    const html = renderToStaticMarkup(<AgentRuntimeOutcome summary={evidence} />);
    for (const output of [html, cli]) {
      for (const label of [
        "Succeeded",
        "Failed",
        "Cancelled",
        "Policy blocked",
        "Budget blocked",
        "Unfinished runs",
        "Deadline elapsed",
        "Running or verifying",
        "Lease elapsed",
        "Lease not recorded",
      ])
        expect(output).toContain(label);
      expect(output).toContain(evidence.generatedAt);
      expect(output).toContain(evidence.windowStart);
      expect(output).toContain("2026-09-24T23:30:00.000Z");
    }
    expect(cli).toContain("Succeeded: 3 · last finished: 2026-09-24T23:30:00.000Z");
    expect(cli).toContain("Failed: 0 · last finished: No matching records");
    expect(cli).toContain("Unfinished runs: 4");
    expect(cli).toContain("Deadline elapsed: 2");
    expect(cli).toContain("Running or verifying: 3");
    expect(cli).toContain("Lease elapsed: 1");
    expect(cli).toContain("Lease not recorded: 1");
    for (const output of [html, cli]) {
      expect(output).toContain("removed history is not counted");
      expect(output).toContain("these counts can overlap with deadline elapsed");
      expect(output).toContain("do not prove a stuck worker");
      expect(output).toContain("current site and viewer permissions");
      expect(output).toContain("/admin/agents/activity?origin=runtime");
      expect(output).toContain("/admin/jobs?name=agent.runExecute");
    }
    expect(html).toContain('aria-labelledby="agent-runtime-outcome-heading"');
    expect(html).not.toMatch(/<button|<form/);
  });

  it("keeps missing evidence distinct from zero results and rejects malformed private data", () => {
    for (const state of ["unsupported", "unavailable"]) {
      const evidence = snapshot();
      const unknown = {
        ...evidence,
        state,
        outcomes: evidence.outcomes.map(({ state }) => ({
          state,
          count: null,
          lastFinishedAt: null,
        })),
        active: {
          unfinished: null,
          deadlineElapsed: null,
          executing: null,
          leaseElapsed: null,
          leaseMissing: null,
        },
      };
      const cli = formatAgentRuntimeOutcomeDetail(unknown);
      expect(cli).toContain(`observation: ${state}`);
      expect(cli).toContain("Unknown");
      expect(cli).not.toContain("Unfinished runs: 0");
      expect(cli).not.toContain("No matching records");
      expect(renderToStaticMarkup(<AgentRuntimeOutcome summary={unknown} />)).toContain("Unknown");
    }
    const malformed = { ...snapshot(), payload: "private-runtime-record-never-render" };
    expect(() => formatAgentRuntimeOutcomeDetail(malformed)).toThrow();
    for (const summary of [malformed, undefined]) {
      const html = renderToStaticMarkup(<AgentRuntimeOutcome summary={summary} />);
      expect(html).toContain(
        "Runtime outcome evidence is unavailable. Refresh to request a valid snapshot.",
      );
      expect(html).not.toContain("private-runtime-record-never-render");
    }
  });
});
