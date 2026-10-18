import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const owners = vi.hoisted(() => ({ runtime: vi.fn(), publicSite: vi.fn() }));
vi.mock("@nexpress/core/agents", () => ({
  getOptionalAgentStudioServerRuntimeV1: owners.runtime,
}));
vi.mock("@nexpress/core/sites", () => ({ resolveSiteForHostname: owners.publicSite }));

import {
  npCreateAgentGuardianRequestObserverV1,
  npObserveInstalledAgentGuardianLoginFailureV1,
} from "./guardian-request-observer.js";

const request = (headers: Record<string, string> = {}) =>
  new NextRequest("https://public.example/api/auth/login?private=query", { headers });
const observation = (req = request()) => ({
  request: req,
  audience: "staff" as const,
  loginIdentifier: "person@example.test",
});
const result = { disposition: "recorded" as const, eventId: null, incidentId: null };

beforeEach(() => vi.resetAllMocks());
describe("Guardian request source trust boundary", () => {
  it("does no initialization or resolution when Guardian is unavailable", async () => {
    const ensureReady = vi.fn();
    const resolveRequest = vi.fn();
    const source = npCreateAgentGuardianRequestObserverV1({
      guardian: null,
      ensureReady,
      resolveRequest,
    });
    await source.onLoginFailure(observation());
    await source.onRateLimited({ request: request(), routeFamily: "staff-auth" });
    expect(ensureReady).not.toHaveBeenCalled();
    expect(resolveRequest).not.toHaveBeenCalled();
    owners.runtime.mockReturnValue(null);
    await npObserveInstalledAgentGuardianLoginFailureV1(observation());
    expect(owners.publicSite).not.toHaveBeenCalled();
  });

  it("initializes its own runtime before trusted site/address resolution and stamps each source", async () => {
    const order: string[] = [];
    const observe = vi.fn().mockResolvedValue(result);
    const req = request({ "x-np-admin-site": "other-site", cookie: "np-admin-site=other-site" });
    const source = npCreateAgentGuardianRequestObserverV1({
      guardian: { observe },
      ensureReady: () => {
        order.push("ready");
        return Promise.resolve();
      },
      resolveRequest: (actual) => {
        expect(actual).toBe(req);
        order.push("resolved");
        return Promise.resolve({ siteId: "trusted-site", networkAddress: "203.0.113.8" });
      },
    });
    await source.onLoginFailure(observation(req));
    await source.onRateLimited({ request: req, routeFamily: "collections" });
    expect(order).toEqual(["ready", "resolved", "ready", "resolved"]);
    expect(observe).toHaveBeenCalledTimes(2);
    const [login, rate] = observe.mock.calls.map(([input]) => input);
    expect(login).toEqual({
      siteId: "trusted-site",
      networkAddress: "203.0.113.8",
      kind: "login-failed",
      audience: "staff",
      loginIdentifier: "person@example.test",
      observationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      occurredAt: expect.any(String),
    });
    expect(new Date(login.occurredAt).toISOString()).toBe(login.occurredAt);
    expect(rate).toEqual({
      siteId: "trusted-site",
      networkAddress: "203.0.113.8",
      kind: "rate-limited",
      routeFamily: "collections",
      observationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      occurredAt: expect.any(String),
    });
    expect(login.observationId).not.toBe(rate.observationId);
    expect(JSON.stringify(observe.mock.calls)).not.toContain("private=query");
    expect(JSON.stringify(observe.mock.calls)).not.toContain("other-site");
  });

  it("contains initialization, resolution and storage failures without retries", async () => {
    const observe = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const ensureReady = vi.fn().mockResolvedValue(undefined);
    const resolveRequest = vi.fn().mockResolvedValue({ siteId: "site-a", networkAddress: "::1" });
    const source = npCreateAgentGuardianRequestObserverV1({
      guardian: { observe },
      ensureReady,
      resolveRequest,
    });
    ensureReady.mockRejectedValueOnce(new Error("bootstrap unavailable"));
    await expect(source.onLoginFailure(observation())).resolves.toBeUndefined();
    expect(resolveRequest).not.toHaveBeenCalled();
    resolveRequest.mockRejectedValueOnce(new Error("site unavailable"));
    await expect(source.onLoginFailure(observation())).resolves.toBeUndefined();
    expect(observe).not.toHaveBeenCalled();
    await expect(source.onLoginFailure(observation())).resolves.toBeUndefined();
    expect(observe).toHaveBeenCalledOnce();
    for (const invalid of [null, { siteId: "site-a", networkAddress: "unknown" }]) {
      resolveRequest.mockResolvedValueOnce(invalid);
      await source.onLoginFailure(observation());
    }
    expect(observe).toHaveBeenCalledOnce();
  });

  it("uses the public hostname and ignores hostile admin headers/cookies on auth observations", async () => {
    const observe = vi.fn().mockResolvedValue(result);
    owners.runtime.mockReturnValue({ guardian: { observe } });
    owners.publicSite.mockResolvedValue({ id: "public-site" });
    await npObserveInstalledAgentGuardianLoginFailureV1(
      observation(
        request({
          "x-forwarded-for": "203.0.113.8, 192.0.2.1",
          "x-real-ip": "192.0.2.5",
          "x-np-admin-site": "hostile-site",
          "x-np-host": "hostile.example",
          cookie: "np-admin-site=hostile-site",
        }),
      ),
    );
    expect(owners.publicSite).toHaveBeenCalledExactlyOnceWith("public.example");
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "public-site",
        networkAddress: "203.0.113.8",
        kind: "login-failed",
      }),
    );
    expect(JSON.stringify(observe.mock.calls)).not.toContain("hostile");
  });

  it("drops missing/invalid forwarded addresses and unresolved public sites", async () => {
    const observe = vi.fn().mockResolvedValue(result);
    owners.runtime.mockReturnValue({ guardian: { observe } });
    const invalidHeaders: Record<string, string>[] = [
      {},
      { "x-forwarded-for": "unknown" },
      { "x-real-ip": "203.0.113.8" },
    ];
    for (const headers of invalidHeaders) {
      await npObserveInstalledAgentGuardianLoginFailureV1(observation(request(headers)));
    }
    expect(owners.publicSite).not.toHaveBeenCalled();
    owners.publicSite.mockResolvedValue(null);
    await npObserveInstalledAgentGuardianLoginFailureV1(
      observation(request({ "x-forwarded-for": "::1" })),
    );
    expect(owners.publicSite).toHaveBeenCalledOnce();
    expect(observe).not.toHaveBeenCalled();
  });
});
