import {
  defineTheme,
  type NpThemeSeedPage,
  type NpThemeSeedPost,
} from "@nexpress/theme";

import { docsBlocks } from "./blocks/index.js";
import { CopyButton } from "./copy-button-bridge.js";
import { DocsHeader } from "./header.js";
import { DocsMembersNotFound } from "./members-not-found.js";
import { DocsMembersShell } from "./members-shell.js";
import { DocsNotFound } from "./not-found.js";
import { DocsDetailRoute } from "./routes/doc-detail.js";
import { DocsSearch } from "./search.js";
import { DocsShell } from "./shell.js";
import { DocsSidebar } from "./sidebar.js";
import { docsCss } from "./styles.js";
import { docsSettingsSchema } from "./settings.js";
import { DocPageTemplate } from "./templates/doc-page.js";
import { PageFrontTemplate } from "./templates/page-front.js";

const SEED_NAV = {
  header: [
    { id: "nav-docs-docs", label: "Docs", type: "link" as const, url: "/docs" },
    { id: "nav-docs-reference", label: "Reference", type: "link" as const, url: "/docs/reference" },
    { id: "nav-docs-blog", label: "Blog", type: "link" as const, url: "/blog" },
  ],
  footer: [
    { id: "nav-docs-footer-docs", label: "Documentation", type: "link" as const, url: "/docs" },
    { id: "nav-docs-footer-reference", label: "Reference", type: "link" as const, url: "/docs/reference" },
    { id: "nav-docs-footer-changelog", label: "Changelog", type: "link" as const, url: "/changelog" },
    { id: "nav-docs-footer-github", label: "GitHub", type: "link" as const, url: "https://github.com" },
  ],
};


function paragraph(text: string) {
  return {
    type: "paragraph", version: 1, direction: null, format: "", indent: 0,
    children: [{
      type: "text", version: 1, detail: 0, format: 0, mode: "normal", style: "", text,
    }],
  };
}

function heading(tag: "h2" | "h3", text: string) {
  return {
    type: "heading", tag, version: 1, direction: null, format: "", indent: 0,
    children: [{
      type: "text", version: 1, detail: 0, format: 0, mode: "normal", style: "", text,
    }],
  };
}

function codeBlock(text: string, language?: string) {
  return {
    type: "code", language: language ?? null, version: 1, direction: null, format: "", indent: 0,
    children: [{
      type: "text", version: 1, detail: 0, format: 0, mode: "normal", style: "", text,
    }],
  };
}

function listItem(text: string) {
  return {
    type: "listitem", value: 1, version: 1, direction: null, format: "", indent: 0,
    children: [{
      type: "text", version: 1, detail: 0, format: 0, mode: "normal", style: "", text,
    }],
  };
}

function bulletList(items: string[]) {
  return {
    type: "list", listType: "bullet", start: 1, tag: "ul",
    version: 1, direction: null, format: "", indent: 0,
    children: items.map((t) => listItem(t)),
  };
}

function lexicalDoc(blocks: unknown[]): unknown {
  return {
    root: {
      type: "root", version: 1, direction: null, format: "", indent: 0,
      children: blocks,
    },
  };
}

const DOCS_NOW = "2026-05-02T12:00:00.000Z";

function stubDoc(opts: {
  title: string;
  parentSlug?: string;
  order?: number;
  badge?: string;
  lede?: string;
  stableSince?: string;
}): NpThemeSeedPost {
  return {
    title: opts.title,
    excerpt: opts.lede ?? `${opts.title} reference page.`,
    content: lexicalDoc([
      paragraph(`Placeholder body for ${opts.title}. Operators replace this once they're set up — every doc-kind post renders through the three-column docs template.`),
    ]),
    publishedAt: DOCS_NOW,
    kind: "doc",
    ...(opts.parentSlug ? { parentSlug: opts.parentSlug } : {}),
    ...(typeof opts.order === "number" ? { order: opts.order } : {}),
    data: {
      ...(opts.badge ? { badge: opts.badge } : {}),
      ...(opts.lede ? { lede: opts.lede } : {}),
      ...(opts.stableSince ? { stableSince: opts.stableSince } : {}),
    },
  };
}

