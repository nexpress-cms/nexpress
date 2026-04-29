import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseWxr } from "../parse/wxr.js";
import { buildAttachmentIndex } from "./attachment-index.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

describe("buildAttachmentIndex", () => {
  it("indexes attachment records by wpId and by source URL", () => {
    const bundle = parseWxr(loadFixture("minimal.wxr.xml"));
    const index = buildAttachmentIndex(bundle);

    const byId = index.byId.get(42);
    expect(byId).toBeDefined();
    expect(byId?.sourceUrl).toBe("https://acme.example.com/wp-content/uploads/2025/04/hero.jpg");
    expect(byId?.title).toBe("hero.jpg");

    const byUrl = index.byUrl.get("https://acme.example.com/wp-content/uploads/2025/04/hero.jpg");
    expect(byUrl?.wpAttachmentId).toBe(42);
  });

  it("returns empty maps when the bundle has no attachments", () => {
    const bundle = parseWxr(`<?xml version="1.0"?>
      <rss xmlns:wp="http://wordpress.org/export/1.2/">
        <channel>
          <title>X</title>
          <link>https://x.example.com</link>
          <description></description>
          <wp:base_site_url>https://x.example.com</wp:base_site_url>
          <wp:base_blog_url>https://x.example.com</wp:base_blog_url>
        </channel>
      </rss>`);
    const index = buildAttachmentIndex(bundle);
    expect(index.byId.size).toBe(0);
    expect(index.byUrl.size).toBe(0);
  });
});
