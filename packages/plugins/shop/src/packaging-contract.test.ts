import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
  NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT,
  NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT,
  npAnalyzeShopPackagingProposalHealth,
  npAnalyzeShopPackagingProposalRequest,
  npAnalyzeShopPackagingProposalResult,
  npAnalyzeShopPackagingProposalResultForRequest,
  npRequireShopExchangePackagingProposalInput,
  npRequireShopFulfillmentPackagingProposalInput,
  npRequireShopPackagingProposalHealth,
  npRequireShopPackagingProposalRequest,
  npRequireShopPackagingProposalResult,
  npRequireShopPackagingProviderId,
} from "./packaging-contract.js";

const proposalId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const exchangeId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const secondProductId = "55555555-5555-4555-8555-555555555555";
const requestedAt = "2026-08-11T00:00:00.000Z";
const proposedAt = "2026-08-11T00:00:01.000Z";
const expiresAt = "2026-08-11T00:01:00.000Z";

const lines = [
  {
    lineKey: `${productId}:_`,
    productId,
    productSlug: "everyday-cup",
    variantSku: null,
    quantity: 1,
  },
  {
    lineKey: `${secondProductId}:CUP-BLUE`,
    productId: secondProductId,
    productSlug: "colored-cup",
    variantSku: "CUP-BLUE",
    quantity: 2,
  },
];

const parcels = [
  {
    id: "parcel-1",
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    weightGrams: 1_500,
    items: [
      { lineKey: `${productId}:_`, quantity: 1 },
      { lineKey: `${secondProductId}:CUP-BLUE`, quantity: 2 },
    ],
  },
];

function outboundRequest() {
  return {
    contract: NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT,
    proposalId,
    orderId,
    target: "outbound" as const,
    exchangeId: null,
    sourceRevision: 2,
    expectedParcelRevision: null,
    lines,
    requestedAt,
    expiresAt,
  };
}

function replacementRequest() {
  return {
    ...outboundRequest(),
    target: "replacement" as const,
    exchangeId,
    sourceRevision: 3,
    expectedParcelRevision: 1,
  };
}

function resultFor(
  request: ReturnType<typeof outboundRequest> | ReturnType<typeof replacementRequest>,
) {
  return {
    contract: NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT,
    proposalId: request.proposalId,
    orderId: request.orderId,
    target: request.target,
    exchangeId: request.exchangeId,
    sourceRevision: request.sourceRevision,
    expectedParcelRevision: request.expectedParcelRevision,
    parcels,
    proposedAt,
    expiresAt: request.expiresAt,
  };
}

