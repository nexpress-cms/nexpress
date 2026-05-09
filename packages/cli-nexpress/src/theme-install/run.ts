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
  flags: {
    dryRun: boolean;
    yes: boolean;
    /** v0.3 — when true, auto-chains `db:migrate` after a
     *  successful `db:generate`. Default false: the operator
     *  reviews the generated SQL diff before it touches the
     *  database. With `--apply`, the operator opts into the
     *  one-shot install (still prompts before applying unless
     *  combined with `--yes`). */
    apply: boolean;
  };
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

function detectPackageManager(cwd: string): "pnpm" | "npm" | "yarn" {
  // Mirrors the helper in `index.ts` (top of file). Duplicated
  // here to avoid an internal import cycle through the bin
  // entry; both helpers are tiny.
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

async function runDrizzleGenerate(cwd: string): Promise<boolean> {
  // Best-effort. Detect the operator's package manager first
  // so `pnpm db:generate` doesn't run on a yarn/npm site. Fall
  // back to direct drizzle-kit invocation when the script isn't
  // wired up. If neither works, return false and the caller
  // prints a manual-step note.
  const pm = detectPackageManager(cwd);
  const runScript: [string, string[]] =
    pm === "yarn"
      ? ["yarn", ["db:generate"]]
      : pm === "pnpm"
        ? ["pnpm", ["db:generate"]]
        : ["npm", ["run", "db:generate"]];
  const directDrizzle: [string, string[]] =
    pm === "yarn"
      ? ["yarn", ["drizzle-kit", "generate"]]
      : pm === "pnpm"
        ? ["pnpm", ["exec", "drizzle-kit", "generate"]]
        : ["npx", ["drizzle-kit", "generate"]];

  for (const [bin, args] of [runScript, directDrizzle]) {
    const ok = await new Promise<boolean>((resolveFn) => {
      const child = spawn(bin, args, { cwd, stdio: "inherit" });
      child.on("error", () => resolveFn(false));
      child.on("exit", (code) => resolveFn(code === 0));
    });
    if (ok) return true;
  }
  return false;
}

/**
 * v0.3 (`--apply` flag) — run `db:migrate` after a successful
 * generate. Only gets called when the operator opted into the
 * one-shot install. Same package-manager detection + drizzle-kit
 * fallback as `runDrizzleGenerate`. Returns true on success;
 * false leaves the migration unreflected in the database and
 * the runner prints a "run pnpm db:migrate manually" hint.
 */
async function runDrizzleMigrate(cwd: string): Promise<boolean> {
  const pm = detectPackageManager(cwd);
  const runScript: [string, string[]] =
    pm === "yarn"
      ? ["yarn", ["db:migrate"]]
      : pm === "pnpm"
        ? ["pnpm", ["db:migrate"]]
        : ["npm", ["run", "db:migrate"]];
  const directDrizzle: [string, string[]] =
    pm === "yarn"
      ? ["yarn", ["drizzle-kit", "migrate"]]
      : pm === "pnpm"
        ? ["pnpm", ["exec", "drizzle-kit", "migrate"]]
        : ["npx", ["drizzle-kit", "migrate"]];

  for (const [bin, args] of [runScript, directDrizzle]) {
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
    if (!stdin.isTTY) {
      // Non-TTY (CI, piped invocation) without --yes is almost
      // always a mistake — silently aborting would let an
      // automation run "succeed" without applying the changes
      // the operator expects. Refuse with a clear next step
      // instead.
      console.error(
        pc.red(
          "error: theme:install needs interactive confirmation, but stdin isn't a TTY.",
        ),
      );
      console.error(
        pc.dim("  Re-run with --yes to skip the prompt non-interactively."),
      );
      return 2;
    }
    // db:generate runs unconditionally after AST patches; --apply
    // additionally chains db:migrate. The prompt scopes the
    // mention to migrate so operators don't read it as
    // "--apply turns generate on too".
    const prompt = input.flags.apply
      ? "Continue? (--apply will also run db:migrate after the staged generate)"
      : "Continue?";
    const ok = await confirm(prompt);
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

  // v0.3 — `--apply` auto-chains db:migrate after a successful
  // generate. Skipped (and printed as a manual step in the
  // standard "Next" block) when the flag is off, or when generate
  // failed (no migration to apply).
  if (input.flags.apply) {
    if (!migrated) {
      console.log("");
      console.log(
        pc.yellow(
          "--apply skipped: db:generate didn't produce a migration. Run `pnpm db:generate && pnpm db:migrate` manually after fixing.",
        ),
      );
    } else {
      console.log("");
      console.log(pc.dim("Applying migration to the database…"));
      const applied = await runDrizzleMigrate(cwd);
      console.log("");
      if (applied) {
        console.log(
          `${pc.green("✓")} Migration applied. Activate the theme in admin → Settings → Theme.`,
        );
      } else {
        console.log(
          pc.yellow(
            "--apply: db:migrate failed. Review the generated SQL (`git diff`) and run `pnpm db:migrate` manually.",
          ),
        );
        return 1;
      }
    }
    return 0;
  }

  console.log("");
  console.log("Next:");
  console.log("  1. Review the changes (`git diff`)");
  console.log("  2. Run `pnpm db:migrate` to apply the migration");
  console.log(
    "     (or re-run with --apply to auto-chain db:migrate after generate)",
  );
  console.log("  3. Activate the theme in admin → Settings → Theme");

  return 0;
}
