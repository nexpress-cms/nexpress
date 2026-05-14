import { spawn } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pc from "picocolors";

import { extractCollectionFromFile } from "./ast/extract-collection.js";
import {
  CollectionUnpatchError,
  unpatchCollectionFile,
} from "./ast/unpatch-collection.js";
import { formatThemeUninstallPlan } from "./format.js";
import {
  planThemeUninstall,
  type PlanCollectionShape,
} from "./plan.js";

/**
 * F.8 runner — full apply phase for theme:uninstall.
 *
 * Flow mirrors theme:install:
 *   1. Load theme module via dynamic import (theme must still be
 *      installed so we can read the manifest).
 *   2. Walk src/collections/*.ts; AST-extract slug + field names.
 *   3. Plan removals (per-field by default; whole-file with
 *      --with-collections).
 *   4. Print plan; --dry-run exits here.
 *   5. Confirm interactively (--yes skips). The confirm copy
 *      lists data-loss explicitly because every column to remove
 *      maps to a DROP COLUMN in the next migration.
 *   6. Apply: AST-remove fields / delete collection files.
 *   7. Best-effort spawn `pnpm db:generate` so the DROP COLUMN
 *      migration lands alongside the staged collection edits.
 *   8. Print operator's next steps (review diff + db:migrate +
 *      pnpm remove + remove from themes: array in config).
 */

interface RunInput {
  themePackage: string;
  flags: {
    dryRun: boolean;
    yes: boolean;
    withCollections: boolean;
    /** v0.3 — when true, auto-chains `db:migrate` after a
     *  successful `db:generate`. Default false: the operator
     *  reviews the generated DROP COLUMN SQL before it touches
     *  the database. With `--apply`, the operator opts into the
     *  one-shot uninstall (still prompts before applying unless
     *  combined with `--yes`). Same flag semantics as
     *  `theme:install --apply` for consistency. */
    apply: boolean;
  };
}

const COLLECTIONS_DIR = "src/collections";

function discoverCollections(cwd: string): PlanCollectionShape[] {
  const dir = resolve(cwd, COLLECTIONS_DIR);
  if (!existsSync(dir)) return [];
  const out: PlanCollectionShape[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name === "index.ts") continue;
    const filePath = join(dir, entry.name);
    const extracted = extractCollectionFromFile(filePath);
    if (!extracted) continue;
    out.push({
      slug: extracted.config.slug,
      filePath: extracted.filePath,
      fieldNames: collectFieldNames(extracted.config.fields),
    });
  }
  return out;
}

/** Match the patcher's `walkFieldNames` recursion: row /
 *  collapsible containers expose their inner names. */
function collectFieldNames(
  fields: { name?: string; type?: string; fields?: unknown }[] | undefined,
): string[] {
  if (!fields) return [];
  const out: string[] = [];
  for (const f of fields) {
    if (f.type === "row" || f.type === "collapsible") {
      out.push(
        ...collectFieldNames(
          f.fields as { name?: string; type?: string; fields?: unknown }[],
        ),
      );
      continue;
    }
    if (typeof f.name === "string") out.push(f.name);
  }
  return out;
}

