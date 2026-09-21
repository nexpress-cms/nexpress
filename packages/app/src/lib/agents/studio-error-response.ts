import { randomUUID } from "node:crypto";
import {
  npApiErrorDiagnosticsHeader,
  npIsApiError,
  type NpApiErrorDiagnosticsV1,
} from "@nexpress/core/api-contract";
import { getLogger } from "@nexpress/core/observability";
import { npErrorResponse } from "../api-response";
import { normalizeAgentStudioError } from "./studio-admin";

function recovery(
  status: number,
  code: string,
  operation: "read" | "mutation",
): NpApiErrorDiagnosticsV1["recovery"] {
  if (status === 401 || (status === 403 && code === "RECENT_REAUTHENTICATION_REQUIRED"))
    return "reauthenticate";
  if (status === 409) return "reconcile";
  // A rejected/failed mutation is never permission to repeat it. In particular,
  // a lost downstream result may follow a committed write or consumed one-time value.
  if (operation === "mutation" && status >= 500) return "check-outcome";
  if (operation === "read" && [429, 502, 503, 504].includes(status)) return "retry-read";
  return "none";
}

/**
 * Studio-only additive transport; the shipped exact error body is unchanged.
 * Callers declare an operation from their route/service contract, not request data.
 * The reference correlates a safe logger event submission. The fail-safe logger
 * offers no acknowledgement that an adapter persisted or delivered that event.
 */
export async function agentStudioErrorResponse(
  error: unknown,
  operation: "read" | "mutation",
  init?: Parameters<typeof npErrorResponse>[1],
): Promise<Response> {
  const response = npErrorResponse(normalizeAgentStudioError(error), init);
  response.headers.delete(npApiErrorDiagnosticsHeader);
  if (
    !response.headers
      .get("cache-control")
      ?.split(",")
      .some((part) => part.trim().toLowerCase() === "no-store")
  )
    response.headers.set("cache-control", "private, no-store");
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!npIsApiError(body) || body.status !== response.status) return response;
  const diagnostics: NpApiErrorDiagnosticsV1 = {
    version: 1,
    status: body.status,
    code: body.error.code,
    supportReference: randomUUID(),
    recovery: recovery(body.status, body.error.code, operation),
  };
  getLogger().warn("Agent Studio request failed", {
    supportReference: diagnostics.supportReference,
    status: diagnostics.status,
    code: diagnostics.code,
    operation,
  });
  response.headers.set(npApiErrorDiagnosticsHeader, JSON.stringify(diagnostics));
  return response;
}
