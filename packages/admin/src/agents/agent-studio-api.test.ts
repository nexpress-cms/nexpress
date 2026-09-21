import { describe, expect, it } from "vitest";
import {
  AgentStudioApiError,
  agentRetryAt,
  principalAccessLostMessage,
  responseError,
} from "./agent-studio-api.js";

describe("Agent Studio safe HTTP errors", () => {
  it("preserves the shared API error code and HTTP status for access-loss handling", async () => {
    const error = await responseError(
      Response.json(
        {
          status: 403,
          error: { code: "ACTIVITY_FORBIDDEN", message: "Activity permission is required." },
        },
        { status: 403 },
      ),
    );
    expect(error).toBeInstanceOf(AgentStudioApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "ACTIVITY_FORBIDDEN",
      message: "Activity permission is required.",
    });
  });
  it.each([
    new Response("upstream private diagnostic", { status: 502 }),
    Response.json({ message: "upstream private diagnostic" }, { status: 502 }),
    Response.json(
      { status: 403, error: { code: "UPSTREAM_FAILURE", message: "upstream private diagnostic" } },
      { status: 502 },
    ),
  ])("discards opaque or status-mismatched upstream bodies", async (response) => {
    const error = await responseError(response);
    expect(error).toMatchObject({
      status: 502,
      code: "HTTP_ERROR",
      message: "Request failed (502)",
    });
    expect(error.message).not.toContain("private diagnostic");
  });
});

describe("Principal authorization-loss guidance", () => {
  it("explains the existing reauthentication floor using only its stable code", () => {
    expect(
      principalAccessLostMessage(
        new AgentStudioApiError("opaque upstream message", 403, "RECENT_REAUTHENTICATION_REQUIRED"),
      ),
    ).toBe("Recent staff-primary reauthentication is required. Reauthenticate and reload.");
  });
  it.each([401, 403, 404])("keeps other access-loss responses generic (%s)", (status) => {
    expect(
      principalAccessLostMessage(
        new AgentStudioApiError("opaque upstream message", status, "ACTIVITY_FORBIDDEN"),
      ),
    ).toBe("This principal is unavailable or you no longer have access.");
  });
});

describe("Agent Studio server retry deadlines", () => {
  const now = Date.parse("2026-09-19T00:00:00Z");
  it("accepts seconds and HTTP dates without creating a deadline for other failures", () => {
    const response = (value: string, status = 429) =>
      new Response(null, { status, headers: { "Retry-After": value } });
    expect(agentRetryAt(response("30"), now)).toBe(now + 30_000);
    expect(agentRetryAt(response("Sat, 19 Sep 2026 00:01:00 GMT"), now)).toBe(now + 60_000);
    expect(agentRetryAt(response("Fri, 18 Sep 2026 00:00:00 GMT"), now)).toBe(now);
    expect(agentRetryAt(response("30", 403), now)).toBeUndefined();
    for (const value of ["-1", "1.5", "Infinity", "999999999999999999999", "2026-09-20", "garbage"])
      expect(agentRetryAt(response(value), now)).toBeUndefined();
  });
  it("preserves the safe error envelope and deadline together", async () => {
    const error = await responseError(
      Response.json(
        { status: 429, error: { code: "RATE_LIMITED", message: "Please wait." } },
        { status: 429, headers: { "Retry-After": "Sat, 19 Sep 2099 00:01:00 GMT" } },
      ),
    );
    expect(error).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      message: "Please wait.",
      retryAt: Date.parse("Sat, 19 Sep 2099 00:01:00 GMT"),
    });
  });
});

describe("Agent Studio versioned diagnostic transport", () => {
  const diagnostics = {
    version: 1,
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    supportReference: "12345678-1234-4234-8234-123456789abc",
    recovery: "check-outcome",
  };
  const body = { status: 503, error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" } };
  it("attaches server declarations only to their validated matching envelope", async () => {
    const error = await responseError(
      Response.json(body, {
        status: 503,
        headers: { "x-np-error-diagnostics": JSON.stringify(diagnostics) },
      }),
    );
    expect(error.diagnostics).toEqual(diagnostics);
    expect(error.status).toBe(503);
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
  });
  it.each([
    "private provider diagnostic",
    JSON.stringify({ ...diagnostics, status: 500 }),
    JSON.stringify({ ...diagnostics, code: "INTERNAL_ERROR" }),
    JSON.stringify({ ...diagnostics, secret: "private provider diagnostic" }),
    JSON.stringify({ ...diagnostics, recovery: "retry-mutation" }),
  ])("discards malformed, mismatched or expanded diagnostics", async (header) => {
    const error = await responseError(
      Response.json(body, {
        status: 503,
        headers: { "x-np-error-diagnostics": header },
      }),
    );
    expect(error.diagnostics).toBeUndefined();
    expect(error.message).toBe("Unavailable");
  });
  it("does not trust valid metadata accompanying an opaque response", async () => {
    const error = await responseError(
      new Response("private proxy text", {
        status: 503,
        headers: { "x-np-error-diagnostics": JSON.stringify(diagnostics) },
      }),
    );
    expect(error.diagnostics).toBeUndefined();
    expect(error.message).toBe("Request failed (503)");
  });
});
