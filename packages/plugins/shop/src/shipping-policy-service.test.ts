import { findDocuments } from "@nexpress/core/collections";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NpShopRuntime } from "./runtime.js";
import {
  npInspectShopShippingPolicies,
  npQuoteShopShippingPolicies,
} from "./shipping-policy-service.js";

vi.mock("@nexpress/core/collections", () => ({ findDocuments: vi.fn() }));

const policyId = "123e4567-e89b-42d3-a456-426614174000";
const runtime = {
  collections: {
    categories: "shop-categories",
    products: "shop-products",
    promotions: "shop-promotions",
    shippingPolicies: "shop-shipping-policies",
  },
  shippingAdapter: null,
} as unknown as NpShopRuntime;

const request = {
  contract: "np.shop-shipping-quote-request.v1" as const,
  draftId: "223e4567-e89b-42d3-a456-426614174000",
  draftRevision: 1,
  currency: "KRW" as const,
  subtotalMinor: 25_000,
  totalUnits: 1,
  lines: [
    {
      key: "323e4567-e89b-42d3-a456-426614174000:_",
      productId: "323e4567-e89b-42d3-a456-426614174000",
      productSlug: "cup",
      productName: "Cup",
      variantSku: null,
      variantName: null,
      quantity: 1,
      unitPriceMinor: 25_000,
      lineTotalMinor: 25_000,
    },
  ],
  destination: {
    recipientName: "홍길동",
    phone: "010-1234-5678",
    countryCode: "KR",
    postalCode: "63000",
    addressLine1: "제주특별자치도 제주시",
    addressLine2: null,
    locality: "제주시",
    administrativeArea: "제주특별자치도",
  },
  requestedAt: "2026-08-05T00:00:00.000Z",
  maximumExpiresAt: "2026-08-05T01:00:00.000Z",
};

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: policyId,
    status: "published",
    name: "Korea standard delivery",
    methodCode: "standard",
    kind: "base",
    label: "Standard delivery",
    currency: "KRW",
    amountMinor: 3_000,
    freeThresholdMinor: null,
    thresholdBasis: "discounted-subtotal",
    minimumDays: 1,
    maximumDays: 3,
    destinationScope: "country",
    countryCode: "KR",
    postalPrefixes: [],
    administrativeAreas: [],
    cartScope: "all",
    products: [],
    categories: [],
    startsAt: null,
    endsAt: null,
    priority: 0,
    ...overrides,
  };
}

function result(docs: unknown[]) {
  return { docs, totalDocs: docs.length } as never;
}

describe("Shop shipping policy service", () => {
  beforeEach(() => {
    vi.mocked(findDocuments).mockReset();
  });

  it("preserves zero shipping only when no local policy is published", async () => {
    vi.mocked(findDocuments).mockResolvedValue(result([]));
    await expect(npQuoteShopShippingPolicies(runtime, request, 0)).resolves.toBeNull();

    vi.mocked(findDocuments).mockResolvedValue(
      result([policy({ destinationScope: "country", countryCode: "US" })]),
    );
    await expect(npQuoteShopShippingPolicies(runtime, request, 0)).rejects.toThrow(
      /No configured shipping method/u,
    );
  });

  it("caps a PII-free local quote at the earliest applied policy end", async () => {
    vi.mocked(findDocuments).mockResolvedValue(
      result([policy({ endsAt: "2026-08-05T00:15:00.000Z" })]),
    );
    await expect(npQuoteShopShippingPolicies(runtime, request, 0)).resolves.toMatchObject({
      contract: "np.shop-shipping-quote-result.v1",
      quoteId: expect.stringMatching(/^policy:[0-9a-f]{64}$/u),
      expiresAt: "2026-08-05T00:15:00.000Z",
      methods: [{ id: "standard", amountMinor: 3_000 }],
    });
  });

  it("diagnoses surcharge-only methods independently per currency", async () => {
    vi.mocked(findDocuments).mockResolvedValue(
      result([
        policy(),
        policy({
          id: "423e4567-e89b-42d3-a456-426614174000",
          currency: "USD",
          kind: "surcharge",
          amountMinor: 500,
          minimumDays: null,
          maximumDays: null,
        }),
      ]),
    );
    await expect(npInspectShopShippingPolicies(runtime)).resolves.toMatchObject({
      published: 2,
      baseRules: 1,
      surchargeRules: 1,
      methodCodes: 2,
      surchargeOnlyMethodCodes: ["USD:standard"],
    });
  });
});
