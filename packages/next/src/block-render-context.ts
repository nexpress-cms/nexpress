import {
  findDocuments,
  getDocumentById,
  type NpAuthUser,
  type NpFindOptions,
  type NpFindResult,
} from "@nexpress/core";
import type { NpBlockRenderContext } from "@nexpress/blocks";

/**
 * Synthetic principal used by the default block render ctx. Role is
 * deliberately the lowest in `ROLE_HIERARCHY` (`viewer`) so a misbehaving
 * block plugin can't escalate into draft / private rows that admin
 * principals would see. The earlier draft used `role: "admin"`, which
 * meant any data-bound block on a public page ran with full read
 * privilege — a plugin author who forgot a `where: { status: "published" }`
 * clause could leak unpublished content to anonymous viewers.
 *
 * Together with the published-only default filter applied below in
 * `applyPublishedDefault`, this gives the default ctx a "what an
 * unauthenticated visitor can see" permission profile without
 * requiring core auth-model changes. A future improvement: a
 * first-class `null`-principal path through `findDocuments` that
 * doesn't need a synthesised user at all.
 */
const BLOCK_RENDER_PRINCIPAL: NpAuthUser = {
  id: "block-render",
  email: "block-render@nexpress.local",
  name: "block-render",
  role: "viewer",
  tokenVersion: 0,
};

/**
 * Forces a `status = "published"` filter when the caller didn't already
 * specify one on `where.status`. The block-render ctx is meant for
 * public-page rendering; surfacing draft / scheduled rows to anonymous
 * visitors is almost always a bug, so we make safe-by-default the path
 * of least resistance. Plugins that explicitly want a different status
 * can pass `where: { status: { equals: "draft" } }` and we won't
 * overwrite it.
 */
function applyPublishedDefault(
  options: Partial<NpFindOptions> | undefined,
): Partial<NpFindOptions> {
  const next: Partial<NpFindOptions> = { ...(options ?? {}) };
  const existingWhere = (next.where ?? {}) as Record<string, unknown>;
  const callerSpecifiedStatus =
    "status" in existingWhere && existingWhere.status !== undefined;
  if (!callerSpecifiedStatus) {
    next.where = {
      ...existingWhere,
      status: { equals: "published" },
    } as NpFindOptions["where"];
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
 * Site / theme template authors call this once per page render and
 * pass the result into `renderBlocks(blocks, { ctx })`. Static-only
 * pages (no data-bound blocks) can omit the ctx — `renderBlocks`
 * passes `undefined` through to each block's render.
 */
export function createDefaultBlockRenderContext(): NpBlockRenderContext {
  return {
    content: {
      async find(collection: string, options?: Partial<NpFindOptions>): Promise<NpFindResult> {
        return findDocuments(
          collection,
          applyPublishedDefault(options),
          BLOCK_RENDER_PRINCIPAL,
        );
      },
      async findOne(collection: string, id: string): Promise<Record<string, unknown> | null> {
        // `getDocumentById` doesn't take a `where`, so the published-only
        // default doesn't apply here. The viewer-role principal is the
        // only safety net — the access function on the collection is
        // responsible for hiding draft rows from low-privilege actors.
        const doc = await getDocumentById(collection, id, BLOCK_RENDER_PRINCIPAL);
        return doc ?? null;
      },
      async count(collection: string): Promise<number> {
        const result = await findDocuments(
          collection,
          applyPublishedDefault({ limit: 1 }),
          BLOCK_RENDER_PRINCIPAL,
        );
        return result.totalDocs;
      },
    },
  };
}
