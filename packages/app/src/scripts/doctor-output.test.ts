import { describe, expect, it } from "vitest";

import {
  buildDoctorFixPlan,
  buildDoctorJson,
  renderBriefDoctorReport,
  renderDoctorCheck,
  renderDoctorFixPlan,
  renderDoctorSummary,
  summarizeChecks,
} from "./doctor-output.js";
import type { CheckResult } from "./doctor-readiness.js";

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
    expect(buildDoctorJson({ prodMode: true, target: "vercel", checks })).not.toHaveProperty(
      "fixPlan",
    );

    expect(
      buildDoctorJson({ prodMode: true, target: "vercel", checks, includeFixPlan: true }),
    ).toEqual(
      expect.objectContaining({
        fixPlan: [
          expect.objectContaining({
            id: "scheduler.generate_token",
            checkIds: ["prod.scheduler_token"],
            commands: ["openssl rand -hex 32"],
          }),
          expect.objectContaining({
            id: "env.run_setup",
            checkIds: ["env.database_url"],
            commands: ["pnpm run setup"],
          }),
        ],
      }),
    );
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
        commands: ["pnpm run deploy:plan -- --target vercel --json", "pnpm run setup"],
      }),
      expect.objectContaining({
        id: "database.configure_target_postgres",
        checkIds: ["target.vercel.database_url"],
        commands: ["pnpm run deploy:plan -- --target vercel --json", "pnpm run setup"],
        notes: expect.arrayContaining([
          "Set DATABASE_URL to the hosted provider's public or pooler connection string.",
        ]),
      }),
      expect.objectContaining({
        id: "jobs.add_target_worker_host",
        checkIds: ["target.vercel.jobs_worker"],
        commands: ["pnpm run deploy:plan -- --target vercel --json", "pnpm worker"],
      }),
    ]);
  });

  it("renders no-color check output for logs", () => {
    expect(renderDoctorCheck(checks[1]!, { color: false })).toBe(
      "⚠ NP_SCHEDULER_TOKEN  not set\n    Set it when scheduled publishing is enabled.",
    );
    expect(renderDoctorCheck(checks[1]!, { color: false })).not.toMatch(/\x1b\[/);
  });

  it("renders a no-color summary", () => {
    expect(renderDoctorSummary(checks, { color: false })).toBe("1 error, 1 warning.");
    expect(renderDoctorSummary([checks[0]!], { color: false })).toBe("All 1 checks passed.");
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

  it("renders a human-readable fix plan", () => {
    expect(
      renderDoctorFixPlan(
        [
          {
            id: "database.configure_target_postgres",
            checkIds: ["target.vercel.database_url"],
            title: "Configure a hosted Postgres DATABASE_URL for the selected deployment target",
            risk: "medium",
            requiresApproval: true,
            commands: ["pnpm run deploy:plan -- --target vercel --json", "pnpm run setup"],
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
        "   risk: medium; approval required",
        "   checks: target.vercel.database_url",
        "   command: pnpm run deploy:plan -- --target vercel --json",
        "   command: pnpm run setup",
        "   note: Set DATABASE_URL to the hosted provider's public or pooler connection string.",
      ].join("\n"),
    );

    expect(renderDoctorFixPlan([], { color: false })).toBe("No fix-plan actions needed.");
  });
});
