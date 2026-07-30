import { describe, expect, it } from "vitest";

import {
  NP_SHOP_INVENTORY_RESERVATION_CONTRACT,
  npAnalyzeShopInventoryReservation,
  npRequireShopInventoryReservation,
  npShopInventoryReservationStorageKey,
  npShopInventoryStockKey,
} from "./inventory-reservation-contract.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const orderId = "223e4567-e89b-42d3-a456-426614174000";
const createdAt = "2026-07-30T00:00:00.000Z";
const expiresAt = "2026-07-31T00:00:00.000Z";

const reservation = {
  contract: NP_SHOP_INVENTORY_RESERVATION_CONTRACT,
  orderId,
  ownerSegment: `guest:${"a".repeat(64)}`,
  productId,
  variantSku: "CUP-BLUE",
  quantity: 2,
  createdAt,
  expiresAt,
} as const;

describe("Shop inventory reservation contract", () => {
  it("accepts one exact PII-free product option hold", () => {
    expect(npAnalyzeShopInventoryReservation(reservation)).toEqual([]);
    expect(npRequireShopInventoryReservation(reservation)).toEqual(reservation);
    expect(npShopInventoryStockKey(productId, null)).toBe(`${productId}:_`);
    expect(npShopInventoryReservationStorageKey(productId, "CUP-BLUE", orderId)).toBe(
      `inventory-reservation:${productId}:CUP-BLUE:${orderId}`,
    );
  });

  it("rejects extra values, malformed ownership, and a non-fixed lifetime", () => {
    expect(
      npAnalyzeShopInventoryReservation({
        ...reservation,
        ownerSegment: "guest:raw-cookie",
        expiresAt: createdAt,
        email: "must-not-be-stored@example.com",
      }),
    ).toEqual(
      expect.arrayContaining([
        "reservation.email is not supported.",
        "reservation.ownerSegment is invalid.",
        "reservation.expiresAt must equal the fixed pending lifetime.",
      ]),
    );
  });
});
