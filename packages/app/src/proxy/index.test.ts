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
  afterEach(async () => {
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
