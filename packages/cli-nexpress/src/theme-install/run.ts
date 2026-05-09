import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pc from "picocolors";

import { formatThemeInstallPlan } from "./format.js";
import { planThemeInstall } from "./plan.js";

/**
 * F.8-A runner — loads the theme package, derives existing
 * collection slugs from `src/collections/*.ts` filenames, runs
 * the pure planner, prints the plan, and exits.
 *
 * F.8-A only ships the planner. The mutation phase (AST-patch
 * existing collection files, write new ones, run drizzle-kit
 * generate) lands in F.8-B as a separate PR — kept apart
 * because that piece carries the highest risk in the v0.2
 * extension and benefits from a focused review.
 *
 * Slug discovery: we list `.ts` files under `src/collections/`
 * and use the basename as the slug. Most projects follow that
 * convention from the create-nexpress scaffold; full config
 * loading (which would surface field-level diffs) requires
 * tsx-based dynamic import and ships in F.8-B.
 */

interface RunInput {
  themePackage: string;
  flags: { dryRun: boolean; yes: boolean };
}

const COLLECTIONS_DIR = "src/collections";

function discoverExistingSlugs(cwd: string): string[] {
  const dir = resolve(cwd, COLLECTIONS_DIR);
  if (!existsSync(dir)) return [];
  const slugs: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name === "index.ts") continue;
    const filePath = join(dir, entry.name);
    const content = readFileSync(filePath, "utf8");
    if (!/defineCollection\s*\(/.test(content)) continue;
    // Prefer the actual `slug: "..."` declaration over the
    // filename — operators who diverge from the scaffold's
    // file=slug convention shouldn't see a wrong report. First
    // `slug: "..."` literal in the file wins; F.8-B's full-config
    // loader will replace this regex with proper AST extraction.
    const slugMatch = content.match(/\bslug\s*:\s*["']([^"']+)["']/);
    slugs.push(slugMatch ? slugMatch[1]! : entry.name.replace(/\.ts$/, ""));
  }
  return slugs;
}

async function loadThemeManifest(
  themePackage: string,
): Promise<Record<string, unknown>> {
  // Node resolves theme packages from the operator's site project
  // (where `pnpm nexpress` runs). The theme MUST be installed —
  // pnpm add @nexpress/theme-magazine before this command.
  const mod = (await import(themePackage)) as Record<string, unknown>;
  // Theme packages typically default-export their `defineTheme`
  // result. Look for a few conventional shapes before giving up.
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

  const existingSlugs = discoverExistingSlugs(cwd);

  const plan = planThemeInstall({
    manifest: manifest as unknown as Parameters<
      typeof planThemeInstall
    >[0]["manifest"],
    existingCollectionSlugs: existingSlugs,
    // F.8-A: no field-level check (would require loading full
    // config). F.8-B passes the real `checkThemeRequirements`
    // result and the planner extends with patch-collection +
    // blocker steps.
    check: {
      themeId: (manifest.id as string) ?? input.themePackage,
      hasMismatches: false,
      hasHardMismatches: false,
      missingCollections: [],
      missingFields: [],
      typeConflicts: [],
      relationConflicts: [],
    },
  });

  console.log("");
  console.log(formatThemeInstallPlan(plan));
  console.log("");

  if (plan.isNoop) return 0;

  console.log(
    pc.yellow(
      "Note: F.8-A ships the planner only. The apply phase " +
        "(AST-patch collection files, write new ones, run " +
        "drizzle-kit generate) lands in F.8-B.",
    ),
  );
  if (input.flags.dryRun) {
    console.log(pc.dim("--dry-run: exiting without applying."));
  }
  return 0;
}
