// Must be the first import — populates process.env (NP_SECRET,
// DATABASE_URL, …) before `nexpress.config.ts` evaluates and
// validates them at module-load time.
import "./_load-env.js";

import { eq } from "drizzle-orm";

import { getActiveTheme, getSiteById, npUsers, withCurrentSite } from "@nexpress/core";
import type { NpAuthUser } from "@nexpress/core";

import { getDb, shutdownBootstrap } from "../src/lib/bootstrap.js";
import { ensureFor } from "../src/lib/init-core.js";
import { seedAll } from "../src/lib/seed-content.js";

/**
 * `pnpm seed:content` — populate a fresh install with the active
 * theme's demo content so the public site renders something
 * meaningful before an editor logs in.
 *
 * The framework's seeder is a pure orchestrator: every fixture
 * (pages, posts, tags, categories, navigation) lives in the active
 * theme's `seedContent` block. This script resolves the active theme
 * and dispatches to `seedAll(actor, theme)`. Per-theme idempotency is
 * keyed on `seed_source = "theme:<id>"` — running this twice for the
 * same theme is a no-op; switching themes leaves the previous theme's
 * seed alongside the new one until the admin reseed flow wipes it.
 *
 * Requires at least one user in `np_users` (use `pnpm seed:admin`
 * to create one) and an active theme. If no theme is active, the
 * script exits with guidance to pick one through the admin or via
 * the setup wizard.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

async function shutdownAndExit(code: number): Promise<never> {
  let exitCode = code;
  try {
    await shutdownBootstrap();
  } catch (error) {
    console.error("Bootstrap shutdown failed", error);
    exitCode = 1;
  }
  process.exit(exitCode);
}

async function findFirstAdmin(): Promise<NpAuthUser | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.role, "admin"))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    tokenVersion: row.tokenVersion,
  };
}

function parseSiteFlag(argv: string[]): string {
  const arg = argv.slice(2).find((a) => a.startsWith("--site="));
  if (!arg) return "default";
  return arg.slice("--site=".length).trim() || "default";
}

async function main(): Promise<void> {
  await ensureFor("plugins");

  const siteId = parseSiteFlag(process.argv);
  if (siteId !== "default") {
    const target = await getSiteById(siteId);
    if (!target) {
      console.error(`Site "${siteId}" not found. Create it via /admin/sites or the API first.`);
      return shutdownAndExit(1);
    }
  }

  const actor = await findFirstAdmin();
  if (!actor) {
    console.error("No admin user found. Run `pnpm seed:admin` first.");
    return shutdownAndExit(1);
  }
  const theme = await getActiveTheme();
  if (!theme) {
    console.error(
      "No active theme — pick one in the admin (or run the setup wizard) before seeding content.",
    );
    return shutdownAndExit(1);
  }
  console.log(
    `Seeding "${theme.manifest.id}" theme content for site "${siteId}" as ${actor.email}…`,
  );

  const { terms, pages, posts, navigation } = await withCurrentSite(siteId, async () =>
    seedAll(actor, theme),
  );

  if (terms.skipped) console.log("• terms: already populated, skipping");
  else
    console.log(
      `  ✓ terms: ${terms.tagsCreated} tags + ${terms.categoriesCreated} categories created`,
    );
  if (pages.skipped) console.log("• pages: already populated, skipping");
  else console.log(`  ✓ pages: ${pages.created} created`);
  if (posts.skipped) console.log("• posts: already populated, skipping");
  else console.log(`  ✓ posts: ${posts.created} created`);
  if (navigation.headerSkipped) console.log("• header navigation: already exists, skipping");
  else console.log(`  ✓ header navigation: ${navigation.header} items`);
  if (navigation.footerSkipped) console.log("• footer navigation: already exists, skipping");
  else console.log(`  ✓ footer navigation: ${navigation.footer} items`);

  console.log("");
  console.log(
    `Done. Created ${pages.created} pages, ${posts.created} posts, ${terms.tagsCreated} tags, ${terms.categoriesCreated} categories, ${
      navigation.header + navigation.footer
    } nav items.`,
  );
  console.log("Visit http://localhost:3000 to preview.");
  return shutdownAndExit(0);
}

void main().catch(async (error) => {
  console.error(error);
  await shutdownAndExit(1);
});
