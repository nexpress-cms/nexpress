import { describe, expect, it, vi } from "vitest";

import {
  NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
  npAnalyzeStoredShopCarrierBooking,
} from "./carrier-contract.js";
import {
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
  npAnalyzeStoredShopExchangeCarrierBooking,
} from "./exchange-carrier-contract.js";
import {
  NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
  npAnalyzeStoredShopExchange,
} from "./exchange-contract.js";
import {
  NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
  npAnalyzeStoredShopFulfillment,
} from "./fulfillment-contract.js";
import { npStageShopOrderNotification } from "./order-notification-service.js";
import {
  NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
  npAnalyzeStoredShopCarrierPickup,
} from "./pickup-contract.js";

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const exchangeId = "223e4567-e89b-42d3-a456-426614174000";
const shipmentId = "323e4567-e89b-42d3-a456-426614174000";
const pickupId = "423e4567-e89b-42d3-a456-426614174000";
const cancellationId = "523e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-12T00:00:00.000Z";
const purgeAt = "2027-08-12T00:00:00.000Z";
const reconciledAt = "2027-08-13T00:00:00.000Z";

const carrierBooking = {
  contract: NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
  id: shipmentId,
  orderId,
  providerId: "test-carrier",
  status: "provider-confirmed",
  fulfillmentRevision: 2,
  operatorNote: null,
  bookingReference: "booking-1",
  carrier: "Parcel Co",
  trackingNumber: "TRACK-1",
  providerErrorCode: null,
  requestedAt,
  updatedAt: reconciledAt,
  bookedAt: reconciledAt,
  purgeAt,
} as const;

const exchangeCarrierBooking = {
  contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
  id: shipmentId,
  orderId,
  exchangeId,
  providerId: "test-carrier",
  status: "cancelled",
  revision: 5,
  sourceOrderRevision: 7,
  sourceExchangeRevision: 2,
  destinationRevision: 1,
  completedOrderRevision: 8,
  completedExchangeRevision: 3,
  operatorNote: null,
  bookingReference: "exchange-booking-1",
  carrier: "Parcel Co",
  trackingNumber: "TRACK-2",
  providerErrorCode: null,
  cancellationId,
  requestedAt,
  confirmedAt: "2026-08-12T00:01:00.000Z",
  cancelRequestedAt: "2027-08-12T01:00:00.000Z",
  cancelledAt: reconciledAt,
  updatedAt: reconciledAt,
  purgeAt,
} as const;

const pickup = {
  contract: NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
  id: pickupId,
  orderId,
  shipmentId,
  target: "outbound",
  exchangeId: null,
  providerId: "test-carrier",
  status: "cancelled",
  revision: 5,
  locationReference: "warehouse-seoul-1",
  readyAt: "2026-08-12T01:00:00.000Z",
  closeAt: "2026-08-12T04:00:00.000Z",
  parcelRevision: 3,
  packages: [{ id: "parcel-1", lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 1_500 }],
  pickupReference: "pickup-1",
  providerErrorCode: null,
  cancellationId,
  requestedAt,
  scheduledAt: "2026-08-12T00:01:00.000Z",
  cancelRequestedAt: "2027-08-12T01:00:00.000Z",
  cancelledAt: reconciledAt,
  updatedAt: reconciledAt,
  purgeAt,
} as const;

const exchange = {
  contract: NP_SHOP_EXCHANGE_STORAGE_CONTRACT,
  id: exchangeId,
  orderId,
  returnId: "623e4567-e89b-42d3-a456-426614174000",
  ownerSegment: `guest:${"a".repeat(64)}`,
  status: "shipped",
  revision: 3,
  orderRevision: 8,
  returnRevision: 4,
  destinationRevision: 1,
  destinationSubmittedAt: "2026-08-12T00:01:00.000Z",
  destinationRedactedAt: "2026-08-12T00:05:00.000Z",
  lines: [
    {
      lineKey: "product:variant",
      productId: "723e4567-e89b-42d3-a456-426614174000",
      productSlug: "canvas-bag",
      productName: "Canvas bag",
      variantSku: "BAG-BLACK",
      variantName: "Black",
      quantity: 1,
    },
  ],
  inventoryOutcome: "consumed",
  carrier: "Parcel Co",
  trackingNumber: "TRACK-2",
  operatorNote: null,
  createdAt: requestedAt,
  updatedAt: reconciledAt,
  shippedAt: reconciledAt,
  cancelledAt: null,
  purgeAt,
} as const;

