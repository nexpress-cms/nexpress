import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT,
  NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT,
  npAnalyzeShopCarrierLabelAcquisitionRequest,
  npAnalyzeShopCarrierLabelAcquisitionResult,
  npAnalyzeStoredShopCarrierLabelAcquisition,
  npRequireShopCarrierLabelAcquisitionActionInput,
} from "./label-acquisition-contract.js";

const acquisitionId = "123e4567-e89b-42d3-a456-426614174000";
const shipmentId = "223e4567-e89b-42d3-a456-426614174000";
const orderId = "323e4567-e89b-42d3-a456-426614174000";
const exchangeId = "423e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-10T00:00:00.000Z";

describe("Shop carrier label acquisition contract", () => {
  it("accepts exact initial purchase and atomic regeneration requests", () => {
    const purchase = {
      contract: NP_SHOP_CARRIER_LABEL_ACQUISITION_REQUEST_CONTRACT,
      acquisitionId,
      shipmentId,
      orderId,
      generation: 1,
      operation: "purchase",
      bookingReference: "booking_123",
      carrier: "Parcel Co",
      trackingNumber: "TRACK-123",
      replacesLabelReference: null,
      requestedAt,
    } as const;
    expect(npAnalyzeShopCarrierLabelAcquisitionRequest(purchase)).toEqual([]);
    expect(
      npAnalyzeShopCarrierLabelAcquisitionRequest({
        ...purchase,
        generation: 2,
        operation: "regenerate",
        replacesLabelReference: "label_1",
      }),
    ).toEqual([]);
    expect(
      npAnalyzeShopCarrierLabelAcquisitionRequest({
        ...purchase,
        operation: "regenerate",
      }),
    ).toContain(
      "carrier label acquisition request.regenerate requires a replaced label reference.",
    );
    expect(npAnalyzeShopCarrierLabelAcquisitionRequest({ ...purchase, generation: 2 })).toContain(
      "carrier label acquisition request.purchase must use generation 1.",
    );
  });

  it("accepts only exact PII-free provider confirmations", () => {
    const result = {
      contract: NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT,
      acquisitionId,
      shipmentId,
      orderId,
      generation: 1,
      operation: "purchase",
      labelReference: "label_1",
      acquiredAt: requestedAt,
    } as const;
    expect(npAnalyzeShopCarrierLabelAcquisitionResult(result)).toEqual([]);
    expect(
      npAnalyzeShopCarrierLabelAcquisitionResult({ ...result, downloadUrl: "https://private" }),
    ).toContain("carrier label acquisition result.downloadUrl is not supported.");
  });

  it("binds storage to one target, generation, and confirmation lifecycle", () => {
    const stored = {
      contract: NP_SHOP_CARRIER_LABEL_ACQUISITION_STORAGE_CONTRACT,
      id: acquisitionId,
      shipmentId,
      orderId,
      target: "replacement",
      exchangeId,
      providerId: "test-carrier",
      status: "completed",
      revision: 3,
      sourceRevision: 4,
      generation: 1,
      operation: "purchase",
      bookingReference: "booking_123",
      carrier: "Parcel Co",
      trackingNumber: "TRACK-123",
      replacesLabelReference: null,
      labelReference: "label_1",
      providerErrorCode: null,
      requestedAt,
      confirmedAt: "2026-08-10T00:01:00.000Z",
      updatedAt: "2026-08-10T00:01:00.000Z",
      purgeAt: "2027-08-10T00:00:00.000Z",
    } as const;
    expect(npAnalyzeStoredShopCarrierLabelAcquisition(stored)).toEqual([]);
    expect(npAnalyzeStoredShopCarrierLabelAcquisition({ ...stored, target: "outbound" })).toContain(
      "stored carrier label acquisition.target and exchangeId are inconsistent.",
    );
    expect(
      npAnalyzeStoredShopCarrierLabelAcquisition({
        ...stored,
        status: "pending",
      }),
    ).toContain(
      "stored carrier label acquisition.provider confirmation fields do not match status.",
    );
    expect(
      npAnalyzeStoredShopCarrierLabelAcquisition({
        ...stored,
        status: "manual-review",
      }),
    ).toContain("stored carrier label acquisition.manual-review requires providerErrorCode.");
  });

  it("normalizes the generic Admin action envelope", () => {
    expect(
      npRequireShopCarrierLabelAcquisitionActionInput({
        row: {
          id: orderId,
          shipmentId,
          target: "replacement",
          exchangeId,
          expectedRevision: 3,
        },
        values: {},
      }),
    ).toEqual({ orderId, shipmentId, target: "replacement", exchangeId, expectedRevision: 3 });
  });
});
