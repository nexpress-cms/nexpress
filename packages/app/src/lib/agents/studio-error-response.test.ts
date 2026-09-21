import { beforeEach, describe, expect, it, vi } from "vitest";
import { NpError, NpAuthError, NpForbiddenError, NpServiceUnavailableError } from "@nexpress/core";
import {
  npApiErrorDiagnosticsHeader,
  npIsApiError,
  type NpApiError,
  npParseApiErrorDiagnosticsV1,
} from "@nexpress/core/api-contract";
import { NextResponse } from "next/server";
import type * as ApiResponse from "../api-response";
const mocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../auth-helpers", () => ({ getAuthRuntimeConfig: vi.fn(), requireAuth: vi.fn() }));
vi.mock("@nexpress/core/observability", () => ({ getLogger: () => ({ warn: mocks.warn }) }));
vi.mock("../api-response", async (original) => {
  const actual = await original<typeof ApiResponse>();
  return { ...actual, npErrorResponse: vi.fn(actual.npErrorResponse) };
});
import { npErrorResponse } from "../api-response";
import { agentStudioErrorResponse } from "./studio-error-response";

beforeEach(() => vi.clearAllMocks());
async function diagnostics(response: Response) {
  const body: unknown = await response.clone().json();
  if (!npIsApiError(body)) throw new Error("Expected exact safe error envelope");
  return npParseApiErrorDiagnosticsV1(response.headers.get(npApiErrorDiagnosticsHeader), {
    status: response.status,
    code: body.error.code,
  });
}

describe("Agent Studio diagnostic response", () => {
  it("correlates fresh references to bounded safe events without changing the error body", async () => {
    const error = new NpServiceUnavailableError("Management is unavailable.");
    const first = await agentStudioErrorResponse(error, "read", {
      headers: {
        [npApiErrorDiagnosticsHeader]: "untrusted-reference",
        "retry-after": "30",
        "referrer-policy": "no-referrer",
        "set-cookie": "test=; Max-Age=0",
      },
    });
    const second = await agentStudioErrorResponse(error, "read", {
      headers: { "cache-control": "no-store" },
    });
    expect(second.headers.get("cache-control")).toBe("no-store");
    const metadata = await diagnostics(first);
    expect(metadata).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      recovery: "retry-read",
    });
    expect((await diagnostics(second))?.supportReference).not.toBe(metadata?.supportReference);
    expect(await first.json()).toEqual(await npErrorResponse(error).json());
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("retry-after")).toBe("30");
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");
    expect(first.headers.get("set-cookie")).toBe("test=; Max-Age=0");
    expect(mocks.warn).toHaveBeenNthCalledWith(1, "Agent Studio request failed", {
      supportReference: metadata?.supportReference,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      operation: "read",
    });
  });

  it("keeps provider text and exception details out of the correlated event and response", async () => {
    const response = await agentStudioErrorResponse(
      new Error("secret-provider-payload"),
      "mutation",
    );
    expect(await diagnostics(response)).toMatchObject({
      code: "INTERNAL_ERROR",
      recovery: "check-outcome",
    });
    expect(await response.text()).not.toContain("secret-provider-payload");
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("secret-provider-payload");
    expect(response.headers.get(npApiErrorDiagnosticsHeader)).not.toContain(
      "secret-provider-payload",
    );
  });

  it("distinguishes declared safe reads from uncertain mutation outcomes and rate limits", async () => {
    for (const status of [429, 502, 503, 504]) {
      const error = new NpError("Temporarily unavailable", "CUSTOM_TRANSIENT", status);
      expect((await diagnostics(await agentStudioErrorResponse(error, "read")))?.recovery).toBe(
        "retry-read",
      );
      expect((await diagnostics(await agentStudioErrorResponse(error, "mutation")))?.recovery).toBe(
        status === 429 ? "none" : "check-outcome",
      );
    }
    expect(
      (
        await diagnostics(
          await agentStudioErrorResponse(new NpError("Invalid", "VALIDATION_ERROR", 400), "read"),
        )
      )?.recovery,
    ).toBe("none");
  });

  it("requires reconciliation for conflict and never invites retries for denied access", async () => {
    const cases = [
      [new NpError("Changed", "CONFLICT", 409), "reconcile"],
      [new NpAuthError(), "reauthenticate"],
      [new NpForbiddenError("agent-studio", "manage"), "none"],
      [new NpError("Verify session", "RECENT_REAUTHENTICATION_REQUIRED", 403), "reauthenticate"],
    ] as const;
    for (const [error, expected] of cases) {
      const response = await agentStudioErrorResponse(error, "mutation");
      expect(response.status).toBe(error.statusCode);
      expect((await diagnostics(response))?.recovery).toBe(expected);
    }
  });

  it("omits stale metadata and logging when the existing response cannot be validated", async () => {
    for (const body of [
      "provider-proxy-body",
      JSON.stringify({ error: { code: "CONFLICT", message: "Changed" }, status: 400 }),
    ]) {
      vi.mocked(npErrorResponse).mockReturnValueOnce(
        new NextResponse<NpApiError>(body, {
          status: 409,
          headers: { [npApiErrorDiagnosticsHeader]: "untrusted-reference" },
        }),
      );
      const response = await agentStudioErrorResponse(new Error("ignored"), "read");
      expect(response.headers.has(npApiErrorDiagnosticsHeader)).toBe(false);
      expect(await response.text()).toBe(body);
    }
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
