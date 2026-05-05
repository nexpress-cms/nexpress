import { defineConfig } from "@nexpress/core";
import {
  defineDiscussionsCollection,
  forumPlugin,
} from "@nexpress/plugin-forum";
import { githubOAuthPlugin } from "@nexpress/plugin-oauth-github";
import { googleOAuthPlugin } from "@nexpress/plugin-oauth-google";
import { readingTimePlugin } from "@nexpress/plugin-reading-time";
import { seoAuditPlugin } from "@nexpress/plugin-seo-audit";
import { defaultTheme } from "@nexpress/theme-default";
import { magazineTheme } from "@nexpress/theme-magazine";
import { minimalTheme } from "@nexpress/theme-minimal";
import { portfolioTheme } from "@nexpress/theme-portfolio";

import { localizedPagesCollection } from "./collections/localized-pages";
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
    localizedPagesCollection,
    taxonomiesCollection,
    discussionsCollection,
  ],
  // Phase 12.1 — i18n config. Required when any collection
  // sets `i18n: true`. The reference app uses this to
  // demonstrate the new primitive on `localized_pages`; sites
  // that don't need multi-language content can drop this block
  // and remove their localized collections.
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
    readingTimePlugin,
    seoAuditPlugin,
    forumPlugin,
    githubOAuthPlugin,
    googleOAuthPlugin,
  ],
  auth: {
    secret: process.env.NP_SECRET ?? "",
  },
});
