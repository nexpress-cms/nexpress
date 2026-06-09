import { describe, expect, it } from "vitest";

import { buildReleaseJson, renderBriefReleaseReport, type ReleaseStep } from "./release-core.js";

const readyStep: ReleaseStep = {
  id: "ops.plugins",
  command: "pnpm run ops:plugins -- doctor --json",
  ok: true,
  exitCode: 0,
  status: "ready",
  nextCommand: null,
  report: { schemaVersion: "np.ops-plugins.v1", ok: true, status: "ready" },
};

describe("release core", () => {
  it("builds a ready release check contract", () => {
    expect(
      buildReleaseJson({
        mode: "check",
        target: "vercel",
        steps: [readyStep],
      }),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: "np.release.v1",
        ok: true,
        mode: "check",
        status: "ready",
        target: "vercel",
        nextCommand: null,
        summary: { steps: 1, ready: 1, attention: 0, blocked: 0 },
      }),
    );
  });

  it("blocks when a required release step fails", () => {
    const report = buildReleaseJson({
      mode: "check",
      target: "vercel",
      steps: [
        readyStep,
        {
          id: "ops.preflight",
          command: "pnpm run ops:preflight -- --target vercel --json",
          ok: false,
          exitCode: 1,
          status: "blocked",
          nextCommand: "pnpm run doctor:prod -- --target vercel --fix-plan",
          report: { schemaVersion: "np.ops-preflight.v1", ok: false, status: "blocked" },
        },
      ],
    });

    expect(report).toEqual(
      expect.objectContaining({
        ok: false,
        status: "blocked",
        nextCommand: "pnpm run doctor:prod -- --target vercel --fix-plan",
        summary: { steps: 2, ready: 1, attention: 0, blocked: 1 },
      }),
    );
  });

  it("keeps attention separate from blocked", () => {
    const report = buildReleaseJson({
      mode: "verify",
      url: "https://example.com",
      steps: [
        readyStep,
        {
          id: "ops.storage",
          command: "pnpm run ops:storage -- --json",
          ok: true,
          exitCode: 0,
          status: "attention",
          nextCommand: "nexpress ops storage status --json",
          report: { schemaVersion: "np.ops-storage.v1", ok: true, status: "attention" },
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("attention");
    expect(report.nextCommand).toBe("nexpress ops storage status --json");
  });

  it("renders compact human output", () => {
    const report = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [readyStep],
    });

    expect(renderBriefReleaseReport(report, { color: false })).toBe(
      [
        "NexPress release check",
        "ready: target: docker",
        "steps: 1 ready, 0 attention, 0 blocked",
        "[ok] ops.plugins ready - pnpm run ops:plugins -- doctor --json",
      ].join("\n"),
    );
  });
});
