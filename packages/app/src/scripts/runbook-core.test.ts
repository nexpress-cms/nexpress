import { describe, expect, it } from "vitest";

import { buildRunbookJson, renderBriefRunbook, type RunbookEvidence } from "./runbook-core.js";

const readyEvidence: RunbookEvidence = {
  id: "ops.jobs",
  command: "pnpm run ops:jobs -- --json",
  ok: true,
  status: "ready",
  nextCommand: null,
};

describe("runbook core", () => {
  it("builds a ready runbook contract", () => {
    expect(
      buildRunbookJson({
        runbook: "worker-not-draining",
        evidence: [readyEvidence],
      }),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: "np.runbook.v1",
        ok: true,
        status: "ready",
        runbook: "worker-not-draining",
        risk: "medium",
      }),
    );
  });

  it("promotes blocked evidence to a blocked runbook", () => {
    const report = buildRunbookJson({
      runbook: "migration-crashed",
      evidence: [
        {
          id: "ops.status",
          command: "pnpm run ops:status -- --json",
          ok: false,
          status: "blocked",
          nextCommand: "pnpm run doctor -- --fix-plan",
        },
      ],
    });

    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        status: "blocked",
        risk: "high",
        nextCommands: ["pnpm run doctor -- --fix-plan"],
      }),
    );
  });

  it("renders compact human output", () => {
    const report = buildRunbookJson({
      runbook: "worker-not-draining",
      evidence: [readyEvidence],
    });

    expect(renderBriefRunbook(report, { color: false })).toContain("ready: Worker not draining");
    expect(renderBriefRunbook(report, { color: false })).toContain("- [ok] ops.jobs ready");
  });
});
