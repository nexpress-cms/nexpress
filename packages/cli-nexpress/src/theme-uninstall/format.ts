import pc from "picocolors";

import type {
  ThemeUninstallPlan,
  ThemeUninstallStep,
} from "./plan.js";

/**
 * Renders a ThemeUninstallPlan for stdout. Mirrors the install
 * formatter shape so operators see a familiar layout, but with
 * destructive coloring (red minuses for removals, yellow for
 * "kept with warning") and an explicit data-loss header at the
 * top of the block.
 */

function describeStep(step: ThemeUninstallStep): string {
  if (step.kind === "remove-field") {
    const required = step.requirement.required ? " (was required)" : "";
    const rel =
      step.requirement.type === "relationship" && step.requirement.relationTo
        ? ` → ${
            Array.isArray(step.requirement.relationTo)
              ? step.requirement.relationTo.join("|")
              : step.requirement.relationTo
          }`
        : "";
    return `      ${pc.red("-")} ${step.collection}.${step.field}: ${step.requirement.type}${rel}${required}`;
  }
  if (step.kind === "remove-collection-file") {
    return `    ${pc.red(step.collection)} (DELETE FILE) — ${pc.dim(step.filePath)}`;
  }
  // keep-collection-with-warning
  return `    ${pc.yellow("⚠")} ${step.collection} — keeping file (${step.reason})`;
}

export function formatThemeUninstallPlan(plan: ThemeUninstallPlan): string {
  const lines: string[] = [];
  lines.push(
    `${pc.cyan("→")} Uninstalling ${pc.bold(plan.themeId)} ${pc.dim(`v${plan.themeVersion}`)}`,
  );

  if (plan.isNoop) {
    lines.push("");
    lines.push(
      pc.dim(
        "  Nothing to remove — the theme's collections / fields are already absent.",
      ),
    );
    return lines.join("\n");
  }

  const removeFieldSteps = plan.steps.filter((s) => s.kind === "remove-field");
  const removeFileSteps = plan.steps.filter(
    (s) => s.kind === "remove-collection-file",
  );
  const keepWarnings = plan.steps.filter(
    (s) => s.kind === "keep-collection-with-warning",
  );

  lines.push("");
  lines.push(
    pc.red(
      "  ⚠  Destructive — the next migration will DROP COLUMN for every field below.",
    ),
  );
  lines.push(
    pc.dim(
      "      Run `pnpm db:migrate` after reviewing the generated migration; back up first.",
    ),
  );

  if (removeFileSteps.length > 0) {
    lines.push("");
    lines.push(pc.red("  Collection files to delete:"));
    for (const step of removeFileSteps) {
      lines.push(describeStep(step));
    }
  }

  if (removeFieldSteps.length > 0) {
    lines.push("");
    lines.push("  Fields to remove:");
    // Group by collection so the operator sees a coherent diff
    // for each file. plan.steps already preserves declaration
    // order so we just bucket without re-sorting.
    const byCollection = new Map<string, typeof removeFieldSteps>();
    for (const step of removeFieldSteps) {
      if (step.kind !== "remove-field") continue;
      const list = byCollection.get(step.collection) ?? [];
      list.push(step);
      byCollection.set(step.collection, list);
    }
    for (const [slug, group] of byCollection) {
      lines.push(`    ${pc.cyan(slug)}:`);
      for (const step of group) lines.push(describeStep(step));
    }
  }

  if (keepWarnings.length > 0) {
    lines.push("");
    lines.push(pc.yellow("  Files NOT deleted (operator extras detected):"));
    for (const step of keepWarnings) {
      lines.push(describeStep(step));
    }
  }

  return lines.join("\n");
}
