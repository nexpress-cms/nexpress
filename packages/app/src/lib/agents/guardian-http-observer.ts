import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  npAgentGuardianRouteFamiliesV1,
  type NpAgentGuardianRouteFamilyV1,
} from "@nexpress/core/agent-contract";
import {
  getOptionalAgentStudioServerRuntimeV1,
  type NpAgentGuardianHttpObservationServiceV1,
} from "@nexpress/core/agents";
import { ensureFor } from "../init-core";
import { resolveAuthRequestContext } from "./guardian-request-observer";

export interface NpAgentGuardianHttpResponseObservationV1 {
  request: Request;
  status: number;
  routeFamily: NpAgentGuardianRouteFamilyV1;
}
export interface NpAgentGuardianHttpResponseObserverOptionsV1 {
  guardian: Pick<NpAgentGuardianHttpObservationServiceV1, "observe"> | null;
  ensureReady(): Promise<void>;
  /** Existing trusted host owner; no admin picker, route/query/body or account chooses the site. */
  resolveRequest(request: Request): Promise<{ siteId: string; networkAddress: string } | null>;
}

/** Owns only completed response status. It never receives or reads a response body. */
export function npCreateAgentGuardianHttpResponseObserverV1(
  options: NpAgentGuardianHttpResponseObserverOptionsV1,
) {
  const guardian = options.guardian;
  const seen = new WeakSet<Request>();
  return async ({
    request,
    status,
    routeFamily,
  }: NpAgentGuardianHttpResponseObservationV1): Promise<void> => {
    if (
      !guardian ||
      (status !== 401 && status !== 403 && status !== 404) ||
      !npAgentGuardianRouteFamiliesV1.includes(routeFamily) ||
      seen.has(request)
    )
      return;
    seen.add(request);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await options.ensureReady();
          if (!active) return;
          const context = await options.resolveRequest(request);
          if (!active || !context || isIP(context.networkAddress) === 0) return;
          await guardian.observe({
            ...context,
            status,
            routeFamily,
            observationId: randomUUID(),
            occurredAt: new Date().toISOString(),
          });
        })(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 750);
        }),
      ]);
    } catch {
      // Failure cannot replace a completed response, retry its handler or change enforcement.
    } finally {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
const observedRequests = new WeakSet<Request>();
/** Optional host source. Absence performs no bootstrap, site lookup or SQL. */
export async function npObserveInstalledAgentGuardianHttpResponseV1(
  input: NpAgentGuardianHttpResponseObservationV1,
): Promise<void> {
  if (input.status !== 401 && input.status !== 403 && input.status !== 404) return;
  try {
    // Preserve the existing host forwarding policy; unknown metadata never becomes an invented bucket.
    const address = input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!address || isIP(address) === 0) return;
    const guardian = getOptionalAgentStudioServerRuntimeV1()?.guardianHttp;
    if (!guardian || observedRequests.has(input.request)) return;
    observedRequests.add(input.request);
    await npCreateAgentGuardianHttpResponseObserverV1({
      guardian,
      ensureReady: () => ensureFor("read"),
      resolveRequest: resolveAuthRequestContext,
    })(input);
  } catch {
    // Optional installation lookup cannot replace an already completed response.
  }
}
/** Return the same final response instance, including all existing headers, cookies and streams. */
export async function npFinalizeAgentGuardianHttpResponseV1<T extends Response>(
  request: Request,
  routeFamily: NpAgentGuardianRouteFamilyV1,
  response: T,
): Promise<T> {
  await npObserveInstalledAgentGuardianHttpResponseV1({
    request,
    routeFamily,
    status: response.status,
  });
  return response;
}
export function npWithAgentGuardianHttpResponseV1<
  RequestType extends Request,
  Args extends unknown[],
  Result extends Response,
>(
  routeFamily: NpAgentGuardianRouteFamilyV1,
  handler: (request: RequestType, ...args: Args) => Promise<Result>,
): (request: RequestType, ...args: Args) => Promise<Result> {
  return async (request, ...args) =>
    npFinalizeAgentGuardianHttpResponseV1(request, routeFamily, await handler(request, ...args));
}

/** Preserve no-argument discovery/setup callers while accepting the real host Request. */
export function npWithAgentGuardianHttpOptionalRequestV1<Result extends Response>(
  routeFamily: NpAgentGuardianRouteFamilyV1,
  handler: () => Promise<Result>,
): (request?: Request) => Promise<Result> {
  return async (request) => {
    const response = await handler();
    return request
      ? npFinalizeAgentGuardianHttpResponseV1(request, routeFamily, response)
      : response;
  };
}
