import { defineTheme } from "@nexpress/theme";

import { MagazineFooter } from "./footer.js";
import { MagazineHeader } from "./header.js";
import { MagazineShell } from "./shell.js";
import { magazineCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageCoverTemplate } from "./templates/page-cover.js";
import { PostFeatureTemplate } from "./templates/post-feature.js";

/**
 * `@nexpress/theme-magazine` — bold serif magazine layout.
 *
 * Demonstrates a richer theme than `theme-minimal` without
 * borrowing the entire shell from `theme-default`. Distinguishing
 * features:
 *
 *   - Caps masthead with thick rule and tagline
 *   - Multi-column page-cover template (full-bleed image + caption)
 *   - Posts get a feature-article template (large title, dropcap,
 *     pulled byline)
 *   - Theme-owned CSS keeps everything inside `.nx-magazine-*`
 *     selectors so swapping back to default doesn't leave
 *     residual rules.
 *
 * No client components — every slot is a server component. If
 * a magazine site wants an interactive nav drawer, that goes
 * in a separate "use client" file with the same two-entry
 * tsup pattern theme-default uses.
 */
export const magazineTheme = defineTheme({
  manifest: {
    id: "magazine",
    name: "Magazine",
    version: "0.1.0",
    description:
      "Editorial magazine layout — caps masthead, full-bleed cover template, feature article posts. Demonstrates per-collection templates and a custom CSS palette.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: MagazineShell,
    slots: {
      header: MagazineHeader,
      footer: MagazineFooter,
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
      },
    },
  },
});

export { MagazineHeader, MagazineFooter, MagazineShell };
export { magazineCss };
