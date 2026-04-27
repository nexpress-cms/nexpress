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

function staffPostsRequest(staff: { accessToken: string; csrfToken: string }, body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/collections/posts", {
    method: "POST",
    headers: {
      cookie: `nx-session=${staff.accessToken}; nx-csrf=${staff.csrfToken}`,
      "x-csrf-token": staff.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
    const res = await sitemapGET();
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
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await sitemapGET();
    const xml = await res.text();
    expect(xml).toContain(
      "<loc>http://localhost:3000/blog/sitemap-regression</loc>",
    );
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
        content: { root: { type: "root", children: [] } },
        _status: "draft",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await sitemapGET();
    const xml = await res.text();
    expect(xml).not.toContain("hidden-draft");
  });

  it("includes published pages with normalized slug", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      new NextRequest("http://localhost:3000/api/collections/pages", {
        method: "POST",
        headers: {
          cookie: `nx-session=${staff.accessToken}; nx-csrf=${staff.csrfToken}`,
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

    const res = await sitemapGET();
    const xml = await res.text();
    expect(xml).toContain("<loc>http://localhost:3000/about</loc>");
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
          cookie: `nx-session=${staff.accessToken}; nx-csrf=${staff.csrfToken}`,
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

    const res = await sitemapGET();
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
    const xml = renderSitemapXml("http://example.com", [
      { loc: "/path?a=1&b=2" },
    ]);
    expect(xml).toContain("a=1&amp;b=2");
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml.endsWith("</urlset>")).toBe(true);
  });
});
