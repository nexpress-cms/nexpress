import { NpAuthError, NpError, NpForbiddenError, NpValidationError, can } from "@nexpress/core";
import { verifyToken } from "@nexpress/core/auth";
import { NpAgentProviderError } from "@nexpress/core/agents";
import {
  npAnalyzeAgentActivityQueryV1,
  type NpAgentActivityKindV1,
} from "@nexpress/core/agent-contract";
import { requireSiteId } from "@nexpress/core/sites";
import type { NextRequest } from "next/server";

import { getAuthRuntimeConfig, requireAuth } from "../auth-helpers";

/** HTTP decoding only; the shared Activity contract owns the allowed keys and values. */
export function readAgentActivityQuery(request: NextRequest, kind: NpAgentActivityKindV1) {
  const invalid = () =>
    new NpValidationError("Invalid Activity query", [
      { field: "query", message: "Use one bounded value per supported Activity filter." },
    ]);
  if (request.nextUrl.search.length > 8192) throw invalid();
  const values: Record<string, unknown> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.hasOwn(values, key)) throw invalid();
    if (key === "limit") {
      if (!/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
      Object.defineProperty(values, key, { value: Number(value), enumerable: true });
    } else Object.defineProperty(values, key, { value, enumerable: true });
  }
  const result = npAnalyzeAgentActivityQueryV1(kind, values);
  if (!result.ok) throw invalid();
  return result.value;
}

export async function requireAgentStudioAdmin(request: NextRequest) {
  const user = await requireAuth(request);
  if (!can(user, "admin.manage")) {
    throw new NpForbiddenError("agent-studio", "manage");
  }
  const token = request.cookies.get("np-session")?.value;
  if (!token) throw new NpAuthError();
  const payload = await verifyToken(token, getAuthRuntimeConfig().secret, "access");
  if (payload.sub !== user.id) throw new NpAuthError();
  return {
    siteId: await requireSiteId(),
    actor: { user, sessionId: payload.sid },
  };
}

export async function requireAgentOauthStaff(request: NextRequest) {
  const user = await requireAuth(request);
  const token = request.cookies.get("np-session")?.value;
  if (!token) throw new NpAuthError();
  const payload = await verifyToken(token, getAuthRuntimeConfig().secret, "access");
  if (payload.sub !== user.id) throw new NpAuthError();
  return {
    siteId: await requireSiteId(),
    actor: { user, sessionId: payload.sid },
  };
}

/** Convert only stable Agent provider failures; opaque schema/provider bodies never reach HTTP. */
export function normalizeAgentStudioError(error: unknown): Error {
  if (error instanceof NpError) return error;
  if (error instanceof NpAgentProviderError) {
    const status = error.code.includes("NOT_FOUND")
      ? 404
      : error.code.includes("CONFLICT") || error.code.includes("MISMATCH")
        ? 409
        : error.code.includes("UNAVAILABLE")
          ? 503
          : 400;
    return new NpError(error.message, error.code, status);
  }
  if (error instanceof SyntaxError) {
    return new NpValidationError("Invalid input", [
      { field: "request", message: "Request JSON is invalid." },
    ]);
  }
  return error instanceof Error ? error : new Error("Unknown Agent Studio error");
}
