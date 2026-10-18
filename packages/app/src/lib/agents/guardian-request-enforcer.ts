import {
  NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX,
  npAgentRestrictionSubjectKeyV1,
  npRequireAgentRestrictionCheckV1,
  npRequireAgentRestrictionDecisionV1,
  npRequireAgentRestrictionHealthV1,
  type NpAgentActorBucketRefV1,
  type NpAgentActorRestrictionScope,
  type NpAgentRestrictionAdapter,
  type NpAgentRestrictionSubjectV1,
} from "@nexpress/core/agent-contract";
import {
  createAgentGuardianActorProjectionV1,
  type NpAgentGuardianActorProjectionV1,
} from "@nexpress/core/agents";
import type { NextRequest } from "next/server";
import type { NpProxyGuardianRequestGuard } from "../../proxy/index.js";

export type NpAgentGuardianProjectionRefV1 = Pick<
  NpAgentActorBucketRefV1,
  "purpose" | "projectionVersion" | "projectionFingerprint" | "keyId"
>;

export interface NpAgentGuardianRequestEnforcerOptionsV1 {
  adapter: NpAgentRestrictionAdapter;
  currentKeyId: string;
  /** Retain every key referenced by an active restriction; rotate id whenever bytes change. */
  actorKeys: readonly { id: string; bytes: Uint8Array }[];
  ensureReady(): Promise<void>;
  /** The host resolves public hostname/site and trusted ingress address; never the admin site picker. */
  resolveRequest(request: NextRequest): Promise<{ siteId: string; networkAddress: string } | null>;
  /** Read the authoritative durable registry, including pending/unknown effects and frozen keys. */
  resolveActiveProjectionRefs(input: {
    siteId: string;
    signal: AbortSignal;
  }): Promise<readonly NpAgentGuardianProjectionRefV1[]>;
  onDegraded?(input: { code: "GUARDIAN_ENFORCEMENT_UNAVAILABLE" }): void | Promise<void>;
  now?: () => Date;
  /** End-to-end request budget; outstanding host work retains a bounded local slot. */
  timeoutMilliseconds?: number;
}

/** Closed V1 route semantics. Recovery/logout, read-only, plugin and unrelated APIs are not restricted. */
export function npResolveGuardianRequestScopeV1(
  request: Pick<NextRequest, "method" | "nextUrl">,
): NpAgentActorRestrictionScope | null {
  const path = request.nextUrl.pathname;
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (method === "POST" && /^\/api\/auth\/(login|refresh)$/u.test(path)) return "auth.staff";
  if (method === "POST" && /^\/api\/members\/(login|refresh)$/u.test(path)) return "auth.member";
  if (method === "POST" && ["/api/mcp", "/api/agent/v1/invocations"].includes(path))
    return "agent.gateway";
  if (
    ["POST", "PATCH", "DELETE"].includes(method) &&
    (/^\/api\/collections\/[^/]+\/[^/]+\/comments$/u.test(path) ||
      /^\/api\/comments\/[^/]+(?:\/(hide|restore))?$/u.test(path) ||
      ["/api/reactions", "/api/community/events"].includes(path))
  )
    return "community.write";
  if (
    ["POST", "PATCH", "DELETE"].includes(method) &&
    /^\/api\/collections\/[^/]+(?:\/[^/]+(?:\/(autosave|moderation|revisions\/[^/]+\/restore))?)?$/u.test(
      path,
    )
  )
    return "content.write";
  return null;
}

