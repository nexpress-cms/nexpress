import pc from "picocolors";

import type { ThemeInstallPlan, ThemeInstallStep } from "./plan.js";

/**
 * Renders a ThemeInstallPlan as a human-readable preview block
 * for stdout. Output mirrors the design doc §4.8 example so
 * operators see the same shape there and at the prompt.
 *
 * Pure: takes a plan, returns a string. Tests assert the shape
 * directly; the runner wraps the print + prompt loop.
 */

function describeStep(step: ThemeInstallStep): string {
  if (step.kind === "create-collection") {
    const fieldCount = Object.keys(step.requirement.fields ?? {}).length;
    return `    ${pc.green(step.collection)} (NEW) — creating with ${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  }
  if (step.kind === "patch-collection") {
    const lines = [
      `    ${pc.cyan(step.collection)} (existing) — adding fields:`,
    ];
    for (const f of step.addFields) {
      const required = f.requirement.required ? " (required)" : "";
      const rel =
        f.requirement.type === "relationship" && f.requirement.relationTo
          ? ` → ${
              Array.isArray(f.requirement.relationTo)
                ? f.requirement.relationTo.join("|")
                : f.requirement.relationTo
            }`
          : "";
      lines.push(
        `      ${pc.green("+")} ${f.name}: ${f.requirement.type}${rel}${required}`,
      );
    }
    return lines.join("\n");
  }
  // warn-soft-mismatch
  return `    ${pc.yellow("!")} ${step.collection}.${step.field} — ${step.reason}`;
}

export function formatThemeInstallPlan(plan: ThemeInstallPlan): string {
  const lines: string[] = [];
  lines.push(
    `${pc.green("✓")} Loaded ${pc.bold(plan.themeId)} ${pc.dim(`v${plan.themeVersion}`)}`,
  );

  if (plan.isNoop) {
    lines.push("");
    lines.push(pc.dim("  Site already satisfies every requirement — nothing to do."));
    return lines.join("\n");
  }

  if (plan.steps.length > 0) {
    lines.push("");
    lines.push("  Required collections:");
    for (const step of plan.steps) {
      lines.push(describeStep(step));
    }
  }

  if (plan.blockers.length > 0) {
    lines.push("");
    lines.push(pc.red("  Conflicts (must resolve manually):"));
    for (const b of plan.blockers) {
      lines.push(
        `    ${pc.red("✗")} ${b.collection}.${b.field}: expected ${b.expected}, got ${b.actual}`,
      );
    }
  }

  return lines.join("\n");
}
