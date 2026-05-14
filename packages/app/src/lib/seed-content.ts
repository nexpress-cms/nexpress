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
  type NpRegisteredTheme,
} from "@nexpress/core";
import type {
  NpThemeSeedContent,
  NpThemeSeedPage,
  NpThemeSeedPost,
  NpThemeSeedTerm,
} from "@nexpress/theme";

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
 *
 * The pages seeded here are composed out of the framework's
 * built-in block library (hero / section-header / feature-grid /
 * stats-grid / testimonials / tabs / pricing / faq / cta /
 * logos-cloud) so the home page actually exercises the page
 * builder out of the box, rather than emitting a single
 * rich-text dump that hides every block primitive.
 */

export interface SeedPagesResult {
  created: number;
  skipped: boolean;
}

export interface SeedPostsResult {
  created: number;
  skipped: boolean;
}

export interface SeedTermsResult {
  tagsCreated: number;
  categoriesCreated: number;
  skipped: boolean;
}

export interface SeedNavigationResult {
  header: number;
  footer: number;
  headerSkipped: boolean;
  footerSkipped: boolean;
}

export interface SeedAllResult {
  terms: SeedTermsResult;
  pages: SeedPagesResult;
  posts: SeedPostsResult;
  navigation: SeedNavigationResult;
}

// ──────────────────────────────────────────────────────────────────
// Tags — seeded before posts so each post can reference real ids.
// ──────────────────────────────────────────────────────────────────

const TAG_SAMPLES: NpThemeSeedTerm[] = [
  {
    name: "Framework",
    description: "Architecture, conventions, and roadmap notes.",
  },
  {
    name: "Plugins",
    description: "Authoring guides and patterns from real plugins.",
  },
  {
    name: "Themes",
    description: "Building, theming, and switching between site shells.",
  },
  {
    name: "Tutorials",
    description: "Step-by-step walkthroughs for common tasks.",
  },
];

const CATEGORY_SAMPLES: NpThemeSeedTerm[] = [
  { name: "Engineering", description: "Architecture, internals, and tooling." },
  { name: "Product", description: "Roadmap, decisions, and announcements." },
];

export interface SeedTermsOptions {
  tags?: NpThemeSeedTerm[];
  categories?: NpThemeSeedTerm[];
}

export async function seedTerms(
  actor: NpAuthUser,
  options: SeedTermsOptions = {},
): Promise<SeedTermsResult> {
  const tags = options.tags ?? TAG_SAMPLES;
  const categories = options.categories ?? CATEGORY_SAMPLES;

  // Both collections are checked together — if the operator has
  // touched EITHER side, treat the seed as already-run so we don't
  // half-overwrite.
  const tagsExisting = await findDocuments("tags", { limit: 1 });
  const categoriesExisting = await findDocuments("categories", { limit: 1 });
  if (tagsExisting.docs.length > 0 || categoriesExisting.docs.length > 0) {
    return { tagsCreated: 0, categoriesCreated: 0, skipped: true };
  }

  for (const sample of tags) {
    await saveDocument(
      "tags",
      null,
      { name: sample.name, description: sample.description ?? "" },
      actor,
      { status: "published" },
    );
  }
  for (const sample of categories) {
    await saveDocument(
      "categories",
      null,
      { name: sample.name, description: sample.description ?? "" },
      actor,
      { status: "published" },
    );
  }
  return {
    tagsCreated: tags.length,
    categoriesCreated: categories.length,
    skipped: false,
  };
}

async function tagIdsByName(): Promise<Map<string, string>> {
  const result = await findDocuments("tags", { limit: 50 });
  const ids = new Map<string, string>();
  for (const doc of result.docs) {
    const name = typeof doc.name === "string" ? doc.name : null;
    const id = typeof doc.id === "string" ? doc.id : null;
    if (name && id) ids.set(name, id);
  }
  return ids;
}

// ──────────────────────────────────────────────────────────────────
// Pages — composed from built-in blocks. Each block instance gets
// a stable id so re-renders don't shuffle the editor's row order.
// ──────────────────────────────────────────────────────────────────

