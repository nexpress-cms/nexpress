import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  isSiteBuildBrowserRequestAllowedV1,
  requireSiteBuildBrowserRequestPolicyV1,
  type NpSiteBuildBrowserRequestPolicyV1,
} from "./browser-request-policy.js";

const origin = "http://127.0.0.1:18080";
const allowedPaths = ["/", "/about", "/_next/static/chunks/app.js", "/np-logo.png"];
const policyValue = (): NpSiteBuildBrowserRequestPolicyV1 => ({
  documentPaths: ["/", "/about", "/blog/example"],
  imagePaths: ["/np-logo.png", "/media/caf%C3%A9.jpg"],
  imageWidths: [32, 640, 1080],
  imageQualities: [75, 90],
});

describe("closed browser request policy", () => {
  const policy = requireSiteBuildBrowserRequestPolicyV1(policyValue());
  const embedded = runInNewContext(`(${isSiteBuildBrowserRequestAllowedV1.toString()})`, {
    URL,
  }) as typeof isSiteBuildBrowserRequestAllowedV1;

  // The embedded browser and the host interceptor execute the same source.
  for (const [name, evaluate] of [
    ["host", isSiteBuildBrowserRequestAllowedV1],
    ["embedded", embedded],
  ] as const) {
    describe(name, () => {
      const allowed = (url: string, method = "GET") =>
        evaluate(url, method, origin, allowedPaths, policy);

      it("preserves finite canonical queryless reads without requiring a policy", () => {
        for (const path of allowedPaths) {
          expect(evaluate(path, "GET", origin, allowedPaths)).toBe(true);
          expect(evaluate(origin + path, "HEAD", origin, allowedPaths)).toBe(true);
        }
        expect(allowed("/blog/example")).toBe(false);
        expect(allowed("/about", "get")).toBe(true);
        expect(allowed("/about", "POST")).toBe(false);
        expect(allowed("/about", "OPTIONS")).toBe(false);
      });

      it("permits only the exact observed static Next metadata URL", () => {
        const icon = "/icon.svg?icon.2l-vijnscfdt2.svg";
        const profile = requireSiteBuildBrowserRequestPolicyV1({
          ...policyValue(),
          metadataRequests: [icon],
        });
        for (const method of ["GET", "HEAD"])
          expect(evaluate(origin + icon, method, origin, [], profile)).toBe(true);
        expect(evaluate(icon, "POST", origin, [], profile)).toBe(false);
        expect(evaluate(icon, "GET", origin, [], policy)).toBe(false);
        for (const value of [
          "/icon.svg?icon.changed.svg",
          icon + "&extra=1",
          icon + "#fragment",
          "/other.svg?icon.2l-vijnscfdt2.svg",
          "/icon.svg?icon.%32l-vijnscfdt2.svg",
          "http://127.0.0.1:18081" + icon,
        ])
          expect(evaluate(value, "GET", origin, [], profile), value).toBe(false);
      });

      it("allows only exact projected Forum hydration reads, never mutations or query expansion", () => {
        const target = "targetType=communityPosts&targetId=00000000-0000-4000-8000-000000000001";
        const reads = [
          "/api/members/me",
          "/api/notifications?count=1",
          "/api/collections/communityPosts/00000000-0000-4000-8000-000000000001/comments?order=oldest&limit=20&offset=0",
          `/api/reactions?${target}&kind=like`,
          `/api/follows/check?${target}`,
          `/api/engagement?${target}`,
          `/api/community/events?scope=document&${target}`,
        ];
        const profile = requireSiteBuildBrowserRequestPolicyV1({
          ...policyValue(),
          readRequests: reads,
        });
        for (const path of reads) {
          expect(evaluate(path, "GET", origin, [], profile)).toBe(true);
          expect(evaluate(path, "POST", origin, [], profile)).toBe(false);
          expect(evaluate(path + "&extra=1", "GET", origin, [], profile)).toBe(false);
          expect(evaluate(path, "GET", origin, [], policy)).toBe(false);
        }
        for (const path of [
          "/api/admin/users",
          `/api/reactions?${target}&kind=unlisted`,
          "/api/notifications?count=01",
        ])
          expect(() =>
            requireSiteBuildBrowserRequestPolicyV1({ ...policyValue(), readRequests: [path] }),
          ).toThrow();
      });

      it("accepts only installed Next RSC forms on declared document routes", () => {
        // Captured from installed Next 16.4.2 for a prefetch with rsc:1.
        for (const suffix of ["?_rsc=HEAvJdHAQJrUAe2K", "?_rsc=bl95g", "?_rsc=a", "?_rsc"]) {
          expect(allowed(`/about${suffix}`)).toBe(true);
          expect(allowed(`${origin}/blog/example${suffix}`, "HEAD")).toBe(true);
        }
        expect(evaluate("/about?_rsc=HEAvJdHAQJrUAe2K", "GET", origin, allowedPaths)).toBe(false);
        for (const value of [
          "/_next/static/chunks/app.js?_rsc=bl95g",
          "/np-logo.png?_rsc=bl95g",
          "/unknown?_rsc=bl95g",
          "/about?_rsc=",
          "/about?_rsc=ABC12",
          "/about?_rsc=abcdef",
          "/about?_rsc=HEAvJdHAQJrUAe2K=",
          "/about?_rsc=HEAvJdHAQJrUAe2",
          "/about?_rsc=%62l95g",
          "/about?%5Frsc=bl95g",
          "/about?_rsc=bl95g&_rsc=a",
          "/about?_rsc=bl95g&other=1",
          "/about?_rsc=bl95g&",
          "/about?_rsc=bl95g#",
          "/about?_rsc=bl95g#fragment",
        ])
          expect(allowed(value), value).toBe(false);
        expect(allowed("/about?_rsc=bl95g", "POST")).toBe(false);
      });

      it("accepts the Next image loader's exact local inventory and numeric sets", () => {
        expect(allowed("/_next/image?url=%2Fnp-logo.png&w=640&q=75")).toBe(true);
        expect(allowed(`${origin}/_next/image?q=90&w=1080&url=%2Fnp-logo.png`, "HEAD")).toBe(true);
        expect(allowed("/_next/image?url=%2Fmedia%2Fcaf%25C3%25A9.jpg&w=32&q=75")).toBe(true);
        for (const value of [
          "/_next/image?url=%2Fnp-logo.png&w=640&q=75&dpl=build",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=75&extra=1",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=75&q=90",
          "/_next/image?url=%2Fnp-logo.png&w=640&w=640",
          "/_next/image?url=%2Fnp-logo.png&%77=640&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=0640&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=075",
          "/_next/image?url=%2Fnp-logo.png&w=%36%34%30&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=6.4e2&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=641&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=80",
          "/_next/image?url=%2Fnp-logo.png&w=0&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=-640&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=0",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=101",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=75=75",
          "/_next/image?url=/np-logo.png&w=640&q=75",
          "/_next/image?url=%2fnp-logo.png&w=640&q=75",
          "/_next/image?url=%2Fundeclared.png&w=640&q=75",
          "/_next/image?url=https%3A%2F%2Fexample.com%2Fnp-logo.png&w=640&q=75",
          "/_next/image?url=%2F%2Fexample.com%2Fnp-logo.png&w=640&q=75",
          "/_next/image?url=%2F..%2Fnp-logo.png&w=640&q=75",
          "/_next/image?url=%2F%252e%252e%2Fnp-logo.png&w=640&q=75",
          "/_next/image?url=%252Fnp-logo.png&w=640&q=75",
          "/_next/image?url=%2Fnp-logo.png%3Fother%3D1&w=640&q=75",
          "/_next/image?url=%2Fnp-logo.png%23fragment&w=640&q=75",
          "/_next/image?url=%2Fnp-logo.png%5Cother&w=640&q=75",
          "/_next/image?url=%2Fnp-logo.png%00&w=640&q=75",
          "/_next/image?url=%2Fnp-logo.png&w=640&q=75#",
          "/_next/image?url=%XX&w=640&q=75",
        ])
          expect(allowed(value), value).toBe(false);
        expect(allowed("/_next/image?url=%2Fnp-logo.png&w=640&q=75", "POST")).toBe(false);
      });

      it("rejects URL normalization, fragments, credentials and undeclared origins", () => {
        for (const value of [
          "about",
          "./about",
          "/about?",
          "/about#",
          "/about#fragment",
          "/about?other=1",
          "/other/../about",
          "/%2e%2e/about",
          "/%252e%252e/about",
          "/about%2Fother",
          "/about\\other",
          "/about\u0000",
          " /about",
          `${origin}/about\n`,
          "//127.0.0.1:18080/about",
          "http://user@127.0.0.1:18080/about",
          "http://127.0.0.1:18081/about",
          "http://localhost:18080/about",
          "https://127.0.0.1:18080/about",
          "https://example.com/about",
          "data:text/plain,example",
        ])
          expect(allowed(value), value).toBe(false);
        expect(evaluate("/about", "GET", "http://localhost:18080", allowedPaths, policy)).toBe(
          false,
        );
        expect(evaluate("/about", "GET", `${origin}/`, allowedPaths, policy)).toBe(false);
      });
    });
  }
});

