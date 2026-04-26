import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET as searchAPIGET } from "@/app/api/search/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";

import { NextRequest } from "next/server";

function staffPostsRequest(
  staff: { accessToken: string; csrfToken: string },
  body: object,
): NextRequest {
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

describe.skipIf(skipIfNoTestDb())("site search (Phase 10.2)", () => {
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

  // The site `/search` page is a server component that calls
  // `searchCollections` directly and uses `seo.urlPath` to build
  // result links. The behavior is fully covered by exercising the
  // public `searchCollections` + per-collection seo plumbing —
  // testing the React render itself would need a full server-
  // component test harness that isn't set up here.

  it("returns published posts for a matching query", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Quick brown fox",
        slug: "quick-brown-fox",
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections } = await import("@nexpress/core");
    const result = await searchCollections({ q: "brown" });
    expect(result.total).toBeGreaterThanOrEqual(1);
    const hit = result.results.find(
      (r) => r.collection === "posts" && (r.doc as { slug: string }).slug === "quick-brown-fox",
    );
    expect(hit).toBeDefined();
  });

  it("draft posts are excluded from search (status filter)", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Hidden draft term-zebra",
        slug: "hidden-zebra",
        content: { root: { type: "root", children: [] } },
        _status: "draft",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections } = await import("@nexpress/core");
    const result = await searchCollections({ q: "zebra" });
    expect(result.total).toBe(0);
  });

  it("URL resolution: post hits map to /blog/{slug} via seo.urlPath", async () => {
    // The search page uses `getCollectionConfig(slug).seo.urlPath`
    // to build links. Verifying the post collection's
    // `seo.urlPath` produces the expected URL closes the loop on
    // 10.1 + 10.2 (10.1 added the field, 10.2 reads it).
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "URL resolver pumpkin",
        slug: "url-resolver",
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    // posts.slugField = { useField: "title", unique: true } so the
    // pipeline derives the slug from the title regardless of what
    // we send. The seeded title becomes slug "url-resolver-pumpkin".
    const { searchCollections, getCollectionConfig } = await import(
      "@nexpress/core"
    );
    const result = await searchCollections({ q: "pumpkin" });
    const hit = result.results.find(
      (r) => r.collection === "posts" &&
        (r.doc as { slug: string }).slug === "url-resolver-pumpkin",
    );
    expect(hit).toBeDefined();
    const urlPath = getCollectionConfig("posts").seo?.urlPath;
    expect(urlPath).toBeDefined();
    const path = urlPath!(hit!.doc as Record<string, unknown>);
    expect(path).toBe("/blog/url-resolver-pumpkin");
  });

  it("/api/search route returns JSON shape the page consumes", async () => {
    // The page calls `searchCollections` directly, but the
    // public `/api/search` route shares the same backbone and
    // is what external callers (3rd-party plugins, mobile
    // apps) will hit. Verify the JSON envelope on a known
    // query.
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "API shape probe walnut",
        slug: "api-shape",
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    // Picked "walnut" intentionally — the search vector is stored
    // raw (no `to_tsvector('english', …)` stemming) but the query
    // goes through `plainto_tsquery('english', …)` which stems.
    // Words whose snowball stem differs from the surface form
    // (e.g. "pineapple" → "pineappl") miss; "walnut" stays
    // "walnut" so the index hit lands. A unified-stemming pass is
    // a pre-existing follow-up on the search-api module.
    const res = await searchAPIGET(
      new NextRequest("http://localhost:3000/api/search?q=walnut"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ collection: string; doc: Record<string, unknown> }>;
      total: number;
      perCollection: Record<string, number>;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.results[0]?.collection).toBe("posts");
    expect(body.perCollection.posts).toBeGreaterThanOrEqual(1);
  });

  it("empty query returns an empty result envelope", async () => {
    const res = await searchAPIGET(
      new NextRequest("http://localhost:3000/api/search?q="),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.results).toHaveLength(0);
  });
});
