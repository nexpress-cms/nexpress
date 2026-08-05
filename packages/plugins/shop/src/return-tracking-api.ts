import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import type { NpShopCarrierReturnTrackingAdapter } from "./carrier-contract.js";
import {
  NpShopReturnTrackingConflictError,
  NpShopReturnTrackingContractError,
  NpShopReturnTrackingVerificationError,
  npIsIgnoredReturnTrackingWebhook,
  npRequireFreshShopReturnTrackingEvent,
} from "./return-tracking-contract.js";
import { npApplyShopReturnTrackingEvent } from "./return-tracking-service.js";

const noStoreHeaders = { "Cache-Control": "private, no-store" } as const;

export function createShopReturnTrackingApiHandler(adapter: NpShopCarrierReturnTrackingAdapter) {
  return async function shopReturnTrackingApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      if (request.bodyMode !== "raw" || request.rawBody === undefined) {
        throw new NpShopReturnTrackingContractError("Invalid return-tracking callback body", [
          "return-tracking callbacks require the exact raw request bytes.",
        ]);
      }
      const receivedAt = new Date();
      const verified = await adapter.verifyReturnTrackingWebhook({
        rawBody: request.rawBody,
        headers: request.headers,
        receivedAt: receivedAt.toISOString(),
      });
      if (verified === null) throw new NpShopReturnTrackingVerificationError();
      if (npIsIgnoredReturnTrackingWebhook(verified)) {
        return {
          status: 200,
          body: { ignored: true, reason: verified.reason },
          headers: noStoreHeaders,
        };
      }
      const event = npRequireFreshShopReturnTrackingEvent(verified, receivedAt);
      const result = await npApplyShopReturnTrackingEvent(adapter.id, event, receivedAt);
      return {
        status: 200,
        body: {
          receipt: {
            providerId: result.receipt.providerId,
            eventId: result.receipt.event.eventId,
            outcome: result.receipt.outcome,
            trackingStatus: result.receipt.trackingStatus,
            processedAt: result.receipt.processedAt,
          },
          duplicate: result.duplicate,
        },
        headers: noStoreHeaders,
      };
    } catch (error) {
      if (error instanceof NpShopReturnTrackingVerificationError) {
        return {
          status: 401,
          body: { error: "return_tracking_verification_failed", message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopReturnTrackingConflictError) {
        return {
          status: 409,
          body: { error: error.code, message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopReturnTrackingContractError) {
        return {
          status: 400,
          body: { error: "invalid_return_tracking_event", message: error.issues.join(" ") },
          headers: noStoreHeaders,
        };
      }
      throw error;
    }
  };
}
