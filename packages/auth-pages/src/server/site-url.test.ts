import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { siteUrlLenient, siteUrlStrict } from "./site-url.js";

const fakeRequest = (url: string): NextRequest => ({ url }) as unknown as NextRequest;

describe("siteUrlLenient", () => {
  it("returns config.site.url when set", () => {
    const out = siteUrlLenient(
      { site: { url: "https://example.com" } },
      fakeRequest("https://attacker.example/api/auth/forgot-password"),
    );
    expect(out.origin).toBe("https://example.com");
  });

  it("falls back to request.url when config.site.url is null", () => {
    // This is the documented permissive fallback for same-origin
    // redirects — OAuth callbacks etc. The request.url's host
    // mirrors the request, which is fine when the user's browser
    // is going back to the same host they came from.
    const out = siteUrlLenient(
      { site: { url: null } },
      fakeRequest("https://example.com/api/oauth/callback"),
    );
    expect(out.origin).toBe("https://example.com");
  });

  it("falls back to request.url when config.site.url is undefined", () => {
    const out = siteUrlLenient({ site: {} }, fakeRequest("https://example.com/api/oauth/callback"));
    expect(out.origin).toBe("https://example.com");
  });
});

describe("siteUrlStrict", () => {
  it("returns config.site.url when set", () => {
    const out = siteUrlStrict({ site: { url: "https://example.com" } });
    expect(out.origin).toBe("https://example.com");
  });

  it("throws when config.site.url is null (#598 host-injection guard)", () => {
    expect(() => siteUrlStrict({ site: { url: null } })).toThrow(/SITE_URL is unset/);
  });

  it("throws when config.site.url is undefined (#598 host-injection guard)", () => {
    expect(() => siteUrlStrict({ site: {} })).toThrow(/SITE_URL is unset/);
  });

  it("throws when config.site.url is the empty string (treated as unset)", () => {
    expect(() => siteUrlStrict({ site: { url: "" } })).toThrow(/SITE_URL is unset/);
  });

  it("error message points operators at the fix", () => {
    try {
      siteUrlStrict({ site: { url: null } });
      expect.unreachable();
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      const message = (err as Error).message;
      expect(message).toContain("SITE_URL");
      expect(message).toContain("public origin");
    }
  });
});
