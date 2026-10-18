import type { NpUserRole } from "../config/types.js";
import type { getDb } from "../db/runtime.js";

export type NpSiteAuthorityMutationActorV1 =
  { kind: "staff"; userId: string } | { kind: "system"; component: string };

export type NpSiteAuthorityMutationScopeV1 =
  { kind: "site"; siteId: string } | { kind: "deployment" };

export type NpSiteAuthorityTransitionV1 =
  | {
      kind: "site-role";
      userId: string;
      previousRole: NpUserRole | null;
      currentRole: NpUserRole | null;
    }
  | { kind: "super-admin"; userId: string; previous: boolean; current: boolean };

export interface NpSiteAuthorityObservationV1 {
  db: ReturnType<typeof getDb>;
  scope: NpSiteAuthorityMutationScopeV1;
  actor: NpSiteAuthorityMutationActorV1;
  transitionId: string;
  occurredAt: Date;
  transition: NpSiteAuthorityTransitionV1;
}

/** Explicit host source. Both callbacks share the domain write transaction;
 * preparation precedes principal/user locks and a failed record rolls back the write. */
export interface NpSiteAuthorityObserverV1 {
  prepare(input: {
    db: ReturnType<typeof getDb>;
    scope: NpSiteAuthorityMutationScopeV1;
  }): Promise<void>;
  record(observation: NpSiteAuthorityObservationV1): Promise<void>;
}

let observer: NpSiteAuthorityObserverV1 | null = null;

/** Framework-host bootstrap only; installing this source grants no mutation authority. */
export function setSiteAuthorityObserverV1(value: NpSiteAuthorityObserverV1): void {
  if (typeof value?.prepare !== "function" || typeof value?.record !== "function")
    throw new Error("Invalid site authority observer");
  observer = value;
}

export function resetSiteAuthorityObserverV1(): void {
  observer = null;
}

/** Internal mutation owner captures installation once, before opening its transaction. */
export function npGetSiteAuthorityObserverV1(): NpSiteAuthorityObserverV1 | null {
  return observer;
}
