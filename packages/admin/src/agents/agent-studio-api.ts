import type { NpAgentOauthClientV1, NpAgentStudioOverviewV1 } from "@nexpress/core/agent-contract";
import {
  npRequireAgentOauthClientV1,
  npRequireAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";
import { npIsApiError } from "@nexpress/core/api-contract";

import { npFetch } from "../lib/api-client.js";

export class AgentStudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "AgentStudioApiError";
  }
}

/** Keep authorization loss redacted while explaining the existing reauthentication floor. */
export function principalAccessLostMessage(error: AgentStudioApiError): string {
  return error.status === 403 && error.code === "RECENT_REAUTHENTICATION_REQUIRED"
    ? "Recent staff-primary reauthentication is required. Reauthenticate and reload."
    : "This principal is unavailable or you no longer have access.";
}

export function agentRetryAt(response: Response, now = Date.now()): number | undefined {
  if (response.status !== 429) return undefined;
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return undefined;
  const numeric = /^\d+$/.test(value);
  // Accept HTTP-date, not Date.parse's permissive numeric/locale date forms.
  if (
    !numeric &&
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  )
    return undefined;
  const deadline = numeric ? now + Number(value) * 1000 : Date.parse(value);
  if (!numeric && (!Number.isFinite(deadline) || new Date(deadline).toUTCString() !== value))
    return undefined;
  return Number.isSafeInteger(deadline) && deadline >= 0 && deadline <= 8.64e15
    ? Math.max(now, deadline)
    : undefined;
}

export async function responseError(response: Response): Promise<AgentStudioApiError> {
  const retryAt = agentRetryAt(response);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The stable fallback deliberately ignores non-JSON provider/proxy bodies.
  }
  if (npIsApiError(body) && body.status === response.status) {
    return new AgentStudioApiError(body.error.message, body.status, body.error.code, retryAt);
  }
  return new AgentStudioApiError(
    `Request failed (${response.status.toString()})`,
    response.status,
    "HTTP_ERROR",
    retryAt,
  );
}

export async function loadAgentStudioOverview(
  signal?: AbortSignal,
): Promise<NpAgentStudioOverviewV1> {
  const response = await npFetch("/api/admin/agents/overview", { cache: "no-store", signal });
  if (!response.ok) throw await responseError(response);
  try {
    return npRequireAgentStudioOverviewV1(await response.json());
  } catch {
    throw new AgentStudioApiError(
      "The Agent Studio response could not be validated.",
      502,
      "STUDIO_CONTRACT_ERROR",
    );
  }
}

export async function loadAgentOauthClients(signal?: AbortSignal): Promise<NpAgentOauthClientV1[]> {
  const response = await npFetch("/api/admin/agents/gateway/oauth-clients", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const body: unknown = await response.json();
  if (!Array.isArray(body) || body.length > 100) throw new Error("Invalid OAuth client list.");
  return body.map(npRequireAgentOauthClientV1);
}
