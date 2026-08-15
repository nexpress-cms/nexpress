import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_LABEL_VOID_RESULT_CONTRACT,
  NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT,
  npAnalyzeShopCarrierLabelVoidRequest,
  npAnalyzeShopCarrierLabelVoidResult,
  npAnalyzeStoredShopCarrierLabelVoid,
  npRequireShopCarrierLabelVoidActionInput,
  npRequireShopCarrierLabelVoidResult,
} from "./label-void-contract.js";

const voidId = "123e4567-e89b-42d3-a456-426614174000";
const acquisitionId = "223e4567-e89b-42d3-a456-426614174000";
const shipmentId = "323e4567-e89b-42d3-a456-426614174000";
const orderId = "423e4567-e89b-42d3-a456-426614174000";
const exchangeId = "523e4567-e89b-42d3-a456-426614174000";
const requestedAt = "2026-08-15T00:00:00.000Z";

describe("Shop carrier label void contract", () => {
  it("accepts one exact PII-free request and provider result", () => {
    const request = {
      contract: NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT,
      voidId,
      acquisitionId,
      shipmentId,
      orderId,
      generation: 2,
      bookingReference: "booking_123",
      labelReference: "label_2",
      requestedAt,
    } as const;
    const result = {
      contract: NP_SHOP_CARRIER_LABEL_VOID_RESULT_CONTRACT,
      voidId,
      acquisitionId,
      shipmentId,
      orderId,
      generation: 2,
      labelReference: "label_2",
      voidedAt: "2026-08-15T00:01:00.000Z",
    } as const;

    expect(npAnalyzeShopCarrierLabelVoidRequest(request)).toEqual([]);
    expect(npAnalyzeShopCarrierLabelVoidResult(result)).toEqual([]);
    expect(
      npAnalyzeShopCarrierLabelVoidResult({ ...result, downloadUrl: "https://private" }),
    ).toContain("carrier label void result.downloadUrl is not supported.");
  });

  it("binds storage to one generation and confirmation lifecycle", () => {
    const stored = {
      contract: NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT,
      id: voidId,
      acquisitionId,
      shipmentId,
      orderId,
      target: "replacement",
      exchangeId,
      providerId: "test-carrier",
      status: "completed",
      revision: 3,
      sourceRevision: 4,
      generation: 2,
      bookingReference: "booking_123",
      labelReference: "label_2",
      providerErrorCode: null,
      requestedAt,
      voidedAt: "2026-08-15T00:01:00.000Z",
      updatedAt: "2026-08-15T00:01:00.000Z",
      purgeAt: "2027-08-15T00:00:00.000Z",
    } as const;

    expect(npAnalyzeStoredShopCarrierLabelVoid(stored)).toEqual([]);
    expect(npAnalyzeStoredShopCarrierLabelVoid({ ...stored, target: "outbound" })).toContain(
      "stored carrier label void.target and exchangeId are inconsistent.",
    );
    expect(npAnalyzeStoredShopCarrierLabelVoid({ ...stored, status: "pending" })).toContain(
      "stored carrier label void.provider confirmation fields do not match status.",
    );
  });

  it("returns a safe canonical result without invoking hostile getters", () => {
    const raw = {
      contract: NP_SHOP_CARRIER_LABEL_VOID_RESULT_CONTRACT,
      voidId,
      acquisitionId,
      shipmentId,
      orderId,
      generation: 1,
      labelReference: "label_1",
      voidedAt: requestedAt,
    };
    const proxy = new Proxy(raw, {
      get() {
        throw new Error("hostile-get");
      },
    });

    expect(npAnalyzeShopCarrierLabelVoidResult(proxy)).toEqual([]);
    const result = npRequireShopCarrierLabelVoidResult(proxy);
    expect(result.labelReference).toBe("label_1");
  });

  it("normalizes the generic Admin action envelope", () => {
    expect(
      npRequireShopCarrierLabelVoidActionInput({
        row: {
          id: orderId,
          shipmentId,
          target: "replacement",
          exchangeId,
          acquisitionId,
          generation: 2,
          expectedAcquisitionRevision: 3,
          expectedVoidRevision: 0,
        },
        values: {},
      }),
    ).toEqual({
      orderId,
      shipmentId,
      target: "replacement",
      exchangeId,
      acquisitionId,
      generation: 2,
      expectedAcquisitionRevision: 3,
      expectedVoidRevision: 0,
    });
  });
});
