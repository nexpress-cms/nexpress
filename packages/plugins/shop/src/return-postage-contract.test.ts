import { describe, expect, it } from "vitest";

import {
  NP_SHOP_QUOTED_RETURN_LOGISTICS_REQUEST_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_QUOTE_RESULT_CONTRACT,
  npAnalyzeShopReturnPostageQuote,
  npAnalyzeStoredShopReturnPostagePrivate,
  npRequireShopQuotedReturnLogisticsRequest,
  npRequireShopReturnPostageQuoteResult,
  npRequireShopReturnPostageQuoteRequest,
} from "./return-postage-contract.js";

const orderId = "00000000-0000-4000-8000-000000000001";
const returnId = "00000000-0000-4000-8000-000000000002";
const quoteId = "00000000-0000-4000-8000-000000000003";
const shipmentId = "00000000-0000-4000-8000-000000000004";
const logisticsId = "00000000-0000-4000-8000-000000000005";
const productId = "00000000-0000-4000-8000-000000000006";
const quotedAt = "2026-08-08T00:00:00.000Z";
const expiresAt = "2026-08-08T01:00:00.000Z";

const method = {
  contract: NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT,
  providerId: "carrier-test",
  quoteId,
  methodId: "dropoff-standard",
  label: "Standard return",
  currency: "KRW" as const,
  amountMinor: 4_000,
  estimatedTransit: { minimumDays: 1, maximumDays: 3 },
  quotedAt,
  quoteExpiresAt: expiresAt,
};

describe("Shop return-postage contract", () => {
  it("accepts exact bounded provider results and rejects echoed private data", () => {
    const result = {
      contract: NP_SHOP_RETURN_POSTAGE_QUOTE_RESULT_CONTRACT,
      quoteId,
      methods: [
        {
          id: "dropoff-standard",
          label: "Standard return",
          amountMinor: 4_000,
          estimatedTransit: { minimumDays: 1, maximumDays: 3 },
        },
      ],
      expiresAt,
    };
    expect(
      npRequireShopReturnPostageQuoteResult(result, {
        quoteId,
        requestedAt: quotedAt,
        maximumExpiresAt: expiresAt,
      }),
    ).toEqual(result);
    try {
      npRequireShopReturnPostageQuoteResult(
        { ...result, origin: { postalCode: "secret" } },
        { quoteId, requestedAt: quotedAt, maximumExpiresAt: expiresAt },
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([expect.stringMatching(/origin is not supported/u)]),
      });
    }
  });

  it("passes one opaque return destination with the exact private quote request", () => {
    const request = {
      contract: NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT,
      quoteId,
      returnId,
      orderId,
      originalShipmentId: shipmentId,
      originalBookingReference: "booking-1",
      returnLocationReference: "returns-seoul-1",
      currency: "KRW",
      mode: "dropoff",
      items: [
        {
          lineKey: "line-1",
          productId,
          productName: "Mug",
          variantSku: null,
          variantName: null,
          quantity: 1,
        },
      ],
      origin: {
        recipientName: "Buyer",
        phone: "+82 10 1234 5678",
        countryCode: "KR",
        postalCode: "04524",
        addressLine1: "1 Test-ro",
        addressLine2: null,
        locality: "Seoul",
        administrativeArea: "Seoul",
      },
      readyAt: null,
      closeAt: null,
      requestedAt: quotedAt,
      maximumExpiresAt: expiresAt,
    } as const;
    expect(npRequireShopReturnPostageQuoteRequest(request)).toEqual(request);
    expect(() =>
      npRequireShopReturnPostageQuoteRequest({
        ...request,
        returnLocationReference: "private postal address",
      }),
    ).toThrow(/Invalid return postage quote request/u);
  });

  it("requires the selected PII-free snapshot to match one quoted method", () => {
    const quote = {
      contract: NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT,
      id: quoteId,
      returnId,
      orderId,
      providerId: "carrier-test",
      status: "selected",
      revision: 2,
      currency: "KRW",
      mode: "dropoff",
      methods: [
        {
          id: "dropoff-standard",
          label: "Standard return",
          amountMinor: 4_000,
          estimatedTransit: { minimumDays: 1, maximumDays: 3 },
        },
      ],
      selectedMethod: method,
      readyAt: null,
      closeAt: null,
      quotedAt,
      expiresAt,
    };
    expect(npAnalyzeShopReturnPostageQuote(quote)).toEqual([]);
    expect(
      npAnalyzeShopReturnPostageQuote({
        ...quote,
        selectedMethod: { ...method, amountMinor: 4_001 },
      }),
    ).toContain("return postage quote.selectedMethod does not match a quoted method.");
    expect(
      npAnalyzeShopReturnPostageQuote({
        ...quote,
        selectedMethod: {
          ...method,
          estimatedTransit: { minimumDays: 2, maximumDays: 3 },
        },
      }),
    ).toContain("return postage quote.selectedMethod does not match a quoted method.");
  });

  it("bounds the private origin to the quote lifetime", () => {
    const privateData = {
      contract: NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT,
      quoteId,
      returnId,
      orderId,
      ownerSegment: "member:00000000-0000-4000-8000-000000000007",
      origin: {
        recipientName: "Buyer",
        phone: "+82 10 1234 5678",
        countryCode: "KR",
        postalCode: "04524",
        addressLine1: "1 Test-ro",
        addressLine2: null,
        locality: "Seoul",
        administrativeArea: "Seoul",
      },
      createdAt: quotedAt,
      expiresAt,
    };
    expect(npAnalyzeStoredShopReturnPostagePrivate(privateData)).toEqual([]);
    expect(
      npAnalyzeStoredShopReturnPostagePrivate({
        ...privateData,
        expiresAt: "2026-08-08T01:00:01.000Z",
      }),
    ).toContain("private return postage lifetime is invalid.");
    expect(
      npAnalyzeStoredShopReturnPostagePrivate({
        ...privateData,
        ownerSegment: "member:not-a-uuid",
      }),
    ).toContain("private return postage.ownerSegment is invalid.");
  });

  it("adds the selected method only to the additive v2 creation request", () => {
    const request = {
      contract: NP_SHOP_QUOTED_RETURN_LOGISTICS_REQUEST_CONTRACT,
      logisticsId,
      returnId,
      orderId,
      originalShipmentId: shipmentId,
      originalBookingReference: "booking-1",
      mode: "dropoff",
      returnLocationReference: "returns-seoul-1",
      items: [
        {
          lineKey: "line-1",
          productId,
          productName: "Mug",
          variantSku: null,
          variantName: null,
          quantity: 1,
        },
      ],
      origin: {
        recipientName: "Buyer",
        phone: "+82 10 1234 5678",
        countryCode: "KR",
        postalCode: "04524",
        addressLine1: "1 Test-ro",
        addressLine2: null,
        locality: "Seoul",
        administrativeArea: "Seoul",
      },
      readyAt: null,
      closeAt: null,
      requestedAt: quotedAt,
      postageMethod: method,
    };
    expect(npRequireShopQuotedReturnLogisticsRequest(request)).toEqual(request);
    try {
      npRequireShopQuotedReturnLogisticsRequest({
        ...request,
        postageMethod: { ...method, providerId: "Other" },
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([
          expect.stringMatching(/postageMethod\.providerId is invalid/u),
        ]),
      });
    }
  });
});