const PAGE_SAMPLES: NpThemeSeedPage[] = [
  {
    title: "Welcome to NexPress",
    slug: "/",
    seoDescription:
      "An opinionated, batteries-included CMS for teams shipping production sites on Next.js.",
    blocks: buildHomePageBlocks(),
  },
  {
    title: "About",
    seoDescription: "What NexPress is, who builds it, and why.",
    blocks: buildAboutPageBlocks(),
  },
  {
    title: "Pricing",
    seoDescription: "Simple per-site pricing — start free, upgrade when you need a team.",
    blocks: buildPricingPageBlocks(),
  },
  {
    title: "Contact",
    seoDescription: "Get in touch with the NexPress team.",
    blocks: buildContactPageBlocks(),
  },
];

export interface SeedPagesOptions {
  pages?: NpThemeSeedPage[];
}

export async function seedPages(
  actor: NpAuthUser,
  options: SeedPagesOptions = {},
): Promise<SeedPagesResult> {
  const pages = options.pages ?? PAGE_SAMPLES;

  const existing = await findDocuments("pages", { limit: 1 });
  if (existing.docs.length > 0) {
    return { created: 0, skipped: true };
  }

  const db = getDb();
  for (const sample of pages) {
    const { slug, ...data } = sample;
    const result = await saveDocument("pages", null, data, actor, {
      status: "published",
    });
    if (slug) {
      const id = result.doc.id as string;
      // The pipeline's slugField derives from title, so we override
      // the home page's slug with a direct DB write after save.
      await db.execute(
        sql`update np_c_pages set slug = ${slug} where id = ${id}`,
      );
    }
  }
  return { created: pages.length, skipped: false };
}

// ──────────────────────────────────────────────────────────────────
// Posts — real prose so the blog template has something to render
// that resembles production content. Includes a future-dated draft
// to demo the scheduled-publish flow.
// ──────────────────────────────────────────────────────────────────