describe("browser request policy transport", () => {
  it("returns a detached JSON DTO including empty and frozen inventories", () => {
    const source = policyValue();
    const result = requireSiteBuildBrowserRequestPolicyV1(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    for (const key of Object.keys(source) as Array<keyof typeof source>)
      expect(result[key]).not.toBe(source[key]);
    source.documentPaths.push("/later");
    source.imageWidths[0] = 99;
    expect(result.documentPaths).not.toContain("/later");
    expect(result.imageWidths).not.toContain(99);
    expect(
      requireSiteBuildBrowserRequestPolicyV1(
        Object.freeze({
          documentPaths: Object.freeze([]),
          imagePaths: Object.freeze([]),
          imageWidths: Object.freeze([]),
          imageQualities: Object.freeze([]),
        }),
      ),
    ).toEqual({ documentPaths: [], imagePaths: [], imageWidths: [], imageQualities: [] });
  });

  it("bounds finite unique path and numeric inventories", () => {
    const paths = (length: number) => Array.from({ length }, (_, i) => `/path-${i}`);
    const numbers = (length: number) => Array.from({ length }, (_, i) => i + 1);
    expect(
      requireSiteBuildBrowserRequestPolicyV1({
        documentPaths: paths(200),
        imagePaths: paths(4096),
        imageWidths: numbers(64),
        imageQualities: numbers(100),
      }).imagePaths,
    ).toHaveLength(4096);
    for (const partial of [
      { documentPaths: paths(201) },
      { imagePaths: paths(4097) },
      { imageWidths: numbers(65) },
      { imageQualities: numbers(101) },
      { documentPaths: ["/about", "/about"] },
      { imagePaths: ["/asset.png", "/asset.png"] },
      { imageWidths: [640, 640] },
      { imageQualities: [75, 75] },
      { imageWidths: [0] },
      { imageWidths: [-1] },
      { imageWidths: [1.5] },
      { imageWidths: [Number.MAX_SAFE_INTEGER + 1] },
      { imageWidths: [Infinity] },
      { imageWidths: ["640"] },
      { imageQualities: [0] },
      { imageQualities: [101] },
      { metadataRequests: ["/icon.svg"] },
      { metadataRequests: ["/icon.svg?icon.a.svg", "/icon.svg?icon.b.svg"] },
      { metadataRequests: ["/icon.svg?icon.a.svg&extra=1"] },
      { metadataRequests: ["/favicon.ico?icon.a.svg"] },
      { metadataRequests: ["https://example.com/icon.svg?icon.a.svg"] },
      { documentPaths: [origin + "/about"] },
      { documentPaths: ["/about?"] },
      { documentPaths: ["/about#"] },
      { imagePaths: ["//example.com/image.png"] },
      { documentPaths: ["/x/../about"] },
      { documentPaths: ["/%2e%2e/about"] },
      { imagePaths: ["/%252e%252e/image.png"] },
      { imagePaths: ["/image%2Fother.png"] },
      { documentPaths: ["/" + "a".repeat(2048)] },
    ])
      expect(() =>
        requireSiteBuildBrowserRequestPolicyV1({ ...policyValue(), ...partial }),
      ).toThrow(TypeError);
  });

  it("rejects non-JSON shapes without invoking getters or proxy traps", () => {
    const accessed = vi.fn(() => {
      throw new Error("must not execute");
    });
    const accessor = Object.defineProperty(policyValue(), "documentPaths", { get: accessed });
    const arrayAccessor = policyValue();
    Object.defineProperty(arrayAccessor.documentPaths, "0", { get: accessed });
    const proxied = new Proxy(policyValue(), {
      get: accessed,
      ownKeys: accessed,
      getPrototypeOf: accessed,
    });
    const arrayProxy = {
      ...policyValue(),
      imagePaths: new Proxy([], { get: accessed, ownKeys: accessed, getPrototypeOf: accessed }),
    };
    const extraArrayProperty = Object.assign(["/about"], { extra: true });
    const symbolicArray = Object.assign(["/about"], { [Symbol("hidden")]: true });
    const nonenumerableArray = ["/about"];
    Object.defineProperty(nonenumerableArray, "0", { enumerable: false });
    const inheritedArray = ["/about"];
    Object.setPrototypeOf(inheritedArray, null);
    const nonenumerableField = policyValue();
    Object.defineProperty(nonenumerableField, "documentPaths", { enumerable: false });
    const inherited = Object.create(policyValue()) as unknown;
    const missing = { imagePaths: [], imageWidths: [], imageQualities: [] };
    for (const value of [
      undefined,
      null,
      [],
      "policy",
      accessor,
      arrayAccessor,
      proxied,
      arrayProxy,
      { ...policyValue(), documentPaths: extraArrayProperty },
      { ...policyValue(), documentPaths: symbolicArray },
      { ...policyValue(), documentPaths: nonenumerableArray },
      { ...policyValue(), documentPaths: inheritedArray },
      { ...policyValue(), documentPaths: new Array(1) },
      { ...policyValue(), extra: true },
      { ...policyValue(), [Symbol("hidden")]: true },
      nonenumerableField,
      inherited,
      missing,
    ])
      expect(() => requireSiteBuildBrowserRequestPolicyV1(value)).toThrow(TypeError);
    expect(accessed).not.toHaveBeenCalled();
  });
});
