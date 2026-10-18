import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { npAgentGuardianRouteFamiliesV1 } from "@nexpress/core/agent-contract";
import type {
  NpAgentGuardianObservationServiceV1,
  NpAgentGuardianObservationV1,
} from "@nexpress/core/agents";
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import { resolveSiteForHostname } from "@nexpress/core/sites";
import type { NpLoginFailureObservation } from "@nexpress/auth-pages/server";
import type { NextRequest } from "next/server";

import type { NpProxyRateLimitObserver } from "../../proxy/index.js";

export interface NpAgentGuardianRequestObserverOptionsV1 {
  guardian: NpAgentGuardianObservationServiceV1 | null;
  /** Initialize this entrypoint's runtime, including the proxy when used there. */
  ensureReady: () => Promise<void>;
  /** Host-owned trust boundary. Never derive site authority from an admin cookie.
   * Forwarded address headers are trustworthy only under the host's proxy policy. */
  resolveRequest: (request: NextRequest) => Promise<{
    siteId: string;
    networkAddress: string;
  } | null>;
}

/** Optional, awaited and contained observations. No authentication or rate-limit
 * outcome is returned or changed; each invocation owns its source identity. */
export function npCreateAgentGuardianRequestObserverV1(
  options: NpAgentGuardianRequestObserverOptionsV1,
): {
  onLoginFailure: (input: NpLoginFailureObservation) => Promise<void>;
  onRateLimited: NpProxyRateLimitObserver;
} {
  const record = async (
    request: NextRequest,
    source:
      | Pick<
          Extract<NpAgentGuardianObservationV1, { kind: "login-failed" }>,
          "kind" | "audience" | "loginIdentifier"
        >
      | Pick<
          Extract<NpAgentGuardianObservationV1, { kind: "rate-limited" }>,
          "kind" | "routeFamily"
        >,
  ): Promise<void> => {
    if (!options.guardian) return;
    try {
      await options.ensureReady();
      const context = await options.resolveRequest(request);
      if (!context || isIP(context.networkAddress) === 0) return;
      await options.guardian.observe({
        siteId: context.siteId,
        networkAddress: context.networkAddress,
        ...source,
        observationId: randomUUID(),
        occurredAt: new Date().toISOString(),
      });
    } catch {
      // Observation availability must not turn into auth/traffic availability.
    }
  };
  return {
    onLoginFailure: ({ request, audience, loginIdentifier }) =>
      record(request, { kind: "login-failed", audience, loginIdentifier }),
    onRateLimited: ({ request, routeFamily }) => {
      if (!npAgentGuardianRouteFamiliesV1.includes(routeFamily)) return;
      return record(request, { kind: "rate-limited", routeFamily });
    },
  };
}

/** Auth factories call this only after their existing write initialization.
 * Public hostname resolution follows the normal default-site fallback and
 * never consumes the staff admin-site picker or its forwarded header. */
export async function npObserveInstalledAgentGuardianLoginFailureV1(
  input: NpLoginFailureObservation,
): Promise<void> {
  const guardian = getOptionalAgentStudioServerRuntimeV1()?.guardian;
  if (!guardian) return;
  await npCreateAgentGuardianRequestObserverV1({
    guardian,
    ensureReady: () => Promise.resolve(),
    resolveRequest: async (request) => {
      // Identical extraction to the auth session's existing request metadata.
      // The deployment must supply a trusted forwarding/proxy configuration.
      const networkAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (!networkAddress || isIP(networkAddress) === 0) return null;
      const site = await resolveSiteForHostname(request.nextUrl.hostname);
      return site ? { siteId: site.id, networkAddress } : null;
    },
  }).onLoginFailure(input);
}