function buildPostSamples(now: Date): NpThemeSeedPost[] {
  const day = 1000 * 60 * 60 * 24;
  return [
    {
      title: "Building Your First NexPress Plugin",
      excerpt:
        "From zero to a running plugin in seven manifest fields. Walks through hook handlers, route registration, and what definePlugin auto-derives so you don't have to type it twice.",
      content: lexicalDoc([
        "Plugins in NexPress are npm packages that ship a single `definePlugin({ manifest, hooks, routes })` body. The manifest takes seven required fields — id, version, name, description, author, license, and the framework's minVersion — and `definePlugin` auto-derives the rest from your declared surface.",
        "The first plugin most teams write logs an event when content publishes. That's a four-line `content:afterCreate` hook handler. The runtime gives you a typed `ctx` with capability-gated namespaces: log, content, storage, http. Adding `ctx.storage.set('last-publish', Date.now())` from the same handler costs one extra line and one capability declaration.",
        "Routes follow the same shape — declare them in the plugin's `routes` array and they mount under `/api/plugins/<id>/<path>` automatically. The framework's middleware applies a conservative rate limit at the catch-all level so plugin authors don't have to think about basic abuse paths from day one.",
        "When you're ready to ship, `pnpm publish` to a public or private registry, then `pnpm add` the package in any consuming site and add it to that site's `nexpress.config.ts` plugins array. Restart, and the hook fires.",
      ]),
      publishedAt: new Date(now.getTime() - day * 14).toISOString(),
      tagNames: ["Plugins", "Tutorials"],
    },
    {
      title: "How the Page Builder's Container Contracts Keep Pages Valid",
      excerpt:
        "When a column accepts only text and a hero block, the editor's add-block popover knows that. Here's how container contracts propagate through the reducer, the wrap actions, and the pasted-pattern validator.",
      content: lexicalDoc([
        "Container blocks (`acceptsChildren: true`) can declare an `allowedChildTypes` list and `min/maxChildren` bounds. That's the contract. The editor honors it everywhere a child enters: ADD, INSERT_BEFORE, INSERT_AFTER, MOVE_INTO, INSERT_PATTERN, and both the single and bulk variants of WRAP.",
        "The interesting case is bulk-wrap. WRAP_MANY collapses N selected siblings into one wrapper, so the parent's child count goes down, but the wrapper type itself has to satisfy the parent's contract. A column whose `allowedChildTypes` is `[\"text\"]` rejects a wrap-into-grid even when each text would fit inside the grid — because the column would now hold a grid, which it doesn't allow.",
        "Pre-validation at the editor surface (the wrap-in popover hides incompatible options) plus the reducer's fail-closed rejection means an invalid tree is impossible to construct from a click. Direct API calls would still need the same gate; the pipeline's pattern validator runs the same `canAcceptChild` check before persisting blocks.",
        "The same invariant gates the paste-blocks dialog. Paste a JSON snippet, and the dialog walks the tree first — any node that fails the shape check rejects the whole paste, so a malformed `children: 'string'` can't make it past validation only to crash the reducer's `cloneBlockDeep` later.",
      ]),
      publishedAt: new Date(now.getTime() - day * 7).toISOString(),
      tagNames: ["Framework"],
    },
    {
      title: "Themes Without Forks: Tokens, Overlays, and the Layered Merge",
      excerpt:
        "Themes ship a partial token overlay and the framework merges it onto sensible defaults. Operators tweak deltas via the admin without ever copying the full token tree.",
      content: lexicalDoc([
        "A theme defines its identity through three things: the React shell, the CSS string, and the token overlay. The overlay is a sub-tree-Partial — `{ colors?: Partial<NpThemeColors>; typography?: Partial<NpThemeTypography>; shape?: Partial<NpThemeShape> }` — so a theme that wants to override only the primary color types `{ colors: { primary: 'oklch(0.6 0.15 30)' } }` and the rest of the token tree falls through to the framework default.",
        "At runtime, `getTheme()` resolves the effective tokens by layering three sources: framework defaults, the active theme's overlay, and the per-site DB row that captures admin overrides. Last writer wins. The merge is field-by-field, so a theme that sets `colors.primary` doesn't blow away the rest of `colors`, and an admin who tweaks one font doesn't lose the theme's other typography choices.",
        "The result lands in `:root { --np-color-*: …; --np-font-*: …; }` via `<NpThemeStyle />` at SSR. Built-in blocks read these via `var(--np-color-primary, #6366f1)` so dropping the same `<cta>` block onto a magazine-themed page picks up the warm terracotta primary, while a portfolio-themed page picks up a near-white accent on dark.",
        "Admins switching themes never lose their custom overrides — the DB row sits on top of whatever the new theme declares. Switching back restores the old visual without touching the operator's deltas.",
      ]),
      publishedAt: new Date(now.getTime() - day * 3).toISOString(),
      tagNames: ["Themes", "Framework"],
    },
    {
      title: "Reading Time and Reactions in Thirty Lines Each",
      excerpt:
        "Two examples of plugins that pay for themselves on the first post. The reading-time plugin attaches a metric on `content:afterCreate`; the reactions plugin exposes a route that records emoji reactions per document.",
      content: lexicalDoc([
        "The bundled reading-time plugin is ~50 lines including comments. It listens on `content:afterCreate` and `content:afterUpdate`, walks the document's rich-text content, counts words, and logs the estimate. Adding it to a site is two lines: install the package and add it to the plugins array in `nexpress.config.ts`.",
        "Reactions follow the same shape but exercise a route. The plugin declares one route at `/reactions/:docId/:kind` (POST), pulls the document via `ctx.content.findOne`, increments a counter in `ctx.storage`, and returns the new count. Capabilities: `hooks:content`, `api:route`, `content:read`, `storage:kv`. Four entries on the manifest, each documented in the capabilities reference.",
        "Neither plugin needs database migrations. Plugin storage is a key-value store keyed by plugin id, scoped per site, with no schema for the plugin to manage. Persistent counters, last-run timestamps, simple flags — exactly the kinds of state plugins need without forcing a Drizzle schema for each.",
        "When you outgrow KV — say, the reactions plugin needs to query \"top reacted posts this week\" — the recommended path is graduating into a real collection registered in the site's config. The plugin keeps the route surface; only the storage backing changes.",
      ]),
      publishedAt: new Date(now.getTime() - day).toISOString(),
      tagNames: ["Plugins", "Tutorials"],
    },
    {
      title: "Coming Soon: What's Next on the Roadmap",
      excerpt:
        "A preview of the work landing in the next few releases — multi-author collaboration, plugin marketplace, and a managed media adapter for projects that don't want to wire S3 by hand.",
      content: lexicalDoc([
        "This post is scheduled — its `publishedAt` is set in the future, and the framework's scheduled-publish job promotes it from draft to published when the timestamp passes. You'll see it live on the public site once the worker's cron tick fires.",
        "On the roadmap: a marketplace for plugins, parity between the page builder's editor surface and the plugin SDK so plugin-contributed blocks feel native, and a managed media adapter that defaults to a sensible cloud bucket for teams that don't want to spin up S3 from scratch.",
        "Everything is being built in the open in the public repo. PR titles map to the same phase numbers you see in `docs/roadmap.md`. Subscribe to the GitHub releases feed to get notified when a phase ships.",
      ]),
      // Seven days in the future — demonstrates that the scheduled-
      // publishing job promotes drafts whose `publishedAt` has
      // passed. Visible in `/admin/collections/posts` as a draft
      // until the cron tick that crosses the timestamp.
      publishedAt: new Date(now.getTime() + day * 7).toISOString(),
      status: "draft",
      tagNames: ["Framework"],
    },
  ];
}

