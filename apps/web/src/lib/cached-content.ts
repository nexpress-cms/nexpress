import { getMemberProfile, type NpMemberProfile } from "@nexpress/core";
import { cache } from "react";

/**
 * Per-request memoized variants of the framework's read
 * primitives. RSC pages typically call the same primitive twice
 * — once in `generateMetadata`, once in the page export — and
 * each call would otherwise hit the DB independently. React's
 * `cache()` deduplicates based on the function's arguments, so
 * wrapping at the app boundary lets `generateMetadata` + the page
 * share a single result for free.
 *
 * Caveat: caching is keyed on the FULL argument tuple. A page
 * that passes `{ avatarVariant: "thumbnail" }` in metadata and
 * `{ avatarVariant: "original" }` in the body will issue two
 * fetches — that's correct (different sizes mean different
 * fetches). Pages that genuinely want one fetch should pass the
 * same options at both call sites.
 */
export const getCachedMemberProfile: typeof getMemberProfile = cache(getMemberProfile);

/**
 * Re-export the type so callers can import both the helper and
 * the shape from one path without having to remember that
 * `NpMemberProfile` lives in core.
 */
export type { NpMemberProfile };
