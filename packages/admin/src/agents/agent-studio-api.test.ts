import { describe, expect, it } from "vitest";
import {
  AgentStudioApiError,
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