export interface SeedPostsOptions {
  posts?: NpThemeSeedPost[];
}

export async function seedPosts(
  actor: NpAuthUser,
  options: SeedPostsOptions = {},
): Promise<SeedPostsResult> {
  const existing = await findDocuments("posts", { limit: 1 });
  if (existing.docs.length > 0) {
    return { created: 0, skipped: true };
  }

  const tagIds = await tagIdsByName();
  const samples = options.posts ?? buildPostSamples(new Date());

  for (const sample of samples) {
    const tagRefs = (sample.tagNames ?? [])
      .map((name) => tagIds.get(name))
      .filter((id): id is string => typeof id === "string");
    const { tagNames: _tagNames, status, ...rest } = sample;
    await saveDocument(
      "posts",
      null,
      { ...rest, author: actor.id, tags: tagRefs },
      actor,
      { status: status ?? "published" },
    );
  }
  return { created: samples.length, skipped: false };
}

// ──────────────────────────────────────────────────────────────────
// Navigation — header + footer linking to the seeded pages.
// ──────────────────────────────────────────────────────────────────

const DEFAULT_HEADER_NAV: NpNavItem[] = [
  { id: navId("blog"), label: "Blog", type: "link", url: "/blog" },
  { id: navId("about"), label: "About", type: "link", url: "/about" },
  { id: navId("pricing"), label: "Pricing", type: "link", url: "/pricing" },
  { id: navId("contact"), label: "Contact", type: "link", url: "/contact" },
  { id: navId("discussions"), label: "Discussions", type: "link", url: "/discussions" },
];

const DEFAULT_FOOTER_NAV: NpNavItem[] = [
  { id: navId("about-f"), label: "About", type: "link", url: "/about" },
  { id: navId("pricing-f"), label: "Pricing", type: "link", url: "/pricing" },
  { id: navId("contact-f"), label: "Contact", type: "link", url: "/contact" },
  { id: navId("github"), label: "GitHub", type: "link", url: "https://github.com/nexpress-cms/nexpress" },
];

export interface SeedNavigationOptions {
  header?: NpNavItem[];
  footer?: NpNavItem[];
}

