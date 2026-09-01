import type { NpAgentOauthClientV1, NpAgentStudioOverviewV1 } from "@nexpress/core/agent-contract";
import {
  npRequireAgentOauthClientV1,
  npRequireAgentStudioOverviewV1,
} from "@nexpress/core/agent-contract";

import { npFetch } from "../lib/api-client.js";

export async function responseError(response: Response): Promise<Error> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The stable fallback deliberately ignores non-JSON provider/proxy bodies.
  }
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length <= 2_000) return new Error(message);
  }
  return new Error(`Request failed (${response.status.toString()})`);
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