describe("Shop packaging proposal contracts", () => {
  it("accepts exact outbound and replacement requests and results", () => {
    const outbound = outboundRequest();
    const replacement = replacementRequest();
    const outboundResult = resultFor(outbound);
    const replacementResult = resultFor(replacement);

    expect(npAnalyzeShopPackagingProposalRequest(outbound)).toEqual([]);
    expect(npAnalyzeShopPackagingProposalRequest(replacement)).toEqual([]);
    expect(npAnalyzeShopPackagingProposalResult(outboundResult)).toEqual([]);
    expect(npAnalyzeShopPackagingProposalResult(replacementResult)).toEqual([]);
    expect(npRequireShopPackagingProposalRequest(outbound)).toBe(outbound);
    expect(npRequireShopPackagingProposalRequest(replacement)).toBe(replacement);
    expect(npRequireShopPackagingProposalResult(outboundResult)).toBe(outboundResult);
    expect(npRequireShopPackagingProposalResult(replacementResult)).toBe(replacementResult);
  });

  it("matches result identity, freshness, and exact allocation to its request", () => {
    const request = outboundRequest();
    const result = resultFor(request);
    expect(
      npAnalyzeShopPackagingProposalResultForRequest(
        request,
        result,
        new Date("2026-08-11T00:00:02.000Z"),
      ),
    ).toEqual([]);

    expect(
      npAnalyzeShopPackagingProposalResultForRequest(
        request,
        {
          ...result,
          orderId: exchangeId,
          proposedAt: "2026-08-11T00:00:40.000Z",
          parcels: [
            {
              ...parcels[0],
              items: [{ lineKey: `${productId}:_`, quantity: 1 }],
            },
          ],
        },
        new Date("2026-08-11T00:00:02.000Z"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "result.orderId must match the request.",
        "result.proposedAt is too far in the future.",
        "result.parcels must allocate every requested line and exact quantity.",
      ]),
    );
    expect(
      npAnalyzeShopPackagingProposalResultForRequest(
        request,
        result,
        new Date("2026-08-11T00:01:01.000Z"),
      ),
    ).toContain("the packaging proposal expired before it could be accepted.");
  });

  it("accepts exact successful and closed-error health receipts", () => {
    const successful = {
      contract: NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
      providerId: "warehouse-pack",
      target: "outbound" as const,
      status: "ok" as const,
      errorCode: null,
      attemptedAt: requestedAt,
    };
    const failed = {
      ...successful,
      status: "error" as const,
      errorCode: "provider-error" as const,
      attemptedAt: proposedAt,
      target: "replacement" as const,
    };

    expect(npAnalyzeShopPackagingProposalHealth(successful)).toEqual([]);
    expect(npAnalyzeShopPackagingProposalHealth(failed)).toEqual([]);
    expect(npRequireShopPackagingProposalHealth(successful)).toBe(successful);
    expect(npRequireShopPackagingProposalHealth(failed)).toBe(failed);
  });

  it("parses exact revision-bound outbound and replacement Admin envelopes", () => {
    expect(
      npRequireShopFulfillmentPackagingProposalInput({
        row: { id: orderId, fulfillmentRevision: 2, parcelRevision: null },
        values: {},
      }),
    ).toEqual({
      orderId,
      target: "outbound",
      exchangeId: null,
      expectedSourceRevision: 2,
      expectedParcelRevision: null,
    });
    expect(
      npRequireShopExchangePackagingProposalInput({
        row: { id: orderId, exchangeId, exchangeRevision: 3, parcelRevision: 1 },
        values: {},
      }),
    ).toEqual({
      orderId,
      target: "replacement",
      exchangeId,
      expectedSourceRevision: 3,
      expectedParcelRevision: 1,
    });
  });

  it("rejects unknown request, line, result, parcel, health, and Admin fields", () => {
    const requestIssues = npAnalyzeShopPackagingProposalRequest({
      ...outboundRequest(),
      privateDestination: "must not cross the contract",
      lines: [{ ...lines[0], productName: "unexpected provider input" }],
    });
    expect(requestIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("privateDestination is not supported"),
        expect.stringContaining("productName is not supported"),
      ]),
    );

    const resultIssues = npAnalyzeShopPackagingProposalResult({
      ...resultFor(outboundRequest()),
      providerMessage: "must not persist",
      parcels: [{ ...parcels[0], label: "free-form provider text" }],
    });
    expect(resultIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("providerMessage is not supported"),
        expect.stringContaining("label is not supported"),
      ]),
    );

    expect(
      npAnalyzeShopPackagingProposalHealth({
        contract: NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
        providerId: "warehouse-pack",
        target: "outbound",
        status: "error",
        errorCode: "provider-error",
        attemptedAt: requestedAt,
        providerError: "private details",
      }),
    ).toContain("packaging proposal health.providerError is not supported.");

    try {
      npRequireShopFulfillmentPackagingProposalInput({
        row: {
          id: orderId,
          fulfillmentRevision: 2,
          parcelRevision: null,
          providerId: "untrusted",
        },
        values: { parcels: [] },
      });
      throw new Error("Expected strict Admin envelope validation to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([
          expect.stringContaining("providerId is not supported"),
          expect.stringContaining("parcels is not supported"),
        ]),
      });
    }
  });

  it("rejects target and exchange identity mismatches", () => {
    expect(
      npAnalyzeShopPackagingProposalRequest({
        ...outboundRequest(),
        exchangeId,
      }),
    ).toContain("packaging proposal request exchange identity does not match its target.");
    expect(
      npAnalyzeShopPackagingProposalRequest({
        ...replacementRequest(),
        exchangeId: null,
      }),
    ).toContain("packaging proposal request exchange identity does not match its target.");
    expect(
      npAnalyzeShopPackagingProposalResult({
        ...resultFor(replacementRequest()),
        target: "outbound",
      }),
    ).toContain("packaging proposal result exchange identity does not match its target.");
  });

  it("accepts canonical provider ids and rejects invalid provider identity", () => {
    expect(npRequireShopPackagingProviderId("warehouse-pack")).toBe("warehouse-pack");
    expect(() => npRequireShopPackagingProviderId("Warehouse Pack")).toThrow(
      "Invalid Shop packaging provider id",
    );
    expect(() => npRequireShopPackagingProviderId(`p${"a".repeat(32)}`)).toThrow(
      "Invalid Shop packaging provider id",
    );
    expect(
      npAnalyzeShopPackagingProposalHealth({
        contract: NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
        providerId: "warehouse/address",
        target: "outbound",
        status: "ok",
        errorCode: null,
        attemptedAt: requestedAt,
      }),
    ).toContain("packaging proposal health.providerId is invalid.");
  });

  it("reuses the exact parcel count, dimension, weight, quantity, and allocation limits", () => {
    expect(
      npAnalyzeShopPackagingProposalResult({
        ...resultFor(outboundRequest()),
        parcels: Array.from({ length: 21 }, (_, index) => ({
          ...parcels[0],
          id: `parcel-${(index + 1).toString()}`,
        })),
      }),
    ).toContain("packaging proposal result.parcels must contain between 1 and 20 parcels.");

    const issues = npAnalyzeShopPackagingProposalResult({
      ...resultFor(outboundRequest()),
      parcels: [
        {
          ...parcels[0],
          lengthMm: 3_001,
          weightGrams: 500_001,
          items: Array.from({ length: 101 }, (_, index) => ({
            lineKey: `line-${index.toString()}`,
            quantity: index === 0 ? 100 : 1,
          })),
        },
      ],
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        "packaging proposal result.parcels[0].lengthMm is invalid.",
        "packaging proposal result.parcels[0].weightGrams is invalid.",
        "packaging proposal result.parcels[0].items accepts at most 100 allocations.",
        "packaging proposal result.parcels[0].items[0].quantity is invalid.",
        "packaging proposal result.parcels accepts at most 100 item allocations.",
      ]),
    );
  });
});
