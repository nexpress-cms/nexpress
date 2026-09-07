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

export async function responseError(response: Response): Promise<AgentStudioApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The stable fallback deliberately ignores non-JSON provider/proxy bodies.
  }
  if (npIsApiError(body) && body.status === response.status) {
    return new AgentStudioApiError(body.error.message, body.status, body.error.code);
  }
  return new AgentStudioApiError(
    `Request failed (${response.status.toString()})`,
    response.status,
    "HTTP_ERROR",
  );
}

export async function loadAgentStudioOverview(): Promise<NpAgentStudioOverviewV1> {
  const response = await npFetch("/api/admin/agents/overview", { cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  return npRequireAgentStudioOverviewV1(await response.json());
}

export async function loadAgentOauthClients(): Promise<NpAgentOauthClientV1[]> {
  const response = await npFetch("/api/admin/agents/gateway/oauth-clients", { cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  const body: unknown = await response.json();
  if (!Array.isArray(body) || body.length > 100) throw new Error("Invalid OAuth client list.");
  return body.map(npRequireAgentOauthClientV1);
}
