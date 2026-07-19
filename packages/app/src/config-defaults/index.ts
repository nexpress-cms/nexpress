import type { NpConfig, NpRegisteredTheme } from "@nexpress/core";
import { npReadStorageRuntimeConfig } from "@nexpress/core/storage";

import { defaultTheme } from "@nexpress/theme-default";
import { communityTheme } from "@nexpress/theme-community";
import { docsTheme } from "@nexpress/theme-docs";
import { magazineTheme } from "@nexpress/theme-magazine";
import { portfolioTheme } from "@nexpress/theme-portfolio";

import { calloutPlugin } from "@nexpress/plugin-block-callout";
import { embedPlugin } from "@nexpress/plugin-block-embed";
import { latestPostsPlugin } from "@nexpress/plugin-block-latest-posts";
import { newsletterPlugin } from "@nexpress/plugin-block-newsletter";
import { pricingPlugin } from "@nexpress/plugin-block-pricing";
import { statsBlockPlugin } from "@nexpress/plugin-block-stats";
import { forumCollections, forumPlugin } from "@nexpress/plugin-forum";
import { githubOAuthPlugin } from "@nexpress/plugin-oauth-github";
import { googleOAuthPlugin } from "@nexpress/plugin-oauth-google";
import { readingTimePlugin } from "@nexpress/plugin-reading-time";
import { seoAuditPlugin } from "@nexpress/plugin-seo-audit";

import { categoriesCollection } from "../collections/categories";
import { pagesCollection } from "../collections/pages";
import { postsCollection } from "../collections/posts";
import { tagsCollection } from "../collections/tags";
import { i18nConfig } from "../i18n-config";

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
 * The forum contributes a board registry plus one shared post
 * collection. Boards are rows, so operators add boards, categories,
 * skins, and moderation policy in Admin without regenerating schema:
 *
 *   collections: [
 *     ...defaultCollections,
 *   ]
 */
export const defaultCollections: NpConfig["collections"] = [
  postsCollection,
  pagesCollection,
  categoriesCollection,
  tagsCollection,
  ...forumCollections,
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
 *   - forum — uses the board/post collections pre-included in
 *     `defaultCollections` and owns the public routes under `/boards`.
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
  communityTheme,
  magazineTheme,
  portfolioTheme,
  docsTheme,
];

/**
 * Exact locale catalog shared with the proxy-facing i18n config. The default
 * `pagesCollection` declares `i18n: true`, so bootstrap needs this block; using
 * the same frozen object prevents generated projects from routing a locale the
 * server refuses to read or write.
 *
 * Sites that need real multi-locale support should override this
 * in their `nexpress.config.ts`:
 *
 *   i18n: { locales: ["en", "fr"], defaultLocale: "en" }
 */
export const defaultI18n: NonNullable<NpConfig["i18n"]> = i18nConfig;

/**
 * Env-driven storage selector. Both apps/web and the scaffold's
 * `nexpress.config.ts` set `storage: storageFromEnv()`, so the
 * operator flips local ↔ S3 from `.env` without editing this
 * file. `pnpm run setup` writes the right env block directly.
 */
export function storageFromEnv(): NonNullable<NpConfig["storage"]> {
  return npReadStorageRuntimeConfig(process.env);
}
