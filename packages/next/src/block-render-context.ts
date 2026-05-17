import {
  findDocuments,
  type NpFindOptions,
  type NpFindResult,
} from "@nexpress/core";
import type { NpBlockRenderContext } from "@nexpress/blocks";

import { getCachedActiveThemeId } from "./cache.js";

/**
 * Forces a `status = "published"` filter when the caller didn't already
 * specify one on `where.status`. The block-render ctx is meant for
 * public-page rendering; surfacing draft / scheduled rows to anonymous
 * visitors is almost always a bug, so we make safe-by-default the path
 * of least resistance. Plugins that explicitly want a different status
 * can pass `where: { status: "draft" }` and we won't overwrite it.
 */
function applyPublishedDefault(
  options: Partial<NpFindOptions> | undefined,
): Partial<NpFindOptions> {
  const next: Partial<NpFindOptions> = { ...(options ?? {}) };
  const existingWhere = next.where ?? {};
  const callerSpecifiedStatus =
    "status" in existingWhere && existingWhere.status !== undefined;
  if (!callerSpecifiedStatus) {
    next.where = {
      ...existingWhere,
      status: "published",
    };
  }
  return next;
}

/**
 * Server-only default builder for `NpBlockRenderContext`. Lives in
 * `@nexpress/next` (server boundary) instead of `@nexpress/blocks`
 * because blocks is in the host's `transpilePackages` list — adding
 * a `@nexpress/core` dependency to blocks (even via dynamic import)
 * would drag `pg` / `@node-rs/argon2` / `node:timers/promises` into
 * the client bundle graph and break the build.
 *
 * Calls into `findDocuments` / `getDocumentById` with NO `user` argument:
 * `@nexpress/core` already treats an absent / null principal as the
 * "anonymous visitor" case — it dispatches to each collection's
 * `access.read({ user: null })` and auto-applies `visibility = "public"`
 * inside the pipeline. The earlier draft of this file synthesised a
 * `viewer`-role principal as a workaround; that's now gone, so block
 * plugins inherit whatever access the collection author defined for
 * unauthenticated reads. Combined with `applyPublishedDefault()`, the
 * surface is "what a logged-out visitor of the site itself can read."
 *
 * Site / theme template authors call this once per page render and
 * pass the result into `renderBlocks(blocks, { ctx })`. Static-only
 * pages (no data-bound blocks) can omit the ctx — `renderBlocks`
 * passes `undefined` through to each block's render.
 */
export function createDefaultBlockRenderContext(): NpBlockRenderContext {
  return {
    content: {
      async find(collection: string, options?: Partial<NpFindOptions>): Promise<NpFindResult> {
        return findDocuments(collection, applyPublishedDefault(options));
      },
      async findOne(collection: string, id: string): Promise<Record<string, unknown> | null> {
        // Issue #475 — route through `findDocuments` so the
        // anonymous-visitor visibility filter (`visibility = "public"`,
        // applied by the pipeline when no `user` is passed) and the
        // `applyPublishedDefault` status guard both fire. The earlier
        // implementation called `getDocumentById` directly, which only
        // checks tenant + `access.read({ user, doc })`. For collections
        // whose `access.read` returns `true` for anonymous users
        // (e.g. the reference `posts` collection), a draft or private
        // doc id reaching a block plugin would render the unfiltered
        // doc to a public page. Going through `findDocuments` closes
        // that hole without changing the per-collection access surface.
        const result = await findDocuments(
          collection,
          applyPublishedDefault({
            where: { id },
            limit: 1,
          }) as NpFindOptions,
        );
        return result.docs[0] ?? null;
      },
      async count(collection: string): Promise<number> {
        const result = await findDocuments(collection, applyPublishedDefault({ limit: 1 }));
        return result.totalDocs;
      },
    },
  };
}

/**
 * Phase F.4 — async variant that resolves the active theme id
 * for the current site and embeds it in `activeSources`.
 * `renderBlocks` filters block instances whose `source` doesn't
 * match, rendering a placeholder instead. Sites in a multi-
 * tenant process get per-site filtering for free.
 *
 * Kept distinct from the sync builder above so existing
 * callers that don't need source filtering (older themes,
 * unit tests) don't have to await. The catch-all `[[...slug]]`
 * and theme route components use this async one.
 */
export async function createSiteScopedBlockRenderContext(): Promise<NpBlockRenderContext> {
  const themeId = await getCachedActiveThemeId();
  const base = createDefaultBlockRenderContext();
  return {
    ...base,
    activeSources: { themeId },
  };
}
