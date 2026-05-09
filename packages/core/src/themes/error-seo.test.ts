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
    expect(
      extractMembersNotFoundComponent({ notFound: TopNotFound }),
    ).toBe(TopNotFound);
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

  it("picks up declared hooks individually", () => {
    const sitemapEntries = async () => [];
    const feedEntries = async () => [];
    const robotsTxt = () => "User-agent: *\n";
    const out = extractSeoHooks({
      seo: { sitemapEntries, feedEntries, robotsTxt },
    });
    expect(out.sitemapEntries).toBe(sitemapEntries);
    expect(out.feedEntries).toBe(feedEntries);
    expect(out.robotsTxt).toBe(robotsTxt);
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

  it("partial declaration — only some hooks set", () => {
    const sitemapEntries = async () => [];
    const out = extractSeoHooks({ seo: { sitemapEntries } });
    expect(out.sitemapEntries).toBe(sitemapEntries);
    expect(out.feedEntries).toBeUndefined();
    expect(out.robotsTxt).toBeUndefined();
  });
});
