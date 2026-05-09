import { defineTheme } from "@nexpress/theme";

import { DocsHeader } from "./header.js";
import { DocsNotFound } from "./not-found.js";
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
      // F.2 — `/search` is a flat route (not collection-archive
      // shaped). Theme registers it explicitly. The component
      // reads `?q=` and runs `searchCollections`.
      { pattern: "/search", component: DocsSearch },
    ],
    navLocations: {
      primary: {
        label: "Primary header nav",
        description: "Inline links beside the masthead search box.",
        maxItems: 5,
      },
    },
    notFound: DocsNotFound,
  },
});

export {
  DocsHeader,
  DocsShell,
  DocsSidebar,
  DocsNotFound,
  DocsSearch,
  DocPageTemplate,
};
export { docsCss };
export { docsSettingsSchema, type DocsSettings } from "./settings.js";
