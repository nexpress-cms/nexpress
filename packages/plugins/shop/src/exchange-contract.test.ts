import { describe, expect, it } from "vitest";

import {
  NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
  npAnalyzeShopExchange,
  npAnalyzeStoredShopExchange,
  npProjectShopExchange,
  npRequireShopExchangeCreateInput,
  npRequireShopExchangeShipInput,
  npShopExchangeLinesFromOrder,
  type NpShopStoredExchange,
} from "./exchange-contract.js";

const storedExchange: NpShopStoredExchange = {
  contract: NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
  id: "323e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  returnId: "423e4567-e89b-42d3-a456-426614174000",
  ownerSegment: `guest:${"a".repeat(64)}`,
  status: "processing",
  revision: 2,
  orderRevision: 6,
  returnRevision: 4,
  destinationRevision: 1,
  destinationSubmittedAt: "2026-08-09T00:01:00.000Z",
  destinationRedactedAt: "2026-08-09T00:05:00.000Z",
  lines: [
    {
      lineKey: "product:variant",
      productId: "523e4567-e89b-42d3-a456-426614174000",
      productSlug: "canvas-bag",
      productName: "Canvas bag",
      variantSku: "BAG-BLACK",
      variantName: "Black",
      quantity: 1,
    },
  ],
  inventoryOutcome: "consumed",
  carrier: null,
  trackingNumber: null,
  operatorNote: "Inspected",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:05:00.000Z",
  shippedAt: null,
  cancelledAt: null,
  purgeAt: "2027-08-09T00:00:00.000Z",
};

describe("Shop same-item exchange contract", () => {
  it("accepts exact durable state and strips staff-only metadata", () => {
    expect(npAnalyzeStoredShopExchange(storedExchange)).toEqual([]);
    const projected = npProjectShopExchange(storedExchange);
    expect(projected).not.toHaveProperty("ownerSegment");
    expect(projected).not.toHaveProperty("operatorNote");
    expect(projected).not.toHaveProperty("orderRevision");
    expect(projected).toMatchObject({ destinationStatus: "redacted", destinationRevision: 1 });
    expect(npAnalyzeShopExchange(projected)).toEqual([]);
  });

  it("projects awaiting, retained, accessed, and expired destination state without PII", () => {
    const awaiting = {
      ...storedExchange,
      status: "awaiting" as const,
      revision: 1,
      destinationRevision: 0,
      destinationSubmittedAt: null,
      destinationRedactedAt: null,
      updatedAt: storedExchange.createdAt,
    };
    expect(
      npProjectShopExchange(awaiting, null, new Date("2026-08-09T00:02:00.000Z")),
    ).toMatchObject({ destinationStatus: "awaiting", destinationExpiresAt: null });
    const submitted = {
      ...awaiting,
      revision: 2,
      destinationRevision: 1,
      destinationSubmittedAt: "2026-08-09T00:03:00.000Z",
      updatedAt: "2026-08-09T00:03:00.000Z",
    };
    expect(
      npProjectShopExchange(
        submitted,
        { expiresAt: "2026-08-10T00:03:00.000Z", accessedAt: null },
        new Date("2026-08-09T00:04:00.000Z"),
      ),
    ).toMatchObject({ destinationStatus: "submitted" });
    expect(
      npProjectShopExchange(
        submitted,
        {
          expiresAt: "2026-08-10T00:03:00.000Z",
          accessedAt: "2026-08-09T00:04:00.000Z",
        },
        new Date("2026-08-09T00:05:00.000Z"),
      ),
    ).toMatchObject({ destinationStatus: "accessed" });
    expect(
      npProjectShopExchange(submitted, null, new Date("2026-08-10T00:04:00.000Z")),
    ).toMatchObject({ destinationStatus: "expired", destinationExpiresAt: null });
  });

  it("rejects inconsistent terminal state and duplicate lines", () => {
    expect(
      npAnalyzeStoredShopExchange({
        ...storedExchange,
        status: "shipped",
        lines: [storedExchange.lines[0], storedExchange.lines[0]],
        carrier: null,
        trackingNumber: null,
        shippedAt: null,
      }),
    ).toEqual(
      expect.arrayContaining([
        "exchange.lines[1].lineKey is invalid or duplicated.",
        "shipped exchanges require tracking and consumed replacement inventory.",
      ]),
    );
    expect(
      npAnalyzeStoredShopExchange({
        ...storedExchange,
        destinationRevision: 0,
        destinationSubmittedAt: null,
      }),
    ).toContain("processing and shipped exchanges require one submitted destination revision.");
  });

  it("validates exact generic Admin action payloads", () => {
    expect(
      npRequireShopExchangeCreateInput({
        row: {
          id: storedExchange.orderId,
          orderRevision: 5,
          returnId: storedExchange.returnId,
          returnRevision: 4,
        },
        values: { operatorNote: "" },
      }),
    ).toMatchObject({ orderId: storedExchange.orderId, operatorNote: null });
    expect(
      npRequireShopExchangeShipInput({
        row: {
          id: storedExchange.orderId,
          exchangeId: storedExchange.id,
          exchangeRevision: 2,
          orderRevision: 6,
        },
        values: { carrier: "CJ Logistics", trackingNumber: "123456789", operatorNote: "" },
      }),
    ).toMatchObject({ carrier: "CJ Logistics", trackingNumber: "123456789" });
    expect(() =>
      npRequireShopExchangeShipInput({
        row: {
          id: storedExchange.orderId,
          exchangeId: storedExchange.id,
          exchangeRevision: 2,
          orderRevision: 6,
        },
        values: { carrier: "", trackingNumber: "123", operatorNote: "", extra: true },
      }),
    ).toThrow(/Invalid Shop exchange/u);
  });

  it("derives immutable replacement lines from the order snapshot", () => {
    expect(
      npShopExchangeLinesFromOrder(
        [
          {
            key: "product:variant",
            productId: storedExchange.lines[0].productId,
            productSlug: "canvas-bag",
            productName: "Canvas bag",
            variantSku: "BAG-BLACK",
            variantName: "Black",
            quantity: 2,
            unitPriceMinor: 1000,
            lineTotalMinor: 2000,
          },
        ],
        [{ lineKey: "product:variant", quantity: 1 }],
      ),
    ).toEqual(storedExchange.lines);
  });
});
