import { defineTheme } from "@nexpress/theme";

import { PortfolioMobileNav } from "./components/mobile-nav.js";
import {
  PortfolioProjectCard,
  type PortfolioProjectDoc,
} from "./components/project-card.js";
import { PortfolioFooter } from "./footer.js";
import { PortfolioHeader } from "./header.js";
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
  },
  impl: {
    shell: PortfolioShell,
    slots: {
      header: PortfolioHeader,
      footer: PortfolioFooter,
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
  },
});

export {
  PortfolioHeader,
  PortfolioFooter,
  PortfolioShell,
  PortfolioProjectCard,
  PortfolioMobileNav,
};
export { portfolioCss };
export type { PortfolioProjectDoc };
