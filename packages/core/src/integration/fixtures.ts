/**
 * Integration-test fixtures. Reuses apps/web's generated collection tables
 * and the app package's source collection definitions so tests exercise the
 * same pipeline path the reference app does, without each test having to
 * re-author schema + config. Theme requirements are merged before
 * registration because the generated tables come from that resolved config,
 * not from the unmerged source definitions.
 *
 * Cross-package (core → apps/web) import is fine here because integration
 * tests are local-only — they never build or ship — and are guaranteed to
 * run inside the monorepo where apps/web's source is on-disk.
 */
// eslint-disable-next-line import-x/no-relative-packages
import {
  categoriesTable,
  pagesTable,
  postsCategoriesTable,
  postsTable,
  postsTagsTable,
  tagsTable,
} from "../../../../apps/web/src/db/generated/collections.js";
// eslint-disable-next-line import-x/no-relative-packages
import { postsCollection } from "../../../../apps/web/src/collections/posts.js";
// eslint-disable-next-line import-x/no-relative-packages
import { pagesCollection } from "../../../../apps/web/src/collections/pages.js";
// eslint-disable-next-line import-x/no-relative-packages
import { categoriesCollection } from "../../../../apps/web/src/collections/categories.js";
// eslint-disable-next-line import-x/no-relative-packages
import { tagsCollection } from "../../../../apps/web/src/collections/tags.js";
// eslint-disable-next-line import-x/no-relative-packages
import { defaultTheme } from "../../../themes/default/src/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { docsTheme } from "../../../themes/docs/src/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { magazineTheme } from "../../../themes/magazine/src/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { portfolioTheme } from "../../../themes/portfolio/src/index.js";
import { registerCollection } from "../collections/registry.js";
import { setI18nConfig } from "../i18n/registry.js";
import type { NpCollectionConfig } from "../config/types.js";
import { mergeThemeRequirements } from "../themes/merge-requirements.js";

let registered = false;

const resolvedCollectionConfigs = mergeThemeRequirements(
  [postsCollection, pagesCollection, categoriesCollection, tagsCollection],
  [defaultTheme, magazineTheme, portfolioTheme, docsTheme],
);

function getResolvedCollectionConfig(slug: string): NpCollectionConfig {
  const config = resolvedCollectionConfigs.find((collection) => collection.slug === slug);
  if (!config) {
    throw new Error(`Missing resolved integration collection config: ${slug}`);
  }
  return config;
}

/**
 * Idempotently registers the reference app's `posts`, `pages`, `categories`,
 * and `tags` collections so tests can call saveDocument / findDocuments /
 * publishScheduledDocuments against known tables. Collections ship with
 * ACLs — we strip them for tests so a synthetic principal can write freely.
 *
 * `pages` is `i18n: true` and replaces the deleted `localized-pages`
 * collection (#528). `categories` + `tags` replace the deleted unified
 * `taxonomies` collection (#522/#526).
 *
 * Phase 12.1 — also installs the i18n config singleton with the same
 * `["en", "ko"]` shape the reference app's nexpress.config.ts uses, so
 * the pipeline's locale resolver has somewhere to read its allowed
 * locale list from.
 */
export function registerTestCollections(): void {
  if (registered) return;

  const postsConfig: NpCollectionConfig = {
    ...getResolvedCollectionConfig("posts"),
    access: undefined,
    hooks: undefined,
  };
  registerCollection("posts", postsTable, postsConfig, {
    joinTables: {
      categories: postsCategoriesTable,
      tags: postsTagsTable,
    },
  });

  const pagesConfig: NpCollectionConfig = {
    ...getResolvedCollectionConfig("pages"),
    access: undefined,
    hooks: undefined,
  };
  registerCollection("pages", pagesTable, pagesConfig);

  // Posts reference categories and tags via relationship fields, so
  // saving a post with terms requires both registrations.
  const categoriesConfig: NpCollectionConfig = {
    ...getResolvedCollectionConfig("categories"),
    access: undefined,
    hooks: undefined,
  };
  registerCollection("categories", categoriesTable, categoriesConfig);

  const tagsConfig: NpCollectionConfig = {
    ...getResolvedCollectionConfig("tags"),
    access: undefined,
    hooks: undefined,
  };
  registerCollection("tags", tagsTable, tagsConfig);

  setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });

  registered = true;
}

export { categoriesTable, pagesTable, postsCategoriesTable, postsTable, postsTagsTable, tagsTable };
