import {
  buildPageMetadata as buildCorePageMetadata,
  type NpPageMetadataInput,
} from "@nexpress/core";
import type { Metadata } from "next";

/**
 * Next-typed wrapper around `@nexpress/core`'s `buildPageMetadata`.
 *
 * The core function returns `NpPageMetadata`, a structurally-shaped
 * type kept independent of `next` so `@nexpress/core` can stay
 * framework-agnostic. The shape matches Next's `Metadata` (modulo
 * a few optional fields), but TypeScript doesn't infer the
 * assignability without a cast.
 *
 * Calling `generateMetadata` from a Next page is the only place
 * the result needs to be `Metadata`-typed, and pages already
 * import from `next`. So this thin wrapper lives in
 * `@nexpress/next` (which already declares `next` as a peer dep)
 * and absorbs the cast — pages can call it directly without the
 * `as Metadata` boilerplate at every call site.
 */
export async function buildPageMetadata(input: NpPageMetadataInput = {}): Promise<Metadata> {
  return await buildCorePageMetadata(input);
}
