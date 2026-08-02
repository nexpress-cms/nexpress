import { describe, expect, it } from "vitest";

import {
  NP_SHOP_TAX_HEALTH_CONTRACT,
  NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT,
  NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
  npAnalyzeShopTaxHealth,
  npRequireShopTaxQuoteRequest,
  npRequireShopTaxQuoteResult,
} from "./tax-contract.js";

const requestedAt = "2026-08-02T00:00:00.000Z";
const maximumExpiresAt = "2026-08-02T01:00:00.000Z";
const deliveryMethod = {
  contract: "np.shop-delivery-method.v1" as const,
  providerId: "test-shipping",
  quoteId: "shipping_quote_1",
  methodId: "parcel",
  label: "Parcel",
  amountMinor: 3_000,
  estimatedDelivery: { minimumDays: 2, maximumDays: 4 },
  quotedAt: requestedAt,
  quoteExpiresAt: maximumExpiresAt,
};
const line = {
  key: "123e4567-e89b-42d3-a456-426614174000:base",
  productId: "123e4567-e89b-42d3-a456-426614174000",
  productSlug: "mug",
  productName: "Mug",
  variantSku: null,
  variantName: null,
  quantity: 2,
  unitPriceMinor: 12_500,
  lineTotalMinor: 25_000,
};
const destination = {
  recipientName: "홍길동",
  phone: "010-1234-5678",
  countryCode: "KR",
  postalCode: "04524",
  addressLine1: "서울특별시 중구 세종대로 110",
  addressLine2: null,
  locality: "중구",
  administrativeArea: "서울특별시",
};

describe("Shop tax contract", () => {
  it("validates one exact private quote request without changing price semantics", () => {
    expect(
      npRequireShopTaxQuoteRequest({
        contract: NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT,
        draftId: "223e4567-e89b-42d3-a456-426614174000",
        draftRevision: 2,
        currency: "KRW",
        subtotalMinor: 25_000,
        shippingMinor: 3_000,
        totalBeforeTaxMinor: 28_000,
        totalUnits: 2,
        lines: [line],
        destination,
        deliveryMethod,
        requestedAt,
        maximumExpiresAt,
      }),
    ).toMatchObject({ totalBeforeTaxMinor: 28_000, deliveryMethod });
    expect(() =>
      npRequireShopTaxQuoteRequest({
        contract: NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT,
        draftId: "223e4567-e89b-42d3-a456-426614174000",
        draftRevision: 2,
        currency: "KRW",
        subtotalMinor: 25_000,
        shippingMinor: 3_000,
        totalBeforeTaxMinor: 25_000,
        totalUnits: 2,
        lines: [line],
        destination: { ...destination, privateNote: "must fail" },
        deliveryMethod,
        requestedAt,
        maximumExpiresAt,
      }),
    ).toThrow(/Invalid Shop tax quote request/u);
  });

  it("closes one provider result into a PII-free additive tax quote", () => {
    expect(
      npRequireShopTaxQuoteResult(
        {
          contract: NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
          quoteId: "tax_quote_1",
          components: [
            { id: "vat", label: "VAT", amountMinor: 2_000 },
            { id: "local", label: "Local tax", amountMinor: 500 },
          ],
          amountMinor: 2_500,
          expiresAt: "2026-08-02T00:15:00.000Z",
        },
        { providerId: "test-tax", requestedAt, maximumExpiresAt },
      ),
    ).toEqual({
      contract: "np.shop-tax-quote.v1",
      providerId: "test-tax",
      quoteId: "tax_quote_1",
      components: [
        { id: "vat", label: "VAT", amountMinor: 2_000 },
        { id: "local", label: "Local tax", amountMinor: 500 },
      ],
      amountMinor: 2_500,
      quotedAt: requestedAt,
      expiresAt: "2026-08-02T00:15:00.000Z",
    });
  });

  it("rejects mismatched component totals and malformed health", () => {
    expect(() =>
      npRequireShopTaxQuoteResult(
        {
          contract: NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
          quoteId: "tax_quote_1",
          components: [{ id: "vat", label: "VAT", amountMinor: 2_000 }],
          amountMinor: 2_001,
          expiresAt: "2026-08-02T00:15:00.000Z",
        },
        { providerId: "test-tax", requestedAt, maximumExpiresAt },
      ),
    ).toThrow(/Invalid Shop tax quote result/u);
    expect(
      npAnalyzeShopTaxHealth({
        contract: NP_SHOP_TAX_HEALTH_CONTRACT,
        providerId: "test-tax",
        status: "ok",
        errorCode: "provider-error",
        attemptedAt: requestedAt,
        succeededAt: null,
      }),
    ).toContain("successful tax health requires the current success timestamp and no error.");
  });

  it("accepts zero added tax with an empty component list", () => {
    expect(
      npRequireShopTaxQuoteResult(
        {
          contract: NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
          quoteId: "tax_quote_zero",
          components: [],
          amountMinor: 0,
          expiresAt: "2026-08-02T00:15:00.000Z",
        },
        { providerId: "test-tax", requestedAt, maximumExpiresAt },
      ),
    ).toMatchObject({ amountMinor: 0, components: [] });
  });
});
