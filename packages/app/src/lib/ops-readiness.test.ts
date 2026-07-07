import { describe, expect, it } from "vitest";

import { buildDeployPlan, buildDeployPlanJson } from "../scripts/deploy-plan-core";
import {
  buildDeployReadinessSection,
  resolveOpsReadinessTarget,
  summarizeOpsReadinessSections,
  type OpsReadinessSection,
} from "./ops-readiness";

describe("ops readiness", () => {
  it("blocks the deploy gate when target-required environment is unresolved", () => {
    const plan = buildDeployPlanJson(buildDeployPlan("vercel"), false, {
      DATABASE_URL: "postgres://user:pass@example.com:5432/app",
      NP_SECRET: "12345678901234567890123456789012",
      SITE_URL: "https://example.com",
      NP_STORAGE_ADAPTER: "local",
    });

    const section = buildDeployReadinessSection(plan);

    expect(section.state).toBe("error");
    expect(section.summary).toContain("required environment");
    expect(section.nextCommand).toContain("doctor:prod");
    expect(section.checks.some((check) => check.id === "deploy.env.np_s3_bucket")).toBe(true);
  });

  it("blocks the deploy gate on production storage safety checks", () => {
    const env = {
      DATABASE_URL: "postgres://user:pass@example.com:5432/app",
      NP_ENABLE_JOBS: "1",
      NP_REPLICAS: "2",
      NP_SCHEDULER_TOKEN: "0123456789abcdef",
      NP_SECRET: "12345678901234567890123456789012",
      NP_STORAGE_ADAPTER: "local",
      SITE_URL: "https://example.com",
    };
    const plan = buildDeployPlanJson(buildDeployPlan("fly"), false, env);

    const section = buildDeployReadinessSection(plan, env);

    expect(section.state).toBe("error");
    expect(section.summary).toContain("production safety");
    expect(section.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prod.storage_adapter",
          state: "error",
          detail: "local + NP_REPLICAS=2",
        }),
        expect.objectContaining({
          id: "target.fly.storage",
          state: "error",
          detail: "local + NP_REPLICAS=2",
        }),
      ]),
    );
  });

  it("surfaces deliberate single-node local storage as a deploy warning", () => {
    const env = {
      DATABASE_URL: "postgres://user:pass@example.com:5432/app",
      NP_ENABLE_JOBS: "1",
      NP_REPLICAS: "1",
      NP_SCHEDULER_TOKEN: "0123456789abcdef",
      NP_SECRET: "12345678901234567890123456789012",
      NP_STORAGE_ADAPTER: "local",
      SITE_URL: "https://example.com",
    };
    const plan = buildDeployPlanJson(buildDeployPlan("fly"), false, env);

    const section = buildDeployReadinessSection(plan, env);

    expect(section.state).toBe("warn");
    expect(section.summary).toContain("production safety warning");
    expect(section.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "target.fly.storage",
          state: "warn",
          detail: "local + NP_REPLICAS=1",
        }),
      ]),
    );
  });

  it("summarizes sections and selects the first blocking next command", () => {
    const sections: OpsReadinessSection[] = [
      section("deploy", "ok", null),
      section("migrations", "error", "nexpress ops migrate plan --json"),
      section("backup", "warn", "nexpress ops backup status --required --json"),
    ];

    const summary = summarizeOpsReadinessSections(sections);

    expect(summary.status).toBe("blocked");
    expect(summary.summary.errors).toBe(1);
    expect(summary.summary.warnings).toBe(1);
    expect(summary.nextCommand).toBe("nexpress ops migrate plan --json");
  });

  it("falls through to the next actionable warning when a blocker has no command", () => {
    const sections: OpsReadinessSection[] = [
      section("deploy", "error", null),
      section("migrations", "warn", "nexpress ops migrate plan --json"),
      section("backup", "ok", "nexpress ops backup status --json"),
    ];

    const summary = summarizeOpsReadinessSections(sections);

    expect(summary.status).toBe("blocked");
    expect(summary.summary.checkErrors).toBe(1);
    expect(summary.summary.checkWarnings).toBe(1);
    expect(summary.nextCommand).toBe("nexpress ops migrate plan --json");
  });

  it("keeps invalid target information while falling back to inferred/default target", () => {
    const resolved = resolveOpsReadinessTarget("unknown", {});

    expect(resolved.target).toBe("docker");
    expect(resolved.inferred).toBe(true);
    expect(resolved.invalidTarget).toBe("unknown");
  });
});

function section(
  id: OpsReadinessSection["id"],
  state: OpsReadinessSection["state"],
  nextCommand: string | null,
): OpsReadinessSection {
  return {
    id,
    title: id,
    state,
    summary: id,
    metrics: [],
    nextCommand,
    projectNextCommand: nextCommand,
    checks: [{ id, state, label: id }],
  };
}
