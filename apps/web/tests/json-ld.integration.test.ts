import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("JSON-LD structured data (Phase 10.5)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  // Builders are pure transforms over `getSiteSeoSettings` —
  // exercising them through the public API doubles as a
  // regression for the underlying settings reader.

  it("WebSite descriptor includes a SearchAction with the canonical search URL", async () => {
    const { buildWebSiteJsonLd } = await import("@nexpress/core");
    const json = await buildWebSiteJsonLd();
    expect(json["@context"]).toBe("https://schema.org");
    expect(json["@type"]).toBe("WebSite");
    expect(json.name).toBe("Default site");
    expect(json.url).toBe("http://localhost:3000/");
    expect(json.potentialAction?.target.urlTemplate).toBe(
      "http://localhost:3000/search?q={search_term_string}",
    );
    expect(json.potentialAction?.["query-input"]).toBe("required name=search_term_string");
  });

  it("Article descriptor carries headline, dates, author, image; resolves /-rooted paths", async () => {
    const { buildArticleJsonLd } = await import("@nexpress/core");
    const published = new Date("2026-04-01T00:00:00Z");
    const modified = new Date("2026-04-15T12:30:00Z");
    const json = await buildArticleJsonLd({
      url: "http://localhost:3000/blog/hello",
      headline: "Hello world",
      description: "A test post.",
      image: "/og.png",
      datePublished: published,
      dateModified: modified,
      authorName: "Ada Lovelace",
      type: "BlogPosting",
    });
    expect(json["@type"]).toBe("BlogPosting");
    expect(json.headline).toBe("Hello world");
    expect(json.url).toBe("http://localhost:3000/blog/hello");
    expect(json.description).toBe("A test post.");
    // /-rooted path joined to site origin.
    expect(json.image).toBe("http://localhost:3000/og.png");
    expect(json.datePublished).toBe(published.toISOString());
    expect(json.dateModified).toBe(modified.toISOString());
    expect(json.author).toEqual({ "@type": "Person", name: "Ada Lovelace" });
    expect(json.publisher.name).toBe("Default site");
  });

  it("DiscussionForumPosting reuses Article shape with the right @type", async () => {
    const { buildDiscussionForumPostingJsonLd } = await import("@nexpress/core");
    const json = await buildDiscussionForumPostingJsonLd({
      url: "http://localhost:3000/discussions/topic",
      headline: "Topic title",
      datePublished: new Date("2026-04-01T00:00:00Z"),
      authorName: "@alice",
    });
    expect(json["@type"]).toBe("DiscussionForumPosting");
    // Inherits article fields.
    expect(json.headline).toBe("Topic title");
    expect(json.author).toEqual({ "@type": "Person", name: "@alice" });
  });

  it("Person descriptor carries handle, display name, avatar", async () => {
    const { buildPersonJsonLd } = await import("@nexpress/core");
    const json = await buildPersonJsonLd({
      url: "http://localhost:3000/u/alice",
      name: "Alice",
      alternateName: "@alice",
      image: "/avatars/alice.png",
      description: "Developer in residence.",
    });
    expect(json["@type"]).toBe("Person");
    expect(json.name).toBe("Alice");
    expect(json.alternateName).toBe("@alice");
    expect(json.image).toBe("http://localhost:3000/avatars/alice.png");
    expect(json.description).toBe("Developer in residence.");
  });

  it("absolute image URLs flow through unchanged (no double-origin)", async () => {
    const { buildArticleJsonLd } = await import("@nexpress/core");
    const json = await buildArticleJsonLd({
      url: "http://localhost:3000/blog/x",
      headline: "x",
      image: "https://cdn.example.com/og.png",
    });
    expect(json.image).toBe("https://cdn.example.com/og.png");
  });

  it("missing optional fields don't appear in the output (no `null` keys)", async () => {
    const { buildArticleJsonLd } = await import("@nexpress/core");
    const json = await buildArticleJsonLd({
      url: "http://localhost:3000/blog/x",
      headline: "x",
    });
    // Optional fields are omitted, not null — keeps the JSON-LD
    // tight and avoids tripping crawlers that strict-validate.
    expect(json).not.toHaveProperty("description");
    expect(json).not.toHaveProperty("image");
    expect(json).not.toHaveProperty("datePublished");
    expect(json).not.toHaveProperty("dateModified");
    expect(json).not.toHaveProperty("author");
  });

  it("settings updates propagate to JSON-LD (siteName, origin)", async () => {
    const { updateCommunitySettings, buildWebSiteJsonLd, updateSite } =
      await import("@nexpress/core");
    void updateCommunitySettings;
    // Persist a site setting so siteName/url change at the next read.
    await updateSite("default", {
      name: "Acme Inc.",
      settings: {
        siteUrl: "https://acme.example",
        defaultLocale: null,
        timezone: null,
      },
    });

    const json = await buildWebSiteJsonLd();
    expect(json.name).toBe("Acme Inc.");
    expect(json.url).toBe("https://acme.example/");
    // Origin trailing slash is normalized — `/search?q=…` not `//search`.
    expect(json.potentialAction?.target.urlTemplate).toBe(
      "https://acme.example/search?q={search_term_string}",
    );
  });
});
