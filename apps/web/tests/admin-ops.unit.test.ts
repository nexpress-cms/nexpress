import { describe, expect, it } from "vitest";

import {
  buildAdminOpsOverview,
  buildHealthActions,
  commandForHealthCheck,
  healthNextCommand,
  stateFromHealthSummary,
} from "@/lib/admin-ops";
import type { OpsReadinessReport, OpsReadinessSection } from "@/lib/ops-readiness";
import type { Check, HealthSummary } from "@/lib/system-health";

describe("admin ops helpers", () => {
  it("turns non-ok health checks into actionable rows", () => {
    const health = healthSummary([
      check("db", "ok"),
      check("storage", "warn", "local media drift"),
      check("secret", "error", "unset"),
    ]);

    const actions = buildHealthActions(health);

    expect(actions.map((action) => action.id)).toEqual(["storage", "secret"]);
    expect(actions[0]?.command).toBe("pnpm --silent run ops:storage -- verify --json");
    expect(actions[1]?.command).toBe("pnpm run setup");
    expect(healthNextCommand(health)).toBe("pnpm run setup");
  });

  it("uses the stale migration tracking recovery command when health identifies that state", () => {
    const command = commandForHealthCheck(
      check("migrations", "error", "drizzle tracks 32 applied, but framework tables are missing"),
    );

    expect(command).toContain("DROP SCHEMA IF EXISTS drizzle CASCADE");
    expect(command).toContain("pnpm db:migrate");
  });

  it("summarizes ops overview with the worst state across health and readiness", () => {
    const health = healthSummary([
      check("db", "ok"),
      check("queue", "warn", "no workers have started yet"),
    ]);
    const readiness = readinessReport([
      section("deploy", "ok"),
      section("jobs", "warn"),
      section("storage", "ok"),
      section("plugins", "ok"),
      section("migrations", "ok"),
      section("backup", "ok"),
    ]);

    const overview = buildAdminOpsOverview(health, readiness);

    expect(stateFromHealthSummary(health)).toBe("warn");
    expect(overview.state).toBe("warn");
    expect(overview.nextCommand).toBe("pnpm --silent run ops:jobs -- --json");
    expect(overview.cards.map((card) => card.id)).toEqual([
      "health",
      "readiness",
      "jobs",
      "storage",
      "plugins",
    ]);
    expect(overview.cards.find((card) => card.id === "storage")?.href).toBe(
      "/admin/readiness?target=vercel",
    );
  });
});

function check(id: string, state: Check["state"], detail = "detail"): Check {
  return {
    id,
    label: id,
    state,
    detail,
    hint: state === "ok" ? undefined : `${id} hint`,
  };
}

function healthSummary(checks: Check[]): HealthSummary {
  return {
    generatedAt: "2026-06-23T00:00:00.000Z",
    checks,
    errorCount: checks.filter((candidate) => candidate.state === "error").length,
    warnCount: checks.filter((candidate) => candidate.state === "warn").length,
  };
}

function section(id: OpsReadinessSection["id"], state: OpsReadinessSection["state"]) {
  return {
    id,
    title: id,
    state,
    summary: `${id} summary`,
    metrics: [],
    checks: [],
    nextCommand: state === "ok" ? null : `nexpress ops ${id} --json`,
    projectNextCommand: state === "ok" ? null : `pnpm --silent run ops:${id} -- --json`,
  };
}

function readinessReport(sections: OpsReadinessSection[]): OpsReadinessReport {
  const errors = sections.filter((candidate) => candidate.state === "error").length;
  const warnings = sections.filter((candidate) => candidate.state === "warn").length;
  return {
    schemaVersion: "np.admin-ops-readiness.v1",
    generatedAt: "2026-06-23T00:00:00.000Z",
    target: "vercel",
    targetTitle: "Vercel",
    inferredTarget: false,
    status: errors > 0 ? "blocked" : warnings > 0 ? "attention" : "ready",
    summary: {
      sections: sections.length,
      ok: sections.length - errors - warnings,
      warnings,
      errors,
      checks: sections.length,
      checkWarnings: warnings,
      checkErrors: errors,
    },
    nextCommand: sections.find((candidate) => candidate.nextCommand)?.nextCommand ?? null,
    projectNextCommand:
      sections.find((candidate) => candidate.projectNextCommand)?.projectNextCommand ?? null,
    sections,
  };
}
