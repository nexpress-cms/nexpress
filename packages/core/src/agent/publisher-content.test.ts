import { describe, expect, it } from "vitest";
import {
  npAnalyzeAgentPublisherContentV1,
  npRankAgentPublisherCandidatesV1,
  npRequireAgentPublisherRouteInventoryV1,
  type NpAgentPublisherCandidateV1,
} from "./publisher-content.js";
import type { NpAgentJsonObject } from "../agent-contract/types.js";
const cutoff = "2026-01-01T00:00:00.000Z";
function content(url: string): NpAgentJsonObject {
  return {
    body: {
      version: 1,
      document: {
        root: {
          type: "root",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [{ type: "link", version: 1, url, children: [] }],
        },
      },
    },
  };
}
describe("Publisher deterministic bounded content analysis", () => {
  it("never calls an internal link broken without complete host evidence", () => {
    const input = {
      fields: [{ name: "body", type: "richText" as const }],
      content: content("/missing"),
      cutoff,
    };
    expect(npAnalyzeAgentPublisherContentV1({ ...input, inventory: null })).toContain(
      "internal-links-unknown",
    );
    expect(
      npAnalyzeAgentPublisherContentV1({
        ...input,
        inventory: { siteId: "default", complete: false, routes: [] },
      }),
    ).not.toContain("broken-internal-link");
    expect(
      npAnalyzeAgentPublisherContentV1({
        ...input,
        inventory: { siteId: "default", complete: true, routes: [] },
      }),
    ).toContain("broken-internal-link");
    expect(
      npAnalyzeAgentPublisherContentV1({
        ...input,
        content: content("https://external.test/missing"),
        inventory: { siteId: "default", complete: true, routes: [] },
      }),
    ).not.toContain("broken-internal-link");
  });
  it("uses configured visible SEO fields and declared referenced freshness only", () => {
    const findings = npAnalyzeAgentPublisherContentV1({
      fields: [
        { name: "seoTitle", type: "text" },
        { name: "seoDescription", type: "text", hidden: true },
        { name: "body", type: "richText" },
      ],
      content: { ...content("/old"), seoTitle: " ", seoDescription: "private" },
      cutoff,
      inventory: {
        siteId: "default",
        complete: true,
        routes: [{ path: "/old", updatedAt: "2025-01-01T00:00:00.000Z" }],
      },
    });
    expect(findings).toContain("missing-seo-title");
    expect(findings).not.toContain("missing-seo-description");
    expect(findings).toContain("seo-fields-unknown");
    expect(findings).toContain("stale-reference");
  });
  it("marks absent declared SEO groups missing and absolute links unknown without a site origin", () => {
    const result = npAnalyzeAgentPublisherContentV1({
      fields: [
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "title", type: "text" },
            { name: "description", type: "text" },
          ],
        },
        { name: "body", type: "richText" },
      ],
      content: content("https://same-site.test/possibly-internal"),
      cutoff,
      inventory: { siteId: "default", complete: true, routes: [] },
    });
    expect(result).toContain("missing-seo-title");
    expect(result).toContain("missing-seo-description");
    expect(result).not.toContain("seo-fields-unknown");
    expect(result).toContain("internal-links-unknown");
    expect(result).not.toContain("broken-internal-link");
  });
  it("rejects cross-site or malformed host route inventories", () => {
    expect(() =>
      npRequireAgentPublisherRouteInventoryV1(
        { siteId: "other", complete: true, routes: [] },
        "default",
      ),
    ).toThrow();
    expect(() =>
      npRequireAgentPublisherRouteInventoryV1(
        { siteId: "default", complete: true, routes: [{ path: "/../private", updatedAt: null }] },
        "default",
      ),
    ).toThrow();
  });
  it("ranks visible issues first then freshness and stable identifiers", () => {
    const candidate = (
      id: string,
      date: string,
      findings: NpAgentPublisherCandidateV1["findings"],
    ): NpAgentPublisherCandidateV1 => ({
      collection: "posts",
      documentId: id,
      base: { version: "1", digest: "unused" },
      updatedAt: date,
      locale: null,
      findings,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
      },
      content: {},
    });
    const old = candidate("a", "2024-01-01T00:00:00.000Z", ["stale-content"]),
      broken = candidate("b", "2025-01-01T00:00:00.000Z", [
        "stale-content",
        "broken-internal-link",
      ]);
    expect(npRankAgentPublisherCandidatesV1([old, broken]).map((c) => c.documentId)).toEqual([
      "b",
      "a",
    ]);
    expect(
      npRankAgentPublisherCandidatesV1([candidate("b", old.updatedAt, old.findings), old]).map(
        (c) => c.documentId,
      ),
    ).toEqual(["a", "b"]);
  });
});
