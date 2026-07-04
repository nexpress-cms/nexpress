import type { NpConfig, NpRegisteredTheme } from "@nexpress/core";

import { defaultTheme } from "@nexpress/theme-default";
import { docsTheme } from "@nexpress/theme-docs";
import { magazineTheme } from "@nexpress/theme-magazine";
import { portfolioTheme } from "@nexpress/theme-portfolio";

import { calloutPlugin } from "@nexpress/plugin-block-callout";
import { embedPlugin } from "@nexpress/plugin-block-embed";
import { latestPostsPlugin } from "@nexpress/plugin-block-latest-posts";
import { newsletterPlugin } from "@nexpress/plugin-block-newsletter";
import { pricingPlugin } from "@nexpress/plugin-block-pricing";
import { statsBlockPlugin } from "@nexpress/plugin-block-stats";
import { defineDiscussionsCollection, forumPlugin } from "@nexpress/plugin-forum";
import { githubOAuthPlugin } from "@nexpress/plugin-oauth-github";
import { googleOAuthPlugin } from "@nexpress/plugin-oauth-google";
import { readingTimePlugin } from "@nexpress/plugin-reading-time";
import { seoAuditPlugin } from "@nexpress/plugin-seo-audit";

import { categoriesCollection } from "../collections/categories";
import { pagesCollection } from "../collections/pages";
import { postsCollection } from "../collections/posts";
import { tagsCollection } from "../collections/tags";

/**
 * The built-in NexPress collections. A scaffolded site spreads
 * this array into its `nexpress.config.ts`:
 *
 *   collections: [...defaultCollections, myCustomCollection]
 *
 * Editing one of these requires upstreaming the change into
 * `packages/app/src/collections/*.ts` — they're the single
 * source of truth used by both apps/web and every scaffold.
 *
 * `discussions` is built by the `@nexpress/plugin-forum` factory
 * with its default options (no extra categories) so the forum
 * plugin's pre-registered hooks have a target collection from
 * boot. Operators who want custom categories override the entry:
 *
 *   collections: [
 *     ...defaultCollections.filter((c) => c.slug !== "discussions"),
 *     defineDiscussionsCollection({ categories: [...] }),
 *   ]
 */
export const defaultCollections: NpConfig["collections"] = [
  postsCollection,
  pagesCollection,
  categoriesCollection,
  tagsCollection,
  defineDiscussionsCollection(),
];

/**
 * Built-in plugins registered out of the box. Every scaffolded
 * site spreads this into `nexpress.config.ts`:
 *
 *   plugins: [...defaultPlugins, myCustomPlugin]
 *
 * What's in here:
 *   - 6 block plugins (callout / embed / latest-posts / newsletter
 *     / pricing / stats) — add new block types to the page builder.
 *   - reading-time, seo-audit — content-pipeline hooks, no extra
 *     surface.
 *   - forum — registers the `discussions` collection (pre-included
 *     in `defaultCollections` above so the plugin has a target
 *     from boot) plus the public forum routes under `/discussions`.
 *   - oauth-github, oauth-google — register OAuth provider entries
 *     but only become reachable when the corresponding env vars
 *     (or admin auto-form values) are populated; the empty case logs
 *     an informational setup hint and registers nothing.
 *
 * Operators who want a stripped-down install filter the list or
 * disable plugins from the admin Plugins page.
 */
export const defaultPlugins: NonNullable<NpConfig["plugins"]> = [
  // Block plugins — additive page-builder blocks.
  calloutPlugin,
  embedPlugin,
  latestPostsPlugin,
  newsletterPlugin,
  pricingPlugin,
  statsBlockPlugin,
  // Hook plugins — silent until they fire.
  readingTimePlugin,
  seoAuditPlugin,
  // Surface-contributing plugins.
  forumPlugin,
  // Env / admin-form gated — register-safe, no side effect without
  // credentials.
  githubOAuthPlugin,
  googleOAuthPlugin,
];

/**
 * Built-in theme packs registered by every NexPress site. The
 * admin's Appearance → Themes picker shows whatever themes the
 * config registers; the operator switches the active one from
 * the UI (no redeploy).
 *
 * Themes don't carry per-site state, so sharing the same
 * imports across apps/web + scaffolds is safe.
 */
export const defaultThemes: NpRegisteredTheme[] = [
  defaultTheme,
  magazineTheme,
  portfolioTheme,
  docsTheme,
];

/**
 * Minimal i18n config — `en` only. The default `pagesCollection`
 * declares `i18n: true` (translation tabs in the admin), which
 * requires a top-level i18n block; without one, the pipeline
 * refuses to boot. Single-locale sites get the same admin UX
 * without configuring anything.
 *
 * Sites that need real multi-locale support should override this
 * in their `nexpress.config.ts`:
 *
 *   i18n: { locales: ["en", "fr"], defaultLocale: "en" }
 */
export const defaultI18n: NonNullable<NpConfig["i18n"]> = {
  locales: ["en"],
  defaultLocale: "en",
};

/**
 * Env-driven storage selector. Both apps/web and the scaffold's
 * `nexpress.config.ts` set `storage: storageFromEnv()`, so the
 * operator flips local ↔ S3 from `.env` without editing this
 * file. `pnpm run setup` writes the right env block directly.
 */
export function storageFromEnv(): NonNullable<NpConfig["storage"]> {
  if (process.env.NP_STORAGE_ADAPTER === "s3") {
    return {
      adapter: "s3",
      s3: {
        bucket: process.env.NP_S3_BUCKET ?? "",
        region: process.env.NP_S3_REGION ?? "us-east-1",
        endpoint: process.env.NP_S3_ENDPOINT,
      },
    };
  }
  return {
    adapter: "local",
    local: {
      directory: process.env.NP_STORAGE_DIR ?? "./public/media",
      baseUrl: process.env.NP_STORAGE_URL ?? "/media",
    },
  };
}
