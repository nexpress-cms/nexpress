import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { GET as feedGET } from "@/app/feed.xml/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";

import { NextRequest } from "next/server";

function staffPostsRequest(staff: TestUserSession, body: object): NextRequest {
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

describe.skipIf(skipIfNoTestDb())("Atom feed (Phase 10.4)", () => {
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

  it("default feed returns Atom XML for posts", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Feed entry alpha",
        slug: "feed-alpha",
        content: npCreateEmptyRichTextContent(),
        excerpt: "Short summary alpha.",
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await feedGET(new NextRequest("http://localhost:3000/feed.xml"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/atom\+xml/);
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain("<title>Feed entry alpha</title>");
    expect(xml).toContain(
      '<link rel="alternate" type="text/html" href="http://localhost:3000/blog/feed-alpha"/>',
    );
    expect(xml).toContain('<summary type="text">Short summary alpha.</summary>');
  });

  it("draft posts are excluded (anonymous read filter)", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Hidden draft tomato",
        slug: "hidden-draft-tomato",
        content: npCreateEmptyRichTextContent(),
        _status: "draft",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await feedGET(new NextRequest("http://localhost:3000/feed.xml"));
    const xml = await res.text();
    expect(xml).not.toContain("hidden-draft-tomato");
  });

  it("?collection=discussions reads from a different collection", async () => {
    const res = await feedGET(
      new NextRequest("http://localhost:3000/feed.xml?collection=discussions"),
    );
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<feed xmlns=");
    // self link encodes the collection query param.
    expect(xml).toContain(
      '<link rel="self" href="http://localhost:3000/feed.xml?collection=discussions"/>',
    );
  });

  it("collection without seo.urlPath returns 404", async () => {
    // `users` is admin-internal; its collection config doesn't
    // declare seo.urlPath, so the feed has nothing to publish
    // and returns 404 instead of an empty feed.
    const res = await feedGET(new NextRequest("http://localhost:3000/feed.xml?collection=users"));
    expect(res.status).toBe(404);
  });

  it("rejects malformed collection query values before feed dispatch", async () => {
    const res = await feedGET(
      new NextRequest("http://localhost:3000/feed.xml?collection=Posts%2F..%2Fusers"),
    );
    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toBe("Invalid feed collection.");
  });

  it("XML body escapes special characters in titles", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Tag <script> & Co.",
        slug: "escape-test",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );
    const res = await feedGET(new NextRequest("http://localhost:3000/feed.xml"));
    const xml = await res.text();
    expect(xml).toContain("Tag &lt;script&gt; &amp; Co.");
    expect(xml).not.toContain("<script>");
  });

  it("entries are ordered most-recently-updated first", async () => {
    const staff = await seedUser({ role: "editor" });
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Older entry papaya",
        slug: "older-papaya",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );
    // Force a measurable timestamp gap.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await collectionPOST(
      staffPostsRequest(staff, {
        title: "Newer entry quince",
        slug: "newer-quince",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );

    const res = await feedGET(new NextRequest("http://localhost:3000/feed.xml"));
    const xml = await res.text();
    const newer = xml.indexOf("Newer entry quince");
    const older = xml.indexOf("Older entry papaya");
    expect(newer).toBeGreaterThanOrEqual(0);
    expect(older).toBeGreaterThanOrEqual(0);
    expect(newer).toBeLessThan(older);
  });
});
