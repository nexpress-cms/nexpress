import { describe, expect, it } from "vitest";

import {
  NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT,
  npAnalyzeStoredShopExchangeParcels,
  npRequireShopExchangeParcelsSaveInput,
} from "./exchange-parcel-contract.js";

const orderId = "11111111-1111-4111-8111-111111111111";
const exchangeId = "22222222-2222-4222-8222-222222222222";
const shipmentId = "33333333-3333-4333-8333-333333333333";
const parcels = [
  {
    id: "replacement-1",
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    weightGrams: 1_500,
    items: [{ lineKey: "line:one", quantity: 1 }],
  },
];

describe("Shop exchange parcel contract", () => {
  it("accepts one exact PII-free replacement snapshot", () => {
    expect(
      npAnalyzeStoredShopExchangeParcels({
        contract: NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT,
        orderId,
        exchangeId,
        exchangeRevision: 2,
        revision: 1,
        parcels,
        lockedShipmentId: shipmentId,
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:01:00.000Z",
        purgeAt: "2027-08-10T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects storage shape drift and invalid chronology", () => {
    const issues = npAnalyzeStoredShopExchangeParcels({
      contract: NP_SHOP_EXCHANGE_PARCELS_STORAGE_CONTRACT,
      orderId,
      exchangeId,
      exchangeRevision: 2,
      revision: 1,
      parcels,
      lockedShipmentId: null,
      createdAt: "2026-08-10T00:02:00.000Z",
      updatedAt: "2026-08-10T00:01:00.000Z",
      purgeAt: "2027-08-10T00:00:00.000Z",
      destination: "private",
    });
    expect(issues).toContain("exchange parcel snapshot.destination is not supported.");
    expect(issues).toContain("exchange parcel snapshot.updatedAt cannot precede createdAt.");
  });

  it("parses the exact declarative Admin action", () => {
    expect(
      npRequireShopExchangeParcelsSaveInput({
        row: { id: orderId, exchangeId, exchangeRevision: 2, parcelRevision: null },
        values: { parcels: JSON.stringify(parcels) },
      }),
    ).toEqual({
      orderId,
      exchangeId,
      expectedExchangeRevision: 2,
      expectedParcelRevision: null,
      parcels,
    });
    expect(() =>
      npRequireShopExchangeParcelsSaveInput({
        row: { id: orderId, exchangeId, exchangeRevision: 2, parcelRevision: null },
        values: { parcels: "null" },
      }),
    ).toThrow("Invalid exchange parcel action");
  });
});
