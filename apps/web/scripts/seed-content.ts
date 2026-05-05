// Must be the first import — populates process.env (NP_SECRET,
// DATABASE_URL, …) before `nexpress.config.ts` evaluates and
// validates them at module-load time.
import "./_load-env.js";

import { eq } from "drizzle-orm";

import {
  createDbConnection,
  getSiteById,
  npUsers,
  withCurrentSite,
} from "@nexpress/core";
import type { NpAuthUser } from "@nexpress/core";

import { ensureFor } from "../src/lib/init-core";
import {
  seedNavigation,
  seedPages,
  seedPosts,
} from "../src/lib/seed-content";

/**
 * `pnpm seed:content` — populate a fresh install with a small
 * demo set so the public site renders something meaningful
 * before an editor logs in.
 *
 * Idempotent: the underlying seeders skip a section that already
 * has rows. The intent is "make a fresh install look alive" —
 * once an editor publishes real content, this script is a no-op.
 *
 * Requires at least one user in `np_users` (use `pnpm seed:admin`
 * to create one). The seeded content is authored by the first
 * admin so revision history and audit log have a sensible owner.
 *
 * The actual content lives in `src/lib/seed-content.ts` so the
 * Admin Setup wizard can reuse the same fixtures.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

async function findFirstAdmin(): Promise<NpAuthUser | null> {
  const db = createDbConnection({ connectionString: databaseUrl as string });
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
    role: row.role as NpAuthUser["role"],
    tokenVersion: row.tokenVersion,
  };
}

function parseSiteFlag(argv: string[]): string {
  const arg = argv.slice(2).find((a) => a.startsWith("--site="));
  if (!arg) return "default";
  return arg.slice("--site=".length).trim() || "default";
}

async function main(): Promise<void> {
  await ensureFor("read");
  await ensureFor("plugins");

  const siteId = parseSiteFlag(process.argv);
  if (siteId !== "default") {
    const target = await getSiteById(siteId);
    if (!target) {
      console.error(
        `Site "${siteId}" not found. Create it via /admin/sites or the API first.`,
      );
      process.exit(1);
    }
  }

  const actor = await findFirstAdmin();
  if (!actor) {
    console.error("No admin user found. Run `pnpm seed:admin` first.");
    process.exit(1);
  }
  console.log(`Seeding content for site "${siteId}" as ${actor.email}…`);

  const { pages, posts, navigation } = await withCurrentSite(siteId, async () => {
    const pages = await seedPages(actor);
    if (pages.skipped) console.log("• pages: already populated, skipping");
    else console.log(`  ✓ pages: ${pages.created} created`);

    const posts = await seedPosts(actor);
    if (posts.skipped) console.log("• posts: already populated, skipping");
    else console.log(`  ✓ posts: ${posts.created} created`);

    const navigation = await seedNavigation(actor);
    if (navigation.headerSkipped)
      console.log("• header navigation: already exists, skipping");
    else console.log(`  ✓ header navigation: ${navigation.header} items`);
    if (navigation.footerSkipped)
      console.log("• footer navigation: already exists, skipping");
    else console.log(`  ✓ footer navigation: ${navigation.footer} items`);

    return { pages, posts, navigation };
  });

  console.log("");
  console.log(
    `Done. Created ${pages.created} pages, ${posts.created} posts, ${
      navigation.header + navigation.footer
    } nav items.`,
  );
  console.log("Visit http://localhost:3000 to preview.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
