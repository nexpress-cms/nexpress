import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { npWithAuthResponseObserver } from "./response-observer.js";
describe("auth final response observation", () => {
  it("preserves the original handler when absent", () => {
    const handler = vi.fn(() => Promise.resolve(NextResponse.json({ ok: true })));
    expect(npWithAuthResponseObserver(handler, "staff", undefined)).toBe(handler);
  });
  it.each([401, 403, 404])(
    "observes final %i once and returns the exact untouched response",
    async (status) => {
      const response = new NextResponse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("private-body"));
            controller.close();
          },
        }),
        { status, headers: { "x-private": "retained" } },
      );
      response.cookies.set("np-refresh", "private-cookie");
      const observer = vi.fn(() => Promise.reject(new Error("observer unavailable")));
      const handler = vi.fn((_request: NextRequest, context: { value: number }) => {
        expect(context.value).toBe(7);
        return Promise.resolve(response);
      });
      const request = new NextRequest("https://example.test/api/auth/me");
      expect(
        await npWithAuthResponseObserver(handler, "staff", observer)(request, { value: 7 }),
      ).toBe(response);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledExactlyOnceWith({ request, audience: "staff", status });
      expect(response.bodyUsed).toBe(false);
      expect(response.headers.get("x-private")).toBe("retained");
      expect(response.cookies.get("np-refresh")?.value).toBe("private-cookie");
    },
  );
  it("does not relabel success, redirect, rate limiting or a rejected handler as HTTP source facts", async () => {
    const observer = vi.fn();
    const request = new NextRequest("https://example.test/api/members/me");
    for (const status of [200, 302, 429, 500])
      await npWithAuthResponseObserver(
        () => Promise.resolve(new NextResponse(null, { status })),
        "member",
        observer,
      )(request);
    await expect(
      npWithAuthResponseObserver(
        () => Promise.reject(new Error("no final response")),
        "member",
        observer,
      )(request),
    ).rejects.toThrow("no final response");
    expect(observer).not.toHaveBeenCalled();
  });
  it("returns the actual response after the bounded optional observer deadline", async () => {
    vi.useFakeTimers();
    try {
      const response = new NextResponse(null, { status: 403 });
      const handler = vi.fn(() => Promise.resolve(response));
      const observer = vi.fn(() => new Promise<void>(() => {}));
      const pending = npWithAuthResponseObserver(
        handler,
        "member",
        observer,
      )(new NextRequest("https://example.test/api/members/me"));
      await vi.advanceTimersByTimeAsync(750);
      expect(await pending).toBe(response);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
