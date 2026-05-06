import { defineTheme } from "@nexpress/theme";

import { MagazineFooter } from "./footer.js";
import { MagazineHeader } from "./header.js";
import { MagazineShell } from "./shell.js";
import { magazineCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageCoverTemplate } from "./templates/page-cover.js";
import { PostFeatureTemplate } from "./templates/post-feature.js";
import { PostListTemplate } from "./templates/post-list.js";

/**
 * `@nexpress/theme-magazine` — production-grade editorial layout.
 *
 * Distinguishing features:
 *   - Display-serif masthead with dateline and rule, mobile drawer.
 *   - Three-column footer (Subscribe / Sections / Colophon) with a
 *     newsletter form and section nav, collapses to a single column.
 *   - Page templates: default centered column, full-bleed cover.
 *   - Post templates: feature article (drop cap, byline rule), index
 *     list with lead piece + 2-up secondary row + archive grid.
 *   - All CSS scoped under `.np-magazine-*` so theme swaps never
 *     leave residue.
 */
export const magazineTheme = defineTheme({
  manifest: {
    id: "magazine",
    name: "Magazine",
    version: "0.1.0",
    description:
      "Editorial magazine layout. Display-serif masthead with mobile drawer, three-column footer with newsletter, feature-article post template with drop cap, magazine-style index with lead piece + archive grid.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: MagazineShell,
    slots: {
      header: MagazineHeader,
      footer: MagazineFooter,
    },
    // Warm cream + serif palette so the magazine theme feels
    // distinct from the indigo+gray default. Editorial sites
    // historically lean on warm off-whites for long-read comfort
    // and a deep brown rather than pure black for better contrast
    // against the cream. Primary is a terracotta accent — used for
    // links, buttons, and the byline rule. Operators can still
    // override any token via the admin theme settings tab.
    tokens: {
      colors: {
        primary: "oklch(0.595 0.155 32)",
        primaryForeground: "oklch(0.985 0.005 80)",
        background: "oklch(0.975 0.012 85)",
        foreground: "oklch(0.245 0.025 60)",
        muted: "oklch(0.945 0.018 85)",
        mutedForeground: "oklch(0.475 0.025 60)",
        border: "oklch(0.875 0.022 80)",
        card: "oklch(0.99 0.008 85)",
        cardForeground: "oklch(0.245 0.025 60)",
        accent: "oklch(0.92 0.04 80)",
        accentForeground: "oklch(0.245 0.025 60)",
      },
      typography: {
        // Match the font stacks magazine's CSS already uses as
        // var() fallbacks — Fraunces is the display serif for
        // mastheads / headlines, Source Serif 4 carries the body
        // text. Operators who don't load these webfonts fall
        // through to Georgia, the universal serif.
        fontHeading: '"Fraunces", Georgia, "Times New Roman", serif',
        fontBody: '"Source Serif 4", Georgia, "Times New Roman", serif',
      },
    },
    css: magazineCss,
    // Phase 12.5 — example UI-string bundle. Theme components
    // call `t("magazine.tagline", locale)` from server-side
    // render so the masthead tagline matches the current
    // request's locale. Sites that want different copy
    // override these keys in their app-level bundle (last
    // writer wins on key collision).
    i18n: {
      en: {
        "magazine.tagline": "Stories, essays, and reports",
      },
      ko: {
        "magazine.tagline": "이야기, 에세이, 그리고 리포트",
      },
    },
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered article column with magazine type ramp.",
          component: PageDefaultTemplate,
        },
        cover: {
          label: "Cover",
          description:
            "Full-bleed hero image at the top with the page title overlaid; body content flows below in the standard column.",
          component: PageCoverTemplate,
        },
      },
      posts: {
        feature: {
          label: "Feature article",
          description:
            "Large headline, byline rule, dropcap on the first paragraph. Best for long-form posts.",
          component: PostFeatureTemplate,
        },
        list: {
          label: "Index",
          description:
            "Magazine-style index — lead piece on top, two-up secondary row, archive grid below.",
          component: PostListTemplate,
        },
      },
    },
  },
});

export { MagazineHeader, MagazineFooter, MagazineShell };
export { magazineCss };
export { MagazineMobileNav } from "./components/mobile-nav.js";
export { MagazineNewsletterForm } from "./components/newsletter-form.js";
export {
  MagazinePostCard,
  type MagazinePostCardDoc,
  type MagazinePostCardProps,
} from "./components/post-card.js";
export { PostListTemplate as MagazinePostListTemplate } from "./templates/post-list.js";
