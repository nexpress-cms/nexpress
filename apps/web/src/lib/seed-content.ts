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

export interface SeedTaxonomiesResult {
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
  taxonomies: SeedTaxonomiesResult;
  pages: SeedPagesResult;
  posts: SeedPostsResult;
  navigation: SeedNavigationResult;
}

// ──────────────────────────────────────────────────────────────────
// Tags — seeded before posts so each post can reference real ids.
// ──────────────────────────────────────────────────────────────────

interface TagSample {
  name: string;
  description: string;
}

const TAG_SAMPLES: TagSample[] = [
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

export async function seedTaxonomies(
  actor: NpAuthUser,
): Promise<SeedTaxonomiesResult> {
  const existing = await findDocuments("taxonomies", { limit: 1 });
  if (existing.docs.length > 0) {
    return { created: 0, skipped: true };
  }

  for (const sample of TAG_SAMPLES) {
    await saveDocument(
      "taxonomies",
      null,
      { ...sample, taxonomy: "post_tag" },
      actor,
      { status: "published" },
    );
  }
  return { created: TAG_SAMPLES.length, skipped: false };
}

async function tagIdsByName(): Promise<Map<string, string>> {
  const result = await findDocuments("taxonomies", { limit: 50 });
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

interface PageSample {
  title: string;
  forceSlug?: string;
  template?: string;
  seoDescription?: string;
  blocks: unknown[];
}

const PAGE_SAMPLES: PageSample[] = [
  {
    title: "Welcome to NexPress",
    forceSlug: "/",
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

// ──────────────────────────────────────────────────────────────────
// Posts — real prose so the blog template has something to render
// that resembles production content. Includes a future-dated draft
// to demo the scheduled-publish flow.
// ──────────────────────────────────────────────────────────────────

interface PostSample {
  title: string;
  excerpt: string;
  content: unknown;
  publishedAt: string;
  status?: "draft" | "published";
  tagNames?: string[];
}

function buildPostSamples(now: Date): PostSample[] {
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

export async function seedPosts(actor: NpAuthUser): Promise<SeedPostsResult> {
  const existing = await findDocuments("posts", { limit: 1 });
  if (existing.docs.length > 0) {
    return { created: 0, skipped: true };
  }

  const tagIds = await tagIdsByName();
  const samples = buildPostSamples(new Date());

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
    { id: navId("blog"), label: "Blog", type: "link", url: "/blog" },
    { id: navId("about"), label: "About", type: "link", url: "/about" },
    { id: navId("pricing"), label: "Pricing", type: "link", url: "/pricing" },
    { id: navId("contact"), label: "Contact", type: "link", url: "/contact" },
    { id: navId("discussions"), label: "Discussions", type: "link", url: "/discussions" },
  ];
  const footerItems: NpNavItem[] = [
    { id: navId("about-f"), label: "About", type: "link", url: "/about" },
    { id: navId("pricing-f"), label: "Pricing", type: "link", url: "/pricing" },
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

// ──────────────────────────────────────────────────────────────────
// Orchestrator — taxonomies first so post tag refs resolve.
// ──────────────────────────────────────────────────────────────────

export async function seedAll(actor: NpAuthUser): Promise<SeedAllResult> {
  const taxonomies = await seedTaxonomies(actor);
  const pages = await seedPages(actor);
  const posts = await seedPosts(actor);
  const navigation = await seedNavigation(actor);
  return { taxonomies, pages, posts, navigation };
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
 * Build the minimal Lexical-compatible JSON shape the editor /
 * renderer expects. A single paragraph with one text child.
 */
function lexicalParagraph(text: string): unknown {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [paragraphNode(text)],
    },
  };
}

/** Multi-paragraph Lexical doc — each entry is one paragraph. */
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
              "Per-site locale registry, translatable collections, RTL, and a localized-pages collection that keeps source / translation pairs aligned.",
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
