import { and, eq, sql } from "drizzle-orm";

import {
  findDocuments,
  getCurrentSiteId,
  getDb,
  NP_DEFAULT_SITE_ID,
  npNavigation,
  saveDocument,
  type NpAuthUser,
  type NpNavItem,
} from "@nexpress/core";

/**
 * Demo-content seeders shared by the CLI script (`pnpm seed:content`)
 * and the first-boot Admin Setup wizard (#A, follow-up to #396).
 *
 * Idempotent — each function checks for an existing row first and
 * is a no-op when content already exists. Callers wrap in
 * `withCurrentSite(siteId, …)` when targeting a non-default tenant;
 * the navigation seeder reads `getCurrentSiteId()` so the row is
 * stamped explicitly.
 *
 * `console.log` lives at the call site; this module only returns
 * counts so an HTTP handler can render structured progress.
 */

export interface SeedPagesResult {
  created: number;
  skipped: boolean;
}

export interface SeedPostsResult {
  created: number;
  skipped: boolean;
}

export interface SeedNavigationResult {
  header: number;
  footer: number;
  headerSkipped: boolean;
  footerSkipped: boolean;
}

export interface SeedAllResult {
  pages: SeedPagesResult;
  posts: SeedPostsResult;
  navigation: SeedNavigationResult;
}

interface PageSample {
  title: string;
  forceSlug?: string;
  seoDescription?: string;
  blocks?: unknown;
}

const PAGE_SAMPLES: PageSample[] = [
  {
    title: "Welcome to NexPress",
    forceSlug: "/",
    seoDescription:
      "A fresh NexPress install. Sign in to /admin to start publishing.",
    blocks: [
      {
        id: "home-hero",
        type: "rich-text",
        props: {
          content: lexicalParagraph(
            "Welcome to NexPress — your site is up and running. Replace this page in the admin to take over the home URL.",
          ),
        },
      },
      {
        id: "home-cta",
        type: "rich-text",
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
        type: "rich-text",
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
        type: "rich-text",
        props: {
          content: lexicalParagraph(
            "Drop us a line: hello@example.com. (This is seed content — replace it with your real contact info in the admin.)",
          ),
        },
      },
    ],
  },
];

export async function seedPages(actor: NpAuthUser): Promise<SeedPagesResult> {
  const existing = await findDocuments("pages", { limit: 1 });
  if (existing.docs.length > 0) {
    return { created: 0, skipped: true };
  }

  const db = getDb();
  for (const sample of PAGE_SAMPLES) {
    const { forceSlug, ...data } = sample;
    const result = await saveDocument("pages", null, data, actor, {
      status: "published",
    });
    if (forceSlug) {
      const id = result.doc.id as string;
      // The pipeline's slugField derives from title, so we override
      // the home page's slug with a direct DB write after save.
      await db.execute(
        sql`update np_c_pages set slug = ${forceSlug} where id = ${id}`,
      );
    }
  }
  return { created: PAGE_SAMPLES.length, skipped: false };
}

export async function seedPosts(actor: NpAuthUser): Promise<SeedPostsResult> {
  const existing = await findDocuments("posts", { limit: 1 });
  if (existing.docs.length > 0) {
    return { created: 0, skipped: true };
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
        "Themes live in npm packages and register via `nexpress.config.ts`. The active id is persisted in `np_settings.activeTheme`, so admins flip between Default / Minimal / Magazine / Portfolio from Settings → Theme. Adding a new theme still requires editing the config, but switching between installed ones doesn't.",
      ),
      publishedAt: now.toISOString(),
      author: actor.id,
    },
  ];

  for (const sample of samples) {
    await saveDocument("posts", null, sample, actor, { status: "published" });
  }
  return { created: samples.length, skipped: false };
}

export async function seedNavigation(
  actor: NpAuthUser,
): Promise<SeedNavigationResult> {
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const db = getDb();

  const headerExisting = await db
    .select({ id: npNavigation.id })
    .from(npNavigation)
    .where(
      and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, "header")),
    )
    .limit(1);

  const footerExisting = await db
    .select({ id: npNavigation.id })
    .from(npNavigation)
    .where(
      and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, "footer")),
    )
    .limit(1);

  const headerItems: NpNavItem[] = [
    { id: navId("posts"), label: "Posts", type: "link", url: "/blog" },
    { id: navId("about"), label: "About", type: "link", url: "/about" },
    { id: navId("discussions"), label: "Discussions", type: "link", url: "/discussions" },
  ];
  const footerItems: NpNavItem[] = [
    { id: navId("about-f"), label: "About", type: "link", url: "/about" },
    { id: navId("contact-f"), label: "Contact", type: "link", url: "/contact" },
    { id: navId("github"), label: "GitHub", type: "link", url: "https://github.com/hahabsw/nexpress" },
  ];

  let headerCount = 0;
  let footerCount = 0;
  const headerSkipped = headerExisting.length > 0;
  const footerSkipped = footerExisting.length > 0;

  if (!headerSkipped) {
    await db.insert(npNavigation).values({
      siteId,
      location: "header",
      items: headerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    headerCount = headerItems.length;
  }

  if (!footerSkipped) {
    await db.insert(npNavigation).values({
      siteId,
      location: "footer",
      items: footerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    footerCount = footerItems.length;
  }

  return {
    header: headerCount,
    footer: footerCount,
    headerSkipped,
    footerSkipped,
  };
}

export async function seedAll(actor: NpAuthUser): Promise<SeedAllResult> {
  const pages = await seedPages(actor);
  const posts = await seedPosts(actor);
  const navigation = await seedNavigation(actor);
  return { pages, posts, navigation };
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
