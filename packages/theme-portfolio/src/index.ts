import { defineTheme } from "@nexpress/theme";

import { PortfolioFooter } from "./footer.js";
import { PortfolioHeader } from "./header.js";
import { PortfolioShell } from "./shell.js";
import { portfolioCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageGalleryTemplate } from "./templates/page-gallery.js";

/**
 * `@nexpress/theme-portfolio` — image-led dark theme.
 *
 * Designed for designers / photographers / studios. The default
 * page template is centered like the magazine but with tighter
 * line-height and sans-serif type. The `gallery` template
 * arranges block content in a grid so an image-heavy page
 * (think project case study) stays visually dense.
 *
 * Demonstrates a theme that flips the surface palette: dark
 * `--nx-color-background` driven entirely from the theme's CSS
 * (no admin token override needed). Sites that want a light
 * variant of this theme would either fork or override tokens
 * via the admin.
 */
export const portfolioTheme = defineTheme({
  manifest: {
    id: "portfolio",
    name: "Portfolio",
    version: "0.1.0",
    description:
      "Image-led dark theme. Compact top bar, sans-serif type, gallery template that arranges blocks in a grid.",
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
    },
  },
});

export { PortfolioHeader, PortfolioFooter, PortfolioShell };
export { portfolioCss };
