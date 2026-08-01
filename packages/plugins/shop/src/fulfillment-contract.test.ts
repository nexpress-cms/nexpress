import { describe, expect, it } from "vitest";

import {
  NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
  npAnalyzeStoredShopFulfillment,
  npRequireShopFulfillmentPrivateReadInput,
  npRequireShopFulfillmentProcessInput,
  npRequireShopFulfillmentShipInput,
} from "./fulfillment-contract.js";

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const fulfillment = {
  contract: NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
  orderId,
  ownerSegment: `guest:${"a".repeat(64)}`,
  status: "awaiting",
  revision: 1,
  privateDataStatus: "retained",
  carrier: null,
  trackingNumber: null,
  operatorNote: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  privateExpiresAt: "2026-08-31T00:00:00.000Z",
  shippedAt: null,
  purgeAt: "2027-07-30T00:00:00.000Z",
} as const;

describe("Shop fulfillment contract", () => {
  it("accepts exact awaiting and shipped states", () => {
    expect(npAnalyzeStoredShopFulfillment(fulfillment)).toEqual([]);
    expect(
      npAnalyzeStoredShopFulfillment({
        ...fulfillment,
        status: "shipped",
        revision: 2,
        privateDataStatus: "redacted",
        carrier: "Parcel Co",
        trackingNumber: "TRACK-123",
        shippedAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects completion metadata before shipment and retained private data after shipment", () => {
    expect(npAnalyzeStoredShopFulfillment({ ...fulfillment, carrier: "Parcel Co" })).toContain(
      "unshipped fulfillment cannot contain shipping completion metadata.",
    );
    expect(
      npAnalyzeStoredShopFulfillment({
        ...fulfillment,
        status: "shipped",
        carrier: "Parcel Co",
        trackingNumber: "TRACK-123",
        shippedAt: "2026-08-02T00:00:00.000Z",
      }),
    ).toContain("shipped fulfillment requires tracking, shippedAt, and redacted private data.");
  });

  it("parses only exact revision-safe Admin row payloads", () => {
    const row = { id: orderId, fulfillmentRevision: 2 };
    expect(
      npRequireShopFulfillmentProcessInput({ row, values: { operatorNote: "Packed safely" } }),
    ).toEqual({ orderId, expectedRevision: 2, operatorNote: "Packed safely" });
    expect(
      npRequireShopFulfillmentShipInput({
        row,
        values: { carrier: "Parcel Co", trackingNumber: "TRACK-123", operatorNote: "" },
      }),
    ).toEqual({
      orderId,
      expectedRevision: 2,
      carrier: "Parcel Co",
      trackingNumber: "TRACK-123",
      operatorNote: null,
    });
    expect(npRequireShopFulfillmentPrivateReadInput({ row, values: {} })).toEqual({
      orderId,
      expectedRevision: 2,
    });
    expect(() =>
      npRequireShopFulfillmentPrivateReadInput({ row: { ...row, hidden: true }, values: {} }),
    ).toThrow(/Invalid row action/u);
  });
});
