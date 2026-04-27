import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { eq, sql } from "drizzle-orm";

import {
  createDbConnection,
  findDocuments,
  getSiteById,
  nxNavigation,
  nxUsers,
  saveDocument,
  withCurrentSite,
} from "@nexpress/core";
import type { NxAuthUser, NxNavItem } from "@nexpress/core";

import { ensureCoreServices, ensurePluginsLoaded } from "../src/lib/init-core";

/**
 * `pnpm seed:content` — populate a fresh install with a small
 * demo set so the public site renders something meaningful
 * before an editor logs in.
 *
 * Idempotent: skips creating pages / posts / nav menus that
 * already exist by checking for any row first. The intent is
 * "make a fresh install look alive" — once an editor publishes
 * real content, this script becomes a no-op.
 *
 * Requires at least one user in `nx_users` (use `pnpm seed:admin`
 * to create one). The seeded content is authored by the first
 * admin so revision history and audit log have a sensible owner.
 */

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env"), override: false });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

async function findFirstAdmin(): Promise<NxAuthUser | null> {
  const db = createDbConnection({ connectionString: databaseUrl as string });
  const rows = await db
    .select({
      id: nxUsers.id,
      email: nxUsers.email,
      name: nxUsers.name,
      role: nxUsers.role,
      tokenVersion: nxUsers.tokenVersion,
    })
    .from(nxUsers)
    .where(eq(nxUsers.role, "admin"))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as NxAuthUser["role"],
    tokenVersion: row.tokenVersion,
  };
}

async function seedPages(actor: NxAuthUser): Promise<number> {
  const existing = await findDocuments("pages", { limit: 1 });
  if (existing.docs.length > 0) {
    console.log("• pages: already populated, skipping");
    return 0;
  }

  const samples: Array<{
    title: string;
    /** Slug to force AFTER saveDocument runs; the pipeline's
     *  slugField derives from title, so we override the home
     *  page's slug with a direct DB write below. */
    forceSlug?: string;
    seoDescription?: string;
    blocks?: unknown;
  }> = [
    {
      title: "Welcome to NexPress",
      forceSlug: "/",
      seoDescription:
        "A fresh NexPress install. Sign in to /admin to start publishing.",
      blocks: [
        {
          id: "home-hero",
          type: "richText",
          props: {
            content: lexicalParagraph(
              "Welcome to NexPress — your site is up and running. Replace this page in the admin to take over the home URL.",
            ),
          },
        },
        {
          id: "home-cta",
          type: "richText",
          props: {
            content: lexicalParagraph(
              "Visit /blog to see the sample posts, or /admin to start publishing your own.",
            ),
          },
        },
      ],
    },
    {
      title: "About",
      seoDescription: "About this site.",
      blocks: [
        {
          id: "about-intro",
          type: "richText",
          props: {
            content: lexicalParagraph(
              "This is the About page that ships with the seed content. Edit it in /admin/collections/pages — your changes replace this draft on the next request.",
            ),
          },
        },
      ],
    },
    {
      title: "Contact",
      seoDescription: "Get in touch.",
      blocks: [
        {
          id: "contact-intro",
          type: "richText",
          props: {
            content: lexicalParagraph(
              "Drop us a line: hello@example.com. (This is seed content — replace it with your real contact info in the admin.)",
            ),
          },
        },
      ],
    },
  ];

  const db = createDbConnection({ connectionString: databaseUrl as string });
  // Pull the generated `pages` table reference indirectly so the
  // seed script doesn't have to import the generated schema
  // module path. A raw SQL UPDATE on `nx_c_pages` is enough for
  // the slug override.

  for (const sample of samples) {
    const { forceSlug, ...data } = sample;
    const result = await saveDocument("pages", null, data, actor, {
      status: "published",
    });
    if (forceSlug) {
      const id = result.doc.id as string;
      await db.execute(
        sql`update nx_c_pages set slug = ${forceSlug} where id = ${id}`,
      );
      console.log(`  ✓ page: ${sample.title} (slug overridden to ${forceSlug})`);
    } else {
      console.log(`  ✓ page: ${sample.title}`);
    }
  }
  return samples.length;
}

async function seedPosts(actor: NxAuthUser): Promise<number> {
  const existing = await findDocuments("posts", { limit: 1 });
  if (existing.docs.length > 0) {
    console.log("• posts: already populated, skipping");
    return 0;
  }

  const now = new Date();
  const samples = [
    {
      title: "Hello, NexPress",
      excerpt: "A first post to confirm the blog renders end-to-end.",
      content: lexicalParagraph(
        "This is the first post seeded by `pnpm seed:content`. Visit /admin/collections/posts to write more — and delete this one when you no longer need the placeholder.",
      ),
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      author: actor.id,
    },
    {
      title: "Working with Blocks",
      excerpt:
        "How NexPress's block editor lets you compose pages without writing markup.",
      content: lexicalParagraph(
        "Blocks are the visual primitives editors arrange on a page. Each block is a typed config the renderer turns into JSX. Add a new block type by registering it in the blocks package and it appears in the admin block palette.",
      ),
      publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString(),
      author: actor.id,
    },
    {
      title: "Switching Themes Without Redeploying",
      excerpt:
        "Phase 11 ships a multi-theme registry. Switch between installed themes from the admin without rebuilding.",
      content: lexicalParagraph(
        "Themes live in npm packages and register via `nexpress.config.ts`. The active id is persisted in `nx_settings.activeTheme`, so admins flip between Default / Minimal / Magazine / Portfolio from Settings → Theme. Adding a new theme still requires editing the config, but switching between installed ones doesn't.",
      ),
      publishedAt: now.toISOString(),
      author: actor.id,
    },
  ];

  for (const sample of samples) {
    await saveDocument("posts", null, sample, actor, { status: "published" });
    console.log(`  ✓ post: ${sample.title}`);
  }
  return samples.length;
}