async function loadThemeManifest(
  themePackage: string,
): Promise<Record<string, unknown>> {
  const mod = (await import(themePackage)) as Record<string, unknown>;
  const candidate =
    (mod as { default?: unknown }).default ??
    Object.values(mod).find(
      (v): v is Record<string, unknown> =>
        typeof v === "object" && v !== null && "manifest" in v,
    );
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

function detectPackageManager(cwd: string): "pnpm" | "npm" | "yarn" {
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

async function runDrizzleGenerate(cwd: string): Promise<boolean> {
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
 * generate. Same shape as install's helper. The migration here
 * contains DROP COLUMN statements when uninstall removed
 * fields, so applying it is genuinely destructive — the
 * runner's confirm prompt and the plan formatter both warn
 * about that.
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

export async function runThemeUninstall(input: RunInput): Promise<number> {
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
        `  Hint: theme:uninstall needs the theme package present so it can read the manifest. ` +
          `Run this BEFORE \`pnpm remove ${input.themePackage}\`.`,
      ),
    );
    return 2;
  }

  const discovered = discoverCollections(cwd);
  const plan = planThemeUninstall({
    manifest: manifest as unknown as Parameters<
      typeof planThemeUninstall
    >[0]["manifest"],
    existingCollections: discovered,
    withCollections: input.flags.withCollections,
  });

  console.log("");
  console.log(formatThemeUninstallPlan(plan));
  console.log("");

  if (plan.isNoop) return 0;

  if (input.flags.dryRun) {
    console.log(pc.dim("--dry-run: exiting without applying."));
    return 0;
  }

  if (!input.flags.yes) {
    if (!stdin.isTTY) {
      console.error(
        pc.red(
          "error: theme:uninstall needs interactive confirmation, but stdin isn't a TTY.",
        ),
      );
      console.error(
        pc.dim("  Re-run with --yes to skip the prompt non-interactively."),
      );
      return 2;
    }
    // db:generate runs unconditionally after AST changes; --apply
    // additionally chains db:migrate, which executes the
    // generated DROP COLUMN statements.
    const prompt = input.flags.apply
      ? pc.red(
          "Apply these destructive changes? (--apply will also run db:migrate, executing DROP COLUMN)",
        )
      : pc.red("Apply these destructive changes?");
    const ok = await confirm(prompt);
    if (!ok) {
      console.log(pc.dim("Aborted."));
      return 0;
    }
  }

  // Build the path map so we can save each file once.
  const pathBySlug = new Map<string, string>();
  for (const c of discovered) pathBySlug.set(c.slug, c.filePath);

  const removalsBySlug = new Map<string, string[]>();
  const filesToDelete: { collection: string; filePath: string }[] = [];
  for (const step of plan.steps) {
    if (step.kind === "remove-field") {
      const list = removalsBySlug.get(step.collection) ?? [];
      list.push(step.field);
      removalsBySlug.set(step.collection, list);
    } else if (step.kind === "remove-collection-file") {
      filesToDelete.push({
        collection: step.collection,
        filePath: step.filePath,
      });
    }
  }

  const summary = { filesDeleted: 0, fieldsRemoved: 0, idempotentSkips: 0 };

  // 1. Delete files first; their per-field removals become moot.
  const deletedSlugs = new Set<string>();
  for (const f of filesToDelete) {
    try {
      unlinkSync(f.filePath);
      console.log(pc.red("✗") + ` Deleted ${pc.cyan(f.filePath)}`);
      deletedSlugs.add(f.collection);
      summary.filesDeleted += 1;
    } catch (error) {
      console.error(
        pc.red("error: ") +
          `Couldn't delete ${f.filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      return 1;
    }
  }

  // 2. AST-unpatch the remaining collections.
  for (const [slug, fields] of removalsBySlug) {
    if (deletedSlugs.has(slug)) continue;
    const filePath = pathBySlug.get(slug);
    if (!filePath) {
      console.error(
        pc.red("error: ") +
          `Couldn't locate file for collection '${slug}'. Skipping.`,
      );
      continue;
    }
    try {
      const result = unpatchCollectionFile(filePath, fields);
      if (result.removed.length > 0) {
        console.log(
          pc.yellow("~") +
            ` Patched ${pc.cyan(filePath)} — removed: ${result.removed.join(", ")}`,
        );
        summary.fieldsRemoved += result.removed.length;
      }
      if (result.skipped.length > 0) {
        console.log(pc.dim(`  (idempotent skip: ${result.skipped.join(", ")})`));
        summary.idempotentSkips += result.skipped.length;
      }
    } catch (error) {
      if (error instanceof CollectionUnpatchError) {
        console.error(pc.red("error: ") + error.message);
        console.error(
          pc.dim(`  File untouched. Reconcile manually then re-run.`),
        );
        return 1;
      }
      throw error;
    }
  }

  console.log("");
  console.log(
    `${pc.green("✓")} Applied: ${summary.filesDeleted} file${summary.filesDeleted === 1 ? "" : "s"} deleted, ${summary.fieldsRemoved} field${summary.fieldsRemoved === 1 ? "" : "s"} removed, ${summary.idempotentSkips} idempotent skip${summary.idempotentSkips === 1 ? "" : "s"}.`,
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

  // v0.3 — `--apply` auto-chains db:migrate. The uninstall
  // migration contains DROP COLUMN statements when fields were
  // removed, so this step is genuinely destructive. The prompt
  // above already reflected that.
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
      console.log(pc.dim("Applying migration to the database (DROP COLUMN)…"));
      const applied = await runDrizzleMigrate(cwd);
      console.log("");
      if (applied) {
        console.log(
          `${pc.green("✓")} Migration applied. Theme columns dropped from the database.`,
        );
        console.log("");
        console.log("Next:");
        console.log(
          `  1. Remove the theme from \`themes:\` in nexpress.config.ts and run \`pnpm remove ${input.themePackage}\`.`,
        );
        if (summary.filesDeleted > 0) {
          console.log(
            pc.dim(
              `  2. Remove the matching \`import { … } from "./collections/<slug>"\` lines from nexpress.config.ts ` +
                `and drop the entries from \`collections: [...]\`.`,
            ),
          );
        }
        return 0;
      }
      console.log(
        pc.yellow(
          "--apply: db:migrate failed. Review the generated SQL (`git diff`) and run `pnpm db:migrate` manually after reconciling.",
        ),
      );
      return 1;
    }
  }

  console.log("");
  console.log("Next:");
  console.log(
    `  1. Review the changes (\`git diff\`) — especially the migration's DROP COLUMN statements.`,
  );
  console.log("  2. Back up your database before migrating.");
  console.log(
    "  3. Run `pnpm db:migrate` to apply the migration (or re-run with --apply to auto-chain after generate).",
  );
  console.log(
    `  4. Remove the theme from \`themes:\` in nexpress.config.ts and run \`pnpm remove ${input.themePackage}\`.`,
  );
  if (summary.filesDeleted > 0) {
    console.log(
      pc.dim(
        `  5. Remove the matching \`import { … } from "./collections/<slug>"\` lines from nexpress.config.ts ` +
          `and drop the entries from \`collections: [...]\` (otherwise TypeScript will fail on the deleted modules).`,
      ),
    );
  }

  return 0;
}
