import * as core from "@nexpress/core";
import * as db from "@nexpress/core/db";
import * as agents from "@nexpress/core/agents";
import type * as bootstrap from "@nexpress/core/bootstrap";
import * as contracts from "@nexpress/core/agent-contract";
import { InMemoryRateLimiter } from "@nexpress/core/rate-limit";

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type TypedService = Assert<
  IsAny<agents.NpAgentGuardianSecurityObservationServiceV1> extends false ? true : false
>;
type TypedTransition = Assert<
  IsAny<contracts.NpAgentSecurityCredentialTransitionV1> extends false ? true : false
>;

declare const options: agents.NpAgentGuardianSecurityObservationOptionsV1;
const service = agents.createAgentGuardianSecurityObservationServiceV1(options);
const observer: bootstrap.NpGuardianSensitiveObserverV1 = service.sensitiveObserver;
const preparation: Parameters<typeof observer.prepare>[0] = {
  db: db.getDb(),
  scope: { kind: "site", siteId: "typed-consumer" },
};
void observer.prepare(preparation);
const rootLimiter: core.InMemoryRateLimiter = new InMemoryRateLimiter();
const adapter: core.NpRateLimiterAdapter = rootLimiter;
void adapter;
const transition = contracts.npRequireAgentSecurityCredentialTransitionV1({
  kind: "password-replaced",
  audience: "staff",
  principalId: "73111111-1111-4111-8111-111111111111",
  purpose: "password-change",
  previous: { tokenVersion: 1 },
  current: { tokenVersion: 2 },
  memberResetActivation: null,
});
if (transition.kind === "password-replaced") {
  const actualVersion: number = transition.current.tokenVersion;
  void actualVersion;
}
export type VerifiedTypes = [TypedService, TypedTransition];
