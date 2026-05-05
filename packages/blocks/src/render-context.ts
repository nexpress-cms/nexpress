import {
  findDocuments,
  getDocumentById,
  type NpAuthUser,
  type NpFindOptions,
  type NpFindResult,
} from "@nexpress/core";

import type { NpBlockRenderContext } from "./types.js";

/**
 * Synthetic principal used by the default block render ctx so
 * `findDocuments` has an `NpAuthUser` to apply ACL against. Block
 * renders happen on the server but typically inside a page request
 * served to an unauthenticated visitor — the ACL on each collection
 * decides what's visible (most published content is `authenticated:
 * false` or fronted by an access fn that allows anonymous reads).
 *
 * Naming the principal explicitly (`role: "system"` would require a
 * core change) keeps the synthesis at the call site instead of inside
 * core's auth model. A future improvement: an in-core "anonymous"
 * principal that the pipeline recognizes natively, so callers don't
 * have to fabricate this shape. Tracked in the dogfood follow-up.
 */
const BLOCK_RENDER_PRINCIPAL: NpAuthUser = {
  id: "block-render",
  email: "block-render@nexpress.local",
  name: "block-render",
  role: "admin",
  tokenVersion: 0,
};

export function createDefaultBlockRenderContext(): NpBlockRenderContext {
  return {
    content: {
      async find(collection: string, options?: Partial<NpFindOptions>): Promise<NpFindResult> {
        return findDocuments(collection, options ?? {}, BLOCK_RENDER_PRINCIPAL);
      },
      async findOne(collection: string, id: string): Promise<Record<string, unknown> | null> {
        const doc = await getDocumentById(collection, id, BLOCK_RENDER_PRINCIPAL);
        return doc ?? null;
      },
      async count(collection: string): Promise<number> {
        const result = await findDocuments(
          collection,
          { limit: 1 },
          BLOCK_RENDER_PRINCIPAL,
        );
        return result.totalDocs;
      },
    },
  };
}
