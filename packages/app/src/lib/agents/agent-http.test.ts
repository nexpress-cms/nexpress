import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  ensureFor: vi.fn(),
  authenticate: vi.fn(),
  capabilities: vi.fn(),
  invoke: vi.fn(),
  getRun: vi.fn(),
  readArtifact: vi.fn(),
  sites: [] as string[],
}));
vi.mock("@nexpress/core/agents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.getRuntime,
}));
vi.mock("@nexpress/core/sites", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  withCurrentSite: async (site: string, fn: () => Promise<unknown>) => {
    mocks.sites.push(site);
    return fn();
  },
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensureFor }));
import { handleAgentHttpRequest } from "./agent-http";
import { NpAgentHttpErrorV1 } from "@nexpress/core/agents";
function request(path = "capabilities", init: RequestInit = {}) {
  return new Request(`https://example.test/api/agent/v1/${path}`, {
    ...init,
    headers: { authorization: "Bearer private-test-value", ...init.headers },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.sites.length = 0;
  mocks.getRuntime.mockReturnValue({ agentHttp: mocks });
  mocks.authenticate.mockResolvedValue({ principal: { siteId: "credential-site" } });
  mocks.capabilities.mockResolvedValue({
    schemaVersion: "np.agent-http-capabilities.v1",
    capabilities: [],
  });
  mocks.getRun.mockRejectedValue(new NpAgentHttpErrorV1(404));
  mocks.readArtifact.mockRejectedValue(new NpAgentHttpErrorV1(404));
});
describe("Agent HTTP bounded route handler", () => {
  it("fails closed without installed gateway, ignores no caller site and uses credential-selected site", async () => {
    expect((await handleAgentHttpRequest(request(), "capabilities")).status).toBe(200);
    expect(mocks.sites).toEqual(["credential-site"]);
    expect(mocks.ensureFor.mock.calls).toEqual([["read"], ["plugins"]]);
    mocks.getRuntime.mockReturnValue(null);
    expect((await handleAgentHttpRequest(request(), "capabilities")).status).toBe(404);
  });
  it("rejects cookies, custom site, query and malformed JSON without invoking", async () => {
    for (const headers of [
      { cookie: "np-session=private" },
      { "x-np-admin-site": "other" },
    ] satisfies Record<string, string>[])
      expect(
        (
          await handleAgentHttpRequest(
            request("capabilities", {
              headers: Object.fromEntries(
                Object.entries(headers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              ),
            }),
            "capabilities",
          )
        ).status,
      ).toBe(401);
    expect(
      (await handleAgentHttpRequest(request("capabilities?siteId=other"), "capabilities")).status,
    ).toBe(404);
    for (const [body, headers] of [
      ["{", { "content-type": "application/json" }],
      ["{}", { "content-type": "text/plain" }],
      ["{}", { "content-type": "application/json", "content-length": "5242881" }],
    ] as const)
      expect(
        (
          await handleAgentHttpRequest(
            request("invocations", { method: "POST", body, headers }),
            "invocations",
          )
        ).status,
      ).toBe(400);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("caps streamed body independently of Content-Length", async () => {
    const result = await handleAgentHttpRequest(
      request("invocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '"' + "x".repeat(5242880) + '"',
      }),
      "invocations",
    );
    expect(result.status).toBe(400);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("rejects unsafe host projections and uses fixed safe artifact headers", async () => {
    mocks.capabilities.mockResolvedValue({
      schemaVersion: "np.agent-http-capabilities.v1",
      capabilities: [],
      credential: "private",
    });
    const response = await handleAgentHttpRequest(request(), "capabilities");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
    mocks.readArtifact.mockResolvedValue({
      bytes: new TextEncoder().encode("{}"),
      mime: "application/json",
      contentDigest: `ac1:sha256:${"A".repeat(43)}`,
    });
    const id = "00000000-0000-4000-8000-000000000001";
    const artifact = await handleAgentHttpRequest(
      request(`previews/${id}/artifacts/${id}`),
      "artifact",
      { previewId: id, artifactId: id },
    );
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get("content-disposition")).toBe(
      `attachment; filename="np-preview-${id}.json"`,
    );
    expect(artifact.headers.get("referrer-policy")).toBe("no-referrer");
    expect(artifact.headers.get("content-security-policy")).toMatch(
      /^default-src 'none'; script-src 'nonce-/u,
    );
  });
  it("normalizes missing and forbidden resources and hides internal failures", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const run = await handleAgentHttpRequest(request(`runs/${id}`), "run", { runId: id });
    const artifact = await handleAgentHttpRequest(
      request(`previews/${id}/artifacts/${id}`),
      "artifact",
      { previewId: id, artifactId: id },
    );
    expect(await run.json()).toEqual(await artifact.json());
    mocks.capabilities.mockRejectedValue(new Error("credential locator pii internal body"));
    const failure = await handleAgentHttpRequest(request(), "capabilities");
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toMatch(/credential|locator|pii/u);
    expect(failure.headers.get("cache-control")).toBe("no-store");
  });
});
