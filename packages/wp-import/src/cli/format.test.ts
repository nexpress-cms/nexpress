import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseWxr } from "../parse/wxr.js";
import { formatSummary } from "./format.js";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

describe("formatSummary", () => {
  const bundle = parseWxr(loadFixture("minimal.wxr.xml"));

  it("renders a stable line-by-line dry-run summary", () => {
    const out = formatSummary({
      bundle,
      sourcePath: "tests/fixtures/minimal.wxr.xml",
      dryRun: true,
    });
    // Pin the exact lines so a future change to the format is
    // explicit (snapshot test, not just a smoke test).
    expect(out).toBe(
      [
        "WordPress import — dry run",
        "",
        "Source: tests/fixtures/minimal.wxr.xml",
        "Site:   Acme Test Blog",
        "        https://acme.example.com",
        "Lang:   en-US",
        "",
        "Authors (1)",
        "  alice <alice@example.com>  Alice Author",
        "",
        "Channel taxonomies (2)",
        "  category     1",
        "  post_tag     1",
        "",
        "Records (3)",
        "  attachment   1  (handled by the media pipeline in 21.5)",
        "  page         1",
        "  post         1",
        "",
        "Inline media refs (1 unique URL)",
        "Featured images   (1)",
        "",
        "Comments: 2 across 1 record",
        "",
        "This was a dry run. Pass --apply to write to the database.",
      ].join("\n"),
    );
  });

  it("switches the trailing line and the title when dryRun is false", () => {
    const out = formatSummary({
      bundle,
      sourcePath: "minimal.wxr.xml",
      dryRun: false,
    });
    expect(out.startsWith("WordPress import\n")).toBe(true);
    expect(out).toContain("Pass --apply to write to the database");
    expect(out).not.toContain("dry run");
  });

  it("handles a bundle with no items / authors / taxonomies gracefully", () => {
    const empty = parseWxr(`<?xml version="1.0"?>
      <rss xmlns:wp="http://wordpress.org/export/1.2/">
        <channel>
          <title>Empty</title>
          <link>https://example.com</link>
          <description></description>
          <wp:base_site_url>https://example.com</wp:base_site_url>
          <wp:base_blog_url>https://example.com</wp:base_blog_url>
        </channel>
      </rss>`);
    const out = formatSummary({ bundle: empty, sourcePath: "x", dryRun: true });
    expect(out).toContain("Authors (0)\n  (none)");
    expect(out).toContain("Channel taxonomies (0)\n  (none)");
    expect(out).toContain("Records (0)\n  (no items)");
  });
});
