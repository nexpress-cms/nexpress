import type { DeployTarget } from "./deploy-targets.js";
import { buildDoctorFixPlan, type DoctorFixPlanItem } from "./doctor-fix-plan.js";
import type { CheckResult } from "./doctor-readiness.js";

export interface DoctorSummary {
  total: number;
  errors: number;
  warnings: number;
}

export { buildDoctorFixPlan, type DoctorFixPlanItem };

export interface DoctorJsonOutput {
  schemaVersion: "np.doctor.v1";
  ok: boolean;
  mode: "dev" | "prod";
  target: DeployTarget | null;
  summary: DoctorSummary;
  checks: CheckResult[];
  fixPlan?: DoctorFixPlanItem[];
}

interface RenderOptions {
  color: boolean;
}

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  red: "",
  dim: "",
  reset: "",
};

export function summarizeChecks(checks: CheckResult[]): DoctorSummary {
  return {
    total: checks.length,
    errors: checks.filter((result) => result.state === "error").length,
    warnings: checks.filter((result) => result.state === "warn").length,
  };
}

export function buildDoctorJson(args: {
  prodMode: boolean;
  target: DeployTarget | null;
  checks: CheckResult[];
  includeFixPlan?: boolean;
}): DoctorJsonOutput {
  const summary = summarizeChecks(args.checks);
  const report: DoctorJsonOutput = {
    schemaVersion: "np.doctor.v1",
    ok: summary.errors === 0,
    mode: args.prodMode ? "prod" : "dev",
    target: args.target,
    summary,
    checks: args.checks,
  };
  if (args.includeFixPlan) {
    report.fixPlan = buildDoctorFixPlan({ checks: args.checks, target: args.target });
  }
  return report;
}

export function renderDoctorCheck(
  result: CheckResult,
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const icon =
    result.state === "ok"
      ? `${c.green}✓${c.reset}`
      : result.state === "warn"
        ? `${c.yellow}⚠${c.reset}`
        : `${c.red}✗${c.reset}`;
  let line = `${icon} ${result.label}`;
  if (result.detail) line += `  ${c.dim}${result.detail}${c.reset}`;
  if (result.hint && result.state !== "ok") line += `\n    ${result.hint}`;
  return line;
}

export function renderDoctorSummary(
  checks: CheckResult[],
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const summary = summarizeChecks(checks);
  if (summary.errors === 0 && summary.warnings === 0) {
    return `${c.green}All ${summary.total.toString()} checks passed.${c.reset}`;
  }
  return (
    `${summary.errors.toString()} error${summary.errors === 1 ? "" : "s"}, ` +
    `${summary.warnings.toString()} warning${summary.warnings === 1 ? "" : "s"}.`
  );
}

export function dim(text: string, color = true): string {
  const c = color ? ANSI : EMPTY_ANSI;
  return `${c.dim}${text}${c.reset}`;
}
