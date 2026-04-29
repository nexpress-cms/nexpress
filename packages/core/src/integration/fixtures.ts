/**
 * Integration-test fixtures. Reuses apps/web's `posts` collection and the
 * generated `nx_c_posts` table so tests exercise the same pipeline path the
 * reference app does, without each test having to re-author schema +
 * config.
 *
 * Cross-package (core → apps/web) import is fine here because integration
 * tests are local-only — they never build or ship — and are guaranteed to
 * run inside the monorepo where apps/web's source is on-disk.
 */
// eslint-disable-next-line import-x/no-relative-packages
import {
  localizedPagesTable,
  pagesTable,
  postsTable,
} from "../../../../apps/web/src/db/generated/collections.js";
// eslint-disable-next-line import-x/no-relative-packages
import { postsCollection } from "../../../../apps/web/src/collections/posts.js";
// eslint-disable-next-line import-x/no-relative-packages
import { pagesCollection } from "../../../../apps/web/src/collections/pages.js";
// eslint-disable-next-line import-x/no-relative-packages
import { localizedPagesCollection } from "../../../../apps/web/src/collections/localized-pages.js";
import { registerCollection } from "../collections/registry.js";
import { setI18nConfig } from "../i18n/registry.js";
import type { NxCollectionConfig } from "../config/types.js";

let registered = false;

/**
 * Idempotently registers the `posts` and `localized-pages` collections so
 * tests can call saveDocument / findDocuments / publishScheduledDocuments
 * against known tables. Collections ship with ACLs — we strip them for
 * tests so a synthetic principal can write freely.
 *
 * Phase 12.1 — also installs the i18n config singleton with the same
 * `["en", "ko"]` shape the reference app's nexpress.config.ts uses, so
 * the pipeline's locale resolver has somewhere to read its allowed
 * locale list from.
 */
export function registerTestCollections(): void {
  if (registered) return;

  const postsConfig: NxCollectionConfig = {
    ...postsCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("posts", postsTable as never, postsConfig);

  const pagesConfig: NxCollectionConfig = {
    ...pagesCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("pages", pagesTable as never, pagesConfig);

  const localizedConfig: NxCollectionConfig = {
    ...localizedPagesCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("localized-pages", localizedPagesTable as never, localizedConfig);

  setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });

  registered = true;
}

export { localizedPagesTable, pagesTable, postsTable };
