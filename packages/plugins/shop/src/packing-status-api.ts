import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import type { NpShopPackingWorkCallbackAdapter } from "./packing-contract.js";
import {
  NpShopPackingStatusConflictError,
  NpShopPackingStatusContractError,
  NpShopPackingStatusVerificationError,
  npIsIgnoredPackingStatusWebhook,
  npRequireFreshShopPackingStatusEvent,
  type NpShopPackingStatusWebhookResult,
} from "./packing-status-contract.js";
import { npApplyShopPackingStatusEvent } from "./packing-status-service.js";

const noStoreHeaders = { "Cache-Control": "private, no-store" } as const;

export function createShopPackingStatusApiHandler(adapter: NpShopPackingWorkCallbackAdapter) {
  return async function shopPackingStatusApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      if (request.bodyMode !== "raw" || request.rawBody === undefined) {
        throw new NpShopPackingStatusContractError("Invalid packing status callback body", [
          "packing status callbacks require the exact raw request bytes.",
        ]);
      }
      const receivedAt = new Date();
      let verified: NpShopPackingStatusWebhookResult;
      try {
        verified = await adapter.verifyPackingStatusWebhook({
          rawBody: request.rawBody,
          headers: request.headers,
          receivedAt: receivedAt.toISOString(),
        });
      } catch {
        throw new NpShopPackingStatusVerificationError();
      }
      if (verified === null) throw new NpShopPackingStatusVerificationError();
      if (npIsIgnoredPackingStatusWebhook(verified)) {
        return {
          status: 200,
          body: { ignored: true, reason: "unsupported-event" },
          headers: noStoreHeaders,
        };
      }
      const event = npRequireFreshShopPackingStatusEvent(verified, receivedAt);
      const result = await npApplyShopPackingStatusEvent(adapter.id, event, receivedAt);
      return {
        status: 200,
        body: {
          receipt: {
            providerId: result.receipt.providerId,
            eventId: result.receipt.event.eventId,
            outcome: result.receipt.outcome,
            packingStatus: result.receipt.packingStatus,
            processedAt: result.receipt.processedAt,
          },
          duplicate: result.duplicate,
        },
        headers: noStoreHeaders,
      };
    } catch (error) {
      if (error instanceof NpShopPackingStatusVerificationError) {
        return {
          status: 401,
          body: { error: "packing_status_verification_failed", message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPackingStatusConflictError) {
        return {
          status: 409,
          body: { error: error.code, message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPackingStatusContractError) {
        return {
          status: 400,
          body: { error: "invalid_packing_status_event", message: error.issues.join(" ") },
          headers: noStoreHeaders,
        };
      }
      throw error;
    }
  };
}
