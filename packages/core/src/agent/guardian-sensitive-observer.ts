import type { getDb } from "../db/runtime.js";
import type {
  NpAgentGuardianSourceStateCommitmentV1,
  NpAgentSecurityCredentialTransitionV1,
} from "../agent-contract/guardian-credential-contract.js";
import type { NpAgentSecurityPluginTransitionV1 } from "../agent-contract/guardian-plugin-contract.js";
import type { NpSiteAuthorityMutationScopeV1 } from "../sites/authority-observer.js";

export type NpGuardianSensitiveActorV1 =
  | { kind: "staff"; userId: string }
  | { kind: "member"; memberId: string }
  | { kind: "system"; component: string };
export interface NpGuardianSensitiveObservationContextV1 {
  actor: NpGuardianSensitiveActorV1;
}
type Db = ReturnType<typeof getDb>;
interface Observation {
  db: Db;
  scope: NpSiteAuthorityMutationScopeV1;
  actor: NpGuardianSensitiveActorV1;
  transitionId: string;
  occurredAt: Date;
  invocationId?: string | null;
}
/** Trusted domain-only seam. A source is explicitly installed by the host;
 * absence adds no source SQL, credentials, activation or provider work. */
export interface NpGuardianSensitiveObserverV1 {
  prepare(this: void, input: { db: Db; scope: NpSiteAuthorityMutationScopeV1 }): Promise<void>;
  /** Transient source-owned read/project. Raw state is never returned, persisted
   * or accepted as a credential/plugin transition payload. */
  projectState(
    this: void,
    input: {
      db: Db;
      scope: NpSiteAuthorityMutationScopeV1;
      kind: "gateway-principal" | "connection-credential" | "plugin-activation" | "plugin-config";
      targetId: string;
      readState: () => Promise<unknown>;
    },
  ): Promise<NpAgentGuardianSourceStateCommitmentV1>;
  recordCredential(
    this: void,
    input: Observation & { transition: NpAgentSecurityCredentialTransitionV1 },
  ): Promise<void>;
  recordPlugin(
    this: void,
    input: Observation & { transition: NpAgentSecurityPluginTransitionV1 },
  ): Promise<void>;
}
let observer: NpGuardianSensitiveObserverV1 | null = null;
export function setGuardianSensitiveObserverV1(value: NpGuardianSensitiveObserverV1): void {
  if (
    typeof value?.prepare !== "function" ||
    typeof value.projectState !== "function" ||
    typeof value.recordCredential !== "function" ||
    typeof value.recordPlugin !== "function"
  )
    throw new Error("Invalid sensitive transition observer");
  observer = Object.freeze({
    prepare: value.prepare,
    projectState: value.projectState,
    recordCredential: value.recordCredential,
    recordPlugin: value.recordPlugin,
  });
}
export function resetGuardianSensitiveObserverV1(): void {
  observer = null;
}
export function npGetGuardianSensitiveObserverV1(): NpGuardianSensitiveObserverV1 | null {
  return observer;
}
/** Capture honest caller attribution before awaiting domain work. */
export function npGuardianSensitiveMutationActorV1(
  context: NpGuardianSensitiveObservationContextV1 | undefined,
  component: string,
): NpGuardianSensitiveActorV1 {
  if (!context) return { kind: "system", component };
  const value = context.actor,
    uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  if (value?.kind === "staff" && uuid.test(value.userId))
    return { kind: "staff", userId: value.userId };
  if (value?.kind === "member" && uuid.test(value.memberId))
    return { kind: "member", memberId: value.memberId };
  if (value?.kind === "system" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value.component))
    return { kind: "system", component: value.component };
  throw new Error("Invalid sensitive transition attribution");
}
