import { describe, expect, it } from "vitest";

import {
  buildReleaseApplyJson,
  buildReleaseJson,
  buildReleasePlanJson,
  getReleaseApplyCommandSpec,
  renderBriefReleaseApply,
  renderBriefReleasePlan,
  renderBriefReleaseReport,
  type ReleaseStep,
} from "./release-core.js";

const readyStep: ReleaseStep = {
  id: "ops.plugins",
  command: "pnpm --silent run ops:plugins -- doctor --json",
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
          command: "pnpm --silent run ops:preflight -- --target vercel --json",
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
          command: "pnpm --silent run ops:storage -- --json",
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
        "[ok] ops.plugins ready - pnpm --silent run ops:plugins -- doctor --json",
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
    expect(plan.apply.projectNextCommand).toBe(
      "pnpm run ops:release -- apply --plan .nexpress/releases/release-test.json",
    );
    expect(plan.commands.map((command) => command.projectCommand)).toEqual([
      "pnpm install",
      "pnpm db:migrate",
      "pnpm run doctor:prod",
      "pnpm --silent run ops:release -- verify --json",
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
          report: {
            schemaVersion: "np.ops-preflight.v1",
            ok: false,
            status: "blocked",
            plan: {
              commands: ["pnpm install", "pnpm db:migrate", "pnpm run doctor:prod"],
            },
          },
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
    expect(plan.summary.releaseCommands).toBe(0);
    expect(plan.commands.map((command) => command.command)).not.toContain("pnpm db:migrate");
  });

  it("promotes blocked step plan next commands into release plans", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        readyStep,
        {
          id: "ops.migrate",
          command: "pnpm --silent run ops:migrate -- rollback-plan --json",
          ok: false,
          exitCode: 1,
          status: "blocked",
          nextCommand: "nexpress ops migrate rollback-plan --json",
          report: {
            schemaVersion: "np.ops-migrate-rollback-plan.v1",
            ok: false,
            status: "blocked",
            plan: {
              nextCommands: [
                "nexpress ops backup restore-plan latest --json",
                "nexpress ops migrate rollback-plan --json",
              ],
            },
          },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-nested-remediation",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-nested-remediation.json",
      check,
    });

    expect(plan.commands.map((command) => command.command)).toEqual([
      "nexpress ops migrate rollback-plan --json",
      "nexpress ops backup restore-plan latest --json",
      "nexpress release verify --json",
    ]);
    expect(plan.commands.map((command) => command.projectCommand)).toEqual([
      "pnpm --silent run ops:migrate -- rollback-plan --json",
      "pnpm --silent run ops:backup -- restore-plan latest --json",
      "pnpm --silent run ops:release -- verify --json",
    ]);
    expect(plan.summary.remediationCommands).toBe(2);
  });

  it("promotes blocked backup handoff commands into release plans", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "vercel",
      steps: [
        readyStep,
        {
          id: "ops.backup",
          command: "pnpm --silent run ops:backup -- status --required --json",
          ok: false,
          exitCode: 1,
          status: "blocked",
          nextCommand: "nexpress ops backup create --database artifacts/db.dump --verified --json",
          report: {
            schemaVersion: "np.ops-backup.v1",
            ok: false,
            status: "blocked",
            plan: {
              nextCommands: [
                "nexpress ops backup create --database artifacts/db.dump --verified --json",
                "nexpress ops backup verify latest --json",
              ],
            },
          },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-backup-remediation",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "vercel",
      artifactPath: ".nexpress/releases/release-backup-remediation.json",
      check,
    });

    expect(plan.commands.map((command) => command.command)).toEqual([
      "nexpress ops backup create --database artifacts/db.dump --verified --json",
      "nexpress ops backup verify latest --json",
      "nexpress release verify --json",
    ]);
    expect(plan.commands.map((command) => command.projectCommand)).toEqual([
      "pnpm --silent run ops:backup -- create --database artifacts/db.dump --verified --json",
      "pnpm --silent run ops:backup -- verify latest --json",
      "pnpm --silent run ops:release -- verify --json",
    ]);
    expect(plan.summary.remediationCommands).toBe(2);
  });

  it("does not add nested next commands from ready steps as remediation", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        {
          ...readyStep,
          report: {
            schemaVersion: "np.ops-plugins-upgrade-plan.v1",
            ok: true,
            status: "ready",
            plan: {
              nextCommands: ["nexpress ops plugins upgrade-plan --json"],
            },
          },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-ready-nested",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-ready-nested.json",
      check,
    });

    expect(plan.commands.map((command) => command.command)).toEqual([
      "nexpress release verify --json",
    ]);
    expect(plan.summary.remediationCommands).toBe(0);
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

  it("marks approval-gated ops execution commands as approval-required", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        {
          ...readyStep,
          ok: false,
          exitCode: 1,
          status: "blocked",
          nextCommand: "nexpress ops storage test --execute --approve storage-test --json",
          report: { schemaVersion: "np.ops-storage.v1", ok: false, status: "blocked" },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-ops-approval",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-ops-approval.json",
      check,
    });

    expect(plan.commands[0]).toEqual(
      expect.objectContaining({
        command: "nexpress ops storage test --execute --approve storage-test --json",
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

  it("builds a dry-run release apply audit without requiring approval", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-test",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-test.json",
      check,
    });
    const apply = buildReleaseApplyJson({
      plan,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "dry-run",
      approved: false,
      artifactPath: ".nexpress/releases/release-test-apply.json",
      planArtifactPath: ".nexpress/releases/release-test.json",
    });

    expect(apply).toEqual(
      expect.objectContaining({
        schemaVersion: "np.release-apply.v1",
        ok: true,
        mode: "dry-run",
        status: "ready",
        approved: false,
      }),
    );
    expect(apply.commands).toEqual([
      expect.objectContaining({
        command: "nexpress release verify --json",
        projectCommand: "pnpm --silent run ops:release -- verify --json",
        status: "pending",
      }),
    ]);
    expect(apply.execution).toEqual({
      nextCommand:
        "nexpress release apply --plan .nexpress/releases/release-test.json --execute --approve release-test --json",
      projectNextCommand:
        "pnpm --silent run ops:release -- apply --plan .nexpress/releases/release-test.json --execute --approve release-test --json",
      requiresApproval: true,
      approved: false,
    });
    expect(renderBriefReleaseApply(apply, { color: false })).toContain(
      "Project next: pnpm --silent run ops:release -- apply --plan .nexpress/releases/release-test.json --execute --approve release-test --json",
    );
  });

  it("allows generated release apply commands", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "vercel",
      steps: [
        {
          ...readyStep,
          id: "ops.preflight",
          report: {
            schemaVersion: "np.ops-preflight.v1",
            ok: true,
            status: "ready",
            plan: {
              commands: [
                "pnpm install",
                "pnpm run setup -- --non-interactive",
                "pnpm db:migrate -- --status",
                "pnpm db:migrate",
                "pnpm run doctor:prod -- --target vercel",
              ],
            },
          },
        },
      ],
    });
    const plan = buildReleasePlanJson({
      planId: "release-generated",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "vercel",
      artifactPath: ".nexpress/releases/release-generated.json",
      check,
    });
    const apply = buildReleaseApplyJson({
      plan,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "dry-run",
      approved: false,
      artifactPath: ".nexpress/releases/release-generated-apply.json",
      planArtifactPath: ".nexpress/releases/release-generated.json",
    });

    expect(apply.ok).toBe(true);
    expect(apply.safety).toEqual({ allowed: true, blockedReason: null, findings: [] });
    expect(apply.summary.pending).toBe(6);
  });

  it("accepts legacy non-silent project commands in existing release plans", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-legacy-project-command",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-legacy-project-command.json",
      check,
    });
    const legacyPlan = {
      ...plan,
      commands: plan.commands.map((command) =>
        command.command === "nexpress release verify --json"
          ? { ...command, projectCommand: "pnpm run ops:release -- verify --json" }
          : command,
      ),
    };
    const apply = buildReleaseApplyJson({
      plan: legacyPlan,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "dry-run",
      approved: false,
      artifactPath: ".nexpress/releases/release-legacy-project-command-apply.json",
      planArtifactPath: ".nexpress/releases/release-legacy-project-command.json",
    });

    expect(apply.ok).toBe(true);
    expect(apply.safety).toEqual({ allowed: true, blockedReason: null, findings: [] });
    expect(apply.commands[0]?.projectCommand).toBe("pnpm run ops:release -- verify --json");
  });

  it("parses release apply commands into structured executable specs", () => {
    expect(getReleaseApplyCommandSpec("pnpm install", "docker")).toEqual({
      executable: "pnpm",
      args: ["install"],
    });
    expect(getReleaseApplyCommandSpec("pnpm run doctor:prod -- --target vercel", "vercel")).toEqual(
      {
        executable: "pnpm",
        args: ["run", "doctor:prod", "--", "--target", "vercel"],
      },
    );
    expect(getReleaseApplyCommandSpec("nexpress release verify --json", "docker")).toEqual({
      executable: "nexpress",
      args: ["release", "verify", "--json"],
    });
    expect(getReleaseApplyCommandSpec("pnpm install && touch /tmp/pwned", "docker")).toBeNull();
    expect(
      getReleaseApplyCommandSpec("pnpm run doctor:prod -- --target docker", "vercel"),
    ).toBeNull();
  });

  it("blocks tampered release apply commands before approval or execution", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-tampered",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-tampered.json",
      check,
    });
    const tampered = {
      ...plan,
      commands: [
        ...plan.commands,
        {
          phase: "release" as const,
          command: 'node -e "process.exit(0)"',
          projectCommand: 'node -e "process.exit(0)"',
          required: true,
          requiresApproval: false,
        },
      ],
    };
    const apply = buildReleaseApplyJson({
      plan: tampered,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "execute",
      approved: true,
      artifactPath: ".nexpress/releases/release-tampered-apply.json",
      planArtifactPath: ".nexpress/releases/release-tampered.json",
    });

    expect(apply.ok).toBe(false);
    expect(apply.status).toBe("blocked");
    expect(apply.blockedReason).toBe(
      "release plan contains commands that are not safe for release apply",
    );
    expect(apply.execution).toEqual({
      nextCommand: "nexpress release plan --target docker --json",
      projectNextCommand: "pnpm --silent run ops:release -- plan --target docker --json",
      requiresApproval: false,
      approved: true,
    });
    expect(apply.summary.blocked).toBe(apply.commands.length);
    expect(apply.safety.findings).toEqual([
      expect.objectContaining({
        index: 1,
        command: 'node -e "process.exit(0)"',
        reason: "command is not in the NexPress release apply allowlist",
      }),
    ]);
    expect(renderBriefReleaseApply(apply, { color: false })).toContain(
      "safety: command[1] command is not in the NexPress release apply allowlist",
    );
  });

  it("blocks release apply plans with tampered project command metadata", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-project-command-tampered",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-project-command-tampered.json",
      check,
    });
    const tampered = {
      ...plan,
      commands: [
        {
          ...plan.commands[0],
          projectCommand:
            'pnpm --silent run ops:release -- verify --json && node -e "process.exit(0)"',
        },
      ],
    };
    const apply = buildReleaseApplyJson({
      plan: tampered,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "dry-run",
      approved: false,
    });

    expect(apply.ok).toBe(false);
    expect(apply.status).toBe("blocked");
    expect(apply.safety.findings).toEqual([
      expect.objectContaining({
        index: 0,
        reason: "projectCommand does not match the command",
      }),
    ]);
  });

  it("blocks release apply plans with tampered targets", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-target-tampered",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-target-tampered.json",
      check,
    });
    const tampered = {
      ...plan,
      target: "docker && node -e process.exit(0)",
      commands: [
        {
          ...plan.commands[0],
          command: "pnpm run doctor:prod -- --target docker && node -e process.exit(0)",
          projectCommand: "pnpm run doctor:prod -- --target docker && node -e process.exit(0)",
          requiresApproval: false,
        },
      ],
    };
    const apply = buildReleaseApplyJson({
      plan: tampered,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "execute",
      approved: true,
    });

    expect(apply.ok).toBe(false);
    expect(apply.execution).toEqual({
      nextCommand: "nexpress release plan --json",
      projectNextCommand: "pnpm --silent run ops:release -- plan --json",
      requiresApproval: false,
      approved: true,
    });
    expect(apply.safety.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: -1,
          reason: "release plan target is not supported",
        }),
        expect.objectContaining({
          index: 0,
          reason: "command is not in the NexPress release apply allowlist",
        }),
      ]),
    );
  });

  it("blocks malformed release apply command entries without throwing", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-malformed-command",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-malformed-command.json",
      check,
    });
    const tampered = {
      ...plan,
      commands: [null],
    } as unknown as typeof plan;
    const apply = buildReleaseApplyJson({
      plan: tampered,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "dry-run",
      approved: false,
    });

    expect(apply.ok).toBe(false);
    expect(apply.status).toBe("blocked");
    expect(apply.safety.findings).toEqual([
      expect.objectContaining({
        index: 0,
        command: "<missing>",
        reason: expect.stringContaining("command must be a non-empty string"),
      }),
    ]);
    expect(apply.commands[0]).toEqual({
      phase: "release",
      command: "<missing>",
      projectCommand: "<missing>",
      required: true,
      requiresApproval: false,
      status: "blocked",
      exitCode: null,
    });
  });

  it("blocks release apply execution without the plan approval token", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-test",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-test.json",
      check,
    });
    const apply = buildReleaseApplyJson({
      plan,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "execute",
      approved: false,
    });

    expect(apply.ok).toBe(false);
    expect(apply.status).toBe("blocked");
    expect(apply.blockedReason).toBe("release apply requires --approve release-test");
    expect(apply.summary.blocked).toBe(apply.commands.length);
    expect(apply.commands[0]).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(apply.execution.nextCommand).toBe(
      "nexpress release apply --plan .nexpress/releases/release-test.json --execute --approve release-test --json",
    );
  });

  it("blocks release apply when the plan itself is blocked", () => {
    const check = buildReleaseJson({
      mode: "check",
      target: "docker",
      steps: [
        {
          ...readyStep,
          ok: false,
          exitCode: 1,
          status: "blocked",
          report: { schemaVersion: "np.ops-backup.v1", ok: false, status: "blocked" },
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
    const apply = buildReleaseApplyJson({
      plan,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "execute",
      approved: true,
    });

    expect(apply.ok).toBe(false);
    expect(apply.status).toBe("blocked");
    expect(apply.blockedReason).toBe(
      "release check is not ready; run remediation commands and regenerate the plan",
    );
    expect(apply.summary.blocked).toBe(apply.commands.length);
    expect(apply.commands[0]).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(apply.execution).toEqual({
      nextCommand: "nexpress release check --json",
      projectNextCommand: "pnpm --silent run ops:release -- check --json",
      requiresApproval: false,
      approved: true,
    });
  });

  it("summarizes executed release apply results", () => {
    const check = buildReleaseJson({ mode: "check", target: "docker", steps: [readyStep] });
    const plan = buildReleasePlanJson({
      planId: "release-test",
      createdAt: "2026-06-10T00:00:00.000Z",
      target: "docker",
      artifactPath: ".nexpress/releases/release-test.json",
      check,
    });
    const apply = buildReleaseApplyJson({
      plan,
      createdAt: "2026-06-10T00:01:00.000Z",
      mode: "execute",
      approved: true,
      commandResults: [
        {
          ...plan.commands[0],
          status: "success",
          exitCode: 0,
          stdout: "{}",
          stderr: "",
        },
      ],
    });

    expect(apply.ok).toBe(true);
    expect(apply.status).toBe("applied");
    expect(apply.summary).toEqual({
      commands: 1,
      pending: 0,
      skipped: 0,
      success: 1,
      failed: 0,
      blocked: 0,
    });
    expect(renderBriefReleaseApply(apply, { color: false })).toContain(
      "applied: plan: release-test",
    );
  });
});
