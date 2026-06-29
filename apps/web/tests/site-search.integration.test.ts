import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import type { TestUserSession } from "./harness.js";

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
      cookie: `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`,
      "x-csrf-token": staff.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function actor(staff: TestUserSession) {
  return {
    id: staff.userId,
    email: staff.email,
    name: "Test",
    role: staff.role,
    tokenVersion: 0,
  };
}

function lexicalParagraph(text: string): unknown {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "paragraph",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              version: 1,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
            },
          ],
        },
      ],
    },
  };
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

  it("scheduled posts are excluded from search until published", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Hidden scheduled term-orchid",
        slug: "hidden-scheduled-orchid",
        content: { root: { type: "root", children: [] } },
        publishedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections } = await import("@nexpress/core");
    const result = await searchCollections({ q: "orchid" });
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
    const { searchCollections, getCollectionConfig } = await import("@nexpress/core");
    const result = await searchCollections({ q: "pumpkin" });
    const hit = result.results.find(
      (r) =>
        r.collection === "posts" && (r.doc as { slug: string }).slug === "url-resolver-pumpkin",
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

    // Phase 10.7 unified the write path with the read path:
    // `buildWeightedSearchVectorSql` wraps each bucket in
    // `to_tsvector('english', …)` (matching the
    // `plainto_tsquery('english', …)` on the read side), so
    // stem-divergent words now hit. "walnut" is stem-stable
    // either way; see the dedicated regression below for a
    // word whose stem actually differs from its surface form.
    const res = await searchAPIGET(new NextRequest("http://localhost:3000/api/search?q=walnut"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ collection: string; doc: Record<string, unknown>; score?: number }>;
      total: number;
      perCollection: Record<string, number>;
      facets?: Array<{ collection: string; label: string; count: number; selected: boolean }>;
      limit?: number;
      offset?: number;
      hasNextPage?: boolean;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.results[0]?.collection).toBe("posts");
    expect(body.results[0]?.score).toBeGreaterThan(0);
    expect(body.perCollection.posts).toBeGreaterThanOrEqual(1);
    expect(
      body.facets?.some((facet) => facet.collection === "posts" && facet.label === "Posts"),
    ).toBe(true);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.hasNextPage).toBe(false);
  });

  it("/api/search supports collection filters and page-based pagination metadata", async () => {
    const staff = await seedUser({ role: "editor" });
    const { saveDocument } = await import("@nexpress/core");
    await saveDocument(
      "posts",
      null,
      {
        title: "Filtered amber post",
        excerpt: "amber scope",
        content: lexicalParagraph("amber body"),
        publishedAt: new Date().toISOString(),
        author: staff.userId,
      },
      actor(staff),
      { status: "published" },
    );
    await saveDocument(
      "pages",
      null,
      {
        title: "Filtered amber page one",
        seoDescription: "amber scope",
        locale: "en",
      },
      actor(staff),
      { status: "published" },
    );
    await saveDocument(
      "pages",
      null,
      {
        title: "Filtered amber page two",
        seoDescription: "amber scope",
        locale: "en",
      },
      actor(staff),
      { status: "published" },
    );

    const res = await searchAPIGET(
      new NextRequest("http://localhost:3000/api/search?q=amber&collections=pages&page=2&limit=1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ collection: string; doc: Record<string, unknown>; score?: number }>;
      total: number;
      perCollection: Record<string, number>;
      facets?: Array<{ collection: string; label: string; count: number; selected: boolean }>;
      limit?: number;
      offset?: number;
      hasNextPage?: boolean;
    };

    expect(body.total).toBe(2);
    expect(body.results).toHaveLength(1);
    expect(body.results.every((result) => result.collection === "pages")).toBe(true);
    expect(body.perCollection.pages).toBe(2);
    expect(body.perCollection.posts).toBeUndefined();
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.hasNextPage).toBe(false);
    expect(body.facets).toEqual([
      { collection: "pages", label: "Pages", count: 2, selected: true },
    ]);
  });

  it("stem-divergent surface form matches stored content (Phase 10.7 regression)", async () => {
    // Regression for the pre-Phase-10.7 mismatch where stored
    // vectors were RAW tsvector text but queries ran through
    // `plainto_tsquery('english', …)`. After 10.7 both sides go
    // through the english snowball stemmer, so a doc indexed
    // with the plural ("pineapples") MUST be hit by a query for
    // the singular ("pineapple") — both reduce to lexeme
    // `pineappl`. If a future refactor regresses the write path
    // back to RAW, this assertion will fail.
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Tropical pineapples are delicious",
        slug: "tropical-pineapples",
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const { searchCollections } = await import("@nexpress/core");
    const result = await searchCollections({ q: "pineapple" });
    const hit = result.results.find(
      (r) =>
        r.collection === "posts" &&
        (r.doc as { slug?: string }).slug?.startsWith("tropical-pineapple"),
    );
    expect(hit).toBeDefined();
  });

  it("empty query returns an empty result envelope", async () => {
    const res = await searchAPIGET(new NextRequest("http://localhost:3000/api/search?q="));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.results).toHaveLength(0);
  });
});
