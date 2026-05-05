import type { NpAuthUser } from "../config/types.js";

/**
 * Canonical principal type — "who is the actor on this operation".
 *
 * Both staff routes (which carry an authenticated `NpAuthUser`) and
 * member routes (which carry only a `memberId`) share this single
 * union. Used by the collection pipeline, plugin hooks (surfaced as
 * `NpHookPrincipal` for historical reasons), and the community
 * `principalCan()` resolver.
 *
 * Add a new variant only after auditing every `switch (principal.kind)`
 * site — the exhaustive switches deliberately fail to compile when the
 * union grows.
 */
export type NpPrincipal =
  | { kind: "staff"; user: NpAuthUser }
  | { kind: "member"; memberId: string };
