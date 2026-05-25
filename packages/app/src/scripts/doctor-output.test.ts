import { describe, expect, it } from "vitest";

import {
  buildDoctorJson,
  renderDoctorCheck,
  renderDoctorSummary,
  summarizeChecks,
} from "./doctor-output.js";
import type { CheckResult } from "./doctor-readiness.js";

const checks: CheckResult[] = [
  { state: "ok", label: "Node.js >= 20", detail: "24.11.1" },
  {
    state: "warn",
    label: "NP_SCHEDULER_TOKEN",
    detail: "not set",
    hint: "Set it when scheduled publishing is enabled.",
  },
  {
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
});