/** Explicit shared enforcement. No factory work initializes services, loads credentials or starts a worker. */
export function npCreateAgentGuardianRequestEnforcerV1(
  options: NpAgentGuardianRequestEnforcerOptionsV1,
): NpProxyGuardianRequestGuard {
  const budget = options.timeoutMilliseconds ?? 500;
  if (
    !Number.isInteger(budget) ||
    budget < 1 ||
    budget > 500 ||
    !Array.isArray(options.actorKeys) ||
    options.actorKeys.length < 1 ||
    options.actorKeys.length > NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX ||
    !options.adapter.sharedAcrossReplicas ||
    typeof options.adapter.check !== "function" ||
    typeof options.adapter.healthCheck !== "function" ||
    typeof options.ensureReady !== "function" ||
    typeof options.resolveRequest !== "function" ||
    typeof options.resolveActiveProjectionRefs !== "function"
  )
    throw new Error("Invalid Guardian request enforcement installation.");
  const projections = new Map<string, NpAgentGuardianActorProjectionV1>();
  for (const key of options.actorKeys) {
    if (projections.has(key.id)) throw new Error("Duplicate Guardian projection key id.");
    projections.set(key.id, createAgentGuardianActorProjectionV1(key));
  }
  const current = projections.get(options.currentKeyId);
  if (!current) throw new Error("Current Guardian projection key is missing.");
  const now = options.now ?? (() => new Date());
  let inFlight = 0;
  const degraded = () => {
    try {
      void Promise.resolve(
        options.onDegraded?.({ code: "GUARDIAN_ENFORCEMENT_UNAVAILABLE" }),
      ).catch(() => undefined);
    } catch {
      /* Degraded observation never changes existing request controls. */
    }
  };
  return async (request) => {
    const actionScope = npResolveGuardianRequestScopeV1(request);
    if (!actionScope) return null;
    if (inFlight >= 4) {
      degraded();
      return null;
    }
    inFlight++;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      try {
        await options.ensureReady();
        if (controller.signal.aborted) return null;
        const context = await options.resolveRequest(request);
        if (!context || controller.signal.aborted) return null;
        const health = npRequireAgentRestrictionHealthV1(await options.adapter.healthCheck());
        const observedAt = now();
        if (
          health.status !== "ready" ||
          !health.sharedAcrossReplicas ||
          Math.abs(observedAt.getTime() - Date.parse(health.checkedAt)) > 60_000 ||
          controller.signal.aborted
        )
          throw new Error("Guardian enforcement is unavailable.");
        const refs = await options.resolveActiveProjectionRefs({
          siteId: context.siteId,
          signal: controller.signal,
        });
        if (refs.length > NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX || controller.signal.aborted)
          throw new Error("Guardian projection coverage is unavailable.");
        const candidates = new Map<string, NpAgentRestrictionSubjectV1>();
        const project = (projection: NpAgentGuardianActorProjectionV1) => {
          const subject: NpAgentRestrictionSubjectV1 = {
            kind: "opaque_actor_bucket",
            ...projection.project({
              siteId: context.siteId,
              purpose: "network-address",
              value: context.networkAddress,
            }),
          };
          candidates.set(npAgentRestrictionSubjectKeyV1(subject), subject);
        };
        project(current);
        for (const ref of refs) {
          const projection = projections.get(ref.keyId);
          if (
            ref.purpose !== "network-address" ||
            !projection ||
            ref.projectionVersion !== projection.projectionVersion ||
            ref.projectionFingerprint !== projection.projectionFingerprint
          )
            throw new Error("A frozen Guardian projection is unavailable.");
          project(projection);
        }
        if (candidates.size > NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX)
          throw new Error("Guardian projection candidate limit exceeded.");
        const check = npRequireAgentRestrictionCheckV1({
          schemaVersion: "np.agent-restriction-check.v1",
          siteId: context.siteId,
          subjects: [...candidates]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, value]) => value),
          actionScope,
          observedAt: now().toISOString(),
        });
        if (controller.signal.aborted) return null;
        const decision = npRequireAgentRestrictionDecisionV1(
          await options.adapter.check(check, { signal: controller.signal }),
          check,
        );
        if (controller.signal.aborted) return null;
        if (decision.decision === "allow") return null;
        if (decision.restrictionId === null || decision.expiresAt === null)
          throw new Error("Invalid Guardian denial binding.");
        const remaining = Date.parse(decision.expiresAt) - now().getTime();
        if (remaining <= 0 || remaining > 3_600_000) throw new Error("Invalid Guardian expiry.");
        return {
          schemaVersion: "np.agent-guardian-request-denial.v1" as const,
          restrictionId: decision.restrictionId,
          expiresAt: decision.expiresAt,
        };
      } catch {
        degraded();
        return null;
      } finally {
        inFlight--;
      }
    })();
    try {
      return await Promise.race([
        work,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            degraded();
            resolve(null);
          }, budget);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
