import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
  NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
  npAnalyzeShopCarrierBookingRequest,
  npAnalyzeShopCarrierParcelBookingRequest,
  npAnalyzeStoredShopCarrierBooking,
  npRequireShopCarrierBookingActionInput,
  npRequireShopCarrierBookingResult,
} from "./carrier-contract.js";

const shipmentId = "123e4567-e89b-42d3-a456-426614174000";
const orderId = "223e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-02T00:00:00.000Z";

const request = {
  contract: NP_SHOP_CARRIER_BOOKING_REQUEST_CONTRACT,
  shipmentId,
  orderId,
  fulfillmentRevision: 2,
  items: [
    {
      key: "323e4567-e89b-42d3-a456-426614174000:_",
      productId: "323e4567-e89b-42d3-a456-426614174000",
      productName: "Everyday cup",
      variantSku: null,
      variantName: null,
      quantity: 1,
    },
  ],
  destination: {
    recipientName: "홍길동",
    phone: "010-1234-5678",
    countryCode: "KR",
    postalCode: "04524",
    addressLine1: "서울특별시 중구 세종대로 110",
    addressLine2: null,
    locality: "중구",
    administrativeArea: "서울특별시",
  },
  deliveryMethod: null,
  requestedAt,
};

const pending = {
  contract: NP_SHOP_CARRIER_BOOKING_STORAGE_CONTRACT,
  id: shipmentId,
  orderId,
  providerId: "test-carrier",
  status: "pending",
  fulfillmentRevision: 2,
  operatorNote: "Packed safely",
  bookingReference: null,
  carrier: null,
  trackingNumber: null,
  providerErrorCode: null,
  requestedAt,
  updatedAt: requestedAt,
  bookedAt: null,
  purgeAt: "2027-08-02T00:00:00.000Z",
} as const;

describe("Shop carrier booking contract", () => {
  it("accepts one exact private booking request", () => {
    expect(npAnalyzeShopCarrierBookingRequest(request)).toEqual([]);
    expect(
      npAnalyzeShopCarrierBookingRequest({
        ...request,
        destination: { ...request.destination, privateNote: "must fail" },
      }),
    ).toContain("carrier booking request.destination.privateNote is not supported.");
  });

  it("adds one exact parcel-aware v2 request without changing v1", () => {
    expect(
      npAnalyzeShopCarrierParcelBookingRequest({
        ...request,
        contract: NP_SHOP_CARRIER_PARCEL_BOOKING_REQUEST_CONTRACT,
        parcelRevision: 3,
        parcels: [
          {
            id: "parcel-1",
            lengthMm: 300,
            widthMm: 200,
            heightMm: 100,
            weightGrams: 1_500,
            items: [{ lineKey: request.items[0].key, quantity: 1 }],
          },
        ],
      }),
    ).toEqual([]);
    expect(npAnalyzeShopCarrierBookingRequest(request)).toEqual([]);
  });

  it("accepts one exact PII-free provider result", () => {
    expect(
      npRequireShopCarrierBookingResult({
        contract: NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
        shipmentId,
        orderId,
        bookingReference: "booking_123",
        carrier: "Parcel Co",
        trackingNumber: "TRACK-123",
        bookedAt: "2026-08-02T00:01:00.000Z",
      }),
    ).toMatchObject({ bookingReference: "booking_123", trackingNumber: "TRACK-123" });
  });

  it("closes pending, provider-confirmed, completed, and manual-review states", () => {
    expect(npAnalyzeStoredShopCarrierBooking(pending)).toEqual([]);
    const confirmation = {
      bookingReference: "booking_123",
      carrier: "Parcel Co",
      trackingNumber: "TRACK-123",
      bookedAt: "2026-08-02T00:01:00.000Z",
      updatedAt: "2026-08-02T00:01:00.000Z",
    };
    expect(
      npAnalyzeStoredShopCarrierBooking({
        ...pending,
        ...confirmation,
        status: "provider-confirmed",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierBooking({
        ...pending,
        ...confirmation,
        status: "completed",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierBooking({
        ...pending,
        status: "manual-review",
        providerErrorCode: "provider-result-mismatch",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopCarrierBooking({
        ...pending,
        status: "completed",
      }),
    ).toContain("completed carrier bookings require exact provider confirmation and no error.");
  });

  it("rejects provider error text outside the closed code grammar", () => {
    expect(
      npAnalyzeStoredShopCarrierBooking({
        ...pending,
        providerErrorCode: "Customer address could not be delivered",
      }),
    ).toContain("carrier booking.providerErrorCode is invalid.");
  });

  it("parses only one exact revision-safe Admin action", () => {
    expect(
      npRequireShopCarrierBookingActionInput({
        row: { id: orderId, fulfillmentRevision: 2 },
        values: { operatorNote: "Packed safely" },
      }),
    ).toEqual({ orderId, expectedRevision: 2, operatorNote: "Packed safely" });
    expect(() =>
      npRequireShopCarrierBookingActionInput({
        row: { id: orderId, fulfillmentRevision: 2, hidden: true },
        values: { operatorNote: "" },
      }),
    ).toThrow(/Invalid Shop carrier booking action/u);
  });
});
