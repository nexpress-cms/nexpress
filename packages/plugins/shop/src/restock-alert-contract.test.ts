import { describe, expect, it } from "vitest";

import {
  NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT,
  NpShopRestockAlertContractError,
  npAnalyzeShopRestockAlertStorage,
  npRequireShopRestockAlertInput,
  npRequireShopRestockAlertListWire,
  npRequireShopRestockAlertMutationWire,
  npRequireShopRestockAlertStorage,
  npShopRestockAlertLimits,
} from "./restock-alert-contract.js";

const memberId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";

function activeAlert() {
  const createdAt = "2026-08-08T00:00:00.000Z";
  return {
    contract: NP_SHOP_RESTOCK_ALERT_STORAGE_CONTRACT,
    eventId,
    memberId,
    productId,
    variantSku: "MUG-BLUE",
    status: "active",
    outcome: null,
    createdAt,
    checkedAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    notificationId: null,
    expiresAt: new Date(
      new Date(createdAt).getTime() + npShopRestockAlertLimits.activeTtlSeconds * 1_000,
    ).toISOString(),
  } as const;
}

describe("Shop restock alert contract", () => {
  it("accepts one exact active storage row and client-safe wires", () => {
    expect(npRequireShopRestockAlertStorage(activeAlert())).toEqual(activeAlert());
    expect(npRequireShopRestockAlertInput({ productId, variantSku: null })).toEqual({
      productId,
      variantSku: null,
    });
    expect(
      npRequireShopRestockAlertListWire({
        alerts: [
          {
            productId,
            variantSku: "MUG-BLUE",
            expiresAt: activeAlert().expiresAt,
          },
        ],
      }),
    ).toMatchObject({ alerts: [{ productId, variantSku: "MUG-BLUE" }] });
    expect(npRequireShopRestockAlertMutationWire({ alert: null })).toEqual({ alert: null });
    expect(() =>
      npRequireShopRestockAlertListWire({
        alerts: Array.from(
          { length: npShopRestockAlertLimits.maximumTargetsPerProduct + 1 },
          () => ({
            productId,
            variantSku: null,
            expiresAt: activeAlert().expiresAt,
          }),
        ),
      }),
    ).toThrow(NpShopRestockAlertContractError);
  });

  it("rejects unknown fields, noncanonical ids, SKUs, and active completion state", () => {
    expect(() =>
      npRequireShopRestockAlertInput({
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
        variantSku: null,
      }),
    ).toThrow(NpShopRestockAlertContractError);
    expect(() =>
      npRequireShopRestockAlertInput({ productId, variantSku: "lowercase", extra: true }),
    ).toThrow(NpShopRestockAlertContractError);
    expect(
      npAnalyzeShopRestockAlertStorage({
        ...activeAlert(),
        completedAt: "2026-08-08T00:01:00.000Z",
      }),
    ).toContain("active restock alerts cannot contain claim or completion state.");
  });

  it("requires fixed claim and completion retention windows", () => {
    const active = activeAlert();
    const claimedAt = "2026-08-08T00:02:00.000Z";
    const claimed = {
      ...active,
      status: "claimed",
      checkedAt: claimedAt,
      claimedAt,
      leaseExpiresAt: new Date(
        new Date(claimedAt).getTime() + npShopRestockAlertLimits.leaseSeconds * 1_000,
      ).toISOString(),
    } as const;
    expect(npRequireShopRestockAlertStorage(claimed).status).toBe("claimed");
    expect(npAnalyzeShopRestockAlertStorage({ ...claimed, checkedAt: active.createdAt })).toContain(
      "claimed restock alerts require checkedAt to equal claimedAt.",
    );

    const completedAt = "2026-08-08T00:03:00.000Z";
    expect(
      npRequireShopRestockAlertStorage({
        ...claimed,
        status: "completed",
        outcome: "notified",
        leaseExpiresAt: null,
        completedAt,
        notificationId: "44444444-4444-4444-8444-444444444444",
        expiresAt: new Date(
          new Date(completedAt).getTime() + npShopRestockAlertLimits.completedTtlSeconds * 1_000,
        ).toISOString(),
      }).status,
    ).toBe("completed");
    expect(npAnalyzeShopRestockAlertStorage({ ...claimed, leaseExpiresAt: claimedAt })).toContain(
      "restock alert claim leases must use the fixed lease lifetime.",
    );
  });
});
