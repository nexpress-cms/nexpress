import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pc from "picocolors";

import {
  checkThemeRequirements,
  type NpCollectionConfig,
} from "@nexpress/core";

import { extractCollectionFromFile } from "./ast/extract-collection.js";
import { renderNewCollectionFile } from "./ast/generate-collection.js";
import {
  CollectionPatchError,
  patchCollectionFile,
} from "./ast/patch-collection.js";
import { formatThemeInstallPlan } from "./format.js";
import { planThemeInstall, type ThemeInstallPlan } from "./plan.js";

/**
 * F.8-B runner — full apply phase.
 *
 * Flow:
 *   1. Load theme module via dynamic import.
 *   2. Walk src/collections/*.ts; AST-extract slug + fields.
 *   3. Run checkThemeRequirements against extracted configs.
 *   4. Plan steps + blockers.
 *   5. Print plan; abort on blockers; --dry-run exits here.
 *   6. Confirm interactively (skip with --yes).
 *   7. Apply: AST-patch existing files / write new ones.
 *   8. Best-effort spawn `pnpm db:generate` so the drizzle
 *      migration lands alongside the staged collection edits.
 *   9. Print operator's next steps (review + db:migrate).
 */

interface RunInput {
  themePackage: string;
  flags: { dryRun: boolean; yes: boolean };
}

const COLLECTIONS_DIR = "src/collections";

interface DiscoveredCollection {
  filePath: string;
  config: NpCollectionConfig;
}

function discoverCollections(cwd: string): DiscoveredCollection[] {
  const dir = resolve(cwd, COLLECTIONS_DIR);
  if (!existsSync(dir)) return [];
  const out: DiscoveredCollection[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name === "index.ts") continue;
    const filePath = join(dir, entry.name);
    const extracted = extractCollectionFromFile(filePath);
    if (extracted) {
      // The extractor returns a partial NpCollectionConfig
      // (slug + labels + fields). The check function reads
      // only those, so the cast is safe.
      out.push({
        filePath: extracted.filePath,
        config: extracted.config as unknown as NpCollectionConfig,
      });
    }
  }
  return out;
}

async function loadThemeManifest(
  themePackage: string,
): Promise<Record<string, unknown>> {
  const mod = (await import(themePackage)) as Record<string, unknown>;
  const candidate =
    (mod as { default?: unknown }).default ??
    (Object.values(mod).find(
      (v) => v && typeof v === "object" && "manifest" in (v as object),
    ) as unknown);
  if (!candidate || typeof candidate !== "object") {
    throw new Error(
      `Theme package '${themePackage}' has no detectable defineTheme export.`,
    );
  }
  const manifest = (candidate as { manifest?: unknown }).manifest;
  if (!manifest || typeof manifest !== "object") {
    throw new Error(
      `Theme package '${themePackage}' export has no .manifest field.`,
    );
  }
  return manifest as Record<string, unknown>;
}

async function confirm(message: string): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

