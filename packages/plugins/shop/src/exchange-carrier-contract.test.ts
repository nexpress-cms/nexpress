import { describe, expect, it } from "vitest";

import {
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT,
  NpShopExchangeCarrierContractError,
  npAnalyzeShopExchangeCarrierBookingRequest,
  npAnalyzeStoredShopExchangeCarrierBooking,
  npRequireShopExchangeCarrierBookActionInput,
  npRequireShopExchangeCarrierBookingResult,
  npRequireShopExchangeCarrierCancelRequest,
  npRequireShopExchangeCarrierCancelResult,
} from "./exchange-carrier-contract.js";

const orderId = "123e4567-e89b-42d3-a456-426614174000";
const exchangeId = "223e4567-e89b-42d3-a456-426614174000";
const shipmentId = "323e4567-e89b-42d3-a456-426614174000";
const cancellationId = "423e4567-e89b-42d3-a456-426614174000";

const destination = {
  recipientName: "홍길동",
  phone: "010-1234-5678",
  countryCode: "KR",
  postalCode: "04524",
  addressLine1: "서울특별시 중구 세종대로 110",
  addressLine2: null,
  locality: "중구",
  administrativeArea: "서울특별시",
};

describe("Shop exchange carrier contract", () => {
  it("accepts one exact private booking request and rejects shape drift", () => {
    const request = {
      contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_REQUEST_CONTRACT,
      shipmentId,
      orderId,
      exchangeId,
      exchangeRevision: 2,
      destinationRevision: 1,
      items: [
        {
          key: "line:one",
          productId: "523e4567-e89b-42d3-a456-426614174000",
          productName: "교환 상품",
          variantSku: "BLACK-M",
          variantName: "블랙 / M",
          quantity: 1,
        },
      ],
      destination,
      requestedAt: "2026-08-10T00:00:00.000Z",
    };
    expect(npAnalyzeShopExchangeCarrierBookingRequest(request)).toEqual([]);
    expect(
      npAnalyzeShopExchangeCarrierBookingRequest({
        ...request,
        destination: { ...destination, instructions: "문 앞" },
      }),
    ).toContain("exchange carrier booking request.destination.instructions is not supported.");
  });

  it("requires exact provider booking and cancellation identities", () => {
    expect(
      npRequireShopExchangeCarrierBookingResult({
        contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_RESULT_CONTRACT,
        shipmentId,
        orderId,
        exchangeId,
        bookingReference: "exchange-booking-1",
        carrier: "CJ Logistics",
        trackingNumber: "1234567890",
        bookedAt: "2026-08-10T00:01:00.000Z",
      }),
    ).toMatchObject({ shipmentId, exchangeId });
    const request = npRequireShopExchangeCarrierCancelRequest({
      contract: NP_SHOP_EXCHANGE_CARRIER_CANCEL_REQUEST_CONTRACT,
      cancellationId,
      shipmentId,
      orderId,
      exchangeId,
      bookingReference: "exchange-booking-1",
      requestedAt: "2026-08-10T00:02:00.000Z",
    });
    expect(request.cancellationId).toBe(cancellationId);
    expect(
      npRequireShopExchangeCarrierCancelResult({
        contract: NP_SHOP_EXCHANGE_CARRIER_CANCEL_RESULT_CONTRACT,
        cancellationId,
        shipmentId,
        orderId,
        exchangeId,
        cancelledAt: "2026-08-10T00:03:00.000Z",
      }),
    ).toMatchObject({ cancellationId, shipmentId });
  });

  it("validates durable confirmation and paired cancellation lifecycle", () => {
    const completed = {
      contract: NP_SHOP_EXCHANGE_CARRIER_BOOKING_STORAGE_CONTRACT,
      id: shipmentId,
      orderId,
      exchangeId,
      providerId: "test-carrier",
      status: "completed",
      revision: 3,
      sourceOrderRevision: 7,
      sourceExchangeRevision: 2,
      destinationRevision: 1,
      completedOrderRevision: 8,
      completedExchangeRevision: 3,
      operatorNote: null,
      bookingReference: "exchange-booking-1",
      carrier: "CJ Logistics",
      trackingNumber: "1234567890",
      providerErrorCode: null,
      cancellationId: null,
      requestedAt: "2026-08-10T00:00:00.000Z",
      confirmedAt: "2026-08-10T00:01:00.000Z",
      cancelRequestedAt: null,
      cancelledAt: null,
      updatedAt: "2026-08-10T00:01:01.000Z",
      purgeAt: "2027-08-10T00:00:00.000Z",
    };
    expect(npAnalyzeStoredShopExchangeCarrierBooking(completed)).toEqual([]);
    expect(
      npAnalyzeStoredShopExchangeCarrierBooking({
        ...completed,
        status: "cancel-pending",
        cancellationId,
        cancelRequestedAt: "2026-08-10T00:02:00.000Z",
        updatedAt: "2026-08-10T00:02:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopExchangeCarrierBooking({
        ...completed,
        status: "cancelled",
      }),
    ).toContain("exchange carrier booking lifecycle metadata is inconsistent.");
  });

  it("parses the exact declarative Admin booking payload", () => {
    expect(
      npRequireShopExchangeCarrierBookActionInput({
        row: {
          id: orderId,
          exchangeId,
          orderRevision: 7,
          exchangeRevision: 2,
          destinationRevision: 1,
        },
        values: { operatorNote: "확인 완료" },
      }),
    ).toMatchObject({ orderId, exchangeId, operatorNote: "확인 완료" });
    try {
      npRequireShopExchangeCarrierBookActionInput({
        row: {
          id: orderId,
          exchangeId,
          orderRevision: 7,
          exchangeRevision: 2,
          destinationRevision: 1,
          destination,
        },
        values: { operatorNote: "" },
      });
      throw new Error("expected exact action validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NpShopExchangeCarrierContractError);
      expect((error as NpShopExchangeCarrierContractError).issues).toContain(
        "payload.row.destination is not supported.",
      );
    }
  });
});
