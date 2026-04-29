import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseWxr } from "./wxr.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

describe("parseWxr — minimal fixture", () => {
  const xml = loadFixture("minimal.wxr.xml");
  const bundle = parseWxr(xml);

  it("captures site-level metadata from the <channel> envelope", () => {
    expect(bundle.site).toEqual({
      title: "Acme Test Blog",
      link: "https://acme.example.com",
      description: "A blog for testing WXR parsing.",
      baseSiteUrl: "https://acme.example.com",
      baseBlogUrl: "https://acme.example.com",
      language: "en-US",
    });
  });

  it("captures every <wp:author>", () => {
    expect(bundle.authors).toHaveLength(1);
    expect(bundle.authors[0]).toEqual({
      wpId: 1,
      login: "alice",
      email: "alice@example.com",
      displayName: "Alice Author",
      description: "Writes about widgets.",
    });
  });

  it("captures channel-level taxonomies (categories + tags)", () => {
    expect(bundle.terms).toEqual([
      { taxonomy: "category", slug: "news", name: "News" },
      { taxonomy: "post_tag", slug: "launch", name: "launch" },
    ]);
  });

  it("returns one record per <item> in document order", () => {
    expect(bundle.records).toHaveLength(3);
    expect(bundle.records.map((r) => r.wpType)).toEqual(["post", "page", "attachment"]);
  });

  it("parses the post item with full content / status / dates / slug", () => {
    const post = bundle.records[0];
    expect(post).toBeDefined();
    if (!post) return;
    expect(post.wpId).toBe(1);
    expect(post.wpType).toBe("post");
    expect(post.status).toBe("publish");
    expect(post.slug).toBe("hello-world");
    expect(post.title).toBe("Hello World");
    expect(post.excerpt).toBe("Welcome to Acme.");
    expect(post.rawContent).toContain("Welcome to Acme.");
    expect(post.rawContent).toContain('class="wp-image-42"');
    expect(post.wpAuthorLogin).toBe("alice");
    expect(post.publishedAt).toBe("2025-04-01 12:00:00");
    expect(post.updatedAt).toBe("2025-04-02 09:30:00");
  });

  it("captures per-post category + tag references", () => {
    const post = bundle.records[0];
    expect(post?.terms).toEqual([
      { taxonomy: "category", slug: "news", name: "News" },
      { taxonomy: "post_tag", slug: "launch", name: "launch" },
    ]);
  });

  it("collects post-meta into a flat key/value map", () => {
    const post = bundle.records[0];
    expect(post?.meta).toEqual({
      _thumbnail_id: "42",
      _edit_last: "1",
    });
  });

  it("extracts both the featured image (from _thumbnail_id) and inline <img> refs", () => {
    const post = bundle.records[0];
    expect(post?.mediaRefs).toEqual([
      { sourceUrl: "", wpAttachmentId: 42, kind: "featured" },
      {
        sourceUrl: "https://acme.example.com/wp-content/uploads/2025/04/hero.jpg",
        wpAttachmentId: 42,
        kind: "inline",
      },
    ]);
  });

  it("captures comments with the parent linkage preserved", () => {
    const post = bundle.records[0];
    expect(post?.comments).toHaveLength(2);
    expect(post?.comments[0]).toMatchObject({
      wpId: 10,
      parentWpId: null,
      authorName: "Bob Reader",
      authorEmail: "bob@example.com",
      authorUrl: null,
      content: "Great post!",
      approved: true,
    });
    expect(post?.comments[1]).toMatchObject({
      wpId: 11,
      parentWpId: 10,
      authorName: "Alice Author",
      authorEmail: "alice@example.com",
      authorUrl: "https://alice.example.com",
      approved: true,
    });
  });

  it("parses page records with the right wpType", () => {
    const page = bundle.records[1];
    expect(page).toMatchObject({
      wpId: 2,
      wpType: "page",
      slug: "about",
      title: "About",
      status: "publish",
    });
    expect(page?.excerpt).toBeNull();
  });

  it("parses attachment records and surfaces their attachment_url as a media ref", () => {
    const attachment = bundle.records[2];
    expect(attachment?.wpType).toBe("attachment");
    expect(attachment?.status).toBe("draft"); // 'inherit' coerces to 'draft' per the design doc
    expect(attachment?.mediaRefs).toEqual([
      {
        sourceUrl: "https://acme.example.com/wp-content/uploads/2025/04/hero.jpg",
        wpAttachmentId: null,
        kind: "inline",
      },
    ]);
  });
});

describe("parseWxr — error handling", () => {
  it("throws a clear error on a non-WXR XML document", () => {
    expect(() => parseWxr("<root><item/></root>")).toThrow(/Invalid WXR/);
  });

  it("returns an empty bundle when the channel has no items / authors", () => {
    const bundle = parseWxr(`<?xml version="1.0"?>
      <rss xmlns:wp="http://wordpress.org/export/1.2/">
        <channel>
          <title>Empty</title>
          <link>https://example.com</link>
          <description></description>
          <wp:base_site_url>https://example.com</wp:base_site_url>
          <wp:base_blog_url>https://example.com</wp:base_blog_url>
        </channel>
      </rss>`);
    expect(bundle.records).toEqual([]);
    expect(bundle.authors).toEqual([]);
    expect(bundle.terms).toEqual([]);
    expect(bundle.site.title).toBe("Empty");
  });

  it("coerces unknown <wp:status> values to 'draft' rather than throwing", () => {
    const bundle = parseWxr(`<?xml version="1.0"?>
      <rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>X</title><link>https://x.example.com</link><description></description>
          <wp:base_site_url>https://x.example.com</wp:base_site_url>
          <wp:base_blog_url>https://x.example.com</wp:base_blog_url>
          <item>
            <title>weird</title>
            <wp:post_id>9</wp:post_id>
            <wp:post_name>weird</wp:post_name>
            <wp:post_type>post</wp:post_type>
            <wp:status>future</wp:status>
            <wp:post_date_gmt>2025-04-01 12:00:00</wp:post_date_gmt>
            <wp:post_modified_gmt>2025-04-01 12:00:00</wp:post_modified_gmt>
            <content:encoded><![CDATA[hi]]></content:encoded>
            <dc:creator>alice</dc:creator>
          </item>
        </channel>
      </rss>`);
    expect(bundle.records[0]?.status).toBe("draft");
  });
});
