import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  npAnalyzeAgentPublisherContentV1,
  npCreateAgentPublisherSelectionReceiptV1,
  npRequireAgentPublisherSelectionReceiptV1,
  npRequireAgentPublisherSelectionDiagnosticV2,
  npRankAgentPublisherCandidatesV1,
  npRequireAgentPublisherRouteInventoryV1,
  type NpAgentPublisherCandidateV1,
} from "./publisher-content.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderRequestCanonicalV1,
} from "../agent-contract/types.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
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
  it("retains only the exact selected snapshot bound to classified source and request hashes", () => {
    const receipt = npCreateAgentPublisherSelectionReceiptV1({
      observedAt: "2026-10-15T00:00:00.000Z",
      collectionSlugs: ["posts"],
      staleBefore: cutoff,
      candidateLimit: 5,
      batchSize: 1,
      partial: false,
      inventory: null,
      scanned: 1,
      admitted: 1,
      selected: 1,
      unavailable: 0,
      oversized: 0,
    });
    const metadata = {
      observedAt: receipt.observedAt,
      scanned: 1,
      truncated: false,
      selectionReceipt: receipt,
      candidates: [
        {
          evidenceId: "publisher-content-000",
          collection: "posts",
          documentId: "01900000-0000-7000-8000-000000000040",
          base: { version: "revision:7", digest: `cj1:sha256:${"a".repeat(43)}` },
          updatedAt: "2025-01-01T00:00:00.000Z",
          locale: null,
          findings: ["stale-content"],
        },
      ],
    };
    const metadataDigest = `cj1:sha256:${createHash("sha256")
      .update(`np.agent-runtime-publisher-candidates.v1\0${serializeAgentCanonicalJson(metadata)}`)
      .digest("base64url")}`;
    const contentDigest = `cj1:sha256:${"b".repeat(43)}`;
    const request = {
      trustedContext: [
        {
          id: "publisher-candidates",
          kind: "server-fact",
          text: serializeAgentCanonicalJson(metadata),
          digest: metadataDigest,
          classification: { dataClass: "sensitive-approved", sourceDigest: metadataDigest },
        },
      ],
      untrustedEvidence: [
        {
          id: "publisher-content-000",
          kind: "content",
          digest: contentDigest,
          observedAt: metadata.candidates[0].updatedAt,
          text: "Never persist this raw body",
          classification: { dataClass: "sensitive-approved", sourceDigest: contentDigest },
        },
      ],
    } as unknown as NpAgentProviderRequestCanonicalV1;
    const diagnostic = npRequireAgentPublisherSelectionDiagnosticV2(
      request,
      `cj1:sha256:${"c".repeat(43)}`,
    );
    expect(diagnostic.candidateSnapshot).toEqual([{ ...metadata.candidates[0], contentDigest }]);
    expect(diagnostic.selectionDigest).toBe(metadataDigest);
    expect(JSON.stringify(diagnostic)).not.toContain("Never persist");
    const changed = structuredClone(request);
    changed.trustedContext[0].text = JSON.stringify({ ...metadata, candidates: [] });
    expect(() =>
      npRequireAgentPublisherSelectionDiagnosticV2(changed, diagnostic.requestDigest),
    ).toThrow();
    changed.trustedContext = request.trustedContext;
    changed.untrustedEvidence[0].classification.sourceDigest = `cj1:sha256:${"d".repeat(43)}`;
    expect(() =>
      npRequireAgentPublisherSelectionDiagnosticV2(changed, diagnostic.requestDigest),
    ).toThrow();
  });
  it("reconstructs only bounded internally consistent selection receipts", () => {
    const receipt = npCreateAgentPublisherSelectionReceiptV1({
      observedAt: "2026-10-15T00:00:00.000Z",
      collectionSlugs: ["posts"],
      staleBefore: cutoff,
      candidateLimit: 5,
      batchSize: 1,
      partial: true,
      inventory: null,
      scanned: 4,
      admitted: 2,
      selected: 1,
      unavailable: 1,
      oversized: 1,
    });
    expect(receipt.exclusions).toEqual([
      { code: "unavailable", count: 1 },
      { code: "oversized", count: 1 },
      { code: "batch-limit", count: 1 },
    ]);
    expect(npRequireAgentPublisherSelectionReceiptV1(receipt)).toEqual(receipt);
    for (const invalid of [
      { ...receipt, hiddenDocumentId: "never retain" },
      { ...receipt, counts: { scanned: 3, admitted: 2, selected: 1 } },
      { ...receipt, counts: { scanned: 4, admitted: 2, selected: 0 } },
      { ...receipt, criteria: { ...receipt.criteria, collectionSlugs: ["posts", "posts"] } },
      { ...receipt, criteria: { ...receipt.criteria, candidateLimit: 51 } },
      { ...receipt, coverage: { ...receipt.coverage, candidateSample: "complete" } },
      { ...receipt, exclusions: [{ code: "read-denied", count: 3 }] },
      {
        ...receipt,
        exclusions: [
          { code: "unavailable", count: 2 },
          { code: "unavailable", count: 1 },
        ],
      },
    ])
      expect(() => npRequireAgentPublisherSelectionReceiptV1(invalid)).toThrow();
    expect(Object.isFrozen(receipt.counts)).toBe(true);
    expect(Object.isFrozen(receipt.exclusions[0])).toBe(true);
  });
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
  it("keeps unknown route age uncertain even when canonical route existence is complete", () => {
    const findings = npAnalyzeAgentPublisherContentV1({
      fields: [{ name: "body", type: "richText" }],
      content: content("/library"),
      cutoff,
      inventory: {
        siteId: "default",
        complete: true,
        routes: [{ path: "/library", updatedAt: null }],
      },
    });
    expect(findings).toContain("internal-links-unknown");
    expect(findings).not.toContain("broken-internal-link");
    expect(findings).not.toContain("stale-reference");
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
  it("checks nested SEO metadata and rich-text links in supported groups and arrays", () => {
    const linked = content("/library").body;
    const findings = npAnalyzeAgentPublisherContentV1({
      fields: [
        {
          type: "row",
          fields: [
            {
              name: "seo",
              type: "group",
              fields: [
                { name: "title", type: "text" },
                { name: "description", type: "textarea" },
              ],
            },
          ],
        },
        {
          name: "sections",
          type: "array",
          fields: [
            { name: "copy", type: "richText" },
            { name: "privateCopy", type: "richText", hidden: true },
          ],
        },
      ],
      content: {
        seo: { title: "", description: "A description grounded in the existing document." },
        sections: [{ copy: linked!, privateCopy: content("/hidden-missing-route").body! }],
      },
      cutoff,
      inventory: {
        siteId: "default",
        complete: true,
        routes: [{ path: "/library", updatedAt: "2025-06-01T00:00:00.000Z" }],
      },
    });
    expect(findings).toEqual(["missing-seo-title", "stale-content", "stale-reference"]);
    expect(findings).not.toContain("broken-internal-link");
    expect(findings).not.toContain("missing-seo-description");
  });
  it("recognizes the shipped post collection's SEO field names", () => {
    expect(
      npAnalyzeAgentPublisherContentV1({
        fields: [
          { name: "seoMetaTitle", type: "text" },
          { name: "seoMetaDescription", type: "textarea" },
        ],
        content: { seoMetaTitle: "", seoMetaDescription: "" },
        cutoff,
        inventory: { siteId: "default", complete: true, routes: [] },
      }),
    ).toEqual(["missing-seo-description", "missing-seo-title", "stale-content"]);
  });
  it("retains unknown coverage for blocks and unsupported link forms alongside grounded findings", () => {
    const findings = npAnalyzeAgentPublisherContentV1({
      fields: [
        { name: "seoTitle", type: "text" },
        { name: "seoDescription", type: "textarea" },
        { name: "body", type: "richText" },
        { name: "layout", type: "blocks", allowedBlocks: [] },
      ],
      content: {
        ...content("/known?tracking=1#chapter"),
        seoTitle: "Known title",
        seoDescription: "",
        layout: [],
      },
      cutoff,
      inventory: {
        siteId: "default",
        complete: true,
        routes: [{ path: "/known", updatedAt: "2026-06-01T00:00:00.000Z" }],
      },
    });
    expect(findings).toEqual([
      "internal-links-unknown",
      "missing-seo-description",
      "stale-content",
    ]);
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
    const missingTitle = candidate("c", "2025-12-01T00:00:00.000Z", [
      "stale-content",
      "missing-seo-title",
    ]);
    const staleReference = candidate("d", "2025-02-01T00:00:00.000Z", [
      "stale-content",
      "stale-reference",
    ]);
    const unknown = candidate("e", "2023-01-01T00:00:00.000Z", [
      "stale-content",
      "internal-links-unknown",
      "seo-fields-unknown",
    ]);
    expect(
      npRankAgentPublisherCandidatesV1([old, staleReference, unknown, broken, missingTitle]).map(
        (c) => c.documentId,
      ),
    ).toEqual(["b", "c", "d", "e", "a"]);
  });
});
