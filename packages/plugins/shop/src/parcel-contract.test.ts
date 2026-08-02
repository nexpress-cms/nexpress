import { describe, expect, it } from "vitest";

import {
  NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT,
  npAnalyzeShopFulfillmentParcels,
  npAnalyzeStoredShopFulfillmentParcels,
  npRequireShopFulfillmentParcelsSaveInput,
  npShopFulfillmentParcelTotals,
} from "./parcel-contract.js";

const orderId = "11111111-1111-4111-8111-111111111111";
const shipmentId = "22222222-2222-4222-8222-222222222222";

const parcels = [
  {
    id: "parcel-1",
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    weightGrams: 1_500,
    items: [
      { lineKey: "product-a", quantity: 2 },
      { lineKey: "product-b", quantity: 1 },
    ],
  },
];

describe("Shop fulfillment parcel contract", () => {
  it("accepts one exact PII-free stored snapshot", () => {
    expect(
      npAnalyzeStoredShopFulfillmentParcels({
        contract: NP_SHOP_FULFILLMENT_PARCELS_STORAGE_CONTRACT,
        orderId,
        fulfillmentRevision: 2,
        revision: 1,
        parcels,
        lockedShipmentId: shipmentId,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:01:00.000Z",
        purgeAt: "2027-08-02T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects unknown fields, duplicate ids, duplicate parcel allocations, and invalid bounds", () => {
    const issues = npAnalyzeShopFulfillmentParcels([
      {
        ...parcels[0],
        extra: true,
        weightGrams: 0,
        items: [
          { lineKey: "product-a", quantity: 1 },
          { lineKey: "product-a", quantity: 1 },
        ],
      },
      parcels[0],
    ]);
    expect(issues).toContain("fulfillment parcels[0].extra is not supported.");
    expect(issues).toContain("fulfillment parcels[0].weightGrams is invalid.");
    expect(issues).toContain("fulfillment parcels[0].items cannot repeat one order line.");
    expect(issues).toContain("fulfillment parcels ids must be unique.");
    expect(
      npAnalyzeShopFulfillmentParcels([
        {
          ...parcels[0],
          items: Array.from({ length: 101 }, (_, index) => ({
            lineKey: `product-${index.toString()}`,
            quantity: 1,
          })),
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        "fulfillment parcels[0].items accepts at most 100 allocations.",
        "fulfillment parcels accepts at most 100 item allocations.",
      ]),
    );
  });

  it("parses the exact generic Admin row action without trusting raw JSON", () => {
    expect(
      npRequireShopFulfillmentParcelsSaveInput({
        row: { id: orderId, fulfillmentRevision: 2, parcelRevision: null },
        values: { parcels: JSON.stringify(parcels) },
      }),
    ).toEqual({
      orderId,
      expectedFulfillmentRevision: 2,
      expectedParcelRevision: null,
      parcels,
    });
    expect(() =>
      npRequireShopFulfillmentParcelsSaveInput({
        row: { id: orderId, fulfillmentRevision: 2, parcelRevision: null },
        values: { parcels: "not-json" },
      }),
    ).toThrow("Invalid fulfillment parcel action");
    expect(() =>
      npRequireShopFulfillmentParcelsSaveInput({
        row: { id: orderId, fulfillmentRevision: 2, parcelRevision: null },
        values: { parcels: "null" },
      }),
    ).toThrow("Invalid fulfillment parcel action");
  });

  it("derives bounded PII-free operational totals", () => {
    expect(npShopFulfillmentParcelTotals(parcels)).toEqual({
      parcelCount: 1,
      allocationCount: 2,
      unitCount: 3,
      weightGrams: 1_500,
    });
  });
});
