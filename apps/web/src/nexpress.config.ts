import { defineConfig } from "@nexpress/core";
import {
  defineDiscussionsCollection,
  forumPlugin,
} from "@nexpress/plugin-forum";
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
import { defaultTheme } from "@nexpress/theme-default";
import { magazineTheme } from "@nexpress/theme-magazine";
import { minimalTheme } from "@nexpress/theme-minimal";
import { portfolioTheme } from "@nexpress/theme-portfolio";

import { pagesCollection } from "./collections/pages";
import { postsCollection } from "./collections/posts";
import { taxonomiesCollection } from "./collections/taxonomies";
import { i18nConfig } from "./i18n.config";

const discussionsCollection = defineDiscussionsCollection({
  categories: [
    { label: "General", value: "general" },
    { label: "Announcements", value: "announcements" },
    { label: "Q&A", value: "qa" },
    { label: "Show & Tell", value: "show-and-tell" },
  ],
});

export default defineConfig({
  site: {
    name: "NexPress Reference",
    url: process.env.SITE_URL ?? "http://localhost:3000",
  },
  db: {
    connectionString: process.env.DATABASE_URL ?? "",
  },
  storage:
    process.env.NP_STORAGE_ADAPTER === "s3"
      ? {
          adapter: "s3",
          s3: {
            bucket: process.env.NP_S3_BUCKET ?? "",
            region: process.env.NP_S3_REGION ?? "us-east-1",
            endpoint: process.env.NP_S3_ENDPOINT,
          },
        }
      : {
          adapter: "local",
          local: {
            directory: process.env.NP_STORAGE_DIR ?? "./uploads",
            baseUrl: process.env.NP_STORAGE_URL ?? "/uploads",
          },
        },
  collections: [
    postsCollection,
    pagesCollection,
    taxonomiesCollection,
    discussionsCollection,
  ],
  // Phase 12.1 — i18n config. Required when any collection
  // sets `i18n: true`. `pagesCollection` opts in: each row
  // carries a locale + translation_group_id, and the admin
  // surfaces TranslationTabs on the edit screen so operators
  // create language variants of the same logical page in one
  // place.
  //
  // Sourced from `./i18n.config` so the middleware (which can't
  // load core) can read the same locale list at request-parse
  // time without duplicating the array.
  i18n: {
    locales: [...i18nConfig.locales],
    defaultLocale: i18nConfig.defaultLocale,
  },
  // Phase 11.1 — themes registry. Sites declare an array;
  // admin switches the active one via the Theme settings tab
  // (11.4) without redeploying. The first entry is the
  // default-active until an admin overrides.
  themes: [defaultTheme, minimalTheme, magazineTheme, portfolioTheme],
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