function applyPlan(
  cwd: string,
  plan: ThemeInstallPlan,
): { patched: number; created: number; skipped: number } {
  let patched = 0;
  let created = 0;
  let skipped = 0;
  for (const step of plan.steps) {
    if (step.kind === "create-collection") {
      const target = resolve(cwd, COLLECTIONS_DIR, `${step.collection}.ts`);
      writeFileSync(
        target,
        renderNewCollectionFile(step.collection, step.requirement),
      );
      console.log(pc.green("✓") + ` Wrote ${pc.cyan(target)}`);
      created += 1;
    } else if (step.kind === "patch-collection") {
      const target = resolve(cwd, COLLECTIONS_DIR, `${step.collection}.ts`);
      try {
        const result = patchCollectionFile(
          target,
          step.addFields.map((f) => ({
            name: f.name,
            requirement: f.requirement,
          })),
        );
        if (result.added.length > 0) {
          console.log(
            pc.green("✓") +
              ` Patched ${pc.cyan(target)} — added: ${result.added.join(", ")}`,
          );
          patched += 1;
        }
        if (result.skipped.length > 0) {
          console.log(
            pc.dim(
              `  (idempotent skip: ${result.skipped.join(", ")})`,
            ),
          );
          skipped += 1;
        }
      } catch (error) {
        if (error instanceof CollectionPatchError) {
          throw error;
        }
        throw new Error(
          `Patcher failed on ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // warn-soft-mismatch — informational; no apply action.
  }
  return { patched, created, skipped };
}

async function runDrizzleGenerate(cwd: string): Promise<boolean> {
  // Best-effort: try `pnpm db:generate` first (the script
  // create-nexpress scaffolds), then fall back to direct
  // `drizzle-kit generate`. If neither works, return false
  // and the caller prints a manual-step note.
  const candidates: Array<[string, string[]]> = [
    ["pnpm", ["db:generate"]],
    ["pnpm", ["exec", "drizzle-kit", "generate"]],
  ];
  for (const [bin, args] of candidates) {
    const ok = await new Promise<boolean>((resolveFn) => {
      const child = spawn(bin, args, { cwd, stdio: "inherit" });
      child.on("error", () => resolveFn(false));
      child.on("exit", (code) => resolveFn(code === 0));
    });
    if (ok) return true;
  }
  return false;
}

export async function runThemeInstall(input: RunInput): Promise<number> {
  const cwd = process.cwd();
  console.log(pc.dim(`Resolving from ${cwd}…`));

  let manifest;
  try {
    manifest = await loadThemeManifest(input.themePackage);
  } catch (error) {
    console.error(
      pc.red("error: ") +
        (error instanceof Error ? error.message : String(error)),
    );
    console.error(
      pc.dim(
        `  Hint: ensure '${input.themePackage}' is installed in this project (\`pnpm add ${input.themePackage}\`).`,
      ),
    );
    return 2;
  }

  // Phase F.8-B — full extraction + check.
  const discovered = discoverCollections(cwd);
  const existingSlugs = discovered.map((d) => d.config.slug);
  const configs = discovered.map((d) => d.config);

  const check = checkThemeRequirements(
    manifest as unknown as Parameters<typeof checkThemeRequirements>[0],
    configs,
  );

  const plan = planThemeInstall({
    manifest: manifest as unknown as Parameters<
      typeof planThemeInstall
    >[0]["manifest"],
    existingCollectionSlugs: existingSlugs,
    check,
  });

  console.log("");
  console.log(formatThemeInstallPlan(plan));
  console.log("");

  if (plan.blockers.length > 0) {
    console.error(
      pc.red(
        "Refusing to apply: the conflicts above require manual reconciliation.",
      ),
    );
    return 1;
  }

  if (plan.isNoop) return 0;

  if (input.flags.dryRun) {
    console.log(pc.dim("--dry-run: exiting without applying."));
    return 0;
  }

  if (!input.flags.yes) {
    const ok = await confirm("Continue?");
    if (!ok) {
      console.log(pc.dim("Aborted."));
      return 0;
    }
  }

  let summary;
  try {
    summary = applyPlan(cwd, plan);
  } catch (error) {
    if (error instanceof CollectionPatchError) {
      console.error(pc.red("error: ") + error.message);
      console.error(
        pc.dim(`  File untouched. Reconcile manually then re-run.`),
      );
      return 1;
    }
    throw error;
  }

  console.log("");
  console.log(
    `${pc.green("✓")} Applied: ${summary.created} new, ${summary.patched} patched, ${summary.skipped} idempotent.`,
  );
  console.log("");

  console.log(pc.dim("Generating drizzle migration…"));
  const migrated = await runDrizzleGenerate(cwd);
  console.log("");

  if (migrated) {
    console.log(`${pc.green("✓")} Drizzle migration generated.`);
  } else {
    console.log(
      pc.yellow(
        "Drizzle migration step couldn't run automatically. Run `pnpm db:generate` manually.",
      ),
    );
  }

  console.log("");
  console.log("Next:");
  console.log("  1. Review the changes (`git diff`)");
  console.log("  2. Run `pnpm db:migrate` to apply the migration");
  console.log("  3. Activate the theme in admin → Settings → Theme");

  return 0;
}
