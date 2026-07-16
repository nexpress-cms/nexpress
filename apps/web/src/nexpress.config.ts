import { defineConfig } from "@nexpress/core";
import { defaultCollections, defaultThemes, storageFromEnv } from "@nexpress/app/config-defaults";
import { forumPlugin } from "@nexpress/plugin-forum";
// @nexpress:plugins-imports-start
import { calloutPlugin } from "@nexpress/plugin-block-callout";
import { embedPlugin } from "@nexpress/plugin-block-embed";
import { latestPostsPlugin } from "@nexpress/plugin-block-latest-posts";
import { newsletterPlugin } from "@nexpress/plugin-block-newsletter";
import { pricingPlugin } from "@nexpress/plugin-block-pricing";
import { statsBlockPlugin } from "@nexpress/plugin-block-stats";
import { githubOAuthPlugin } from "@nexpress/plugin-oauth-github";
import { googleOAuthPlugin } from "@nexpress/plugin-oauth-google";
import { readingTimePlugin } from "@nexpress/plugin-reading-time";
import { seoAuditPlugin } from "@nexpress/plugin-seo-audit";
// @nexpress:plugins-imports-end
// @nexpress:themes-imports-start
// @nexpress:themes-imports-end

import { i18nConfig } from "./i18n.config";
import { discussionsCollection } from "./collections/discussions";

export default defineConfig({
  site: {
    name: "NexPress Reference",
    url: process.env.SITE_URL ?? "http://localhost:3000",
  },
  db: {
    connectionString: process.env.DATABASE_URL ?? "",
  },
  storage: storageFromEnv(),
  collections: [
    ...defaultCollections.filter((c) => c.slug !== "discussions"),
    discussionsCollection,
  ],
  // Phase 12.1 — i18n config. Required when any collection
  // sets `i18n: true`. `pagesCollection` opts in: each row
  // carries a locale + translation_group_id, and the admin
  // surfaces TranslationTabs on the edit screen so operators
  // create language variants of the same logical page in one
  // place.
  //
  // Sourced from `./i18n.config` so the client-safe proxy and server bootstrap
  // consume the same validated, frozen catalog without duplicating the array.
  i18n: i18nConfig,
  themes: [
    ...defaultThemes,
    // @nexpress:themes-list-start
    // @nexpress:themes-list-end
  ],
  plugins: [
    forumPlugin,
    // @nexpress:plugins-list-start
    calloutPlugin,
    embedPlugin,
    latestPostsPlugin,
    newsletterPlugin,
    pricingPlugin,
    statsBlockPlugin,
    readingTimePlugin,
    seoAuditPlugin,
    githubOAuthPlugin,
    googleOAuthPlugin,
    // @nexpress:plugins-list-end
  ],
  auth: {
    secret: process.env.NP_SECRET ?? "",
  },
});
