import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  NpSiteBuildPreviewHttpFailureV1,
  requireSiteBuildPreviewHttpDiagnosticV1,
  requireSiteBuildPreviewHttpV1,
} from "./preview-http.js";

describe("fixed loopback HTTP preparation", () => {
  let origin: string;
  const server = createServer((request, response) => {
    if (request.url === "/timeout") return;
    response.setHeader("content-type", request.url === "/media" ? "application/json" : "text/html");
    response.statusCode = ["/withheld", "/privacy"].includes(request.url ?? "") ? 404 : 200;
    if (request.url === "/status") response.statusCode = 503;
    if (request.url === "/ready" && request.headers.cookie !== "np-mb-session=synthetic-only")
      response.statusCode = 401;
    response.end(
      request.url === "/limit"
        ? "x".repeat(2 * 1024 * 1024 + 1)
        : request.url === "/privacy"
          ? '<article data-np-forum-surface="post-detail">private fixture</article>'
          : "<!doctype html><p>synthetic fixture</p>",
    );
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server unavailable");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const run = (route: string, expected: "ready" | "anonymous-withheld" = "ready") =>
    requireSiteBuildPreviewHttpV1({
      url: origin + route,
      expected,
      timeoutMs: route === "/timeout" ? 30 : 5000,
      ...(route === "/ready" ? { memberSessionToken: "synthetic-only" } : {}),
    });
  it("uses the private member cookie and consumes the complete bounded HTML response", async () => {
    await expect(run("/ready")).resolves.toBeUndefined();
    await expect(run("/withheld", "anonymous-withheld")).resolves.toBeUndefined();
  });
  it("separates status, media, body limits, privacy and actual timeout without leaking content", async () => {
    for (const [route, reason, status] of [
      ["/status", "status", 503],
      ["/media", "media", 200],
      ["/limit", "body-limit", 200],
      ["/privacy", "privacy", 404],
      ["/timeout", "timeout", null],
    ] as const) {
      let failure: unknown;
      try {
        await run(route, route === "/privacy" ? "anonymous-withheld" : "ready");
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(NpSiteBuildPreviewHttpFailureV1);
      expect((failure as NpSiteBuildPreviewHttpFailureV1).diagnostic).toEqual({ reason, status });
      expect(JSON.stringify(failure)).not.toContain("synthetic-only");
      expect(JSON.stringify(failure)).not.toContain("private fixture");
      expect(JSON.stringify(failure)).not.toContain(origin);
    }
  });
});

it("accepts only detached finite HTTP diagnostics without evaluating fields", () => {
  const value = { reason: "status", status: 503 };
  const result = requireSiteBuildPreviewHttpDiagnosticV1(value);
  expect(result).toEqual(value);
  expect(result).not.toBe(value);
  const accessed = vi.fn();
  for (const invalid of [
    { ...value, path: "/private" },
    { reason: "raw-error", status: null },
    { ...value, status: 600 },
    Object.defineProperty({ ...value }, "reason", { get: accessed }),
    new Proxy(value, { ownKeys: accessed, getPrototypeOf: accessed }),
  ])
    expect(requireSiteBuildPreviewHttpDiagnosticV1(invalid)).toBeNull();
  expect(accessed).not.toHaveBeenCalled();
});
