import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const runtime = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@nexpress/core/agents", () => ({ getOptionalAgentStudioServerRuntimeV1: runtime.get }));
vi.mock("../init-core", () => ({ ensureFor: vi.fn() }));
vi.mock("./guardian-request-observer", () => ({ resolveAuthRequestContext: vi.fn() }));
import { getOptionalAgentStudioServerRuntimeV1 } from "@nexpress/core/agents";
import { ensureFor } from "../init-core";
import { resolveAuthRequestContext } from "./guardian-request-observer";
import {
  npCreateAgentGuardianHttpResponseObserverV1,
  npFinalizeAgentGuardianHttpResponseV1,
  npObserveInstalledAgentGuardianHttpResponseV1,
  npWithAgentGuardianHttpResponseV1,
  npWithAgentGuardianHttpOptionalRequestV1,
} from "./guardian-http-observer";
import type { NpAgentGuardianHttpObservationServiceV1 } from "@nexpress/core/agents";
const request = () =>
  new Request("https://example.test/api/admin/private?secret=private", {
    headers: { "x-forwarded-for": "192.0.2.81", cookie: "np-admin-site=other-site" },
  });
function fixture(installed = true) {
  const observe = vi
    .fn<Pick<NpAgentGuardianHttpObservationServiceV1, "observe">["observe"]>()
    .mockResolvedValue({ disposition: "recorded", eventId: "event", incidentId: null });
  const ensureReady = vi.fn(() => Promise.resolve()),
    resolveRequest = vi.fn(() =>
      Promise.resolve({ siteId: "default", networkAddress: "192.0.2.81" }),
    );
  return {
    observe,
    ensureReady,
    resolveRequest,
    observer: npCreateAgentGuardianHttpResponseObserverV1({
      guardian: installed ? { observe } : null,
      ensureReady,
      resolveRequest,
    }),
  };
}
describe("Guardian final HTTP response bridge", () => {
  it("does no bootstrap or metadata lookup while absent", async () => {
    const f = fixture(false);
    await f.observer({ request: request(), status: 403, routeFamily: "admin" });
    expect(f.ensureReady).not.toHaveBeenCalled();
    expect(f.resolveRequest).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    vi.mocked(getOptionalAgentStudioServerRuntimeV1).mockReturnValue(null);
    await npObserveInstalledAgentGuardianHttpResponseV1({
      request: request(),
      status: 403,
      routeFamily: "admin",
    });
    expect(ensureFor).not.toHaveBeenCalled();
  });
  it("passes only actual status plus trusted host metadata once without attacker path/body/cookie identity", async () => {
    const f = fixture(),
      req = request();
    await f.observer({ request: req, status: 404, routeFamily: "admin" });
    await f.observer({ request: req, status: 404, routeFamily: "admin" });
    expect(f.observe).toHaveBeenCalledTimes(1);
    expect(f.observe.mock.calls[0][0]).toEqual({
      siteId: "default",
      networkAddress: "192.0.2.81",
      status: 404,
      routeFamily: "admin",
      observationId: expect.any(String),
      occurredAt: expect.any(String),
    });
    expect(JSON.stringify(f.observe.mock.calls)).not.toContain("private");
    expect(JSON.stringify(f.observe.mock.calls)).not.toContain("other-site");
  });
  it("skips nontracked statuses and contains source failure", async () => {
    const f = fixture();
    for (const status of [200, 302, 429, 500])
      await f.observer({ request: request(), status, routeFamily: "admin" });
    expect(f.ensureReady).not.toHaveBeenCalled();
    f.observe.mockRejectedValue(new Error("unavailable"));
    await expect(
      f.observer({ request: request(), status: 401, routeFamily: "mcp" }),
    ).resolves.toBeUndefined();
  });
  it("preserves the same Response without reading body, replacing cookies or altering headers", async () => {
    vi.mocked(getOptionalAgentStudioServerRuntimeV1).mockReturnValue(null);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      { status: 404, headers: { "set-cookie": "private=retained", "x-private": "retained" } },
    );
    expect(await npFinalizeAgentGuardianHttpResponseV1(request(), "plugin-public", response)).toBe(
      response,
    );
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("set-cookie")).toBe("private=retained");
    expect(response.headers.get("x-private")).toBe("retained");
  });
  it("bounds stalled host metadata and prevents a late source call after returning", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let release: (() => void) | undefined;
      f.ensureReady.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
      const pending = f.observer({ request: request(), status: 404, routeFamily: "admin" });
      await vi.advanceTimersByTimeAsync(750);
      await expect(pending).resolves.toBeUndefined();
      release?.();
      await Promise.resolve();
      expect(f.resolveRequest).not.toHaveBeenCalled();
      expect(f.observe).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves Request/context and the exact NextResponse subtype while globally deduplicating nested finalizers", async () => {
    const f = fixture();
    runtime.get.mockReturnValue({ guardianHttp: { observe: f.observe } });
    vi.mocked(resolveAuthRequestContext).mockResolvedValue({
      siteId: "default",
      networkAddress: "192.0.2.81",
    });
    const response = NextResponse.json(
      { denied: true },
      { status: 403, headers: { "x-retained": "yes" } },
    );
    response.cookies.set("np-private", "retained");
    const req = new NextRequest("https://example.test/api/collections/private", {
      headers: { "x-forwarded-for": "192.0.2.81" },
    });
    const context = { params: Promise.resolve({ slug: "private" }) };
    const handler = vi.fn((actual: NextRequest, actualContext: typeof context) => {
      expect(actual).toBe(req);
      expect(actualContext).toBe(context);
      return Promise.resolve(response);
    });
    const wrapped = npWithAgentGuardianHttpResponseV1(
      "collections",
      npWithAgentGuardianHttpResponseV1("collections", handler),
    );
    const result: NextResponse = await wrapped(req, context);
    expect(result).toBe(response);
    expect(result.cookies.get("np-private")?.value).toBe("retained");
    expect(result.headers.get("x-retained")).toBe("yes");
    expect(result.bodyUsed).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(f.observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 403, routeFamily: "collections" }),
    );
  });
  it("preserves optional no-argument callers, actual final 404, and original thrown handler errors", async () => {
    const f = fixture();
    runtime.get.mockReturnValue({ guardianHttp: { observe: f.observe } });
    vi.mocked(resolveAuthRequestContext).mockResolvedValue({
      siteId: "default",
      networkAddress: "192.0.2.81",
    });
    const response = NextResponse.json({ missing: true }, { status: 404 });
    const handler = vi.fn(() => Promise.resolve(response));
    const optional = npWithAgentGuardianHttpOptionalRequestV1("cms", handler);
    const noArg: NextResponse = await optional();
    expect(noArg).toBe(response);
    expect(f.observe).not.toHaveBeenCalled();
    expect(await optional(request())).toBe(response);
    expect(f.observe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 404, routeFamily: "cms" }),
    );
    const error = new Error("actual handler failure");
    await expect(
      npWithAgentGuardianHttpResponseV1("community", (_request: Request) => Promise.reject(error))(
        request(),
      ),
    ).rejects.toBe(error);
    expect(f.observe).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 401, forwarded: null },
    { status: 403, forwarded: "" },
    { status: 404, forwarded: "not-an-address" },
    { status: 401, forwarded: "192.0.2.81:443" },
    { status: 403, forwarded: "invalid, 192.0.2.81" },
    { status: 404, forwarded: "2001:db8::invalid" },
  ])(
    "skips Runtime resolution and bootstrap for status $status with forwarded metadata $forwarded",
    async ({ status, forwarded }) => {
      const f = fixture();
      runtime.get.mockClear();
      runtime.get.mockReturnValue({ guardianHttp: { observe: f.observe } });
      vi.mocked(ensureFor).mockClear();
      vi.mocked(resolveAuthRequestContext).mockClear();
      const headers = new Headers();
      if (forwarded !== null) headers.set("x-forwarded-for", forwarded);
      await expect(
        npObserveInstalledAgentGuardianHttpResponseV1({
          request: new Request("https://example.test/api/admin/private", { headers }),
          status,
          routeFamily: "admin",
        }),
      ).resolves.toBeUndefined();
      expect(runtime.get).not.toHaveBeenCalled();
      expect(ensureFor).not.toHaveBeenCalled();
      expect(resolveAuthRequestContext).not.toHaveBeenCalled();
      expect(f.observe).not.toHaveBeenCalled();
    },
  );
  it.each(["runtime", "source"] as const)(
    "preserves the completed Response when the optional %s lookup throws",
    async (lookup) => {
      const error = new Error("Optional host installation unavailable");
      runtime.get.mockReset();
      if (lookup === "runtime")
        runtime.get.mockImplementation(() => {
          throw error;
        });
      else
        runtime.get.mockReturnValue({
          get guardianHttp() {
            throw error;
          },
        });
      vi.mocked(ensureFor).mockClear();
      vi.mocked(resolveAuthRequestContext).mockClear();
      const response = NextResponse.json(
        { denied: true },
        { status: 403, headers: { "x-retained": "yes" } },
      );
      response.cookies.set("np-private", "retained");
      await expect(
        npFinalizeAgentGuardianHttpResponseV1(request(), "admin", response),
      ).resolves.toBe(response);
      expect(response.cookies.get("np-private")?.value).toBe("retained");
      expect(response.headers.get("x-retained")).toBe("yes");
      expect(response.bodyUsed).toBe(false);
      expect(ensureFor).not.toHaveBeenCalled();
      expect(resolveAuthRequestContext).not.toHaveBeenCalled();
    },
  );
});
