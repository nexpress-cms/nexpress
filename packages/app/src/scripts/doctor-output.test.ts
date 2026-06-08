import { describe, expect, it } from "vitest";

import {
  buildDoctorFixPlan,
  buildDoctorFixPlanCommand,
  buildDoctorJson,
  renderBriefDoctorReport,
  renderDoctorCheck,
  renderDoctorFixPlan,
  renderDoctorNextCommand,
  renderDoctorSummary,
  summarizeChecks,
} from "./doctor-output.js";
import type { CheckResult } from "./doctor-readiness.js";

const ANSI_ESCAPE_RE = new RegExp(String.raw`\x1b\[`);

const checks: CheckResult[] = [
  { id: "node.version", state: "ok", label: "Node.js >= 20", detail: "24.11.1" },
  {
    id: "prod.scheduler_token",
    state: "warn",
    label: "NP_SCHEDULER_TOKEN",
    detail: "not set",
    hint: "Set it when scheduled publishing is enabled.",
  },
  {
    id: "env.database_url",
    state: "error",
    label: "DATABASE_URL",
    detail: "not set",
    hint: "Set DATABASE_URL first.",
  },
];

function checkAt(index: number): CheckResult {
  const check = checks[index];
  if (!check) throw new Error(`Missing test check at index ${index}`);
  return check;
}

