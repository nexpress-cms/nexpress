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

/**
 * `@nexpress/theme-docs` — documentation theme for NexPress.
 *
 * Stresses F.2 (search route + sidebar slot consuming
 * hierarchy) and F.3 (settings: version, githubRepo,
 * sidebarHeading, TOC toggle). Different contract axis from
 * F.9-A's magazine — sidebar-driven layout, hierarchical doc
 * collection, prev/next navigation.
 */
export const docsTheme = defineTheme({
  manifest: {
    id: "docs",
    name: "Docs",
    version: "0.1.0",
    description:
      "Documentation theme — hierarchical sidebar, prev/next nav, search masthead. Pairs with a `docs` collection that has parent/order fields.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
    requires: {
      collections: {
        docs: {
          createIfAbsent: true,
          fields: {
            title: { type: "text", required: true },
            body: { type: "richText" },
            parent: {
              type: "relationship",
              relationTo: "docs",
              hard: false,
            },
            order: { type: "number" },
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
      // Docs lean cool/neutral with a sharp accent — distinct
      // from magazine's warm cream so a side-by-side preview
      // makes the swap obvious.
      colors: {
        primary: "oklch(0.55 0.18 260)",
        primaryForeground: "oklch(0.985 0.005 260)",
        background: "oklch(0.99 0.005 260)",
        foreground: "oklch(0.18 0.025 260)",
        muted: "oklch(0.95 0.012 260)",
        mutedForeground: "oklch(0.5 0.025 260)",
        border: "oklch(0.9 0.012 260)",
        card: "oklch(0.985 0.008 260)",
        cardForeground: "oklch(0.18 0.025 260)",
        accent: "oklch(0.92 0.05 260)",
        accentForeground: "oklch(0.18 0.025 260)",
      },
    },
    templates: {
      docs: {
        default: {
          label: "Doc page",
          description:
            "Hierarchical sidebar + body + prev/next nav. Optional 'Edit on GitHub' link when settings.githubRepo is set.",
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
      // Doc detail dispatch (#614). The sidebar + template emit
      // `/docs/<slug>` links; without this route those 404 in
      // the reference app — the catch-all only resolves `pages`
      // rows, not arbitrary `docs` collection rows. The
      // component looks up the docs row by slug and renders
      // through `templates.docs.default` (DocPageTemplate).
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
