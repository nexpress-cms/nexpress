import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseWxrStream, WpImportStreamError } from "./wxr-stream.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

describe("parseWxrStream", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "wp-import-stream-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("parses the channel header up front then yields items lazily", async () => {
    const stream = await parseWxrStream(path.join(FIXTURES_DIR, "minimal.wxr.xml"));
    expect(stream.header.site.title).toBe("Acme Test Blog");
    expect(stream.header.authors).toHaveLength(1);
    expect(stream.header.authors[0]?.login).toBe("alice");
    expect(stream.header.terms.find((t) => t.taxonomy === "category")?.slug).toBe("news");

    const records: string[] = [];
    for await (const record of stream.items) {
      records.push(`${record.wpType}/${record.slug}`);
    }
    // Fixture has a post, a page, and an attachment (in that order).
    expect(records).toEqual(["post/hello-world", "page/about", "attachment/hero-jpg"]);
  });

  it("aborts when a single item exceeds maxItemBytes", async () => {
    const file = path.join(tmp, "big.xml");
    const big = "x".repeat(2048);
    writeFileSync(
      file,
      `<?xml version="1.0"?><rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>X</title><link></link><description></description><wp:base_site_url></wp:base_site_url><wp:base_blog_url></wp:base_blog_url><item><title>Big</title><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><wp:post_name>big</wp:post_name><content:encoded><![CDATA[${big}]]></content:encoded></item></channel></rss>`,
      "utf8",
    );
    const stream = await parseWxrStream(file, {
      maxItemBytes: 256, // smaller than the embedded payload
      highWaterMark: 64,
    });
    await expect(async () => {
      for await (const _ of stream.items) {
        // unreachable
      }
    }).rejects.toBeInstanceOf(WpImportStreamError);
  });

  it("aborts when the header itself exceeds maxItemBytes", async () => {
    const file = path.join(tmp, "header.xml");
    // No <item> at all — the header guard kicks in once the
    // buffered prefix exceeds the cap.
    writeFileSync(file, "<rss>" + "x".repeat(4096) + "</rss>", "utf8");
    await expect(
      parseWxrStream(file, { maxItemBytes: 256, highWaterMark: 64 }),
    ).rejects.toBeInstanceOf(WpImportStreamError);
  });
});