const QUICKSTART_BODY = lexicalDoc([
  paragraph(
    "A NexPress plugin is a single function that returns a manifest. The framework loads it during boot, validates its declared shape, and wires the hooks and routes into the request pipeline. There's no plugin loader to learn — if you can write a TypeScript module, you can write a plugin.",
  ),
  paragraph(
    "Prerequisites: a running NexPress site (see Install & bootstrap) and Node 20+. The plugin lives inside your app — no separate workspace required to start.",
  ),
  heading("h2", "Scaffold the plugin"),
  paragraph(
    "The CLI ships a scaffold command that drops a typed plugin module into plugins/. The generated file imports definePlugin from the SDK and exports a single function.",
  ),
  codeBlock("pnpm nexpress plugin:new hello-world", "bash"),
  paragraph(
    "The generated module is ~20 lines, ready to run. Open it in your editor before continuing.",
  ),
  codeBlock(
    [
      'import { definePlugin } from "@nexpress/plugin-sdk";',
      "",
      "export default definePlugin({",
      "  manifest: {",
      '    id: "hello-world",',
      '    name: "Hello, world",',
      '    version: "0.1.0",',
      '    nexpress: { minVersion: "0.1.0" },',
      "  },",
      "  hooks: {",
      "    onDocumentPublished: async ({ doc, collection }) => {",
      '      if (collection !== "posts") return;',
      "      console.log(`Published: ${doc.title}`);",
      "    },",
      "  },",
      "});",
    ].join("\n"),
    "typescript",
  ),
  heading("h2", "Register it with your site"),
  paragraph(
    "NexPress loads plugins from nexpress.config.ts. Import your module and add it to the plugins array — order matters, hooks run in the order they're registered.",
  ),
  codeBlock(
    [
      'import { defineConfig } from "@nexpress/core";',
      'import helloWorld from "./plugins/hello-world";',
      "",
      "export default defineConfig({",
      "  plugins: [helloWorld()],",
      "});",
    ].join("\n"),
    "typescript",
  ),
  paragraph(
    "Hot reload: the dev server picks up new plugin files without a restart. Config changes do require one — that's a Next.js constraint, not ours.",
  ),
  heading("h2", "Lifecycle hooks at a glance"),
  paragraph(
    "Hooks are typed callbacks NexPress invokes at well-known points. Each receives a context object scoped to that event. The most commonly used hooks:",
  ),
  bulletList([
    "onBoot — after config load, before request handling. Context: { config, env }.",
    "onDocumentPublished (async) — a document's status transitions to published. Context: { doc, collection, by }.",
    "onDocumentUnpublished — status leaves published. Context: { doc, collection, by }.",
    "onRequest — every request, after routing, before render. Context: { req, route, user }.",
    "onSchedule — cron-like; declare cadence in the manifest. Context: { now, schedule }.",
  ]),
  paragraph(
    "The full list — including admin-surface and search hooks — lives in the lifecycle hooks reference.",
  ),
  heading("h2", "Run and verify"),
  bulletList([
    "Start the dev server. pnpm dev from the repo root. Codegen runs alongside Next's watcher, so plugin types are picked up as you save.",
    "Publish a post from the admin. Open /admin, create a draft in the posts collection, and click Publish. The hook fires inside the same request.",
    "Check the dev server log. You should see Published: <title> in the terminal. That's it — the plugin is live.",
  ]),
  paragraph(
    "Hooks block the response: onDocumentPublished runs inside the publish request. Long-running work — sending emails, regenerating sitemaps — belongs in onSchedule or a queued job. Otherwise the editor will wait on it.",
  ),
  heading("h2", "Next steps"),
  paragraph(
    "You have a plugin that runs. Two natural directions from here:",
  ),
  bulletList([
    "Add a route. Declare a routes entry in the manifest to expose a public URL — for webhooks, OAuth callbacks, or a custom admin screen.",
    "Add collections. Plugins can declare their own collections, which the admin surfaces alongside the operator's. See the Plugin manifest reference.",
  ]),
]);

