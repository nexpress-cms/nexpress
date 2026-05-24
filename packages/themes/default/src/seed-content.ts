import type { NpThemeSeedPage, NpThemeSeedTerm } from "@nexpress/theme";

/**
 * Default theme demo pages.
 *
 * The design handoff treats `theme-default` as Equilibrium: a
 * production-blog baseline, not a NexPress product marketing site.
 * The seeded home page therefore dispatches to the theme's front
 * template, which fetches posts and renders the same index surface
 * as `/blog`. The About page is template-owned too; its blocks are
 * intentionally empty because the layout/copy live in the theme.
 */
export const defaultPages: NpThemeSeedPage[] = [
  {
    title: "Writing",
    slug: "/",
    seoDescription:
      "Long-form essays and shorter notes from Equilibrium on distributed systems, databases, type systems, queues, and the trade-offs that show up when you ship.",
    blocks: [],
    template: "front",
  },
  {
    title: "About Equilibrium",
    slug: "about",
    seoDescription:
      "Equilibrium is a working journal by Anya Hartwell and a rotating group of engineers writing about production systems.",
    blocks: [],
    template: "about",
  },
];

/**
 * The default theme intentionally ships no categories. The seeded
 * tags cover the topic axis, while the front-page category strip is
 * part of the publication design and rendered by the list template.
 */
export const defaultCategories: NpThemeSeedTerm[] = [];
