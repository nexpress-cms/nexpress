import type { NpPatternDefinition } from "@nexpress/blocks";

/**
 * Phase F.9 — magazine-shipped patterns.
 *
 * Source is auto-stamped to `theme:magazine` by bootstrap. Each
 * pattern's blocks deep-clone with fresh ids on insert (the
 * page-builder's INSERT_PATTERN action handles regeneration);
 * the literal ids below are templates only.
 *
 * Two representative patterns:
 *   - homepage-feature-grid: hero + 3-column section strip
 *   - editorial-cta: section strip + CTA — used at the bottom
 *     of long-form posts to surface related sections
 *
 * The picker UI (categorized + thumbnailed) is F.5.1 follow-up;
 * today these surface in Cmd-K's "Pattern" group.
 */

export const magazinePatterns: NpPatternDefinition[] = [
  {
    id: "magazine.homepage-feature-grid",
    label: "Homepage: feature + grid",
    description:
      "Lead hero feature followed by a three-column section strip — the canonical magazine homepage opener.",
    category: "homepage",
    blocks: [
      {
        id: "tpl-hero",
        type: "magazine.hero-feature",
        props: {
          title: "Today's lead story",
          subtitle: "Replace this subdeck with the lead piece's summary or rotating editor's pick.",
          ctaText: "Read more",
          ctaUrl: "#",
        },
      },
      {
        id: "tpl-strip",
        type: "magazine.section-strip",
        props: {
          heading: "More from the magazine",
          items: [
            { title: "Section piece 1", url: "#", category: "Politics" },
            { title: "Section piece 2", url: "#", category: "Culture" },
            { title: "Section piece 3", url: "#", category: "Tech" },
          ],
        },
      },
    ],
  },
  {
    id: "magazine.editorial-cta",
    label: "Editorial CTA",
    description:
      "Section strip + call-to-action block. Drop at the bottom of a long-form post to surface related coverage.",
    category: "section",
    blocks: [
      {
        id: "tpl-strip-related",
        type: "magazine.section-strip",
        props: {
          heading: "Related coverage",
          items: [{ title: "Related piece", url: "#", category: "Section" }],
        },
      },
      {
        id: "tpl-cta",
        type: "cta",
        props: {
          heading: "Stay subscribed",
          description: "Get the weekly digest in your inbox.",
          buttonText: "Subscribe",
          buttonUrl: "/subscribe",
        },
      },
    ],
  },
];
