import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import type { NpShopCarrierTrackingAdapter } from "./carrier-contract.js";
import {
  NpShopTrackingConflictError,
  NpShopTrackingContractError,
  NpShopTrackingVerificationError,
  npIsIgnoredTrackingWebhook,
  npRequireFreshShopTrackingEvent,
} from "./tracking-contract.js";
import { npApplyShopTrackingEvent } from "./tracking-service.js";

const noStoreHeaders = { "Cache-Control": "private, no-store" } as const;

export function createShopTrackingApiHandler(adapter: NpShopCarrierTrackingAdapter) {
  return async function shopTrackingApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      if (request.bodyMode !== "raw" || request.rawBody === undefined) {
        throw new NpShopTrackingContractError("Invalid Shop tracking callback body", [
          "tracking callbacks require the exact raw request bytes.",
        ]);
      }
      const receivedAt = new Date();
      const verified = await adapter.verifyTrackingWebhook({
        rawBody: request.rawBody,
        headers: request.headers,
        receivedAt: receivedAt.toISOString(),
      });
      if (verified === null) throw new NpShopTrackingVerificationError();
      if (npIsIgnoredTrackingWebhook(verified)) {
        return {
          status: 200,
          body: { ignored: true, reason: verified.reason },
          headers: noStoreHeaders,
        };
      }
      const event = npRequireFreshShopTrackingEvent(verified, receivedAt);
      const result = await npApplyShopTrackingEvent(adapter.id, event, receivedAt);
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
      if (error instanceof NpShopTrackingVerificationError) {
        return {
          status: 401,
          body: { error: "tracking_verification_failed", message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopTrackingConflictError) {
        return {
          status: 409,
          body: { error: error.code, message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopTrackingContractError) {
        return {
          status: 400,
          body: { error: "invalid_tracking_event", message: error.issues.join(" ") },
          headers: noStoreHeaders,
        };
      }
      throw error;
    }
  };
}
