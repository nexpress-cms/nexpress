import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npRequireApiError } from "@nexpress/core/api-contract";

function request(path = "/api/auth/login"): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "x-forwarded-for": "203.0.113.8" },
  });
}

async function loadModules() {
  vi.resetModules();
  const core = await import("@nexpress/core/rate-limit");
  const proxyModule = await import("./index.js");
  return { core, proxyModule };
}

describe("shared application proxy rate limiting", () => {
  it("observes only its own final CSRF 403 without changing that response or claiming downstream status", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const onResponse = vi.fn().mockRejectedValue(new Error("Synthetic observation failure"));
    const handler = proxyModule.npCreateProxy({
      rateLimiter: {
        kind: "redis",
        check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
      },
      onResponse,
    });
    const denied = new NextRequest("http://localhost/api/admin/private", { method: "POST" });
    const response = await handler(denied);
    expect(response.status).toBe(403);
    expect(onResponse).toHaveBeenCalledExactlyOnceWith({
      request: denied,
      status: 403,
      routeFamily: "admin",
    });
    expect((await response.json()).error.code).toBe("CSRF_INVALID");
    expect((await handler(request("/api/admin/private"))).status).toBe(200);
    expect(
      (await handler(new NextRequest("http://localhost/api/unclassified", { method: "POST" })))
        .status,
    ).toBe(403);
    expect(onResponse).toHaveBeenCalledTimes(1);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    const core = await import("@nexpress/core/rate-limit");
    core.setRateLimiter(null);
    vi.resetModules();
  });

  it("uses a directly injected custom adapter and emits a numeric Retry-After", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 17 });
    const handler = proxyModule.npCreateProxy({ rateLimiter: { kind: "redis", check } });

    const response = await handler(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(npRequireApiError(await response.json())).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
      status: 429,
    });
    expect(check).toHaveBeenCalledWith(expect.any(String), 10, 60_000);
  });

  it("enforces an explicit temporary Guardian denial before counting ordinary requests", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 });
    const onRateLimited = vi.fn();
    const onGuardianRequest = vi.fn().mockResolvedValue({
      schemaVersion: "np.agent-guardian-request-denial.v1",
      restrictionId: "00000000-0000-4000-8000-000000000001",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "redis", check },
      onRateLimited,
      onGuardianRequest,
    });
    const req = request();
    const response = await handler(req);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(response.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect(onGuardianRequest).toHaveBeenCalledExactlyOnceWith(req);
    expect(check).not.toHaveBeenCalled();
    expect(onRateLimited).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("00000000");
  });

  it("falls back to ordinary controls for unavailable, malformed and expired Guardian decisions", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 17 });
    const onGuardianRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        schemaVersion: "np.agent-guardian-request-denial.v1",
        restrictionId: "arbitrary",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce({
        schemaVersion: "np.agent-guardian-request-denial.v1",
        restrictionId: "00000000-0000-4000-8000-000000000001",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "redis", check },
      onGuardianRequest,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await handler(request());
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("17");
    }
    expect(check).toHaveBeenCalledTimes(3);
    await handler(request("/en"));
    expect(onGuardianRequest).toHaveBeenCalledTimes(3);
  });

  it("bounds a stalled explicit Guardian guard and resumes ordinary rate limiting", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 19 });
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "redis", check },
      onGuardianRequest: () => new Promise(() => undefined),
    });
    const pending = handler(request());
    await vi.advanceTimersByTimeAsync(500);
    const response = await pending;
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("19");
    expect(check).toHaveBeenCalledOnce();
  });

  it("rejects a custom adapter when runtime intent still says memory", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    expect(() =>
      proxyModule.npCreateProxy({
        rateLimiter: {
          kind: "redis",
          check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
        },
      }),
    ).toThrow(/NP_RATE_LIMIT_ADAPTER/u);
  });

  it("rejects a memory adapter that tries to satisfy custom runtime intent", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    expect(() =>
      proxyModule.npCreateProxy({
        rateLimiter: {
          kind: "memory",
          check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
        },
      }),
    ).toThrow(/must not be "memory"/u);
  });

  it("requires one exact plain proxy options object", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const rateLimiter = {
      kind: "redis",
      check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
    };

    expect(() => proxyModule.npCreateProxy({} as never)).toThrow(/exact \{ rateLimiter \}/u);
    expect(() => proxyModule.npCreateProxy({ rateLimiter, extra: true } as never)).toThrow(
      /exact \{ rateLimiter \}/u,
    );
    expect(() => proxyModule.npCreateProxy(Object.create({ rateLimiter }) as never)).toThrow(
      /exact \{ rateLimiter \}/u,
    );
    for (const onRateLimited of [null, undefined, {}, "observer"]) {
      expect(() => proxyModule.npCreateProxy({ rateLimiter, onRateLimited } as never)).toThrow(
        /exact \{ rateLimiter \}/u,
      );
    }
    expect(() =>
      proxyModule.npCreateProxy({ rateLimiter, onRateLimited: vi.fn(), extra: true } as never),
    ).toThrow(/exact \{ rateLimiter \}/u);
  });

  it("observes only enforced decisions with the fixed first-match family and contains observer failure", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 17 });
    const onRateLimited = vi.fn().mockRejectedValue(new Error("observation unavailable"));
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "redis", check },
      onRateLimited,
    });
    const req = request("/api/admin/jobs/secret-job/retry?token=private");
    const response = await handler(req);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(check).toHaveBeenCalledExactlyOnceWith(
      "203.0.113.8:^\\/api\\/admin\\/jobs\\/[^/]+\\/retry",
      30,
      60_000,
    );
    expect(onRateLimited).toHaveBeenCalledExactlyOnceWith({
      request: req,
      routeFamily: "job-retry",
    });
    check.mockResolvedValue({ limited: false, retryAfterSeconds: 60 });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request("/api/unknown"))).status).toBe(200);
    expect(onRateLimited).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("keeps private plugin paths out of the bounded observer family", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 5 });
    const onRateLimited = vi.fn();
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "memory", check },
      onRateLimited,
    });
    for (const [path, routeFamily, limit] of [
      ["/api/plugins/private-plugin/webhooks/private-id", "plugin-public", 30],
      ["/api/plugins/private-plugin/actions/private-action", "plugins", 60],
      ["/api/auth/login", "staff-auth", 10],
    ] as const) {
      const req = request(path);
      expect((await handler(req)).status).toBe(429);
      expect(onRateLimited).toHaveBeenLastCalledWith({ request: req, routeFamily });
      expect(check).toHaveBeenLastCalledWith(expect.any(String), limit, 60_000);
    }
  });

  it("fails closed when custom runtime intent has no proxy-local adapter", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    await expect(proxyModule.proxy(request())).rejects.toThrow(/npCreateProxy/u);
  });

  it("reads the current registered adapter instead of retaining the first one", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { core, proxyModule } = await loadModules();
    const first = vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 });
    const second = vi.fn().mockResolvedValue({ limited: true, retryAfterSeconds: 9 });

    core.setRateLimiter({ kind: "first", check: first });
    expect((await proxyModule.proxy(request())).status).toBe(200);
    core.setRateLimiter({ kind: "second", check: second });
    const response = await proxyModule.proxy(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("rejects a malformed decision instead of serializing an undefined header", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "custom");
    const { proxyModule } = await loadModules();
    const handler = proxyModule.npCreateProxy({
      rateLimiter: {
        kind: "bad-result",
        check: vi.fn().mockResolvedValue({ limited: true }) as never,
      },
    });

    await expect(handler(request())).rejects.toThrow(/retryAfterSeconds/u);
  });

  it("emits the same canonical contract for CSRF failures", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const handler = proxyModule.npCreateProxy({
      rateLimiter: {
        kind: "memory",
        check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
      },
    });
    const response = await handler(
      new NextRequest("http://localhost/api/collections/posts", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.8" },
      }),
    );

    expect(response.status).toBe(403);
    expect(npRequireApiError(await response.json())).toEqual({
      error: { code: "CSRF_INVALID", message: "Invalid CSRF token" },
      status: 403,
    });
  });

  it("allows anonymous view receipts without CSRF and rate-limits the route", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 });
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "memory", check },
    });

    const response = await handler(
      new NextRequest("http://localhost/api/views", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.8" },
      }),
    );

    expect(response.status).toBe(200);
    expect(check).toHaveBeenCalledWith(expect.any(String), 120, 60_000);
  });

  it("exempts only MCP token endpoints while keeping OAuth consent CSRF-protected", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 });
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "memory", check },
    });

    for (const path of ["/api/mcp", "/api/agent-oauth/token", "/api/agent-oauth/revoke"]) {
      const response = await handler(
        new NextRequest(`http://localhost${path}`, {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.8" },
        }),
      );
      expect(response.status, path).toBe(200);
    }

    const consent = await handler(
      new NextRequest("http://localhost/api/agent-oauth/authorize", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.8" },
      }),
    );
    expect(consent.status).toBe(403);
    expect(check).toHaveBeenCalledWith(expect.any(String), 30, 60_000);
  });

  it("exempts the exact Agent invocation path without opening adjacent Admin or Agent paths", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const handler = proxyModule.npCreateProxy({
      rateLimiter: {
        kind: "memory",
        check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
      },
    });
    for (const [path, status] of [
      ["/api/agent/v1/invocations", 200],
      ["/api/agents/security/sentry", 200],
      ["/api/agents/security/sentry/extra", 403],
      ["/api/agent/v1/invocations/extra", 403],
      ["/api/agent/v1/capabilities", 403],
      ["/api/admin/agents/gateway/principals", 403],
    ] as const) {
      expect(
        (await handler(new NextRequest(`http://localhost${path}`, { method: "POST" }))).status,
        path,
      ).toBe(status);
    }
  });

  it("bounds community SSE connection starts without blocking read access", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const check = vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 });
    const handler = proxyModule.npCreateProxy({
      rateLimiter: { kind: "memory", check },
    });

    const response = await handler(
      request("/api/community/events?scope=document&targetType=posts&targetId=target"),
    );

    expect(response.status).toBe(200);
    expect(check).toHaveBeenCalledWith(expect.any(String), 60, 60_000);
  });

  it("forwards the selected Admin site only to staff media-library routes", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const handler = proxyModule.npCreateProxy({
      rateLimiter: {
        kind: "memory",
        check: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 60 }),
      },
    });
    const makeRequest = (path: string) =>
      new NextRequest(`http://localhost${path}`, {
        headers: {
          cookie: "np-admin-site=tenant-a",
          "x-forwarded-for": "203.0.113.8",
        },
      });

    for (const path of [
      "/api/media",
      "/api/media/upload",
      "/api/media/folders",
      "/api/media/folders/11111111-1111-4111-8111-111111111111",
      "/api/media/11111111-1111-4111-8111-111111111111",
    ]) {
      const response = await handler(makeRequest(path));
      expect(response.headers.get("x-middleware-request-x-np-admin-site"), path).toBe("tenant-a");
    }

    const attachment = await handler(
      makeRequest("/api/media/attachments/11111111-1111-4111-8111-111111111111"),
    );
    expect(attachment.headers.get("x-middleware-request-x-np-admin-site")).toBeNull();
  });
});

describe("native Agent preview launch CSRF", () => {
  it("accepts only exact same-origin launch forms with matching staff CSRF", async () => {
    vi.stubEnv("NP_RATE_LIMIT_ADAPTER", "memory");
    const { proxyModule } = await loadModules();
    const id = "10000000-0000-4000-8000-000000000001";
    const path = `/api/admin/agents/changesets/${id}/previews/${id}/launch`;
    const form = (
      target = path,
      extra: Record<string, string> = {},
      cookie = "np-csrf=fixture-csrf",
    ) =>
      new NextRequest(`https://site.example${target}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://site.example",
          "sec-fetch-site": "same-origin",
          cookie,
          ...extra,
        },
        body: new URLSearchParams({ command: "{}", csrfToken: "fixture-csrf" }),
      });
    expect((await proxyModule.proxy(form())).status).toBe(200);
    for (const req of [
      form(path, { origin: "null" }),
      form(path, { "sec-fetch-site": "same-site" }),
      form(path, {}, "np-mb-csrf=fixture-csrf"),
      form("/api/admin/agents/changesets"),
      form(path, {}, "np-csrf=other"),
    ])
      expect((await proxyModule.proxy(req)).status).toBe(403);
    vi.unstubAllEnvs();
  });
});