const SEED_PAGES: NpThemeSeedPage[] = [
  {
    title: "Documentation",
    slug: "/",
    seoDescription:
      "Install NexPress, learn the core concepts, write plugins, and look up the API.",
    blocks: [],
    data: { template: "front" },
  },
];

const SEED_DOCS: NpThemeSeedPost[] = [
  stubDoc({
    title: "Get started",
    order: 0,
    lede: "Install NexPress, scaffold a site, and ship a first deploy.",
  }),
  stubDoc({
    title: "Introduction",
    parentSlug: "get-started",
    order: 0,
    lede: "What NexPress is, what it isn't, and who it's for.",
    stableSince: "Stable since 0.1",
  }),
  stubDoc({ title: "Install & bootstrap", parentSlug: "get-started", order: 1, stableSince: "Stable since 0.1" }),
  stubDoc({ title: "Project structure", parentSlug: "get-started", order: 2 }),
  stubDoc({ title: "Configuration", parentSlug: "get-started", order: 3 }),
  stubDoc({ title: "Deployment", parentSlug: "get-started", order: 4 }),

  stubDoc({
    title: "Core concepts",
    order: 1,
    lede: "The model behind collections, themes, plugins, and blocks.",
  }),
  stubDoc({ title: "Collections", parentSlug: "core-concepts", order: 0, stableSince: "Stable since 0.1" }),
  stubDoc({ title: "Pages & routing", parentSlug: "core-concepts", order: 1 }),
  stubDoc({ title: "Themes", parentSlug: "core-concepts", order: 2 }),
  stubDoc({ title: "Blocks", parentSlug: "core-concepts", order: 3 }),
  stubDoc({ title: "Hooks & access", parentSlug: "core-concepts", order: 4 }),
  stubDoc({ title: "Internationalization", parentSlug: "core-concepts", order: 5 }),

  stubDoc({
    title: "Plugins",
    order: 2,
    lede: "Extend NexPress with hooks, routes, blocks, and scheduled jobs.",
  }),
  stubDoc({ title: "Plugin overview", parentSlug: "plugins", order: 0 }),
  {
    title: "Author quickstart",
    excerpt:
      "From \"I want to add behavior to NexPress\" to a running plugin in about ten minutes. Walks through the manifest, a lifecycle hook, and shipping the result to your own site.",
    content: QUICKSTART_BODY,
    publishedAt: DOCS_NOW,
    kind: "doc",
    parentSlug: "plugins",
    order: 1,
    data: {
      badge: "NEW",
      lede:
        "From \"I want to add behavior to NexPress\" to a running plugin in about ten minutes. Walks through the manifest, a lifecycle hook, and shipping the result to your own site.",
      stableSince: "Stable since 0.1",
    },
  },
  stubDoc({ title: "Manifest reference", parentSlug: "plugins", order: 2 }),
  stubDoc({ title: "Lifecycle hooks", parentSlug: "plugins", order: 3 }),
  stubDoc({ title: "Publishing", parentSlug: "plugins", order: 4 }),

  stubDoc({
    title: "Reference",
    order: 3,
    lede: "API surface — CLI, define* helpers, server functions.",
  }),
  stubDoc({ title: "CLI", parentSlug: "reference", order: 0 }),
  stubDoc({ title: "defineCollection", parentSlug: "reference", order: 1, badge: "API" }),
  stubDoc({ title: "defineTheme", parentSlug: "reference", order: 2 }),
  stubDoc({ title: "definePlugin", parentSlug: "reference", order: 3 }),
  stubDoc({ title: "Server functions", parentSlug: "reference", order: 4, badge: "BETA" }),
];

