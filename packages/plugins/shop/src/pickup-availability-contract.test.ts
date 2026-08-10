import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
  npAnalyzeShopCarrierPickupAvailabilityHealth,
  npAnalyzeShopCarrierPickupAvailabilityRequest,
  npAnalyzeShopCarrierPickupAvailabilityResult,
  npAnalyzeStoredShopCarrierPickupAvailability,
  npRequireShopCarrierPickupAvailabilityQueryInput,
  npRequireShopCarrierPickupAvailabilitySelectionInput,
} from "./pickup-availability-contract.js";

const availabilityId = "123e4567-e89b-42d3-a456-426614174000";
const shipmentId = "223e4567-e89b-42d3-a456-426614174000";
const orderId = "323e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-11T00:00:00.000Z";
const expiresAt = "2026-08-11T00:30:00.000Z";
const purgeAt = "2027-08-11T00:00:00.000Z";

const packages = [
  { id: "parcel-1", lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 1_500 },
];
const windows = [
  {
    id: "morning-1",
    readyAt: "2026-08-11T01:00:00.000Z",
    closeAt: "2026-08-11T03:00:00.000Z",
  },
  {
    id: "afternoon-1",
    readyAt: "2026-08-11T04:00:00.000Z",
    closeAt: "2026-08-11T07:00:00.000Z",
  },
];

describe("Shop carrier pickup availability contracts", () => {
  it("accepts exact request, result, storage, and health contracts", () => {
    expect(
      npAnalyzeShopCarrierPickupAvailabilityRequest({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_REQUEST_CONTRACT,
        availabilityId,
        shipmentId,
        orderId,
        bookingReference: "booking-1",
        carrier: "Parcel Co",
        trackingNumber: "TRACK-1",
        locationReference: "warehouse-seoul-1",
        parcelRevision: 1,
        packages,
        requestedAt,
        maximumExpiresAt: "2026-08-11T01:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeShopCarrierPickupAvailabilityResult({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT,
        availabilityId,
        windows,
        expiresAt,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierPickupAvailability({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
        id: availabilityId,
        orderId,
        shipmentId,
        target: "outbound",
        exchangeId: null,
        providerId: "test-carrier",
        bookingFingerprint: "a".repeat(64),
        revision: 1,
        locationReference: "warehouse-seoul-1",
        parcelRevision: 1,
        packages,
        windows,
        requestedAt,
        expiresAt,
        purgeAt,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeShopCarrierPickupAvailabilityHealth({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_HEALTH_CONTRACT,
        providerId: "test-carrier",
        status: "ok",
        errorCode: null,
        attemptedAt: requestedAt,
        succeededAt: requestedAt,
      }),
    ).toEqual([]);
  });

  it("rejects ambiguous, overlapping, expired-at-start, and extra result state", () => {
    expect(
      npAnalyzeShopCarrierPickupAvailabilityResult({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT,
        availabilityId,
        windows: [
          { ...windows[0], label: "Free-form provider text must not persist" },
          { ...windows[1], id: "morning-1", readyAt: "2026-08-11T02:00:00.000Z" },
        ],
        expiresAt,
        secret: "must fail closed",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("secret is not supported"),
        expect.stringContaining("label is not supported"),
        expect.stringContaining("ids must be unique"),
        expect.stringContaining("ordered and non-overlapping"),
      ]),
    );
    expect(
      npAnalyzeStoredShopCarrierPickupAvailability({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
        id: availabilityId,
        orderId,
        shipmentId,
        target: "replacement",
        exchangeId: null,
        providerId: "test-carrier",
        bookingFingerprint: "a".repeat(64),
        revision: 1,
        locationReference: "warehouse-seoul-1",
        parcelRevision: 1,
        packages,
        windows: [{ ...windows[0], readyAt: "2026-08-11T00:15:00.000Z" }],
        requestedAt,
        expiresAt,
        purgeAt,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exchange identity"),
        expect.stringContaining("must begin after expiry"),
      ]),
    );
    expect(
      npAnalyzeStoredShopCarrierPickupAvailability({
        contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_STORAGE_CONTRACT,
        id: availabilityId,
        orderId,
        shipmentId,
        target: "outbound",
        exchangeId: null,
        providerId: "test-carrier",
        bookingFingerprint: "a".repeat(64),
        revision: 1,
        locationReference: "warehouse-seoul-1",
        parcelRevision: 1,
        packages,
        windows: [
          {
            id: "late-window",
            readyAt: "2026-08-24T23:00:00.000Z",
            closeAt: "2026-08-25T01:00:00.000Z",
          },
        ],
        requestedAt,
        expiresAt,
        purgeAt,
      }),
    ).toContain("stored carrier pickup availability windows exceed the 14-day horizon.");
  });

  it("requires exact revision-bound Admin query and selection envelopes", () => {
    expect(
      npRequireShopCarrierPickupAvailabilityQueryInput({
        row: {
          id: orderId,
          shipmentId,
          pickupTarget: "outbound",
          exchangeId: null,
          pickupRevision: 0,
        },
        values: {},
      }),
    ).toEqual({
      orderId,
      shipmentId,
      target: "outbound",
      exchangeId: null,
      expectedPickupRevision: 0,
    });
    expect(
      npRequireShopCarrierPickupAvailabilitySelectionInput({
        row: {
          id: orderId,
          shipmentId,
          pickupTarget: "outbound",
          exchangeId: null,
          pickupRevision: 0,
          availabilityId,
          availabilityRevision: 1,
          windowId: "morning-1",
        },
        values: {},
      }),
    ).toMatchObject({ availabilityId, expectedAvailabilityRevision: 1, windowId: "morning-1" });
    try {
      npRequireShopCarrierPickupAvailabilitySelectionInput({
        row: {
          id: orderId,
          shipmentId,
          pickupTarget: "outbound",
          exchangeId: null,
          pickupRevision: 0,
          availabilityId,
          availabilityRevision: 1,
          windowId: "morning-1",
          readyAt: windows[0]?.readyAt,
        },
        values: {},
      });
      throw new Error("Expected strict selection validation to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        issues: [expect.stringContaining("readyAt is not supported")],
      });
    }
  });
});
