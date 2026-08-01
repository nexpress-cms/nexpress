import { describe, expect, it } from "vitest";

import {
  NP_SHOP_ORDER_DRAFT_CONTRACT,
  npAnalyzeShopOrderDraft,
  npRequireShopOrderDraft,
  npRequireShopOrderDraftCreateInput,
  npRequireShopOrderDraftDeleteInput,
  npRequireShopOrderDraftReadQuery,
  npRequireShopOrderDraftUpdateInput,
} from "./order-draft-contract.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const intentId = "223e4567-e89b-42d3-a456-426614174000";
const draftId = "323e4567-e89b-42d3-a456-426614174000";

function draft() {
  return {
    contract: NP_SHOP_ORDER_DRAFT_CONTRACT,
    id: draftId,
    status: "reviewable",
    revision: 2,
    checkoutIntentId: intentId,
    cartRevision: 2,
    cartFingerprint: "a".repeat(64),
    currency: "KRW",
    subtotalMinor: 50_000,
    shippingMinor: 0,
    totalMinor: 50_000,
    totalUnits: 2,
    lines: [
      {
        key: `${productId}:_`,
        productId,
        productSlug: "everyday-cup",
        productName: "Everyday cup",
        variantSku: null,
        variantName: null,
        quantity: 2,
        unitPriceMinor: 25_000,
        lineTotalMinor: 50_000,
      },
    ],
    customer: {
      fullName: "홍길동",
      email: "buyer@example.com",
      phone: "010-1234-5678",
    },
    shipping: {
      recipientName: "홍길동",
      phone: "010-1234-5678",
      countryCode: "KR",
      postalCode: "04524",
      addressLine1: "서울특별시 중구 세종대로 110",
      addressLine2: null,
      locality: "중구",
      administrativeArea: "서울특별시",
    },
    shippingQuote: null,
    deliveryMethod: null,
    sourceCreatedAt: "2026-07-30T00:00:00.000Z",
    sourceExpiresAt: "2026-07-30T00:15:00.000Z",
    createdAt: "2026-07-30T00:05:00.000Z",
    updatedAt: "2026-07-30T00:06:00.000Z",
    expiresAt: "2026-07-31T00:05:00.000Z",
  };
}

describe("shop order draft contract", () => {
  it("accepts one exact bounded private draft", () => {
    expect(npRequireShopOrderDraft(draft())).toEqual(draft());
  });

  it("rejects partial PII, unknown fields, and inconsistent commerce totals", () => {
    expect(
      npAnalyzeShopOrderDraft({
        ...draft(),
        extra: true,
        subtotalMinor: 1,
        customer: null,
      }),
    ).toEqual(
      expect.arrayContaining([
        "draft.extra is not supported.",
        "draft.subtotalMinor does not match its lines.",
        "draft.customer and draft.shipping must both be null or both be present.",
        "draft.reviewable state requires customer and shipping data.",
      ]),
    );
    expect(
      npAnalyzeShopOrderDraft({
        ...draft(),
        sourceCreatedAt: "2026-07-30T00:06:00.000Z",
        sourceExpiresAt: "2026-07-30T00:21:00.000Z",
      }),
    ).toContain("draft.createdAt must not precede source checkout creation.");
  });

  it("normalizes complete update values without reflecting them in validation errors", () => {
    expect(
      npRequireShopOrderDraftUpdateInput({
        draftId,
        expectedRevision: 1,
        customer: {
          fullName: "  홍길동  ",
          email: " Buyer@Example.COM ",
          phone: " 010-1234-5678 ",
        },
        shipping: {
          recipientName: " 홍길동 ",
          phone: " 010-1234-5678 ",
          countryCode: " kr ",
          postalCode: " 04524 ",
          addressLine1: " 서울특별시   중구 ",
          addressLine2: " ",
          locality: " 중구 ",
          administrativeArea: " 서울특별시 ",
        },
      }),
    ).toEqual({
      draftId,
      expectedRevision: 1,
      customer: {
        fullName: "홍길동",
        email: "buyer@example.com",
        phone: "010-1234-5678",
      },
      shipping: {
        recipientName: "홍길동",
        phone: "010-1234-5678",
        countryCode: "KR",
        postalCode: "04524",
        addressLine1: "서울특별시 중구",
        addressLine2: null,
        locality: "중구",
        administrativeArea: "서울특별시",
      },
    });

    const privateEmail = "private-person@example.com";
    try {
      npRequireShopOrderDraftUpdateInput({
        draftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: privateEmail,
          phone: "invalid",
        },
        shipping: draft().shipping,
      });
    } catch (error) {
      expect(error).toMatchObject({
        issues: ["order draft update request.customer.phone is invalid."],
      });
      expect(String(error)).not.toContain(privateEmail);
    }
  });

  it("requires exact create, read, and delete envelopes", () => {
    expect(
      npRequireShopOrderDraftCreateInput({
        idempotencyKey: draftId,
        checkoutIntentId: intentId,
      }),
    ).toEqual({ idempotencyKey: draftId, checkoutIntentId: intentId });
    expect(npRequireShopOrderDraftReadQuery({ id: draftId })).toBe(draftId);
    expect(npRequireShopOrderDraftDeleteInput({ draftId })).toEqual({ draftId });
    expect(() =>
      npRequireShopOrderDraftCreateInput({
        idempotencyKey: draftId,
        checkoutIntentId: intentId,
        email: "private-person@example.com",
      }),
    ).toThrow(/Invalid order draft create request/u);
  });
});
