import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET as sitemapGET } from "@/app/sitemap.xml/route";
import { GET as robotsGET } from "@/app/robots.txt/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";

import { NextRequest } from "next/server";

function staffPostsRequest(
  staff: { accessToken: string; csrfToken: string },
  body: object,
): NextRequest {
  return new NextRequest("http://localhost:3000/api/collections/posts", {
    method: "POST",
    headers: {
      cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
      "x-csrf-token": staff.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * The integration harness installs an i18n config (en + ko, default
 * en) so most tests need to call the per-locale child sitemap (`?locale=en`)
 * rather than the bare `/sitemap.xml` — the bare URL now serves a
 * `<sitemapindex>` per Phase 12.9. Helper keeps the test bodies tight.
 */
function sitemapRequest(locale?: string): NextRequest {
  const url = locale
    ? `http://localhost:3000/sitemap.xml?locale=${encodeURIComponent(locale)}`
    : "http://localhost:3000/sitemap.xml";
  return new NextRequest(url);
}

describe.skipIf(skipIfNoTestDb())("sitemap.xml + robots.txt (Phase 10.1)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("static routes always appear in the sitemap", async () => {
    const res = await sitemapGET(sitemapRequest("en"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/xml/);
    const xml = await res.text();
    // Home + blog index + discussions index + search are
    // unconditional — they don't depend on any DB state.
    expect(xml).toContain("<loc>http://localhost:3000/</loc>");
    expect(xml).toContain("<loc>http://localhost:3000/blog</loc>");
    expect(xml).toContain("<loc>http://localhost:3000/discussions</loc>");
    expect(xml).toContain("<loc>http://localhost:3000/search</loc>");
    expect(xml).toContain("<priority>1.0</priority>");
  });

  it("published posts surface as /blog/{slug} entries", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Sitemap regression",
        slug: "sitemap-regression",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await sitemapGET(sitemapRequest("en"));
    const xml = await res.text();
    expect(xml).toContain("<loc>http://localhost:3000/blog/sitemap-regression</loc>");
    // Each collection-row entry carries the changefreq + priority
    // declared on the collection's seo config.
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.7</priority>");
  });

  it("draft / pending posts are excluded (anonymous read filter)", async () => {
    const staff = await seedUser({ role: "editor" });
    // Draft post — not published.
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Hidden draft",
        slug: "hidden-draft",
        content: npCreateEmptyRichTextContent(),
        _status: "draft",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await sitemapGET(sitemapRequest("en"));
    const xml = await res.text();
    expect(xml).not.toContain("hidden-draft");
  });

  it("scheduled posts are excluded until the publish sweep promotes them", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Hidden scheduled sitemap",
        slug: "hidden-scheduled-sitemap",
        content: npCreateEmptyRichTextContent(),
        publishedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await sitemapGET(sitemapRequest("en"));
    const xml = await res.text();
    expect(xml).not.toContain("hidden-scheduled-sitemap");
  });

  it("includes published pages with normalized slug", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      new NextRequest("http://localhost:3000/api/collections/pages", {
        method: "POST",
        headers: {
          cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
          "x-csrf-token": staff.csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "About",
          slug: "about",
          blocks: [],
          _status: "published",
        }),
      }),
      { params: Promise.resolve({ slug: "pages" }) },
    );

    const res = await sitemapGET(sitemapRequest("en"));
    const xml = await res.text();
    // Pages is `i18n: true` since the localized-pages → pages
    // collapse, so a page saved without an explicit locale
    // defaults to defaultLocale="en" and the seo helper prepends
    // the locale prefix.
    expect(xml).toContain("<loc>http://localhost:3000/en/about</loc>");
  });

  it("dedupes overlapping static + dynamic entries", async () => {
    // The home page slug `/` would land at "/" via the page seo
    // helper, which collides with the static "/" entry. The
    // route should emit only one `<loc>http://localhost:3000/</loc>`.
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      new NextRequest("http://localhost:3000/api/collections/pages", {
        method: "POST",
        headers: {
          cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
          "x-csrf-token": staff.csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Home",
          slug: "/",
          blocks: [],
          _status: "published",
        }),
      }),
      { params: Promise.resolve({ slug: "pages" }) },
    );

    const res = await sitemapGET(sitemapRequest("en"));
    const xml = await res.text();
    const matches = xml.match(/<loc>http:\/\/localhost:3000\/<\/loc>/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("robots.txt points at the sitemap and disallows admin/api", async () => {
    const res = await robotsGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/^User-agent: \*/m);
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /api");
    expect(body).toContain("Sitemap: http://localhost:3000/sitemap.xml");
  });

  it("XML body is well-formed (escapes & < > in URLs)", async () => {
    // Slugs the platform accepts won't contain these characters,
    // but the renderer's escape function is part of the public
    // contract — verify it's wired by passing an entry through
    // the helper directly.
    const { renderSitemapXml } = await import("@nexpress/core");
    const xml = renderSitemapXml("http://example.com", [{ loc: "/path?a=1&b=2" }]);
    expect(xml).toContain("a=1&amp;b=2");
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml.endsWith("</urlset>")).toBe(true);
  });

  // -------------------------------------------------------------
  // Phase 12.9 — sitemap-index split for i18n sites.
  // The harness installs `{ locales: ["en", "ko"], defaultLocale: "en" }`,
  // so the bare `/sitemap.xml` URL resolves to a `<sitemapindex>` and
  // each locale's content lives at `/sitemap.xml?locale=…`.
  // -------------------------------------------------------------

  it("bare /sitemap.xml emits a sitemap index pointing at every locale", async () => {
    const res = await sitemapGET(sitemapRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/xml/);
    const xml = await res.text();
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("<loc>http://localhost:3000/sitemap.xml?locale=en</loc>");
    expect(xml).toContain("<loc>http://localhost:3000/sitemap.xml?locale=ko</loc>");
    // The index never carries `<url>` entries; child sitemaps own those.
    expect(xml).not.toContain("<url>");
    expect(xml).not.toContain("<urlset");
  });

  it("non-default-locale sitemap omits static routes (avoids cross-file dupes)", async () => {
    const res = await sitemapGET(sitemapRequest("ko"));
    expect(res.status).toBe(200);
    const xml = await res.text();
    // Static routes (/, /blog, /search, /discussions) live in the
    // default-locale sitemap so a row never appears in two siblings.
    expect(xml).not.toContain("<loc>http://localhost:3000/</loc>");
    expect(xml).not.toContain("<loc>http://localhost:3000/blog</loc>");
    expect(xml).not.toContain("<loc>http://localhost:3000/discussions</loc>");
    // It IS a urlset though — header must be present even when empty.
    expect(xml).toContain("<urlset");
  });

  it("non-i18n collection rows only appear in the default-locale sitemap", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "English-only post",
        slug: "english-only",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const en = await (await sitemapGET(sitemapRequest("en"))).text();
    const ko = await (await sitemapGET(sitemapRequest("ko"))).text();
    // posts is non-i18n, so its rows go to the default (en) sitemap
    // only — ko's sitemap stays free of the explicitly supplied slug.
    expect(en).toContain("<loc>http://localhost:3000/blog/english-only</loc>");
    expect(ko).not.toContain("english-only");
  });

  it("unknown ?locale value 404s rather than falling back silently", async () => {
    const res = await sitemapGET(sitemapRequest("xx"));
    expect(res.status).toBe(404);
  });

  it("i18n collection: each per-locale sitemap carries the full hreflang alternates", async () => {
    // Two siblings of the same translation group should appear
    // exactly once across the locale-split sitemaps (en row in en
    // sitemap, ko row in ko sitemap), but EACH entry must list
    // both as `<xhtml:link>` alternates so crawlers discover the
    // translation when arriving at either URL.
    const { saveDocument } = await import("@nexpress/core");
    const admin = await seedUser({ role: "admin" });
    const actor = {
      id: admin.userId,
      email: admin.email,
      name: "Test",
      role: admin.role,
      tokenVersion: 0,
    };
    // The collection's slug derives from the title via
    // `slugField: { useField: "title" }`. Using the same ASCII
    // title in both locales gives identical slugs (which is fine
    // because the unique constraint is `(locale, slug)`), so both
    // entries land at /en/greeting and /ko/greeting.
    const en = await saveDocument(
      "pages",
      null,
      { title: "Greeting", seoDescription: "en body", locale: "en" },
      actor,
      { status: "published" },
    );
    const groupId = (en.doc as { translationGroupId: string }).translationGroupId;
    await saveDocument(
      "pages",
      null,
      {
        title: "Greeting",
        seoDescription: "ko body",
        locale: "ko",
        translationGroupId: groupId,
      },
      actor,
      { status: "published" },
    );

    const enXml = await (await sitemapGET(sitemapRequest("en"))).text();
    const koXml = await (await sitemapGET(sitemapRequest("ko"))).text();

    expect(enXml).toContain("<loc>http://localhost:3000/en/greeting</loc>");
    expect(enXml).not.toContain("<loc>http://localhost:3000/ko/greeting</loc>");
    expect(enXml).toContain('hreflang="en" href="http://localhost:3000/en/greeting"');
    expect(enXml).toContain('hreflang="ko" href="http://localhost:3000/ko/greeting"');

    expect(koXml).toContain("<loc>http://localhost:3000/ko/greeting</loc>");
    expect(koXml).not.toContain("<loc>http://localhost:3000/en/greeting</loc>");
    expect(koXml).toContain('hreflang="en" href="http://localhost:3000/en/greeting"');
    expect(koXml).toContain('hreflang="ko" href="http://localhost:3000/ko/greeting"');
  });

  it("ignores ?locale= when i18n is not configured (flat-mode regression)", async () => {
    // Non-i18n sites historically served `<urlset>` directly at
    // /sitemap.xml. A stray `?locale=` from a crawler shouldn't
    // collapse that into an empty document — the param is a
    // 12.9 affordance, not a filter. Fix: ignore the param when
    // `getI18nConfig()` returns null. This test reproduces a
    // non-i18n environment by clearing the harness's i18n config
    // for the duration of the assertion, then restores it so
    // sibling tests stay green.
    const { resetI18nConfig, setI18nConfig } = await import("@nexpress/core");
    resetI18nConfig();
    try {
      const res = await sitemapGET(sitemapRequest("anything"));
      expect(res.status).toBe(200);
      const xml = await res.text();
      // Flat urlset, NOT an index, AND static routes still present.
      expect(xml).toContain("<urlset");
      expect(xml).not.toContain("<sitemapindex");
      expect(xml).toContain("<loc>http://localhost:3000/</loc>");
      expect(xml).toContain("<loc>http://localhost:3000/blog</loc>");
    } finally {
      setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    }
  });

  it("renderSitemapIndexXml emits a sitemap-index document with absolute URLs", async () => {
    const { renderSitemapIndexXml } = await import("@nexpress/core");
    const xml = renderSitemapIndexXml("https://example.com", [
      { loc: "/sitemap.xml?locale=en", lastmod: "2026-04-29T00:00:00.000Z" },
      { loc: "/sitemap.xml?locale=ko" },
    ]);
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("<loc>https://example.com/sitemap.xml?locale=en</loc>");
    expect(xml).toContain("<lastmod>2026-04-29T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<loc>https://example.com/sitemap.xml?locale=ko</loc>");
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml.endsWith("</sitemapindex>")).toBe(true);
  });
});
