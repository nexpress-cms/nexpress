/**
 * Integration-test fixtures. Reuses apps/web's `posts` collection and the
 * generated `np_c_posts` table so tests exercise the same pipeline path the
 * reference app does, without each test having to re-author schema +
 * config.
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
import { registerCollection } from "../collections/registry.js";
import { setI18nConfig } from "../i18n/registry.js";
import type { NpCollectionConfig } from "../config/types.js";

let registered = false;

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
    ...postsCollection,
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
    ...pagesCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("pages", pagesTable, pagesConfig);

  // Posts reference categories and tags via relationship fields, so
  // saving a post with terms requires both registrations.
  const categoriesConfig: NpCollectionConfig = {
    ...categoriesCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("categories", categoriesTable, categoriesConfig);

  const tagsConfig: NpCollectionConfig = {
    ...tagsCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("tags", tagsTable, tagsConfig);

  setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });

  registered = true;
}

export { categoriesTable, pagesTable, postsCategoriesTable, postsTable, postsTagsTable, tagsTable };
