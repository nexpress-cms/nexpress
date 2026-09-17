import { afterEach, describe, expect, it, vi } from "vitest";
import { npRequireAgentRuntimeStudioMutationResultV1 } from "@nexpress/core/agent-contract";
import { AgentStudioApiError } from "./agent-studio-api.js";
import { runtimeErrorMessage, runtimeRequest } from "./agent-runtime-api.js";
import { npFetch } from "../lib/api-client.js";

vi.mock("../lib/api-client.js", () => ({ npFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("Runtime Studio client boundary", () => {
  it("uses shared fetch and rejects extra mutation output instead of retaining it", async () => {
    vi.mocked(npFetch).mockResolvedValue(
      Response.json({
        resourceId: "0195dd3e-55e6-7000-a111-111111111111",
        replayed: false,
        canonicalInput: { secret: "private-upstream-body" },
      }),
    );
    await expect(
      runtimeRequest(
        "/api/admin/agents/configurations",
        npRequireAgentRuntimeStudioMutationResultV1,
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "RUNTIME_CONTRACT_ERROR",
      message: "The Runtime response could not be validated.",
    });
    expect(npFetch).toHaveBeenCalledWith("/api/admin/agents/configurations", { cache: "no-store" });
  });
  it("preserves exact retry bytes and idempotency key through the shared HTTP request", async () => {
    const body = JSON.stringify({
      idempotencyKey: "same-reviewed-action",
      expectedVersion: 7,
      reason: "pause",
    });
    vi.mocked(npFetch)
      .mockResolvedValueOnce(new Response("private network detail", { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({ resourceId: "0195dd3e-55e6-7000-a111-111111111111", replayed: true }),
      );
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body };
    await expect(
      runtimeRequest(
        "/api/admin/agents/runtime/pause",
        npRequireAgentRuntimeStudioMutationResultV1,
        init,
      ),
    ).rejects.toMatchObject({ message: "Request failed (502)" });
    await expect(
      runtimeRequest(
        "/api/admin/agents/runtime/pause",
        npRequireAgentRuntimeStudioMutationResultV1,
        init,
      ),
    ).resolves.toMatchObject({ replayed: true });
    expect(vi.mocked(npFetch).mock.calls[0][1]).toEqual(vi.mocked(npFetch).mock.calls[1][1]);
  });
  it.each([401, 403, 404])("redacts authorization-loss prose for %i", (status) => {
    expect(
      runtimeErrorMessage(
        new AgentStudioApiError("private diagnostic", status, "RUNTIME_RESOURCE_UNAVAILABLE"),
      ),
    ).toBe("This Runtime resource is unavailable or you no longer have access.");
  });
  it("explains reauthentication and conflicts without exposing arbitrary exceptions", () => {
    expect(
      runtimeErrorMessage(
        new AgentStudioApiError("private", 403, "RECENT_REAUTHENTICATION_REQUIRED"),
      ),
    ).toContain("staff-primary reauthentication");
    expect(
      runtimeErrorMessage(new AgentStudioApiError("private", 409, "RUNTIME_VERSION_CONFLICT")),
    ).toContain("review the current version");
    expect(runtimeErrorMessage(new Error("private credential"))).not.toContain("private");
    expect(
      runtimeErrorMessage(new AgentStudioApiError("private", 400, "RUNTIME_MANUAL_INPUT_INVALID")),
    ).toContain("recipe input fields");
    expect(
      runtimeErrorMessage(
        new AgentStudioApiError("private", 409, "RUNTIME_MANUAL_INPUT_POLICY_DENIED"),
      ),
    ).toContain("sensitive-approved");
  });
});
