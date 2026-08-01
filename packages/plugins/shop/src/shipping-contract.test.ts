import { describe, expect, it } from "vitest";

import {
  NP_SHOP_DELIVERY_METHOD_CONTRACT,
  NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
  npAnalyzeShopDeliveryMethod,
  npRequireShopShippingMethodSelectInput,
  npRequireShopShippingQuoteResult,
} from "./shipping-contract.js";

const requestedAt = "2026-08-01T00:00:00.000Z";
const maximumExpiresAt = "2026-08-01T01:00:00.000Z";

describe("Shop shipping contract", () => {
  it("closes one provider result into a PII-free quote", () => {
    expect(
      npRequireShopShippingQuoteResult(
        {
          contract: NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
          quoteId: "quote_123",
          methods: [
            {
              id: "parcel-standard",
              label: "Standard parcel",
              amountMinor: 3_000,
              estimatedDelivery: { minimumDays: 2, maximumDays: 4 },
            },
          ],
          expiresAt: "2026-08-01T00:15:00.000Z",
        },
        { providerId: "test-shipping", requestedAt, maximumExpiresAt },
      ),
    ).toEqual({
      contract: "np.shop-shipping-quote.v1",
      providerId: "test-shipping",
      quoteId: "quote_123",
      methods: [
        {
          id: "parcel-standard",
          label: "Standard parcel",
          amountMinor: 3_000,
          estimatedDelivery: { minimumDays: 2, maximumDays: 4 },
        },
      ],
      quotedAt: requestedAt,
      expiresAt: "2026-08-01T00:15:00.000Z",
    });
  });

  it("rejects duplicate methods, unknown fields, and expiry outside the request window", () => {
    expect(() =>
      npRequireShopShippingQuoteResult(
        {
          contract: NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
          quoteId: "quote_123",
          methods: [
            {
              id: "parcel",
              label: "Parcel",
              amountMinor: 3_000,
              estimatedDelivery: null,
            },
            {
              id: "parcel",
              label: "Duplicate",
              amountMinor: 4_000,
              estimatedDelivery: null,
            },
          ],
          expiresAt: "2026-08-01T01:00:01.000Z",
          destination: "must not be reflected",
        },
        { providerId: "test-shipping", requestedAt, maximumExpiresAt },
      ),
    ).toThrow(/Invalid Shop shipping quote result/u);
  });

  it("requires exact delivery snapshots and revision-safe selections", () => {
    expect(
      npAnalyzeShopDeliveryMethod({
        contract: NP_SHOP_DELIVERY_METHOD_CONTRACT,
        providerId: "test-shipping",
        quoteId: "quote_123",
        methodId: "parcel",
        label: "Parcel",
        amountMinor: 3_000,
        estimatedDelivery: { minimumDays: 5, maximumDays: 2 },
        quotedAt: requestedAt,
        quoteExpiresAt: "2026-08-01T00:15:00.000Z",
      }),
    ).toContain("delivery method.estimatedDelivery.minimumDays must not exceed maximumDays.");
    expect(
      npRequireShopShippingMethodSelectInput({
        draftId: "123e4567-e89b-42d3-a456-426614174000",
        expectedRevision: 2,
        methodId: "parcel",
      }),
    ).toEqual({
      draftId: "123e4567-e89b-42d3-a456-426614174000",
      expectedRevision: 2,
      methodId: "parcel",
    });
  });
});
