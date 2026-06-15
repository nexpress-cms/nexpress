import { describe, expect, it } from "vitest";

import type { DeployPlanJson } from "./deploy-plan-core.js";
import type { DoctorJsonOutput } from "./doctor-output.js";
import type { OpsMigrateJson } from "./ops-migrate-core.js";
import { buildOpsPreflightReport, renderBriefOpsPreflightReport } from "./ops-preflight.js";

const readyPlan: DeployPlanJson = {
  schemaVersion: "np.deploy-plan.v1",
  target: "vercel",
  title: "Vercel",
  inferred: false,
  dryRun: false,
  summary: {
    requiredEnv: { total: 3, set: 3, unresolved: 0 },
    recommendedEnv: { total: 0, set: 0, unresolved: 0 },
  },
  fit: [],
  bridge: {
    title: "Vercel deploy bridge",
    summary: "Deploy bridge",
    steps: [],
  },
  requiredEnv: [],
  recommendedEnv: [],
  storage: [],
  runtime: [],
  commands: ["pnpm db:migrate"],
  nextCommands: [],
  diagnostics: [],
};

const readyDoctor: DoctorJsonOutput = {
  schemaVersion: "np.doctor.v1",
  ok: true,
  blocksDeploy: false,
  nextCommand: null,
  projectNextCommand: null,
  mode: "prod",
  target: "vercel",
  summary: { total: 1, errors: 0, warnings: 0 },
  checks: [{ id: "doctor.ready", state: "ok", label: "Doctor" }],
};

const readyMigrate: OpsMigrateJson = {
  schemaVersion: "np.ops-migrate.v1",
  ok: true,
  status: "ready",
  mode: "plan",
  migrationsFolder: "./drizzle",
  migrationTable: "drizzle.__drizzle_migrations",
  summary: {
    local: 1,
    applied: 1,
    pending: 0,
    drifted: 0,
    unknownApplied: 0,
    destructiveFindings: 0,
    inspectionBlocked: false,
    backupRequired: false,
    manualReviewRequired: false,
    canApplyAfterBackup: false,
  },
  nextCommand: null,
  projectNextCommand: null,
  pending: [],
  destructiveFindings: [],
  actions: [],
  checks: [{ id: "migrate.pending", state: "ok", label: "Pending migrations" }],
};

describe("ops preflight", () => {
  it("includes migration evidence in ready preflight reports", () => {
    const report = buildOpsPreflightReport({
      target: "vercel",
      planRun: {
        command: "pnpm run deploy:plan -- --target vercel --json",
        stdout: "{}",
        stderr: "",
        exitCode: 0,
      },
      doctorRun: {
        command: "pnpm run doctor:prod -- --target vercel --json --fix-plan",
        stdout: "{}",
        stderr: "",
        exitCode: 0,
      },
      migrateRun: {
        command: "pnpm run ops:migrate -- plan --json",
        stdout: "{}",
        stderr: "",
        exitCode: 0,
      },
      plan: readyPlan,
      doctor: readyDoctor,
      migrate: readyMigrate,
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-preflight.v1",
        ok: true,
        status: "ready",
        summary: expect.objectContaining({
          migrationErrors: 0,
          migrationWarnings: 0,
          migrationPending: 0,
          migrationDestructiveFindings: 0,
          migrationInspectionBlocked: false,
        }),
        migrate: readyMigrate,
      }),
    );
    expect(report.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ops.migrate",
          ok: true,
          projectCommand: "pnpm run ops:migrate -- plan --json",
        }),
      ]),
    );
    expect(renderBriefOpsPreflightReport(report, false)).toContain(
      "migrate: 0 pending, 0 destructive findings, 0 errors, 0 warnings",
    );
  });

  it("blocks preflight on pending migrations and surfaces the migration next command", () => {
    const migrate: OpsMigrateJson = {
      ...readyMigrate,
      ok: false,
      status: "blocked",
      summary: {
        ...readyMigrate.summary,
        pending: 1,
        backupRequired: true,
        canApplyAfterBackup: true,
      },
      nextCommand: "nexpress ops backup status --required --json",
      projectNextCommand: "pnpm run ops:backup -- status --required --json",
      pending: [{ tag: "0002_posts", createdAt: 1_700_000_020_000, hash: "h2" }],
      actions: [
        {
          id: "backup.required",
          phase: "prepare",
          command: "nexpress ops backup status --required --json",
          projectCommand: "pnpm run ops:backup -- status --required --json",
          required: true,
          requiresApproval: false,
          blockedBy: [],
          note: "Confirm a fresh verified backup before applying pending migrations.",
        },
      ],
      checks: [{ id: "migrate.pending", state: "error", label: "Pending migrations" }],
    };

    const report = buildOpsPreflightReport({
      target: "vercel",
      planRun: {
        command: "pnpm run deploy:plan -- --target vercel --json",
        stdout: "{}",
        stderr: "",
        exitCode: 0,
      },
      doctorRun: {
        command: "pnpm run doctor:prod -- --target vercel --json --fix-plan",
        stdout: "{}",
        stderr: "",
        exitCode: 0,
      },
      migrateRun: {
        command: "pnpm run ops:migrate -- plan --json",
        stdout: "{}",
        stderr: "",
        exitCode: 1,
      },
      plan: readyPlan,
      doctor: readyDoctor,
      migrate,
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("blocked");
    expect(report.nextCommand).toBe("nexpress ops backup status --required --json");
    expect(report.projectNextCommand).toBe("pnpm run ops:backup -- status --required --json");
    expect(report.summary.migrationPending).toBe(1);
    expect(report.steps.find((step) => step.id === "ops.migrate")).toEqual(
      expect.objectContaining({ ok: false, exitCode: 1 }),
    );
  });
});
