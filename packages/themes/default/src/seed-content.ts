import type { NpThemeSeedPage, NpThemeSeedTerm } from "@nexpress/theme";

/**
 * Default-theme marketing pages. Walks every built-in block primitive
 * (hero / section-header / feature-grid / stats-grid / testimonials /
 * tabs / pricing / faq / cta / logos-cloud) so a fresh install exercises
 * the page builder out of the box — operators see what blocks look like
 * before they touch the admin.
 *
 * Lives in the theme (not in `@nexpress/app`) because the framework's
 * seeder is a pure orchestrator: themes own their demo content. Other
 * themes (magazine / portfolio / docs) seed their own front pages with
 * theme-specific layouts; default's home is the marketing landing.
 */

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


/**
 * Demo categories that the marketing home pricing card references.
 * Operators replace these with their own taxonomy once content goes
 * live — `category-with-posts` keeps the row from being orphaned and
 * losing analytics history.
 */
export const defaultCategories: NpThemeSeedTerm[] = [
  { name: "Engineering", description: "Architecture, internals, and tooling." },
  { name: "Product", description: "Roadmap, decisions, and announcements." },
];

/**
 * Marketing pages — Welcome (home), About, Pricing, Contact. Walks the
 * built-in block library so the admin's block picker has something
 * meaningful in the page builder on first open.
 */
export const defaultPages: NpThemeSeedPage[] = [
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
    seoDescription:
      "Simple per-site pricing — start free, upgrade when you need a team.",
    blocks: buildPricingPageBlocks(),
  },
  {
    title: "Contact",
    seoDescription: "Get in touch with the NexPress team.",
    blocks: buildContactPageBlocks(),
  },
];
