import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
  npAnalyzeShopCarrierPickupCancelRequest,
  npAnalyzeShopCarrierPickupCancelResult,
  npAnalyzeShopCarrierPickupRequest,
  npAnalyzeShopCarrierPickupResult,
  npAnalyzeStoredShopCarrierPickup,
  npRequireShopCarrierPickupCancelInput,
  npRequireShopCarrierPickupResumeInput,
  npRequireShopCarrierPickupScheduleInput,
} from "./pickup-contract.js";

const pickupId = "123e4567-e89b-42d3-a456-426614174000";
const shipmentId = "223e4567-e89b-42d3-a456-426614174000";
const orderId = "323e4567-e89b-42d3-a456-426614174000";
const cancellationId = "423e4567-e89b-42d3-a456-426614174000";
const exchangeId = "523e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-03T00:00:00.000Z";
const readyAt = "2026-08-03T01:00:00.000Z";
const closeAt = "2026-08-03T04:00:00.000Z";
const scheduledAt = "2026-08-03T00:01:00.000Z";
const packages = [
  { id: "parcel-1", lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 1_500 },
];

const request = {
  contract: NP_SHOP_CARRIER_PICKUP_REQUEST_CONTRACT,
  pickupId,
  shipmentId,
  orderId,
  bookingReference: "booking_123",
  carrier: "Parcel Co",
  trackingNumber: "TRACK-123",
  locationReference: "warehouse-seoul-1",
  readyAt,
  closeAt,
  parcelRevision: 3,
  packages,
  requestedAt,
} as const;

const pending = {
  contract: NP_SHOP_CARRIER_PICKUP_STORAGE_CONTRACT,
  id: pickupId,
  orderId,
  shipmentId,
  target: "outbound",
  exchangeId: null,
  providerId: "test-carrier",
  status: "pending",
  revision: 1,
  locationReference: "warehouse-seoul-1",
  readyAt,
  closeAt,
  parcelRevision: 3,
  packages,
  pickupReference: null,
  providerErrorCode: null,
  cancellationId: null,
  requestedAt,
  scheduledAt: null,
  cancelRequestedAt: null,
  cancelledAt: null,
  updatedAt: requestedAt,
  purgeAt: "2027-08-03T00:00:00.000Z",
} as const;

describe("Shop carrier pickup contract", () => {
  it("accepts one exact PII-free parcel scheduling request", () => {
    expect(npAnalyzeShopCarrierPickupRequest(request)).toEqual([]);
    expect(
      npAnalyzeShopCarrierPickupRequest({
        ...request,
        packages: [{ ...packages[0], items: [{ lineKey: "secret", quantity: 1 }] }],
      }),
    ).toContain("carrier pickup request.packages[0].items is not supported.");
  });

  it("closes provider scheduling and cancellation results", () => {
    expect(
      npAnalyzeShopCarrierPickupResult({
        contract: NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
        pickupId,
        shipmentId,
        orderId,
        pickupReference: "pickup_123",
        readyAt,
        closeAt,
        scheduledAt,
      }),
    ).toEqual([]);
    const cancellationRequest = {
      contract: NP_SHOP_CARRIER_PICKUP_CANCEL_REQUEST_CONTRACT,
      cancellationId,
      pickupId,
      shipmentId,
      orderId,
      pickupReference: "pickup_123",
      requestedAt: "2026-08-03T00:02:00.000Z",
    } as const;
    expect(npAnalyzeShopCarrierPickupCancelRequest(cancellationRequest)).toEqual([]);
    expect(
      npAnalyzeShopCarrierPickupCancelResult({
        contract: NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
        cancellationId,
        pickupId,
        shipmentId,
        orderId,
        cancelledAt: "2026-08-03T00:03:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeShopCarrierPickupCancelRequest({ ...cancellationRequest, reason: "home" }),
    ).toContain("carrier pickup cancellation request.reason is not supported.");
  });

  it("enforces each durable confirmation state", () => {
    expect(npAnalyzeStoredShopCarrierPickup(pending)).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierPickup({ ...pending, target: "replacement", exchangeId: null }),
    ).toContain("carrier pickup exchange identity does not match its target.");
    const confirmed = {
      ...pending,
      status: "provider-confirmed",
      revision: 2,
      pickupReference: "pickup_123",
      scheduledAt,
      updatedAt: scheduledAt,
    } as const;
    expect(npAnalyzeStoredShopCarrierPickup(confirmed)).toEqual([]);
    const cancelling = {
      ...confirmed,
      status: "cancel-pending",
      revision: 4,
      cancellationId,
      cancelRequestedAt: "2026-08-03T00:02:00.000Z",
      updatedAt: "2026-08-03T00:02:00.000Z",
    } as const;
    expect(npAnalyzeStoredShopCarrierPickup(cancelling)).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierPickup({
        ...cancelling,
        status: "cancel-confirmed",
        revision: 5,
        cancelledAt: "2026-08-03T00:03:00.000Z",
        updatedAt: "2026-08-03T00:03:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierPickup({
        ...pending,
        status: "scheduled",
      }),
    ).toContain("carrier pickup provider confirmation fields do not match its status.");
    expect(
      npAnalyzeStoredShopCarrierPickup({
        ...confirmed,
        scheduledAt: "2026-08-02T23:59:00.000Z",
      }),
    ).toContain("carrier pickup.scheduledAt cannot precede requestedAt.");
  });

  it("accepts only bounded windows and unique package ids", () => {
    expect(
      npAnalyzeShopCarrierPickupRequest({
        ...request,
        closeAt: "2026-08-03T01:05:00.000Z",
        packages: [...packages, packages[0]],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must span between"),
        "carrier pickup request.packages ids must be unique.",
      ]),
    );
  });

  it("parses exact revision-safe Admin actions", () => {
    expect(
      npRequireShopCarrierPickupScheduleInput({
        row: {
          id: orderId,
          shipmentId,
          pickupTarget: "replacement",
          exchangeId,
          pickupRevision: 0,
        },
        values: { readyAt, closeAt },
      }),
    ).toEqual({
      orderId,
      shipmentId,
      target: "replacement",
      exchangeId,
      expectedRevision: 0,
      readyAt,
      closeAt,
    });
    const existing = {
      row: {
        id: orderId,
        shipmentId,
        pickupTarget: "outbound",
        exchangeId: null,
        pickupId,
        pickupRevision: 3,
      },
      values: {},
    };
    expect(npRequireShopCarrierPickupResumeInput(existing)).toEqual({
      orderId,
      shipmentId,
      target: "outbound",
      exchangeId: null,
      pickupId,
      expectedRevision: 3,
    });
    expect(npRequireShopCarrierPickupCancelInput(existing)).toEqual({
      orderId,
      shipmentId,
      target: "outbound",
      exchangeId: null,
      pickupId,
      expectedRevision: 3,
    });
    expect(() =>
      npRequireShopCarrierPickupCancelInput({ ...existing, values: { reason: "changed" } }),
    ).toThrow(/Invalid existing Shop pickup action/u);
    expect(() =>
      npRequireShopCarrierPickupScheduleInput({
        row: {
          id: orderId,
          shipmentId,
          pickupTarget: "outbound",
          exchangeId,
          pickupRevision: 0,
        },
        values: { readyAt, closeAt },
      }),
    ).toThrow(/Invalid Shop pickup scheduling action/u);
  });
});