/**
 * `@nexpress/theme-docs` — documentation theme for NexPress.
 *
 * Three-column reference-docs layout: sticky search-first header
 * (brand mark + version pill + ⌘K search + primary nav + GitHub
 * link), hierarchical sidebar with bullet-eyebrow groups + nested
 * links + status badges, centered article column with breadcrumbs
 * + lede + meta pills + Lexical body, on-this-page TOC on the
 * right. Sidebar collapses out at the tablet breakpoint; TOC
 * collapses out below 1100px.
 *
 * Pairs with `posts` rows of `kind: "doc"`
 * (universal-content-model #748 — docs are posts with a kind
 * discriminator, not a separate collection). The doc-specific
 * fields (`lede`, `stableSince`) are contributed via
 * `requires.collections.posts.fields` and merged onto the
 * built-in posts collection at config-resolution time.
 *
 * `seedContent.navigation` ships the primary header / footer
 * links. Doc rows are operator-authored; themes that want to
 * seed kind="doc" content use `seedContent.posts` with the
 * `kind` field set on each entry (see U.1 #749).
 */
export const docsTheme = defineTheme({
  manifest: {
    id: "docs",
    name: "Docs",
    version: "0.2.0",
    description:
      "Documentation theme — three-column layout with hierarchical sidebar, breadcrumbs + lede + meta pills on the article column, on-this-page TOC on the right rail. Blue accent on a near-white surface; pairs with a `docs` collection.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
    requires: {
      collections: {
        posts: {
          // Universal-content-model #748 — docs are posts with
          // `kind: "doc"`. The framework's built-in `posts`
          // collection already supplies `title` / `body` /
          // `parent` (rel→posts) / `order`. Docs theme adds the
          // doc-specific meta pills and contributes the kind
          // option + kinds metadata block for admin / URL
          // routing.
          fields: {
            kind: {
              type: "select",
              options: [{ label: "Doc", value: "doc" }],
            },
            // Short opening paragraph rendered as a lede under
            // the h1. Optional — the article still renders
            // without it. Lives in a "Docs" sidebar group with
            // `stableSince`; the group + fields hide entirely
            // when the active kind isn't `"doc"`.
            lede: {
              type: "textarea",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Docs",
                condition: { when: "kind", equals: "doc" },
              },
            },
            // Meta-pill slot — advisory hint the doc-page
            // template surfaces in the strap row. Note: portfolio
            // theme also contributes a `badge: text` field on
            // posts; the merge-requirements union picks the first
            // declarer. Docs reads `doc.badge` regardless of which
            // theme declared the column.
            stableSince: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Docs",
                condition: { when: "kind", equals: "doc" },
              },
            },
          },
          groupMeta: {
            Docs: {
              icon: "BookOpen",
              description: "Doc-specific meta — lede and API stability hint.",
            },
          },
          kinds: {
            doc: {
              label: "Doc",
              labelPlural: "Documentation",
              icon: "BookOpen",
              // Public-site URL pattern. The catch-all router
              // matches `/docs/<slug>` and queries posts with
              // `where: { kind: "doc", slug }`.
              urlPattern: "/docs/:slug",
              // Hint to admin: show parent + order controls and
              // render the list as a tree, not a flat table.
              hierarchical: true,
            },
          },
        },
      },
    },
    settingsSchema: docsSettingsSchema,
  },
  impl: {
    shell: DocsShell,
    slots: {
      header: DocsHeader,
      sidebar: DocsSidebar,
    },
    css: docsCss,
    tokens: {
      colors: {
        primary: "#2563eb",
        primaryForeground: "#ffffff",
        background: "#fbfcfe",
        foreground: "#0c1320",
        muted: "#f1f4f9",
        mutedForeground: "#5b6478",
        border: "#e2e7ef",
        card: "#ffffff",
      },
      typography: {
        fontHeading:
          '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontBody:
          '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontMono:
          '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      },
      shape: {
        radiusSm: "5px",
        radiusMd: "9px",
        radiusLg: "10px",
      },
    },
    seedContent: {
      navigation: SEED_NAV,
      pages: SEED_PAGES,
      posts: SEED_DOCS,
    },
    templates: {
      pages: {
        front: {
          label: "Front page",
          description:
            "Docs landing — hero + 2x2 group cards walking the kind=\"doc\" tree + recently-updated row. The seeded home page (slug \"/\") ships with this template.",
          component: PageFrontTemplate,
        },
      },
      // Universal-content-model #748 — docs are posts with
      // `kind: "doc"`. The template key matches the kind value so
      // the per-kind template lookup picks this up automatically.
      // Article-kind posts continue rendering through the
      // framework's inline article markup unless the operator
      // declares a `templates.posts.default` of their own.
      posts: {
        doc: {
          label: "Doc page",
          description:
            "Three-column reference layout — breadcrumbs + lede + meta + Lexical body + feedback + prev/next, with the docs sidebar slotted on the left and the on-page TOC on the right.",
          component: DocPageTemplate,
        },
      },
    },
    routes: [
      // F.2 — docs theme's scoped search route. Lives at
      // `/docs/search` rather than `/search` (#609): the host's
      // reference app has an app-explicit `/search` page route
      // that takes precedence over theme routes per the locked
      // dispatch order (app file > page > theme > plugin). The
      // theme can't override the universal search page, so it
      // scopes its own search to a `/docs/*` namespace and the
      // operator gets both routes: framework `/search` + docs
      // theme `/docs/search`.
      //
      // Order matters: search comes first so `/docs/search` is
      // matched as a literal rather than `{ slug: "search" }`
      // by the parametric detail route below (dispatcher is
      // first-match-wins).
      { pattern: "/docs/search", component: DocsSearch },
      // Doc detail dispatch. The sidebar + template emit
      // `/docs/<slug>` links; the route component looks up the
      // doc-kind post by slug and renders through DocPageTemplate.
      // Universal-content-model #748 — docs are posts with
      // `kind="doc"`; the lookup filters on kind, not collection.
      { pattern: "/docs/:slug", component: DocsDetailRoute },
    ],
    navLocations: {
      header: {
        label: "Primary header nav",
        description: "Inline links beside the masthead search box.",
        maxItems: 5,
      },
    },
    notFound: DocsNotFound,
    // M.* adoption (2026-05-11). Docs gains purpose-built member
    // chrome: drops the docs sidebar (hierarchical doc nav is
    // useless on auth forms), keeps the masthead, narrows the
    // content column. Without this, the fallback chain would
    // walk back to `impl.shell` (the 3-column grid) and the
    // sidebar slot would surface alongside an auth form.
    // - `shell`: DocsMembersShell (header + narrow column, no
    //   sidebar).
    // - `notFound`: DocsMembersNotFound (stale-auth-link framing
    //   with /members/login CTA, monospace accent matching the
    //   theme).
    // - `error`: forward-compat type marker; the actual render
    //   goes through `./components/members-error`'s client
    //   subpath, lazy-imported by
    //   `apps/web/src/app/(member)/error.tsx`'s registry
    //   (F.7.1 delegation — Next mandates `error.tsx` is "use
    //   client").
    members: {
      shell: DocsMembersShell,
      notFound: DocsMembersNotFound,
    },
    blocks: docsBlocks,
  },
});

export {
  CopyButton,
  DocsHeader,
  DocsShell,
  DocsSidebar,
  DocsNotFound,
  DocsMembersShell,
  DocsMembersNotFound,
  DocsSearch,
  DocPageTemplate,
};
export { docsBlocks } from "./blocks/index.js";
export { docsCss };
export { docsSettingsSchema, type DocsSettings } from "./settings.js";
