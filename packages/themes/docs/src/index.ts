import { defineTheme } from "@nexpress/theme";

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
 * Pairs with a `docs` collection (auto-created via
 * `requires.collections.docs.createIfAbsent` on the bundled-themes
 * prebake path). Operator-declared fields with the same names win
 * on collision so a site that ships its own `docs` schema is
 * never overwritten.
 *
 * `seedContent.navigation` ships the primary header / footer
 * links; the `docs` collection rows are operator-authored.
 * Seeding actual doc rows requires the seedContent contract to
 * grow a `documents?: Record<slug, ...>` slot, which is queued as
 * a follow-up — without it, themes that target non-page / non-post
 * collections (docs, projects, products) can only seed nav.
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
            // without it.
            lede: { type: "textarea", hard: false },
            // Meta-pill slot — advisory hint the doc-page
            // template surfaces in the strap row. Note: portfolio
            // theme also contributes a `badge: text` field on
            // posts; the merge-requirements union picks the first
            // declarer. Docs reads `doc.badge` regardless of which
            // theme declared the column.
            stableSince: { type: "text", hard: false },
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
    },
    templates: {
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
      primary: {
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
  },
});

export {
  DocsHeader,
  DocsShell,
  DocsSidebar,
  DocsNotFound,
  DocsMembersShell,
  DocsMembersNotFound,
  DocsSearch,
  DocPageTemplate,
};
export { docsCss };
export { docsSettingsSchema, type DocsSettings } from "./settings.js";