describe("doctor output", () => {
  it("summarizes checks for stable JSON output", () => {
    expect(summarizeChecks(checks)).toEqual({
      total: 3,
      errors: 1,
      warnings: 1,
    });
  });

  it("builds a machine-readable doctor report", () => {
    expect(buildDoctorJson({ prodMode: true, target: "vercel", checks })).toEqual({
      schemaVersion: "np.doctor.v1",
      ok: false,
      blocksDeploy: true,
      nextCommand: "pnpm run doctor:prod -- --target vercel --fix-plan",
      mode: "prod",
      target: "vercel",
      summary: {
        total: 3,
        errors: 1,
        warnings: 1,
      },
      checks,
    });
  });

  it("adds fix-plan actions only when requested", () => {
    expect(buildDoctorJson({ prodMode: true, target: "vercel", checks })).toEqual(
      expect.not.objectContaining({ fixPlan: expect.anything() }),
    );

    expect(
      buildDoctorJson({ prodMode: true, target: "vercel", checks, includeFixPlan: true }),
    ).toEqual(
      expect.objectContaining({
        fixPlan: [
          expect.objectContaining({
            id: "scheduler.generate_token",
            checkIds: ["prod.scheduler_token"],
            severity: "warning",
            blocksDeploy: false,
            nextCommand: "openssl rand -hex 32",
            commands: ["openssl rand -hex 32"],
            notes: expect.arrayContaining([
              "Set it when scheduled publishing is enabled.",
              "Set NP_SCHEDULER_TOKEN to the generated value and send Authorization: Bearer <token> from the scheduler.",
            ]),
          }),
          expect.objectContaining({
            id: "env.run_setup",
            checkIds: ["env.database_url"],
            severity: "blocking",
            blocksDeploy: true,
            nextCommand: "pnpm run setup",
            commands: ["pnpm run setup"],
            notes: ["Set DATABASE_URL first."],
          }),
        ],
        nextCommand: "pnpm run setup",
      }),
    );
  });

  it("builds follow-up fix-plan commands without materializing the fix plan", () => {
    expect(buildDoctorFixPlanCommand(false, null)).toBe("pnpm run doctor -- --fix-plan");
    expect(buildDoctorFixPlanCommand(true, null)).toBe("pnpm run doctor:prod -- --fix-plan");
    expect(buildDoctorFixPlanCommand(true, "vercel")).toBe(
      "pnpm run doctor:prod -- --target vercel --fix-plan",
    );
    expect(
      buildDoctorJson({
        prodMode: false,
        target: null,
        checks: [{ id: "node.version", state: "ok", label: "Node.js >= 20" }],
      }).nextCommand,
    ).toBeNull();
  });

  it("builds target-specific fix-plan actions for deployment checks", () => {
    const fixPlan = buildDoctorFixPlan({
      target: "vercel",
      checks: [
        {
          id: "target.vercel.storage",
          state: "error",
          label: "Vercel storage",
          detail: "NP_STORAGE_ADAPTER=local",
        },
        {
          id: "target.vercel.database_url",
          state: "error",
          label: "Vercel database URL",
          detail: "DATABASE_URL host is 127.0.0.1",
        },
        {
          id: "target.vercel.site_url",
          state: "error",
          label: "Vercel SITE_URL",
          detail: "SITE_URL host is localhost",
        },
        {
          id: "target.vercel.jobs_worker",
          state: "warn",
          label: "Vercel jobs worker",
        },
      ],
    });

    expect(fixPlan).toEqual([
      expect.objectContaining({
        id: "storage.configure_target_durable_storage",
        checkIds: ["target.vercel.storage"],
        severity: "blocking",
        blocksDeploy: true,
        nextCommand: "pnpm run deploy:plan -- --target vercel --brief --no-color",
        commands: ["pnpm run deploy:plan -- --target vercel --brief --no-color", "pnpm run setup"],
      }),
      expect.objectContaining({
        id: "database.configure_target_postgres",
        checkIds: ["target.vercel.database_url"],
        severity: "blocking",
        blocksDeploy: true,
        nextCommand: "pnpm run deploy:plan -- --target vercel --brief --no-color",
        commands: ["pnpm run deploy:plan -- --target vercel --brief --no-color", "pnpm run setup"],
        notes: expect.arrayContaining([
          "Set DATABASE_URL to the hosted provider's public or pooler connection string.",
        ]),
      }),
      expect.objectContaining({
        id: "site.configure_target_public_url",
        checkIds: ["target.vercel.site_url"],
        severity: "blocking",
        blocksDeploy: true,
        nextCommand: "pnpm run deploy:plan -- --target vercel --brief --no-color",
        commands: ["pnpm run deploy:plan -- --target vercel --brief --no-color", "pnpm run setup"],
        notes: expect.arrayContaining([
          "Use the final https:// origin, not localhost or a private network address.",
        ]),
      }),
      expect.objectContaining({
        id: "jobs.add_target_worker_host",
        checkIds: ["target.vercel.jobs_worker"],
        severity: "warning",
        blocksDeploy: false,
        nextCommand: "pnpm run deploy:plan -- --target vercel --brief --no-color",
        commands: ["pnpm run deploy:plan -- --target vercel --brief --no-color", "pnpm worker"],
      }),
    ]);
  });

  it("renders no-color check output for logs", () => {
    const warningCheck = checkAt(1);
    expect(renderDoctorCheck(warningCheck, { color: false })).toBe(
      "⚠ NP_SCHEDULER_TOKEN  not set\n    Set it when scheduled publishing is enabled.",
    );
    expect(renderDoctorCheck(warningCheck, { color: false })).not.toMatch(ANSI_ESCAPE_RE);
  });

  it("renders a no-color summary", () => {
    const okCheck = checkAt(0);
    expect(renderDoctorSummary(checks, { color: false })).toBe("1 error, 1 warning.");
    expect(renderDoctorSummary([okCheck], { color: false })).toBe("All 1 checks passed.");
  });

  it("renders a compact one-line-per-check brief", () => {
    expect(
      renderBriefDoctorReport({ prodMode: true, target: "vercel", checks }, { color: false }),
    ).toBe(
      [
        "NexPress doctor: prod for vercel",
        "1 error, 1 warning.",
        "[ok] node.version Node.js >= 20 - 24.11.1",
        "[warn] prod.scheduler_token NP_SCHEDULER_TOKEN - not set",
        "[error] env.database_url DATABASE_URL - not set",
      ].join("\n"),
    );
  });

  it("renders compact doctor follow-up commands", () => {
    expect(
      renderBriefDoctorReport(
        {
          prodMode: true,
          target: "vercel",
          checks,
          nextCommand: "pnpm run doctor:prod -- --target vercel --fix-plan",
        },
        { color: false },
      ),
    ).toContain("Next: pnpm run doctor:prod -- --target vercel --fix-plan");
    expect(renderDoctorNextCommand("pnpm run doctor -- --fix-plan", { color: false })).toBe(
      "Next: pnpm run doctor -- --fix-plan",
    );
  });

  it("renders a human-readable fix plan", () => {
    expect(
      renderDoctorFixPlan(
        [
          {
            id: "database.configure_target_postgres",
            checkIds: ["target.vercel.database_url"],
            title: "Configure a hosted Postgres DATABASE_URL for the selected deployment target",
            severity: "blocking",
            blocksDeploy: true,
            risk: "medium",
            requiresApproval: true,
            nextCommand: "pnpm run deploy:plan -- --target vercel --brief --no-color",
            commands: [
              "pnpm run deploy:plan -- --target vercel --brief --no-color",
              "pnpm run setup",
            ],
            notes: [
              "Set DATABASE_URL to the hosted provider's public or pooler connection string.",
            ],
          },
        ],
        { color: false },
      ),
    ).toBe(
      [
        "Fix plan",
        "1. Configure a hosted Postgres DATABASE_URL for the selected deployment target",
        "   severity: blocking; risk: medium; approval required",
        "   checks: target.vercel.database_url",
        "   next: pnpm run deploy:plan -- --target vercel --brief --no-color",
        "   command: pnpm run deploy:plan -- --target vercel --brief --no-color",
        "   command: pnpm run setup",
        "   note: Set DATABASE_URL to the hosted provider's public or pooler connection string.",
      ].join("\n"),
    );

    expect(renderDoctorFixPlan([], { color: false })).toBe("No fix-plan actions needed.");
  });
});