export async function seedNavigation(
  actor: NpAuthUser,
  options: SeedNavigationOptions = {},
): Promise<SeedNavigationResult> {
  const headerItems = options.header ?? DEFAULT_HEADER_NAV;
  const footerItems = options.footer ?? DEFAULT_FOOTER_NAV;

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

// ──────────────────────────────────────────────────────────────────
// Orchestrator — terms first so post tag/category refs resolve.
// ──────────────────────────────────────────────────────────────────

/**
 * Theme-aware seed orchestrator.
 *
 * When `theme.impl.seedContent` is set, each slot drives its
 * respective seeder. Unset slots fall through to the framework's
 * generic content per-slot — so a theme that overrides only
 * `posts` keeps the generic pages, tags, and nav. Pass no `theme`
 * (or one without `seedContent`) to run the pure framework
 * default — the current call signature `seedAll(actor)` still
 * works for back-compat with `seed:content` scripts.
 */
export async function seedAll(
  actor: NpAuthUser,
  theme?: NpRegisteredTheme | null,
): Promise<SeedAllResult> {
  // `NpRegisteredTheme.impl` is typed as opaque `unknown` in core
  // (themes opt into the typed `NpThemeImpl` view by importing
  // `@nexpress/theme`); narrow at the boundary so the seeder
  // sees the typed shape. The structural cast is benign — both
  // sides go through the `defineTheme` author surface.
  const impl = (theme?.impl ?? null) as { seedContent?: NpThemeSeedContent } | null;
  const themed: NpThemeSeedContent = impl?.seedContent ?? {};

  const terms = await seedTerms(actor, {
    tags: themed.tags,
    categories: themed.categories,
  });
  const pages = await seedPages(actor, { pages: themed.pages });
  const posts = await seedPosts(actor, { posts: themed.posts });
  const nav = await seedNavigation(actor, {
    header: themed.navigation?.header,
    footer: themed.navigation?.footer,
  });
  return { terms, pages, posts, navigation: nav };
}

// ──────────────────────────────────────────────────────────────────
// Helpers — block tree builders + Lexical doc constructors.
// ──────────────────────────────────────────────────────────────────

function navId(token: string): string {
  return `nav-${token}-${Math.random().toString(36).slice(2, 8)}`;
}

function blockId(token: string): string {
  // Stable across re-runs — operators who rerun the seeder shouldn't
  // see the editor's row order shuffle just because random ids
  // changed.
  return `seed-${token}`;
}

/**
 * Multi-paragraph Lexical doc — each entry is one paragraph. The
 * shape is the minimal `root → paragraph → text` tree the Lexical
 * renderer expects; richer formatting lands when an editor opens
 * the document in the admin.
 */
function lexicalDoc(paragraphs: string[]): unknown {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: paragraphs.map(paragraphNode),
    },
  };
}

function paragraphNode(text: string): unknown {
  return {
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
  };
}

