import { describe, expect, it } from "vitest";

import {
  NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_CANCEL_RESULT_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_RESULT_CONTRACT,
  NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT,
  npAnalyzeShopReturnLogistics,
  npAnalyzeShopReturnLogisticsRequest,
  npAnalyzeShopReturnLogisticsResult,
  npAnalyzeStoredShopReturnLogistics,
  npAnalyzeStoredShopReturnLogisticsPrivate,
  npRequireShopReturnLogisticsCancelRequest,
  npRequireShopReturnLogisticsCancelResult,
  npRequireShopReturnLogisticsCreateInput,
} from "./return-logistics-contract.js";
import { NP_SHOP_RETURN_TRACKING_CONTRACT } from "./return-tracking-contract.js";
import { NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT } from "./return-postage-contract.js";

const logisticsId = "123e4567-e89b-42d3-a456-426614174000";
const returnId = "223e4567-e89b-42d3-a456-426614174000";
const orderId = "323e4567-e89b-42d3-a456-426614174000";
const shipmentId = "423e4567-e89b-42d3-a456-426614174000";
const cancellationId = "523e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-03T00:00:00.000Z";
const confirmedAt = "2026-08-03T00:01:00.000Z";
const readyAt = "2026-08-03T01:00:00.000Z";
const closeAt = "2026-08-03T04:00:00.000Z";

const origin = {
  recipientName: "Return Sender",
  phone: "+82-10-0000-0000",
  countryCode: "KR",
  postalCode: "04524",
  addressLine1: "1 Sejong-daero",
  addressLine2: null,
  locality: "Seoul",
  administrativeArea: null,
} as const;

const request = {
  contract: NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
  logisticsId,
  returnId,
  orderId,
  originalShipmentId: shipmentId,
  originalBookingReference: "booking_123",
  mode: "pickup",
  returnLocationReference: "returns-seoul-1",
  items: [
    {
      lineKey: "product:1",
      productId: "623e4567-e89b-42d3-a456-426614174000",
      productName: "T-shirt",
      variantSku: "TSHIRT-BLK-M",
      variantName: "Black / M",
      quantity: 1,
    },
  ],
  origin,
  readyAt,
  closeAt,
  requestedAt,
} as const;

const pending = {
  contract: NP_SHOP_RETURN_LOGISTICS_STORAGE_CONTRACT,
  id: logisticsId,
  returnId,
  orderId,
  ownerSegment: `guest:${"0".repeat(64)}`,
  providerId: "test-carrier",
  status: "pending",
  revision: 1,
  mode: "pickup",
  originalShipmentId: shipmentId,
  originalBookingReference: "booking_123",
  returnReference: null,
  carrier: null,
  trackingNumber: null,
  readyAt,
  closeAt,
  providerErrorCode: null,
  cancellationId: null,
  requestedAt,
  confirmedAt: null,
  cancelRequestedAt: null,
  cancelledAt: null,
  updatedAt: requestedAt,
  purgeAt: "2027-08-03T00:00:00.000Z",
} as const;

