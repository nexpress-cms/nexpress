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
import { minimalTheme } from "@nexpress/theme-minimal";

import { pagesCollection } from "./collections/pages";
import { postsCollection } from "./collections/posts";

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
    process.env.NX_STORAGE_ADAPTER === "s3"
      ? {
          adapter: "s3",
          s3: {
            bucket: process.env.NX_S3_BUCKET ?? "",
            region: process.env.NX_S3_REGION ?? "us-east-1",
            endpoint: process.env.NX_S3_ENDPOINT,
          },
        }
      : {
          adapter: "local",
          local: {
            directory: process.env.NX_STORAGE_DIR ?? "./uploads",
            baseUrl: process.env.NX_STORAGE_URL ?? "/uploads",
          },
        },
  collections: [postsCollection, pagesCollection, discussionsCollection],
  // Phase 11.1 — themes registry. Sites declare an array;
  // admin switches the active one via the Theme settings tab
  // (11.4) without redeploying. The first entry is the
  // default-active until an admin overrides.
  themes: [defaultTheme, minimalTheme],
  plugins: [
    readingTimePlugin,
    seoAuditPlugin,
    forumPlugin,
    githubOAuthPlugin,
    googleOAuthPlugin,
  ],
  auth: {
    secret: process.env.NX_SECRET ?? "",
  },
});
