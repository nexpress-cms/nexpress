import { describe, expect, it } from "vitest";

import {
  extractErrorComponent,
  extractMembersNotFoundComponent,
  extractNotFoundComponent,
  extractSeoHooks,
} from "./error-seo.js";

describe("extractNotFoundComponent / extractErrorComponent", () => {
  it("returns null when impl is undefined", () => {
    expect(extractNotFoundComponent(undefined)).toBeNull();
    expect(extractErrorComponent(undefined)).toBeNull();
  });

  it("returns null when component fields aren't functions", () => {
    expect(extractNotFoundComponent({ notFound: "wrong" })).toBeNull();
    expect(extractErrorComponent({ error: 42 })).toBeNull();
  });

  it("returns the component reference when present", () => {
    const NotFound = () => null;
    const ErrorComp = () => null;
    expect(extractNotFoundComponent({ notFound: NotFound })).toBe(NotFound);
    expect(extractErrorComponent({ error: ErrorComp })).toBe(ErrorComp);
  });
});

describe("extractMembersNotFoundComponent", () => {
  it("returns null when impl is undefined", () => {
    expect(extractMembersNotFoundComponent(undefined)).toBeNull();
  });

  it("returns null when neither member-level nor top-level notFound is declared", () => {
    expect(extractMembersNotFoundComponent({})).toBeNull();
    expect(extractMembersNotFoundComponent({ members: {} })).toBeNull();
  });

  it("prefers `impl.members.notFound` when both are declared", () => {
    const TopNotFound = () => null;
    const MemberNotFound = () => null;
    expect(
      extractMembersNotFoundComponent({
        notFound: TopNotFound,
        members: { notFound: MemberNotFound },
      }),
    ).toBe(MemberNotFound);
  });

  it("falls back to `impl.notFound` when `impl.members.notFound` is omitted", () => {
    const TopNotFound = () => null;
    expect(extractMembersNotFoundComponent({ notFound: TopNotFound })).toBe(TopNotFound);
  });

  it("falls back to `impl.notFound` when `impl.members.notFound` is non-function", () => {
    const TopNotFound = () => null;
    expect(
      extractMembersNotFoundComponent({
        notFound: TopNotFound,
        members: { notFound: "not a function" },
      }),
    ).toBe(TopNotFound);
  });
});

describe("extractSeoHooks", () => {
  it("returns empty when impl has no seo", () => {
    expect(extractSeoHooks(undefined)).toEqual({});
    expect(extractSeoHooks({})).toEqual({});
    expect(extractSeoHooks({ seo: "wrong" })).toEqual({});
  });

  it("validates declared hook results at dispatch", async () => {
    const sitemapEntries = () => Promise.resolve([{ loc: "/archive" }]);
    const feedEntries = () =>
      Promise.resolve([
        {
          id: "https://example.com/archive",
          title: "Archive",
          summary: null,
          link: "https://example.com/archive",
          author: null,
          updated: "2026-07-15T00:00:00.000Z",
          published: null,
        },
      ]);
    const robotsTxt = () => "User-agent: *\n";
    const out = extractSeoHooks({
      seo: { sitemapEntries, feedEntries, robotsTxt },
    });
    await expect(out.sitemapEntries?.()).resolves.toEqual([{ loc: "/archive" }]);
    await expect(out.feedEntries?.()).resolves.toEqual([
      expect.objectContaining({ id: "https://example.com/archive" }),
    ]);
    await expect(out.robotsTxt?.()).resolves.toBe("User-agent: *\n");
  });

  it("rejects malformed hook results before a route renders or caches them", async () => {
    const out = extractSeoHooks({
      seo: {
        sitemapEntries: () => [{ loc: "https://evil.example/archive" }],
        feedEntries: () => [{ id: "not-a-url" }],
        robotsTxt: () => ({ body: "User-agent: *" }),
      },
    });

    await expect(out.sitemapEntries?.()).rejects.toThrow(/sitemapEntries\.0\.loc/u);
    await expect(out.feedEntries?.()).rejects.toThrow(/feedEntries\.0/u);
    await expect(out.robotsTxt?.()).rejects.toThrow(/robotsTxt/u);
  });

  it("ignores non-function members (malformed manifest)", () => {
    const out = extractSeoHooks({
      seo: {
        sitemapEntries: "not a fn",
        feedEntries: 42,
        robotsTxt: { kind: "wrong" },
      },
    });
    expect(out).toEqual({});
  });

  it("partial declaration — only some hooks set", async () => {
    const sitemapEntries = () => Promise.resolve([]);
    const out = extractSeoHooks({ seo: { sitemapEntries } });
    await expect(out.sitemapEntries?.()).resolves.toEqual([]);
    expect(out.feedEntries).toBeUndefined();
    expect(out.robotsTxt).toBeUndefined();
  });

  it("preserves the theme seo receiver while validating results", async () => {
    const seo = {
      suffix: "archive",
      sitemapEntries(this: { suffix: string }) {
        return [{ loc: `/${this.suffix}` }];
      },
    };
    const out = extractSeoHooks({ seo });
    await expect(out.sitemapEntries?.()).resolves.toEqual([{ loc: "/archive" }]);
  });
});