function buildHomePageBlocks(): unknown[] {
  return [
    {
      id: blockId("home-hero"),
      type: "hero",
      props: {
        title: "Build pages block by block",
        subtitle:
          "An opinionated, batteries-included CMS for teams shipping production sites on Next.js. Plugins, themes, page builder, jobs, and a real plugin SDK out of the box.",
        ctaText: "Read the quickstart",
        ctaUrl: "/blog",
        backgroundImage:
          "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1600&q=80",
      },
    },
    {
      id: blockId("home-logos"),
      type: "logos-cloud",
      props: {
        heading: "Trusted by teams shipping production sites",
        items: [
          { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Northwind", alt: "Northwind" },
          { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Aurora", alt: "Aurora" },
          { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Switchback", alt: "Switchback" },
          { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Larkfield", alt: "Larkfield" },
          { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Meridian", alt: "Meridian" },
          { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Halcyon", alt: "Halcyon" },
        ],
      },
    },
    {
      id: blockId("home-features-header"),
      type: "section-header",
      props: {
        eyebrow: "What's in the box",
        heading: "Everything a content team actually needs",
        subtitle:
          "We didn't ship a CMS skeleton with bring-your-own auth, jobs, and plugin loader. NexPress comes with all of them, opinionated and tested together.",
        align: "center",
      },
    },
    {
      id: blockId("home-features"),
      type: "feature-grid",
      props: {
        heading: "",
        columns: 3,
        features: [
          {
            icon: "🧱",
            title: "Page builder",
            description:
              "Drop blocks into a 12-column grid with per-breakpoint column spans, container contracts, multi-select bulk actions, and live preview.",
          },
          {
            icon: "🔌",
            title: "Plugin SDK",
            description:
              "Seven required manifest fields. definePlugin() auto-derives the rest from your declared surface — hooks, routes, scheduled tasks, blocks.",
          },
          {
            icon: "🎨",
            title: "Theme system",
            description:
              "Themes ship a partial token overlay; the framework merges it onto defaults. Switch themes without touching admin overrides.",
          },
          {
            icon: "⚡",
            title: "Jobs queue",
            description:
              "pg-boss-backed worker, paused / resumed from /admin/jobs, with archived job inspection and per-handler heartbeats.",
          },
          {
            icon: "🌍",
            title: "i18n",
            description:
              "Per-site locale registry, translatable collections, RTL, and Translation Tabs in the page editor that keep source / translation pairs aligned.",
          },
          {
            icon: "🛡️",
            title: "Capability-gated",
            description:
              "Plugins declare what they touch; runtime errors point at the missing capability instead of failing silently mid-handler.",
          },
        ],
      },
    },
    {
      id: blockId("home-stats"),
      type: "stats-grid",
      props: {
        heading: "",
        items: [
          { value: "9", label: "Built-in blocks", hint: "Ready to compose" },
          { value: "12+", label: "Bundled plugins", hint: "Real, dogfooded" },
          { value: "<50ms", label: "p50 page render" },
          { value: "5min", label: "From clone to deploy" },
        ],
      },
    },
    {
      id: blockId("home-quotes-header"),
      type: "section-header",
      props: {
        eyebrow: "What teams are saying",
        heading: "Built by people who write code daily",
        subtitle: "",
        align: "center",
      },
    },
    {
      id: blockId("home-testimonials"),
      type: "testimonials",
      props: {
        heading: "",
        items: [
          {
            quote:
              "We rebuilt our marketing site in a weekend. The block library and theme system fit our brand without forking templates.",
            name: "Mei Tanaka",
            role: "Engineering Lead, Aurora",
            rating: 5,
          },
          {
            quote:
              "The plugin SDK gave us a clean place to land custom CMS logic. Six months in and our site has grown without spaghetti.",
            name: "Carlos Mendes",
            role: "Founder, Switchback",
            rating: 5,
          },
          {
            quote:
              "Editors stopped opening tickets the day we shipped the page builder. Container contracts mean nobody can break a layout.",
            name: "Priya Raman",
            role: "Head of Content, Larkfield",
            rating: 5,
          },
        ],
      },
    },
    {
      id: blockId("home-tabs-header"),
      type: "section-header",
      props: {
        eyebrow: "How it fits your stack",
        heading: "Pick the surface, drop into your project",
        subtitle:
          "Each part of NexPress is loose enough to use on its own, opinionated enough that you don't have to reinvent the wiring.",
        align: "center",
      },
    },
    {
      id: blockId("home-tabs"),
      type: "tabs",
      props: {
        heading: "",
        items: [
          {
            label: "Page builder",
            content:
              "A 12-column grid, per-breakpoint column spans, container contracts (allowedChildTypes / minChildren / maxChildren), multi-select bulk actions, save-as-pattern, paste-blocks JSON import, Cmd-K command menu, and live iframe preview. Editors don't need to learn the framework — they get a tool that already knows what's allowed.",
          },
          {
            label: "Plugin SDK",
            content:
              "Seven required manifest fields, the rest auto-derived. Hooks, routes, scheduled tasks, admin extensions, and page-builder block contributions all live in one definePlugin() body. Capabilities gate ctx access at registration time AND call time, so a misconfigured plugin fails at boot with a clear error instead of leaking privilege.",
          },
          {
            label: "Theme system",
            content:
              "defineTheme({ shell, slots, templates, tokens, css }) — tokens layer onto framework defaults via a sub-tree partial, CSS uses var(--np-color-*) so admin overrides cascade through every block. Per-collection page templates surface in the admin picker. Switch active theme without redeploying.",
          },
          {
            label: "Jobs",
            content:
              "pg-boss adapter with pause / resume per queue, archived-job inspection, manual enqueue, and a worker-health widget driven by heartbeat records. Plugins schedule cron tasks declaratively; the host reconciles pgboss.schedule rows on plugin reload so toggling enabled / disabled actually flows through to the worker.",
          },
        ],
      },
    },
    {
      id: blockId("home-pricing-header"),
      type: "section-header",
      props: {
        eyebrow: "Pricing",
        heading: "Simple per-site pricing",
        subtitle: "Start free for one site. Upgrade when your team grows.",
        align: "center",
      },
    },
    {
      id: blockId("home-pricing"),
      type: "pricing",
      props: {
        heading: "",
        plans: [
          {
            name: "Solo",
            price: "Free",
            period: "forever",
            features:
              "One site\nUnlimited content\nCommunity support\nAll built-in blocks\nMIT license",
            ctaText: "Start building",
            ctaUrl: "/blog",
            highlighted: false,
          },
          {
            name: "Team",
            price: "$29",
            period: "/site / month",
            features:
              "Multi-site management\nRole-based access\nAudit log\nPriority support\nAll Solo features",
            ctaText: "Talk to us",
            ctaUrl: "/contact",
            highlighted: true,
          },
          {
            name: "Enterprise",
            price: "Custom",
            period: "annual",
            features:
              "SSO + SCIM\nCustom plugin development\nSecurity review\nSLA\nDedicated success rep",
            ctaText: "Contact sales",
            ctaUrl: "/contact",
            highlighted: false,
          },
        ],
      },
    },
    {
      id: blockId("home-faq"),
      type: "faq",
      props: {
        heading: "Common questions",
        items: [
          {
            question: "Is NexPress production-ready?",
            answer:
              "The v0.1 surface is documented in AGENTS.md's STABILITY section. Anything listed there carries semver guarantees pre-1.0; everything else may evolve. The framework is dogfooded — the marketing site you're reading is built on it.",
          },
          {
            question: "Can I use my existing Postgres?",
            answer:
              "Yes. NexPress wires to any Postgres 16+ via DATABASE_URL. Migrations are Drizzle-based and reviewable; nothing runs against your DB you didn't approve.",
          },
          {
            question: "What about WordPress imports?",
            answer:
              "The wp-import package ingests a WXR export end-to-end — posts, pages, media, taxonomies, comments, custom post types, and an audit log. It's a long-running pg-boss job with a resume marker for crash recovery.",
          },
          {
            question: "How do plugins work?",
            answer:
              "npm-package + rebuild — there's no hot reload of code edits in v1, but enabled / config changes hot-reload via /admin/plugins's Reload all. Plugins declare capabilities; the host enforces them at registration AND call time.",
          },
        ],
      },
    },
    {
      id: blockId("home-cta"),
      type: "cta",
      props: {
        heading: "Ready to ship faster?",
        description:
          "Stop wrangling block shapes and get back to writing content. Try NexPress for free.",
        buttonText: "Read the docs",
        buttonUrl: "/blog",
        variant: "primary",
      },
    },
  ];
}

function buildAboutPageBlocks(): unknown[] {
  return [
    {
      id: blockId("about-header"),
      type: "section-header",
      props: {
        eyebrow: "About",
        heading: "We build the CMS we wanted to use",
        subtitle:
          "After three companies and too many bespoke admin UIs, we wrote down the parts that should be the framework's job — and built them.",
        align: "center",
      },
    },
    {
      id: blockId("about-intro"),
      type: "rich-text",
      props: {
        content: lexicalDoc([
          "Most CMS frameworks ship a skeleton. You bring your own auth, your own jobs queue, your own page builder, your own theme system. Six months in, the project's bus factor is one — the developer who wired it all together.",
          "NexPress takes the opposite stance. Authentication, jobs, page builder, plugin SDK, theme system, multi-site, i18n, capabilities, scheduled publishing — they all ship in the box, opinionated and integrated. You add features by writing plugins; the framework's job is to handle the wiring you'd otherwise reinvent.",
          "The project is open source under MIT. Built in the open in the public repo. PRs welcome.",
        ]),
      },
    },
    {
      id: blockId("about-values-header"),
      type: "section-header",
      props: {
        eyebrow: "Principles",
        heading: "What we optimize for",
        subtitle: "",
        align: "center",
      },
    },
    {
      id: blockId("about-values"),
      type: "feature-grid",
      props: {
        heading: "",
        columns: 3,
        features: [
          {
            icon: "📦",
            title: "Batteries included",
            description:
              "We ship the parts you'd build first anyway — auth, jobs, plugins, themes, i18n. You add features, not framework wiring.",
          },
          {
            icon: "📐",
            title: "Strong contracts",
            description:
              "Capabilities, container contracts, sub-tree token overlays — every contract is named, typed, and surfaced where it matters.",
          },
          {
            icon: "🪶",
            title: "Single-process friendly",
            description:
              "A reasonable default deploys as one Next.js app with Postgres. Multi-node and dedicated workers when you need them, not before.",
          },
        ],
      },
    },
  ];
}

function buildPricingPageBlocks(): unknown[] {
  return [
    {
      id: blockId("pricing-header"),
      type: "section-header",
      props: {
        eyebrow: "Pricing",
        heading: "Pay per site, no surprises",
        subtitle:
          "Free for personal projects. Per-site monthly when your team needs roles, audit, and priority support.",
        align: "center",
      },
    },
    {
      id: blockId("pricing-tiers"),
      type: "pricing",
      props: {
        heading: "",
        plans: [
          {
            name: "Solo",
            price: "Free",
            period: "forever",
            features:
              "One site\nUnlimited content\nCommunity support\nAll built-in blocks\nMIT license",
            ctaText: "Start building",
            ctaUrl: "/blog",
            highlighted: false,
          },
          {
            name: "Team",
            price: "$29",
            period: "/site / month",
            features:
              "Multi-site management\nRole-based access\nAudit log\nPriority support\nAll Solo features",
            ctaText: "Talk to us",
            ctaUrl: "/contact",
            highlighted: true,
          },
          {
            name: "Enterprise",
            price: "Custom",
            period: "annual",
            features:
              "SSO + SCIM\nCustom plugin development\nSecurity review\nSLA\nDedicated success rep",
            ctaText: "Contact sales",
            ctaUrl: "/contact",
            highlighted: false,
          },
        ],
      },
    },
    {
      id: blockId("pricing-faq"),
      type: "faq",
      props: {
        heading: "Pricing FAQ",
        items: [
          {
            question: "Can I self-host instead?",
            answer:
              "Yes — NexPress is MIT licensed. The Solo plan is the open-source build; Team / Enterprise add hosted features (audit log retention, SSO) you can also self-host with the underlying primitives.",
          },
          {
            question: "What counts as a site?",
            answer:
              "One site = one tenant in the multi-site registry. Multi-site customers can run multiple sites under one Team subscription; each site has its own theme, content, and admin.",
          },
          {
            question: "Is there a trial?",
            answer:
              "Solo is free forever. Team plans include a 14-day evaluation; cancel anytime during the trial without payment.",
          },
        ],
      },
    },
  ];
}

function buildContactPageBlocks(): unknown[] {
  return [
    {
      id: blockId("contact-header"),
      type: "section-header",
      props: {
        eyebrow: "Get in touch",
        heading: "We read every message",
        subtitle:
          "Questions, plugin proposals, or just saying hi — we'd love to hear from you.",
        align: "center",
      },
    },
    {
      id: blockId("contact-form"),
      type: "contact-form",
      props: {
        heading: "Send us a note",
        email: "hello@example.com",
        fields: [
          { label: "Name" },
          { label: "Email" },
          { label: "Company" },
          { label: "Message" },
        ],
      },
    },
    {
      id: blockId("contact-rich"),
      type: "rich-text",
      props: {
        content: lexicalDoc([
          "Prefer a different channel? GitHub issues are best for bug reports and feature requests. Reach security@example.com for security concerns — we'll respond within one business day. Partnership inquiries: partners@example.com.",
        ]),
      },
    },
  ];
}
