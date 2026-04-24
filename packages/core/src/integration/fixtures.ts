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
import { postsTable } from "../../../../apps/web/src/db/generated/collections.js";
// eslint-disable-next-line import-x/no-relative-packages
import { postsCollection } from "../../../../apps/web/src/collections/posts.js";
import { registerCollection } from "../collections/registry.js";
import type { NxCollectionConfig } from "../config/types.js";

let registered = false;

/**
 * Idempotently registers the `posts` collection so tests can call
 * saveDocument / findDocuments / publishScheduledDocuments against a known
 * table. `postsCollection` ships with ACLs — we strip them for tests so a
 * synthetic principal can write freely.
 */
export function registerTestCollections(): void {
  if (registered) return;

  const config: NxCollectionConfig = {
    ...postsCollection,
    access: undefined,
    hooks: undefined,
  };
  registerCollection("posts", postsTable as never, config);
  registered = true;
}

export { postsTable };
