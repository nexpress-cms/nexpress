import { describe, expect, it } from "vitest";

import {
  NpSeoContractError,
  npAnalyzeArticleJsonLdInput,
  npAnalyzeFeedEntries,
  npAnalyzePageMetadataInput,
  npAnalyzePersonJsonLdInput,
  npAnalyzeSitemapEntries,
  npAnalyzeSitemapIndexEntries,
  npDefineFeedEntries,
  npDefineSitemapEntries,
  npRequireAtomFeedOptions,
  npRequireJsonLdContext,
  npRequirePageMetadataInput,
  npRequireRobotsTxt,
  npRequireSeoOrigin,
  npRequireSeoPath,
  npRequireSiteSeoSettings,
  npRequireSitemapOptions,
  npSeoContractLimits,
} from "./contract.js";
import { npJoinSitemapXmlLines, renderSitemapIndexXml, renderSitemapXml } from "./sitemap.js";

const feedEntry = {
  id: "https://example.com/posts/hello",
  title: "Hello",
  summary: "A safe summary.",
  link: "https://example.com/posts/hello",
  author: "Ada",
  updated: "2026-07-15T00:00:00.000Z",
  published: "2026-07-14T00:00:00.000Z",
};

describe("canonical SEO contribution contracts", () => {
  it("clones and freezes exact sitemap entries with canonical alternates", () => {
    const input = [
      {
        loc: "/about?view=full",
        lastmod: "2026-07-15T00:00:00.000Z",
        changefreq: "weekly" as const,
        priority: 0.7,
        alternates: [
          { hreflang: "en", href: "/en/about" },
          { hreflang: "ko", href: "/ko/about" },
        ],
      },
    ];

    const parsed = npDefineSitemapEntries(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed[0])).toBe(true);
    expect(Object.isFrozen(parsed[0]?.alternates)).toBe(true);
  });

  it("rejects unsafe, non-canonical, duplicate, and oversized sitemap values", () => {
    expect(
      npAnalyzeSitemapEntries([
        { loc: "https://example.com/about", typo: true },
        { loc: "/safe", lastmod: "2026-07-15" },
        { loc: "/safe", priority: Number.POSITIVE_INFINITY },
        { loc: "/duplicate" },
        { loc: "/duplicate" },
        {
          loc: "/translations",
          alternates: [
            { hreflang: "en-US", href: "/en-us" },
            { hreflang: "en-US", href: "/duplicate" },
          ],
        },
      ]).map((entry) => entry.code),
    ).toEqual(expect.arrayContaining(["invalid-field", "unknown-field", "duplicate"]));

    expect(
      npAnalyzeSitemapEntries(
        Array.from({ length: npSeoContractLimits.maxSitemapEntries + 1 }, (_, index) => ({
          loc: `/item-${index.toString()}`,
        })),
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "max-items" })]));

    let enumerated = false;
    const oversized = new Proxy(new Array<unknown>(npSeoContractLimits.maxSitemapEntries + 1), {
      ownKeys(target) {
        enumerated = true;
        return Reflect.ownKeys(target);
      },
    });
    expect(npAnalyzeSitemapEntries(oversized)).toEqual([
      expect.objectContaining({ code: "max-items" }),
    ]);
    expect(enumerated).toBe(false);
  });

  it("requires exact sitemap-index entries", () => {
    expect(
      npAnalyzeSitemapIndexEntries([
        { loc: "/sitemap.xml?locale=en" },
        { loc: "/sitemap.xml?locale=en" },
      ]),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate" })]));
    expect(npAnalyzeSitemapIndexEntries([{ loc: "/safe", alternates: [] }])).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]),
    );
  });

  it("validates before rendering bounded sitemap XML", () => {
    const xml = renderSitemapXml("https://example.com", [
      {
        loc: "/search?q=a&kind=post",
        alternates: [{ hreflang: "en", href: "/en/search?q=a&kind=post" }],
      },
    ]);
    expect(xml).toContain("https://example.com/search?q=a&amp;kind=post");
    expect(xml).toContain('hreflang="en"');
    expect(
      renderSitemapIndexXml("https://example.com", [{ loc: "/sitemap.xml?locale=en" }]),
    ).toContain("https://example.com/sitemap.xml?locale=en");
    expect(() => renderSitemapXml("https://example.com/", [{ loc: "/safe" }])).toThrow(
      NpSeoContractError,
    );
    expect(() => renderSitemapXml("https://example.com", [{ loc: "javascript:alert(1)" }])).toThrow(
      NpSeoContractError,
    );

    expect(npJoinSitemapXmlLines(["a", "한"], 5)).toBe("a\n한");
    expect(() => npJoinSitemapXmlLines(["a", "한"], 4)).toThrow(/at most 4 UTF-8 bytes/u);
  });

  it("clones exact Atom entries and rejects partial or unsafe values", () => {
    const input = [feedEntry];
    const parsed = npDefineFeedEntries(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed[0])).toBe(true);

    expect(
      npAnalyzeFeedEntries([
        { ...feedEntry, id: "javascript:alert(1)" },
        { ...feedEntry, id: "https://example.com/second", updated: "yesterday" },
        { ...feedEntry, id: "https://example.com/third", summary: null, typo: true },
      ]).map((entry) => entry.code),
    ).toEqual(expect.arrayContaining(["invalid-field", "unknown-field"]));
    expect(npAnalyzeFeedEntries([{ id: feedEntry.id }])).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(/title/u) })]),
    );
  });

  it("does not invoke record accessors or array length traps", () => {
    let getterCalled = false;
    let lengthRead = false;
    const entry: Record<string, unknown> = { loc: "/safe" };
    Object.defineProperty(entry, "lastmod", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "2026-07-15T00:00:00.000Z";
      },
    });
    const entries = new Proxy<unknown[]>([entry], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthRead = true;
          throw new Error("must not read length through property access");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(npAnalyzeSitemapEntries(entries).map((entry) => entry.code)).toContain("shape");
    expect(getterCalled).toBe(false);
    expect(lengthRead).toBe(false);
  });

  it("turns revoked proxies and sparse/custom arrays into contract issues", () => {
    const revoked = Proxy.revocable<unknown[]>([], {});
    revoked.revoke();
    expect(npAnalyzeSitemapEntries(revoked.proxy)).toEqual([
      expect.objectContaining({ code: "shape", path: "sitemapEntries" }),
    ]);

    const sparse = new Array<unknown>(1);
    expect(npAnalyzeFeedEntries(sparse)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "shape" })]),
    );
    const custom = [feedEntry] as unknown[] & { extra?: boolean };
    custom.extra = true;
    expect(npAnalyzeFeedEntries(custom)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]),
    );

    class SeoEntryList extends Array<typeof feedEntry> {}
    expect(npAnalyzeFeedEntries(new SeoEntryList(feedEntry))).toEqual([
      expect.objectContaining({ code: "shape", path: "feedEntries" }),
    ]);
  });
});

