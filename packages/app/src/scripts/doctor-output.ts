import type { DeployTarget } from "./deploy-targets.js";
import { buildDoctorFixPlan, type DoctorFixPlanItem } from "./doctor-fix-plan.js";
import type { CheckResult } from "./doctor-readiness.js";
import { toProjectCommand } from "./ops-command-format.js";

export interface DoctorSummary {
  total: number;
  errors: number;
  warnings: number;
}

export { buildDoctorFixPlan, type DoctorFixPlanItem };

export interface DoctorJsonOutput {
  schemaVersion: "np.doctor.v1";
  ok: boolean;
  blocksDeploy: boolean;
  nextCommand: string | null;
  projectNextCommand: string | null;
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
    blocksDeploy: summary.errors > 0,
    nextCommand: null,
    projectNextCommand: null,
    mode: args.prodMode ? "prod" : "dev",
    target: args.target,
    summary,
    checks: args.checks,
  };
  if (args.includeFixPlan) {
    const fixPlan = buildDoctorFixPlan({ checks: args.checks, target: args.target });
    report.nextCommand =
      fixPlan.find((item) => item.blocksDeploy)?.nextCommand ?? fixPlan[0]?.nextCommand ?? null;
    report.projectNextCommand = report.nextCommand ? toProjectCommand(report.nextCommand) : null;
    report.fixPlan = fixPlan;
  } else if (summary.errors > 0 || summary.warnings > 0) {
    report.nextCommand = buildDoctorFixPlanCommand(args.prodMode, args.target);
    report.projectNextCommand = toProjectCommand(report.nextCommand);
  }
  return report;
}

export function buildDoctorFixPlanCommand(prodMode: boolean, target: DeployTarget | null): string {
  if (!prodMode) return "pnpm run doctor -- --fix-plan";
  const targetArg = target ? ` --target ${target}` : "";
  return `pnpm run doctor:prod --${targetArg} --fix-plan`;
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

function formatBriefState(state: CheckResult["state"], color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  if (state === "ok") return `${c.green}[ok]${c.reset}`;
  if (state === "warn") return `${c.yellow}[warn]${c.reset}`;
  return `${c.red}[error]${c.reset}`;
}

function renderBriefDoctorCheck(result: CheckResult, options: RenderOptions): string {
  const parts = [formatBriefState(result.state, options.color), result.id, result.label];
  if (result.detail) parts.push(`- ${result.detail.replace(/\s+/g, " ")}`);
  return parts.join(" ");
}

export function renderBriefDoctorReport(
  args: {
    prodMode: boolean;
    target: DeployTarget | null;
    checks: CheckResult[];
    nextCommand?: string | null;
  },
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  const targetDetail = args.prodMode && args.target ? ` for ${args.target}` : "";
  const mode = args.prodMode ? "prod" : "dev";
  const lines = [`${c.dim}NexPress doctor: ${mode}${targetDetail}${c.reset}`];
  lines.push(renderDoctorSummary(args.checks, options));
  for (const result of args.checks) lines.push(renderBriefDoctorCheck(result, options));
  if (args.nextCommand) lines.push(`Next: ${args.nextCommand}`);
  if (args.nextCommand) {
    const projectNextCommand = toProjectCommand(args.nextCommand);
    if (projectNextCommand !== args.nextCommand) lines.push(`Project next: ${projectNextCommand}`);
  }
  return lines.join("\n");
}

export function renderDoctorFixPlan(
  fixPlan: DoctorFixPlanItem[],
  options: RenderOptions = { color: true },
): string {
  const c = options.color ? ANSI : EMPTY_ANSI;
  if (fixPlan.length === 0) return `${c.green}No fix-plan actions needed.${c.reset}`;

  const lines = [`${c.dim}Fix plan${c.reset}`];
  fixPlan.forEach((item, index) => {
    const approval = item.requiresApproval ? "approval required" : "no approval needed";
    lines.push(`${String(index + 1)}. ${item.title}`);
    lines.push(`   severity: ${item.severity}; risk: ${item.risk}; ${approval}`);
    lines.push(`   checks: ${item.checkIds.join(", ")}`);
    if (item.nextCommand) lines.push(`   next: ${item.nextCommand}`);
    if (item.projectNextCommand && item.projectNextCommand !== item.nextCommand) {
      lines.push(`   project next: ${item.projectNextCommand}`);
    }
    for (const command of item.commands) lines.push(`   command: ${command}`);
    for (const command of item.projectCommands.filter((command, commandIndex) => {
      return command !== item.commands[commandIndex];
    })) {
      lines.push(`   project command: ${command}`);
    }
    for (const note of item.notes ?? []) lines.push(`   note: ${note}`);
  });
  return lines.join("\n");
}

export function renderDoctorNextCommand(
  nextCommand: string | null,
  options: RenderOptions = { color: true },
): string | null {
  if (!nextCommand) return null;
  const c = options.color ? ANSI : EMPTY_ANSI;
  return `${c.dim}Next: ${nextCommand}${c.reset}`;
}

export function dim(text: string, color = true): string {
  const c = color ? ANSI : EMPTY_ANSI;
  return `${c.dim}${text}${c.reset}`;
}
