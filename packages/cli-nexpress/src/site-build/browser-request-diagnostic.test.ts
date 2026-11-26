import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  classifySiteBuildBrowserRequestV1,
  classifySiteBuildBrowserPendingRequestV1,
  projectSiteBuildBrowserDiagnosticV1,
  requireSiteBuildBrowserRequestDiagnosticV1,
} from "./browser-request-diagnostic.js";
describe("safe browser denial categories", () => {
  it("keeps host and embedded classifiers equal without retaining any request values", () => {
    const origin = "http://127.0.0.1:18080";
    const embedded = runInNewContext(`(${classifySiteBuildBrowserRequestV1.toString()})`, {
      URL,
    }) as typeof classifySiteBuildBrowserRequestV1;
    for (const [href, method, target, query] of [
      ["/?_rsc=private-value", "GET", "root", "rsc"],
      ["/ko/about?_rsc=private-value", "GET", "declared", "rsc"],
      ["/_next/image?url=private-value", "GET", "image", "image"],
      ["/api/private?token=private-value", "POST", "api", "other"],
      [
        "https://user:private-value@external.invalid/private?token=value",
        "GET",
        "external",
        "other",
      ],
    ]) {
      const observed = classifySiteBuildBrowserRequestV1(
        href,
        method,
        origin,
        ["/ko/about"],
        ["/ko/about"],
      );
      expect(observed).toEqual({ target, query, method });
      expect(embedded(href, method, origin, ["/ko/about"], ["/ko/about"])).toEqual(observed);
      expect(JSON.stringify(observed)).not.toContain("private-value");
      expect(
        requireSiteBuildBrowserRequestDiagnosticV1({ sink: "fetch", ...observed }),
      ).not.toBeNull();
    }
    expect(
      requireSiteBuildBrowserRequestDiagnosticV1({
        sink: "fetch",
        target: "root",
        query: "none",
        method: "GET",
        url: "secret",
      }),
    ).toBeNull();
  });

  it("classifies only exact projected hydration APIs without retaining request values", () => {
    const origin = "http://127.0.0.1:18080";
    const target = "targetType=forum-posts&targetId=11111111-1111-4111-8111-111111111111";
    const paths = [
      ["/api/members/me", "member-session"],
      ["/api/notifications?count=1", "notifications"],
      [
        "/api/collections/forum-posts/11111111-1111-4111-8111-111111111111/comments?order=oldest&limit=20&offset=0",
        "comments",
      ],
      [`/api/reactions?${target}&kind=like`, "reactions"],
      [`/api/engagement?${target}`, "engagement"],
      [`/api/follows/check?${target}`, "follows"],
      [`/api/community/events?scope=document&${target}`, "events"],
    ] as const;
    for (const [path, apiRole] of paths) {
      const result = classifySiteBuildBrowserPendingRequestV1(
        origin + path,
        "GET",
        "Fetch",
        origin,
        [],
        [],
        paths.map(([path]) => path),
      );
      expect(result).toMatchObject({
        target: "api",
        method: "GET",
        apiRole,
        resourceType: "fetch",
      });
      expect(JSON.stringify(result)).not.toContain("11111111");
      expect(JSON.stringify(result)).not.toContain("/api/");
      expect(
        classifySiteBuildBrowserPendingRequestV1(origin + path, "GET", "Fetch", origin, [], [], [])
          .apiRole,
      ).toBe("other");
    }
    expect(
      classifySiteBuildBrowserPendingRequestV1(
        "/api/members/me?token=private",
        "GET",
        "secret-type",
        origin,
        [],
        [],
        ["/api/members/me?token=private"],
      ),
    ).toEqual({
      target: "api",
      query: "other",
      method: "GET",
      apiRole: "other",
      resourceType: "other",
    });
    expect(
      classifySiteBuildBrowserPendingRequestV1(
        "https://external.invalid/api/members/me",
        "GET",
        "XHR",
        origin,
        [],
        [],
        ["/api/members/me"],
      ).apiRole,
    ).toBe("other");
  });

  it("bounds optional wait telemetry and drops malformed or value-bearing snapshots", () => {
    const pending = {
      target: "api",
      query: "none",
      method: "GET",
      apiRole: "member-session",
      resourceType: "fetch",
      headersReceived: false,
      eventStream: false,
      ageMs: 90,
    };
    const wait = {
      step: "post-font-idle",
      elapsedMs: 1200,
      stepElapsedMs: 100,
      pendingCount: 9,
      truncated: true,
      pending: Array.from({ length: 8 }, () => ({ ...pending })),
    };
    const base = { reason: "timeout", loaded: true, inflight: 9, ready: 0, request: null };
    expect(projectSiteBuildBrowserDiagnosticV1({ ...base, wait })).toEqual({ ...base, wait });
    for (const patch of [
      { step: "raw-private-value" },
      { elapsedMs: Infinity },
      { elapsedMs: 86_400_001 },
      { stepElapsedMs: 1201 },
      { pendingCount: 257 },
      { truncated: false },
      { pending: [...wait.pending, pending] },
      { pending: [] },
      { rawUrl: "private" },
      { pending: [{ ...pending, ageMs: 1201 }, ...wait.pending.slice(1)] },
      { pending: [{ ...pending, eventStream: true }, ...wait.pending.slice(1)] },
      { pending: [{ ...pending, url: "private" }, ...wait.pending.slice(1)] },
      {
        pending: [
          { ...pending, resourceType: { toString: () => "fetch" } },
          ...wait.pending.slice(1),
        ],
      },
    ])
      expect(projectSiteBuildBrowserDiagnosticV1({ ...base, wait: { ...wait, ...patch } })).toEqual(
        base,
      );
    expect(projectSiteBuildBrowserDiagnosticV1({ ...base, inflight: 257, wait })).toBeNull();
    expect(
      projectSiteBuildBrowserDiagnosticV1({ ...base, reason: { toString: () => "timeout" } }),
    ).toBeNull();
  });

  it.each([401, 503])("keeps only finite response metadata for HTTP %i", (status) => {
    const request = {
      target: "api",
      query: "none",
      method: "GET",
      apiRole: "member-session",
      resourceType: "fetch",
      headersReceived: true,
      eventStream: false,
      ageMs: 90,
    };
    const base = { reason: "network", loaded: true, inflight: 0, ready: 0, request: null };
    const networkFailure = {
      cause: "response",
      status,
      error: null,
      canceled: false,
      blocked: false,
      request,
    };
    const projected = projectSiteBuildBrowserDiagnosticV1({
      ...base,
      networkFailure,
      rawUrl: "https://user:private-value@external.invalid/?token=private-value",
    });
    expect(projected).toEqual({ ...base, networkFailure });
    expect(projected?.networkFailure).not.toBe(networkFailure);
    expect(projected?.networkFailure?.request).not.toBe(request);
    expect(JSON.stringify(projected)).not.toContain("private-value");
  });

  it("keeps finite loading errors and cancellation or blocking flags without raw error text", () => {
    const base = { reason: "network", loaded: true, inflight: 0, ready: 0, request: null };
    for (const error of ["aborted", "closed", "reset", "refused", "timed-out", "failed", "other"]) {
      const networkFailure = {
        cause: "loading",
        status: null,
        error,
        canceled: error === "aborted",
        blocked: error === "refused",
        request: null,
      };
      expect(projectSiteBuildBrowserDiagnosticV1({ ...base, networkFailure })).toEqual({
        ...base,
        networkFailure,
      });
    }
  });

  it("drops malformed or value-bearing network failures without losing safe base telemetry", () => {
    const request = {
      target: "api",
      query: "none",
      method: "GET",
      apiRole: "member-session",
      resourceType: "fetch",
      headersReceived: true,
      eventStream: false,
      ageMs: 90,
    };
    const base = { reason: "network", loaded: true, inflight: 0, ready: 0, request: null };
    const response = {
      cause: "response",
      status: 401,
      error: null,
      canceled: false,
      blocked: false,
      request,
    };
    for (const patch of [
      { rawUrl: "https://external.invalid/?token=private-value" },
      { error: "net::ERR_FAILED https://external.invalid/?token=private-value" },
      { error: "failed" },
      { canceled: true },
      { blocked: true },
      { status: 99 },
      { status: 600 },
      { status: 401.5 },
      { status: NaN },
      { status: Infinity },
      { status: "401" },
      { cause: "private-value" },
      { cause: { toString: () => "response" } },
      { canceled: "false" },
      { blocked: 0 },
      { request: [] },
      { request: "https://external.invalid/?token=private-value" },
      { request: { ...request, url: "https://external.invalid/?token=private-value" } },
      { request: { ...request, headersReceived: "true" } },
      { request: { ...request, headersReceived: false, eventStream: true } },
      { request: { ...request, ageMs: -1 } },
      { request: { ...request, ageMs: 86_400_001 } },
    ]) {
      const projected = projectSiteBuildBrowserDiagnosticV1({
        ...base,
        networkFailure: { ...response, ...patch },
      });
      expect(projected).toEqual(base);
      expect(JSON.stringify(projected)).not.toContain("private-value");
    }
    for (const networkFailure of [
      null,
      [],
      "private-value",
      { ...response, request: undefined },
      { ...response, cause: "loading", error: "failed" },
      { ...response, cause: "loading", status: null },
      {
        ...response,
        cause: "loading",
        status: null,
        error: "net::ERR_FAILED https://external.invalid/?token=private-value",
      },
      { ...response, cause: "loading", status: null, error: { toString: () => "failed" } },
    ])
      expect(projectSiteBuildBrowserDiagnosticV1({ ...base, networkFailure })).toEqual(base);
  });
});