describe("SEO builder input contracts", () => {
  it("requires bounded exact sitemap and Atom options", () => {
    expect(
      npRequireSitemapOptions({
        perCollectionLimit: 25,
        collections: ["posts", "pages"],
        locale: "ko-KR",
      }),
    ).toEqual({ perCollectionLimit: 25, collections: ["posts", "pages"], locale: "ko-KR" });
    expect(() => npRequireSitemapOptions({ collections: ["posts", "posts"] })).toThrow(
      /duplicate collection/u,
    );
    expect(() => npRequireSitemapOptions({ perCollectionLimit: 0 })).toThrow(/integer/u);
    expect(() => npRequireAtomFeedOptions({ collection: "Posts" })).toThrow(/collection/u);
    expect(() => npRequireAtomFeedOptions({ limit: 501 })).toThrow(/integer/u);
    expect(npRequireAtomFeedOptions({ extraEntries: [feedEntry] }).extraEntries).toEqual([
      feedEntry,
    ]);
  });

  it("requires safe root-relative paths and canonical origins", () => {
    expect(npRequireSeoPath("/search?q=hello")).toBe("/search?q=hello");
    expect(npRequireSeoOrigin("https://example.com")).toBe("https://example.com");
    for (const path of ["https://example.com", "//example.com", "/a/../b", "/bad path", "/x#y"]) {
      expect(() => npRequireSeoPath(path)).toThrow(NpSeoContractError);
    }
    for (const origin of [
      "https://example.com/",
      "https://user@example.com",
      "ftp://example.com",
    ]) {
      expect(() => npRequireSeoOrigin(origin)).toThrow(NpSeoContractError);
    }
  });

  it("validates and normalizes metadata without leaking invalid Dates", () => {
    const date = new Date("2026-07-15T00:00:00.000Z");
    const parsed = npRequirePageMetadataInput({
      title: "  About  ",
      description: " Summary ",
      path: "/about/",
      ogImage: "/og.png",
      ogType: "article",
      publishedTime: date,
      locale: "ko-KR",
    });
    expect(parsed.title).toBe("About");
    expect(parsed.description).toBe("Summary");
    expect(parsed.publishedTime).toEqual(date);
    expect(parsed.publishedTime).not.toBe(date);

    expect(npAnalyzePageMetadataInput({ publishedTime: new Date(Number.NaN) })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-field" })]),
    );
    expect(npAnalyzePageMetadataInput({ locale: "ko-kr" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "pageMetadata.locale" })]),
    );
    expect(npAnalyzePageMetadataInput({ ogImage: "javascript:alert(1)" })).not.toEqual([]);
    expect(npAnalyzePageMetadataInput({ typo: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]),
    );
  });

  it("validates JSON-LD inputs and contexts", () => {
    expect(
      npAnalyzeArticleJsonLdInput({
        url: "https://example.com/post",
        headline: "Post",
        datePublished: "2026-07-15T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(npAnalyzeArticleJsonLdInput({ url: "/post", headline: "Post" })).not.toEqual([]);
    expect(
      npAnalyzeArticleJsonLdInput({
        url: "https://example.com/post",
        headline: "Post",
        datePublished: "2026-07-15",
      }),
    ).not.toEqual([]);
    expect(
      npAnalyzePersonJsonLdInput({
        url: "https://example.com/u/ada",
        name: "Ada",
        image: "/avatar.png",
      }),
    ).toEqual([]);
    expect(npAnalyzePersonJsonLdInput({ url: "javascript:alert(1)", name: "Ada" })).not.toEqual([]);
    expect(npRequireJsonLdContext({ origin: "https://example.com" })).toEqual({
      origin: "https://example.com",
    });
    expect(() => npRequireJsonLdContext({ origin: "https://example.com/path" })).toThrow(/origin/u);
  });

  it("requires canonical site settings and bounded robots text", () => {
    expect(
      npRequireSiteSeoSettings({
        siteName: "Example",
        siteUrl: "https://example.com",
        defaultDescription: "",
        defaultOgImage: null,
        twitterHandle: null,
        defaultLocale: "en_US",
      }),
    ).toEqual({
      siteName: "Example",
      siteUrl: "https://example.com",
      defaultDescription: "",
      defaultOgImage: null,
      twitterHandle: null,
      defaultLocale: "en_US",
    });
    expect(() =>
      npRequireSiteSeoSettings({
        siteName: "Example",
        siteUrl: "https://example.com/",
        defaultDescription: "",
        defaultOgImage: null,
        twitterHandle: null,
        defaultLocale: "en-US",
      }),
    ).toThrow(NpSeoContractError);
    expect(npRequireRobotsTxt("User-agent: *\nDisallow: /admin\n")).toContain("Disallow");
    expect(() => npRequireRobotsTxt("x".repeat(npSeoContractLimits.robotsTxtLength + 1))).toThrow(
      /robots/u,
    );
  });
});
