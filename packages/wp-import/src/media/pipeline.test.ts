import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildAttachmentIndex } from "../apply/attachment-index.js";
import { parseWxr } from "../parse/wxr.js";
import { runMediaPipeline, type MediaPipelineDeps } from "./pipeline.js";
import { WpMediaDownloadError } from "./download.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function loadBundle() {
  const xml = readFileSync(path.join(FIXTURES_DIR, "minimal.wxr.xml"), "utf8");
  const bundle = parseWxr(xml);
  const attachments = buildAttachmentIndex(bundle);
  return { bundle, attachments };
}

const HERO_URL = "https://acme.example.com/wp-content/uploads/2025/04/hero.jpg";

describe("runMediaPipeline", () => {
  it("downloads each unique URL once and stamps both lookup maps", async () => {
    const { bundle, attachments } = loadBundle();
    let callCount = 0;
    const deps: MediaPipelineDeps = {
      download: vi.fn(() => {
        callCount++;
        return Promise.resolve({
          buffer: Buffer.from([1, 2, 3]),
          mimeType: "image/jpeg",
          filename: "hero.jpg",
        });
      }),
      upload: vi.fn(() => Promise.resolve({ id: "media-1" })),
    };
    const report = await runMediaPipeline(bundle, attachments, deps);
    expect(report.uploaded).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toEqual([]);
    expect(callCount).toBe(1);
    // The hero asset is referenced both as an inline URL and as the
    // featured-image attachment id 42 — both maps must point at the
    // same media row.
    expect(report.resolution.byUrl.get(HERO_URL)).toBe("media-1");
    expect(report.resolution.byAttachmentId.get(42)).toBe("media-1");
  });

  it("does not download or upload in dry-run mode", async () => {
    const { bundle, attachments } = loadBundle();
    const download = vi.fn(() => Promise.reject(new Error("should not be called")));
    const upload = vi.fn(() => Promise.reject(new Error("should not be called")));
    const report = await runMediaPipeline(
      bundle,
      attachments,
      { download, upload },
      { dryRun: true },
    );
    expect(report.uploaded).toBe(0);
    expect(report.skipped).toBeGreaterThan(0);
    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(report.resolution.byUrl.size).toBe(0);
  });

  it("records a 404 as an error and continues", async () => {
    const { bundle, attachments } = loadBundle();
    const deps: MediaPipelineDeps = {
      download: vi.fn((url: string) =>
        Promise.reject(new WpMediaDownloadError(url, "not found", 404)),
      ),
      upload: vi.fn(() => Promise.resolve({ id: "unreachable" })),
    };
    const report = await runMediaPipeline(bundle, attachments, deps);
    expect(report.uploaded).toBe(0);
    expect(report.errors[0]).toMatchObject({
      url: HERO_URL,
      reason: expect.stringContaining("HTTP 404"),
    });
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("rejects disallowed MIME types without uploading", async () => {
    const { bundle, attachments } = loadBundle();
    const upload = vi.fn(() => Promise.resolve({ id: "unreachable" }));
    const report = await runMediaPipeline(bundle, attachments, {
      download: vi.fn(() =>
        Promise.resolve({
          buffer: Buffer.from([0]),
          mimeType: "text/html",
          filename: "phish.html",
        }),
      ),
      upload,
    });
    expect(report.uploaded).toBe(0);
    expect(report.errors[0]?.reason).toContain("disallowed MIME");
    expect(upload).not.toHaveBeenCalled();
  });

  it("21.13 — reuses an existing np_media row when findExistingByHash returns a hit", async () => {
    const { bundle, attachments } = loadBundle();
    const upload = vi.fn(() => Promise.resolve({ id: "fresh-id" }));
    const findExistingByHash = vi.fn(() => Promise.resolve({ id: "reused-id" }));
    const report = await runMediaPipeline(bundle, attachments, {
      download: () =>
        Promise.resolve({
          buffer: Buffer.from([1, 2, 3]),
          mimeType: "image/jpeg",
          filename: "hero.jpg",
        }),
      upload,
      findExistingByHash,
    });
    expect(report.uploaded).toBe(0);
    expect(report.reused).toBe(1);
    expect(upload).not.toHaveBeenCalled();
    // Hash deps received the SHA-256 of [1, 2, 3].
    expect(findExistingByHash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    // Resolution still points at the reused id, not a new one.
    expect(report.resolution.byUrl.get(HERO_URL)).toBe("reused-id");
  });

  it("21.13 — runs same-host downloads in parallel up to perHostConcurrency", async () => {
    // Synthetic bundle with three URLs on the same host. Track
    // overlap by counting how many downloads are in-flight at once.
    const xml = `<?xml version="1.0"?>
<rss version="2.0"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>X</title>
  <link>https://x.example.com</link>
  <description></description>
  <wp:base_site_url>https://x.example.com</wp:base_site_url>
  <wp:base_blog_url>https://x.example.com</wp:base_blog_url>
  <item>
    <title>Many images</title>
    <dc:creator>alice</dc:creator>
    <content:encoded><![CDATA[<p><img src="https://x.example.com/a.jpg"/><img src="https://x.example.com/b.jpg"/><img src="https://x.example.com/c.jpg"/></p>]]></content:encoded>
    <wp:post_id>1</wp:post_id>
    <wp:post_date_gmt>2025-04-01 12:00:00</wp:post_date_gmt>
    <wp:post_modified_gmt>2025-04-01 12:00:00</wp:post_modified_gmt>
    <wp:post_name>many-images</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_type>post</wp:post_type>
  </item>
</channel>
</rss>`;
    const bundle = parseWxr(xml);
    const attachments = buildAttachmentIndex(bundle);
    let inflight = 0;
    let peak = 0;
    const download = vi.fn(async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      // Yield to the event loop so other workers can pick up.
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return { buffer: Buffer.from([0]), mimeType: "image/jpeg", filename: "x.jpg" };
    });
    let counter = 0;
    const upload = vi.fn(() => Promise.resolve({ id: `m-${counter++}` }));
    const report = await runMediaPipeline(
      bundle,
      attachments,
      { download, upload },
      { perHostConcurrency: 2 },
    );
    expect(report.uploaded).toBe(3);
    // With concurrency=2, two downloads should be in flight at once.
    expect(peak).toBe(2);
  });

  it("flags featured-image refs whose attachment record is missing", async () => {
    // A WXR that references a _thumbnail_id but never declares the
    // attachment record. Hand-build a minimal bundle for this.
    const xml = `<?xml version="1.0"?>
<rss version="2.0"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>X</title>
  <link>https://x.example.com</link>
  <description></description>
  <wp:base_site_url>https://x.example.com</wp:base_site_url>
  <wp:base_blog_url>https://x.example.com</wp:base_blog_url>
  <item>
    <title>Orphan</title>
    <dc:creator>alice</dc:creator>
    <content:encoded><![CDATA[<p>body</p>]]></content:encoded>
    <wp:post_id>1</wp:post_id>
    <wp:post_date_gmt>2025-04-01 12:00:00</wp:post_date_gmt>
    <wp:post_modified_gmt>2025-04-01 12:00:00</wp:post_modified_gmt>
    <wp:post_name>orphan</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_type>post</wp:post_type>
    <wp:postmeta>
      <wp:meta_key>_thumbnail_id</wp:meta_key>
      <wp:meta_value>999</wp:meta_value>
    </wp:postmeta>
  </item>
</channel>
</rss>`;
    const bundle = parseWxr(xml);
    const attachments = buildAttachmentIndex(bundle);
    const deps: MediaPipelineDeps = {
      download: vi.fn(),
      upload: vi.fn(),
    };
    const report = await runMediaPipeline(bundle, attachments, deps);
    expect(report.errors[0]?.reason).toContain("attachment record missing");
    expect(deps.download).not.toHaveBeenCalled();
  });
});