async function seedNavigation(actor: NxAuthUser): Promise<{ header: number; footer: number }> {
  // Phase 15.8 — site-scoped. The caller wraps this in
  // withCurrentSite(siteId, …) so getCurrentSiteId() returns
  // the right id; we read it explicitly here so the insert
  // stamps a value (the column has a 'default' default at
  // the schema level, but explicit is safer when the script
  // is targeting a non-default tenant).
  const { getCurrentSiteId, NX_DEFAULT_SITE_ID } = await import(
    "@nexpress/core"
  );
  const { and } = await import("drizzle-orm");
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  const db = createDbConnection({ connectionString: databaseUrl as string });

  const headerExisting = await db
    .select({ id: nxNavigation.id })
    .from(nxNavigation)
    .where(
      and(
        eq(nxNavigation.siteId, siteId),
        eq(nxNavigation.location, "header"),
      ),
    )
    .limit(1);

  const footerExisting = await db
    .select({ id: nxNavigation.id })
    .from(nxNavigation)
    .where(
      and(
        eq(nxNavigation.siteId, siteId),
        eq(nxNavigation.location, "footer"),
      ),
    )
    .limit(1);

  const headerItems: NxNavItem[] = [
    { id: navId("posts"), label: "Posts", type: "link", url: "/blog" },
    { id: navId("about"), label: "About", type: "link", url: "/about" },
    { id: navId("discussions"), label: "Discussions", type: "link", url: "/discussions" },
  ];
  const footerItems: NxNavItem[] = [
    { id: navId("about-f"), label: "About", type: "link", url: "/about" },
    { id: navId("contact-f"), label: "Contact", type: "link", url: "/contact" },
    { id: navId("github"), label: "GitHub", type: "link", url: "https://github.com/hahabsw/nexpress" },
  ];

  let headerCount = 0;
  let footerCount = 0;

  if (headerExisting.length === 0) {
    await db.insert(nxNavigation).values({
      siteId,
      location: "header",
      items: headerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    headerCount = headerItems.length;
    console.log(`  ✓ header navigation: ${headerCount} items`);
  } else {
    console.log("• header navigation: already exists, skipping");
  }

  if (footerExisting.length === 0) {
    await db.insert(nxNavigation).values({
      siteId,
      location: "footer",
      items: footerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    footerCount = footerItems.length;
    console.log(`  ✓ footer navigation: ${footerCount} items`);
  } else {
    console.log("• footer navigation: already exists, skipping");
  }

  return { header: headerCount, footer: footerCount };
}

function navId(token: string): string {
  return `nav-${token}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build the minimal Lexical-compatible JSON shape the editor /
 * renderer expects. A single paragraph with one text child is
 * enough for seed content; richer formatting lands when an
 * editor opens the post in the admin.
 */
function lexicalParagraph(text: string): unknown {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              version: 1,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
            },
          ],
        },
      ],
    },
  };
}

function parseSiteFlag(argv: string[]): string {
  const arg = argv.slice(2).find((a) => a.startsWith("--site="));
  if (!arg) return "default";
  return arg.slice("--site=".length).trim() || "default";
}

async function main(): Promise<void> {
  // Re-use the apps/web bootstrap so collection registrations,
  // plugins, hooks all match what runtime sees. saveDocument
  // depends on the registry being loaded.
  ensureCoreServices();
  await ensurePluginsLoaded();

  // Phase 15.8 — `--site=<id>` flag scopes the seeded
  // content to a non-default tenant. Without the flag,
  // everything lands on the default site (preserves the
  // pre-15.8 behavior). With the flag, every save runs
  // inside `withCurrentSite(siteId, …)` so the pipeline
  // stamps each row with the right site_id.
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
  console.log(
    `Seeding content for site "${siteId}" as ${actor.email}…`,
  );

  const { pageCount, postCount, navCounts } = await withCurrentSite(
    siteId,
    async () => {
      const pageCount = await seedPages(actor);
      const postCount = await seedPosts(actor);
      const navCounts = await seedNavigation(actor);
      return { pageCount, postCount, navCounts };
    },
  );

  console.log("");
  console.log(
    `Done. Created ${pageCount} pages, ${postCount} posts, ${navCounts.header + navCounts.footer} nav items.`,
  );
  console.log("Visit http://localhost:3000 to preview.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