const fulfillment = {
  contract: NP_SHOP_FULFILLMENT_STORAGE_CONTRACT,
  orderId,
  ownerSegment: `guest:${"a".repeat(64)}`,
  status: "shipped",
  revision: 3,
  privateDataStatus: "redacted",
  carrier: "Parcel Co",
  trackingNumber: "TRACK-1",
  operatorNote: null,
  createdAt: requestedAt,
  updatedAt: reconciledAt,
  privateExpiresAt: "2026-09-11T00:00:00.000Z",
  shippedAt: reconciledAt,
  purgeAt,
} as const;

describe("Shop retained post-purge reconciliation contracts", () => {
  it("allows pre-purge carrier effects to confirm or cancel after purge", () => {
    expect(npAnalyzeStoredShopCarrierBooking(carrierBooking)).toEqual([]);
    expect(npAnalyzeStoredShopExchangeCarrierBooking(exchangeCarrierBooking)).toEqual([]);
    expect(npAnalyzeStoredShopCarrierPickup(pickup)).toEqual([]);
  });

  it("allows pre-purge commercial sources to terminalize after purge", () => {
    expect(npAnalyzeStoredShopExchange(exchange)).toEqual([]);
    expect(npAnalyzeStoredShopFulfillment(fulfillment)).toEqual([]);
  });

  it("rejects carrier effects first requested at the purge boundary", () => {
    expect(
      npAnalyzeStoredShopCarrierBooking({
        ...carrierBooking,
        status: "pending",
        bookingReference: null,
        carrier: null,
        trackingNumber: null,
        requestedAt: purgeAt,
        updatedAt: purgeAt,
        bookedAt: null,
      }),
    ).toContain("carrier booking.purgeAt must follow requestedAt.");
    expect(
      npAnalyzeStoredShopExchangeCarrierBooking({
        ...exchangeCarrierBooking,
        status: "pending",
        revision: 1,
        completedOrderRevision: null,
        completedExchangeRevision: null,
        bookingReference: null,
        carrier: null,
        trackingNumber: null,
        cancellationId: null,
        requestedAt: purgeAt,
        confirmedAt: null,
        cancelRequestedAt: null,
        cancelledAt: null,
        updatedAt: purgeAt,
      }),
    ).toContain("exchange carrier booking.purgeAt must follow requestedAt.");
    expect(
      npAnalyzeStoredShopCarrierPickup({
        ...pickup,
        status: "pending",
        revision: 1,
        pickupReference: null,
        cancellationId: null,
        requestedAt: purgeAt,
        scheduledAt: null,
        cancelRequestedAt: null,
        cancelledAt: null,
        updatedAt: purgeAt,
      }),
    ).toContain("carrier pickup.purgeAt must follow requestedAt.");
  });

  it.each([purgeAt, reconciledAt])(
    "does not stage a new order notification at or after purge (%s)",
    async (occurredAt) => {
      const insert = vi.fn(() => {
        throw new Error("post-purge notification staging must not write");
      });
      const tx = { insert } as unknown as Parameters<typeof npStageShopOrderNotification>[0];

      await npStageShopOrderNotification(tx, "site-1", {
        orderId,
        ownerSegment: `member:${exchangeId}`,
        kind: "exchange.shipped",
        orderRevision: 8,
        occurredAt,
        purgeAt,
        email: "buyer@example.com",
      });

      expect(insert).not.toHaveBeenCalled();
    },
  );
});
