import { describe, expect, it } from "vitest";

import {
  buildReleaseJson,
  buildReleasePlanJson,
  renderBriefReleasePlan,
  renderBriefReleaseReport,
  type ReleaseStep,
} from "./release-core.js";

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

  it("builds a release plan artifact contract from a ready check", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        {
          ...readyStep,
          id: "ops.preflight",
          report: {
            schemaVersion: "np.ops-preflight.v1",
            ok: true,
            status: "ready",
            plan: {
              commands: ["pnpm install", "pnpm db:migrate", "pnpm run doctor:prod"],
            },
          },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-test",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-test.json",
      check,
    });

    expect(plan).toEqual(
      expect.objectContaining({
        schemaVersion: "np.release-plan.v1",
        ok: true,
        planId: "release-test",
        target: "docker",
        apply: expect.objectContaining({
          allowed: true,
          requiresApproval: true,
        }),
        summary: expect.objectContaining({
          releaseCommands: 3,
          verifyCommands: 1,
        }),
      }),
    );
    expect(plan.commands.map((command) => command.command)).toEqual([
      "pnpm install",
      "pnpm db:migrate",
      "pnpm run doctor:prod",
      "nexpress release verify --json",
    ]);
    expect(plan.commands.find((command) => command.command === "pnpm db:migrate")).toEqual(
      expect.objectContaining({ requiresApproval: true }),
    );
  });

  it("keeps blocked release plans approval-gated with remediation commands", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        {
          ...readyStep,
          ok: false,
          exitCode: 1,
          status: "blocked",
          nextCommand: "pnpm run doctor:prod -- --fix-plan",
          report: { schemaVersion: "np.ops-preflight.v1", ok: false, status: "blocked" },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-blocked",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-blocked.json",
      check,
    });

    expect(plan.ok).toBe(false);
    expect(plan.apply.allowed).toBe(false);
    expect(plan.apply.nextCommand).toBe("pnpm run doctor:prod -- --fix-plan");
    expect(plan.commands[0]).toEqual(
      expect.objectContaining({
        phase: "remediate",
        command: "pnpm run doctor:prod -- --fix-plan",
      }),
    );
  });

  it("marks risky remediation commands as approval-required", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        {
          ...readyStep,
          ok: false,
          exitCode: 1,
          status: "blocked",
          nextCommand: "pnpm db:migrate",
          report: { schemaVersion: "np.ops-migrate.v1", ok: false, status: "blocked" },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-risky-remediation",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-risky-remediation.json",
      check,
    });

    expect(plan.commands[0]).toEqual(
      expect.objectContaining({
        phase: "remediate",
        command: "pnpm db:migrate",
        requiresApproval: true,
      }),
    );
  });

  it("renders compact release plan output", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-test",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-test.json",
      check,
    });

    expect(renderBriefReleasePlan(plan, { color: false })).toContain("NexPress release plan");
    expect(renderBriefReleasePlan(plan, { color: false })).toContain(
      "artifact: .nexpress/releases/release-test.json",
    );
  });
});
