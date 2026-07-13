import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectDoctorChecks, collectDoctorReport } from "./doctor-core.js";

describe("doctor core", () => {
  it("collects reusable doctor checks without requiring a bootable app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      env: {},
      nodeVersion: "24.11.1",
    });

    expect(checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "node.version",
        "env.file",
        "env.database_url",
        "database.reachable",
        "settings.contract",
        "revisions.contract",
        "jobs.contract",
        "migrations.applied",
      ]),
    );
    expect(checks.find((check) => check.id === "env.database_url")).toEqual(
      expect.objectContaining({
        state: "error",
        label: "DATABASE_URL",
      }),
    );
    expect(checks.find((check) => check.id === "database.reachable")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "DATABASE_URL not set",
      }),
    );
  });

  it("builds production doctor JSON with an optional fix plan", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const report = await collectDoctorReport({
      cwd,
      prodMode: true,
      target: "vercel",
      includeFixPlan: true,
      nodeVersion: "24.11.1",
      env: {
        npm_config_user_agent: "pnpm/10.33.0",
      },
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.doctor.v1",
        ok: false,
        blocksDeploy: true,
        mode: "prod",
        target: "vercel",
      }),
    );
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(report.fixPlan?.length).toBeGreaterThan(0);
  });

  it("includes partial OAuth env errors in collected checks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: {
        npm_config_user_agent: "pnpm/10.33.0",
        NP_OAUTH_GITHUB_CLIENT_ID: "Iv1.partial",
      },
    });

    expect(checks.find((check) => check.id === "oauth.github.credentials")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "partial env: missing NP_OAUTH_GITHUB_CLIENT_SECRET",
      }),
    );
  });
});
