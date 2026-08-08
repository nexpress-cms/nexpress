import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT,
  NpShopPriceAlertContractError,
  npAnalyzeShopPriceAlertStorage,
  npRequireShopPriceAlertInput,
  npRequireShopPriceAlertListWire,
  npRequireShopPriceAlertStorage,
  npShopPriceAlertLimits,
} from "./price-alert-contract.js";

const memberId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

function activeAlert() {
  const createdAt = "2026-08-08T00:00:00.000Z";
  return {
    contract: NP_SHOP_PRICE_ALERT_STORAGE_CONTRACT,
    eventId: "33333333-3333-4333-8333-333333333333",
    memberId,
    productId,
    variantSku: "MUG-BLUE",
    currency: "KRW",
    baselinePriceMinor: 20_000,
    status: "active",
    outcome: null,
    createdAt,
    checkedAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    notificationId: null,
    expiresAt: new Date(
      new Date(createdAt).getTime() + npShopPriceAlertLimits.activeTtlSeconds * 1_000,
    ).toISOString(),
  } as const;
}

describe("Shop price alert contract", () => {
  it("accepts exact positive-price storage and owner-safe wires", () => {
    expect(npRequireShopPriceAlertStorage(activeAlert())).toEqual(activeAlert());
    expect(npRequireShopPriceAlertInput({ productId, variantSku: null })).toEqual({
      productId,
      variantSku: null,
    });
    expect(
      npRequireShopPriceAlertListWire({
        alerts: [
          {
            productId,
            variantSku: null,
            currency: "KRW",
            baselinePriceMinor: 20_000,
            expiresAt: activeAlert().expiresAt,
          },
        ],
      }),
    ).toMatchObject({ alerts: [{ productId, baselinePriceMinor: 20_000 }] });
  });

  it("rejects zero baselines, unknown fields, and contradictory completion state", () => {
    expect(npAnalyzeShopPriceAlertStorage({ ...activeAlert(), baselinePriceMinor: 0 })).toContain(
      "price alert.baselinePriceMinor must be a positive bounded integer.",
    );
    expect(() =>
      npRequireShopPriceAlertInput({ productId, variantSku: "lowercase", extra: true }),
    ).toThrow(NpShopPriceAlertContractError);
    expect(
      npAnalyzeShopPriceAlertStorage({
        ...activeAlert(),
        notificationId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toContain("active price alerts cannot contain claim or completion state.");
  });

  it("requires fixed claim and completion retention windows", () => {
    const claimedAt = "2026-08-08T00:02:00.000Z";
    const claimed = {
      ...activeAlert(),
      status: "claimed",
      checkedAt: claimedAt,
      claimedAt,
      leaseExpiresAt: new Date(
        new Date(claimedAt).getTime() + npShopPriceAlertLimits.leaseSeconds * 1_000,
      ).toISOString(),
    } as const;
    expect(npRequireShopPriceAlertStorage(claimed).status).toBe("claimed");
    const completedAt = "2026-08-08T00:03:00.000Z";
    expect(
      npRequireShopPriceAlertStorage({
        ...claimed,
        status: "completed",
        outcome: "notified",
        leaseExpiresAt: null,
        completedAt,
        notificationId: "44444444-4444-4444-8444-444444444444",
        expiresAt: new Date(
          new Date(completedAt).getTime() + npShopPriceAlertLimits.completedTtlSeconds * 1_000,
        ).toISOString(),
      }).status,
    ).toBe("completed");
    expect(
      npAnalyzeShopPriceAlertStorage({
        ...claimed,
        status: "completed",
        outcome: "suppressed",
        checkedAt: activeAlert().createdAt,
        leaseExpiresAt: null,
        completedAt: activeAlert().createdAt,
        expiresAt: new Date(
          new Date(activeAlert().createdAt).getTime() +
            npShopPriceAlertLimits.completedTtlSeconds * 1_000,
        ).toISOString(),
      }),
    ).toEqual(
      expect.arrayContaining([
        "completed price alerts require checkedAt to equal claimedAt.",
        "price alert.completedAt cannot precede claimedAt.",
      ]),
    );
  });
});
