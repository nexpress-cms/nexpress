import { defineTheme } from "@nexpress/theme";

import { portfolioBlocks } from "./blocks.js";
import { PortfolioMobileNav } from "./components/mobile-nav.js";
import {
  PortfolioProjectCard,
  type PortfolioProjectDoc,
} from "./components/project-card.js";
import { PortfolioFooter } from "./footer.js";
import { PortfolioHeader } from "./header.js";
import { PortfolioMembersNotFound } from "./members-not-found.js";
import { PortfolioMembersShell } from "./members-shell.js";
import { PortfolioNotFound } from "./not-found.js";
import { PortfolioProjectDetailRoute } from "./routes/project-detail.js";
import { portfolioSettingsSchema } from "./settings.js";
import { PortfolioShell } from "./shell.js";
import { portfolioCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageGalleryTemplate } from "./templates/page-gallery.js";
import { ProjectDetailTemplate } from "./templates/project-detail.js";
import { ProjectIndexTemplate } from "./templates/project-index.js";

/**
 * `@nexpress/theme-portfolio` — image-led dark theme.
 *
 * Designed for designers / photographers / studios. Pages get a
 * centered text column or a gallery grid; "posts" are treated as
 * project case studies with a hero image, role / year / client
 * meta strip, and the standard block body underneath. The index
 * template renders the project archive as a 2- / 3-column grid
 * of square cards with hover-fade captions.
 *
 * Flips the surface palette: dark `--np-color-background` is
 * driven entirely from the theme's CSS (no admin override
 * required). Sites that want a light variant fork or override
 * tokens via the admin.
 */
export const portfolioTheme = defineTheme({
  manifest: {
    id: "portfolio",
    name: "Portfolio",
    version: "0.1.0",
    description:
      "Image-led dark theme for studios and designers. Hero-led project detail template, archive grid, gallery and centered page templates.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
    // Phase F.1 — declared data-shape requirements. The
    // framework auto-merges these at `defineConfig` time;
    // `pnpm nexpress theme add @nexpress/theme-portfolio` + a
    // `pnpm db:generate && pnpm db:migrate` is all that's needed.
    requires: {
      collections: {
        posts: {
          fields: {
            heroImage: { type: "upload", relationTo: "media" },
            client: { type: "text", hard: false },
            year: { type: "number", hard: false },
            role: { type: "text", hard: false },
          },
        },
      },
    },
    // Phase F.3 — operator-tunable settings. Stresses the
    // auto-form on deep schema (10 fields, range-constrained
    // numbers, color regex, nested array of objects).
    settingsSchema: portfolioSettingsSchema,
  },
  impl: {
    shell: PortfolioShell,
    slots: {
      header: PortfolioHeader,
      footer: PortfolioFooter,
    },
    // Dark palette is now token-driven — previously the dark
    // surface was hardcoded as `#0b0b0c` in `styles.ts`, so admin
    // overrides couldn't reach it. Tokens here flip background +
    // foreground for the whole shell; `styles.ts` reads them via
    // `var(--np-color-*)` so a single token change reflows the
    // entire theme. Light variant: override these in the admin's
    // theme settings tab — no fork required.
    tokens: {
      colors: {
        primary: "oklch(0.985 0.001 106)",
        primaryForeground: "oklch(0.145 0.005 285)",
        background: "oklch(0.16 0.005 285)",
        foreground: "oklch(0.91 0.003 286)",
        muted: "oklch(0.22 0.006 286)",
        mutedForeground: "oklch(0.66 0.005 286)",
        border: "oklch(0.28 0.008 286)",
        card: "oklch(0.20 0.006 286)",
        cardForeground: "oklch(0.91 0.003 286)",
        accent: "oklch(0.32 0.012 286)",
        accentForeground: "oklch(0.985 0.001 106)",
      },
      typography: {
        fontHeading:
          '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
        fontBody:
          '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
      },
    },
    css: portfolioCss,
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered text column on dark background.",
          component: PageDefaultTemplate,
        },
        gallery: {
          label: "Gallery",
          description:
            "Two-column block grid for image-led project pages and case studies.",
          component: PageGalleryTemplate,
        },
      },
      posts: {
        detail: {
          label: "Project detail",
          description:
            "Hero image, centered title and excerpt, role / year / client meta strip, then the body blocks.",
          component: ProjectDetailTemplate,
        },
        index: {
          label: "Project index",
          description:
            "Archive grid of square project cards with hover-fade captions.",
          component: ProjectIndexTemplate,
        },
      },
    },
    // F.2 — theme routes. `/work/:slug` dispatches a posts row
    // through `ProjectDetailTemplate` (#613). Without this, the
    // `/work/<slug>` URLs `PortfolioProjectCard` emits would
    // 404 — the framework catch-all only resolves `pages` rows
    // by URL, so case studies (`posts` collection) need a theme
    // route to be reachable.
    routes: [
      { pattern: "/work/:slug", component: PortfolioProjectDetailRoute },
    ],
    // Phase F.4 — portfolio-shipped block types.
    blocks: portfolioBlocks,
    // Phase F.6 — declared nav locations.
    navLocations: {
      primary: {
        label: "Primary nav",
        description: "Top nav links (Work / About / Contact).",
        maxItems: 5,
      },
      footerSocial: {
        label: "Footer social links",
        description: "Social profile links shown in the footer.",
        maxItems: 6,
      },
    },
    // Phase F.7 — error chrome.
    notFound: PortfolioNotFound,
    // M.* adoption (2026-05-11). Portfolio gains purpose-built
    // member chrome: narrow column wrapping the auth forms,
    // tonally matched 404 + error pages. The fallback chain in
    // `<ShellWrap surface="member">` would have walked back to
    // `impl.shell` + the public slots, which would have stretched
    // a 320-wide login form across the image-led wide layout.
    // - `shell`: PortfolioMembersShell (narrow column, same
    //   header/footer chrome so a masthead bump cascades).
    // - `notFound`: PortfolioMembersNotFound (stale-auth-link
    //   framing with /members/login CTA).
    // - `error`: forward-compat type marker; the actual render
    //   goes through `./components/members-error`'s client
    //   subpath, lazy-imported by
    //   `apps/web/src/app/(member)/error.tsx`'s registry
    //   (F.7.1 delegation — Next mandates `error.tsx` is "use
    //   client").
    members: {
      shell: PortfolioMembersShell,
      notFound: PortfolioMembersNotFound,
    },
  },
});

export {
  PortfolioHeader,
  PortfolioFooter,
  PortfolioShell,
  PortfolioMembersShell,
  PortfolioMembersNotFound,
  PortfolioProjectCard,
  PortfolioMobileNav,
  PortfolioNotFound,
};
export { portfolioCss };
export type { PortfolioProjectDoc };
export {
  portfolioSettingsSchema,
  type PortfolioSettings,
} from "./settings.js";