describe("Shop return logistics contract", () => {
  it("accepts one exact private provider request and rejects extra address fields", () => {
    expect(npAnalyzeShopReturnLogisticsRequest(request)).toEqual([]);
    expect(
      npAnalyzeShopReturnLogisticsRequest({
        ...request,
        origin: { ...origin, email: "private@example.com" },
      }),
    ).toContain("return logistics request.origin.email is not supported.");
  });

  it("keeps dropoff windows empty and bounds pickup windows", () => {
    expect(
      npAnalyzeShopReturnLogisticsRequest({
        ...request,
        mode: "dropoff",
        readyAt: null,
        closeAt: null,
      }),
    ).toEqual([]);
    expect(npAnalyzeShopReturnLogisticsRequest({ ...request, mode: "dropoff" })).toContain(
      "return logistics request dropoff mode cannot contain a pickup window.",
    );
    expect(
      npAnalyzeShopReturnLogisticsRequest({
        ...request,
        closeAt: "2026-08-03T01:05:00.000Z",
      }),
    ).toContain("return logistics request pickup window duration is invalid.");
  });

  it("closes provider confirmation and cancellation results", () => {
    expect(
      npAnalyzeShopReturnLogisticsResult({
        contract: NP_SHOP_RETURN_LOGISTICS_RESULT_CONTRACT,
        logisticsId,
        returnId,
        orderId,
        returnReference: "return_123",
        carrier: "Parcel Co",
        trackingNumber: "RETURN-123",
        readyAt,
        closeAt,
        confirmedAt,
      }),
    ).toEqual([]);
    const cancelRequest = {
      contract: NP_SHOP_RETURN_LOGISTICS_CANCEL_REQUEST_CONTRACT,
      cancellationId,
      logisticsId,
      returnId,
      orderId,
      returnReference: "return_123",
      requestedAt: "2026-08-03T00:02:00.000Z",
    };
    expect(npRequireShopReturnLogisticsCancelRequest(cancelRequest)).toEqual(cancelRequest);
    expect(
      npRequireShopReturnLogisticsCancelResult({
        contract: NP_SHOP_RETURN_LOGISTICS_CANCEL_RESULT_CONTRACT,
        cancellationId,
        logisticsId,
        returnId,
        orderId,
        cancelledAt: "2026-08-03T00:03:00.000Z",
      }),
    ).toMatchObject({ cancellationId, logisticsId });
  });

  it("enforces durable provider and cancellation confirmation fields", () => {
    expect(npAnalyzeStoredShopReturnLogistics(pending)).toEqual([]);
    const active = {
      ...pending,
      status: "active",
      revision: 3,
      returnReference: "return_123",
      carrier: "Parcel Co",
      trackingNumber: "RETURN-123",
      confirmedAt,
      updatedAt: confirmedAt,
    } as const;
    expect(npAnalyzeStoredShopReturnLogistics(active)).toEqual([]);
    const quoted = {
      ...active,
      postageMethod: {
        contract: NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT,
        providerId: "test-carrier",
        quoteId: "723e4567-e89b-42d3-a456-426614174000",
        methodId: "pickup-standard",
        label: "Standard return",
        currency: "KRW",
        amountMinor: 4_000,
        estimatedTransit: { minimumDays: 1, maximumDays: 3 },
        quotedAt: requestedAt,
        quoteExpiresAt: "2026-08-03T01:00:00.000Z",
      },
    } as const;
    expect(npAnalyzeStoredShopReturnLogistics(quoted)).toEqual([]);
    expect(
      npAnalyzeStoredShopReturnLogistics({
        ...quoted,
        postageMethod: { ...quoted.postageMethod, providerId: "other-carrier" },
      }),
    ).toContain("stored return logistics.postageMethod provider must match logistics.");
    expect(
      npAnalyzeStoredShopReturnLogistics({
        ...quoted,
        postageMethod: {
          ...quoted.postageMethod,
          quoteExpiresAt: requestedAt,
        },
      }),
    ).toContain("stored return logistics.postageMethod must be live at creation.");
    expect(npAnalyzeStoredShopReturnLogistics({ ...pending, status: "active" })).toContain(
      "stored return logistics provider confirmation fields do not match status.",
    );
    expect(
      npAnalyzeStoredShopReturnLogistics({
        ...pending,
        status: "cancelled",
        revision: 2,
        cancellationId,
        cancelRequestedAt: confirmedAt,
        cancelledAt: confirmedAt,
        updatedAt: confirmedAt,
      }),
    ).toContain("stored return logistics provider confirmation fields do not match status.");
    expect(
      npAnalyzeStoredShopReturnLogistics({
        ...active,
        status: "cancelled",
      }),
    ).toEqual(
      expect.arrayContaining([
        "stored return logistics cancellation fields do not match status.",
        "stored return logistics cancelledAt does not match status.",
      ]),
    );
    expect(
      npAnalyzeStoredShopReturnLogistics({
        ...active,
        status: "manual-review",
        revision: 4,
        providerErrorCode: "provider-rejected",
        cancellationId,
        cancelRequestedAt: confirmedAt,
      }),
    ).toEqual([]);
    const projected = {
      contract: NP_SHOP_RETURN_LOGISTICS_CONTRACT,
      id: logisticsId,
      status: "active",
      revision: 5,
      mode: "pickup",
      carrier: "Parcel Co",
      trackingNumber: "RETURN-123",
      readyAt,
      closeAt,
      requestedAt,
      confirmedAt,
      cancelledAt: null,
      updatedAt: "2026-08-03T00:03:00.000Z",
      tracking: {
        contract: NP_SHOP_RETURN_TRACKING_CONTRACT,
        logisticsId,
        status: "in-transit",
        occurredAt: "2026-08-03T00:02:00.000Z",
        deliveredAt: null,
        updatedAt: "2026-08-03T00:02:00.000Z",
      },
    } as const;
    expect(npAnalyzeShopReturnLogistics(projected)).toEqual([]);
    expect(
      npAnalyzeShopReturnLogistics({
        ...projected,
        postageMethod: quoted.postageMethod,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeShopReturnLogistics({
        ...projected,
        tracking: { ...projected.tracking, logisticsId: orderId },
      }),
    ).toContain("return logistics.tracking must match the logistics id.");
    expect(npAnalyzeShopReturnLogistics({ ...projected, status: "cancelled" })).toContain(
      "return logistics.tracking requires active logistics.",
    );
    expect(
      npAnalyzeShopReturnLogistics({
        contract: NP_SHOP_RETURN_LOGISTICS_CONTRACT,
        id: logisticsId,
        status: "cancel-confirmed",
        revision: 5,
        mode: "pickup",
        carrier: "Parcel Co",
        trackingNumber: "RETURN-123",
        readyAt,
        closeAt,
        requestedAt,
        confirmedAt,
        cancelledAt: "2026-08-03T00:03:00.000Z",
        updatedAt: "2026-08-03T00:03:00.000Z",
      }),
    ).toEqual([]);
  });

  it("keeps origin PII in one exact sidecar for no more than 24 hours", () => {
    expect(
      npAnalyzeStoredShopReturnLogisticsPrivate({
        contract: NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT,
        logisticsId,
        returnId,
        orderId,
        ownerSegment: `guest:${"0".repeat(64)}`,
        origin,
        createdAt: requestedAt,
        expiresAt: "2026-08-04T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopReturnLogisticsPrivate({
        contract: NP_SHOP_RETURN_LOGISTICS_PRIVATE_CONTRACT,
        logisticsId,
        returnId,
        orderId,
        ownerSegment: `guest:${"0".repeat(64)}`,
        origin,
        createdAt: requestedAt,
        expiresAt: "2026-08-04T00:00:01.000Z",
      }),
    ).toContain("private return logistics lifetime is invalid.");
  });

  it("parses one exact revision-safe owner create input", () => {
    expect(
      npRequireShopReturnLogisticsCreateInput({
        orderId,
        returnId,
        expectedReturnRevision: 2,
        mode: "dropoff",
        origin,
        readyAt: null,
        closeAt: null,
      }),
    ).toMatchObject({ orderId, returnId, expectedReturnRevision: 2, mode: "dropoff" });
  });
});
