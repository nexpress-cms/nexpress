import { defineTheme } from "@nexpress/theme";

import { DefaultFooter } from "./footer.js";
import { DefaultHeader } from "./header.js";
import { DefaultShell } from "./shell.js";
import { defaultThemeCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageLandingTemplate } from "./templates/page-landing.js";
import { PageSidebarTemplate } from "./templates/page-sidebar.js";
import { PageWideTemplate } from "./templates/page-wide.js";
import { PostDefaultTemplate } from "./templates/post-default.js";
import { PostListTemplate } from "./templates/post-list.js";

/**
 * `@nexpress/theme-default` — v0.1-era baseline theme.
 *
 * **Status (v0.2):** kept for back-compat. The v0.2 reference
 * themes are `theme-magazine` / `theme-docs` / `theme-portfolio`
 * — they exercise the new contract surfaces (manifest.requires,
 * settingsSchema, blocks, patterns, navLocations, archives,
 * routes, seo). New sites should start from one of those.
 *
 * `theme-default` doesn't declare v0.2 surfaces: operators using
 * it skip the no-code-customization workflow (no admin auto-
 * form for theme settings, no `requires`-driven data-shape
 * auto-merge, no theme-shipped blocks/patterns). It remains a
 * valid `defineTheme` caller — production sites pinned to v0.1
 * keep working — but consider migrating to a v0.2 reference if
 * you want operator-tunable settings.
 *
 * Production-grade defaults: sticky header with a mobile drawer,
 * a four-column footer (brand / sitemap / resources / newsletter)
 * with optional social icons, post list / detail templates that
 * surface excerpt / cover / tags / reading time, and three page
 * templates (default centered column, edge-to-edge wide, marketing
 * landing, doc-style sidebar). All CSS is theme-owned so the
 * framework drops it as a single `<style data-np-theme="default">`
 * tag at SSR time — no extra round-trip.
 *
 * Sites brand by overriding the design tokens (`--np-color-*` etc).
 */
export const defaultTheme = defineTheme({
  manifest: {
    id: "default",
    name: "NexPress Default",
    version: "0.1.0",
    description:
      "Production-grade baseline theme. Sticky header with mobile drawer, four-column footer, blog list / detail templates, landing + sidebar page variants, dark-mode parity, social + newsletter slots in the footer.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: DefaultShell,
    slots: {
      header: DefaultHeader,
      footer: DefaultFooter,
    },
    css: defaultThemeCss,
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered content container with the standard reading width.",
          component: PageDefaultTemplate,
        },
        wide: {
          label: "Wide",
          description:
            "Edge-to-edge layout with no max-width. Best for galleries and immersive media.",
          component: PageWideTemplate,
        },
        landing: {
          label: "Landing",
          description:
            "Marketing-style template — full-bleed hero from the first block, then sections render edge-to-edge so Hero / FeatureGrid / CTA blocks span the viewport.",
          component: PageLandingTemplate,
        },
        sidebar: {
          label: "Sidebar",
          description:
            "Two-column layout with a sticky right sidebar. Suited to docs / knowledge bases. Sites can populate the aside with a `sidebar` field on their pages collection.",
          component: PageSidebarTemplate,
        },
      },
      posts: {
        default: {
          label: "Article",
          description:
            "Centered article column with cover image, tags, byline, reading time, and Lexical body.",
          component: PostDefaultTemplate,
        },
        list: {
          label: "List view",
          description:
            "Blog-index template: one feature card on top, then a 3-column grid (collapses on phones). Suitable for any collection that ships PostCard-shaped docs.",
          component: PostListTemplate,
        },
      },
    },
  },
});

export { DefaultShell } from "./shell.js";
export { DefaultHeader } from "./header.js";
export { DefaultFooter } from "./footer.js";
export { MemberStatusWidget } from "./components/member-status-widget.js";
export { MobileNav } from "./components/mobile-nav.js";
export { SocialLinks } from "./components/social-links.js";
export { NewsletterForm } from "./components/newsletter-form.js";
export { PostCard, type PostCardDoc, type PostCardProps } from "./components/post-card.js";
export { Pagination, type PaginationProps } from "./components/pagination.js";
export { PageLandingTemplate } from "./templates/page-landing.js";
export { PageSidebarTemplate } from "./templates/page-sidebar.js";
export { PostDefaultTemplate } from "./templates/post-default.js";
export { PostListTemplate } from "./templates/post-list.js";
export { defaultThemeCss } from "./styles.js";
