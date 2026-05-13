import type { NpConfig, NpRegisteredTheme } from "@nexpress/core";

import { defaultTheme } from "@nexpress/theme-default";
import { docsTheme } from "@nexpress/theme-docs";
import { magazineTheme } from "@nexpress/theme-magazine";
import { portfolioTheme } from "@nexpress/theme-portfolio";

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
 */
export const defaultCollections: NpConfig["collections"] = [
  postsCollection,
  pagesCollection,
  categoriesCollection,
  tagsCollection,
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
