import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopPaymentConflictError,
  NpShopPaymentContractError,
  NpShopPaymentVerificationError,
  npIsIgnoredPaymentWebhook,
  npRequireFreshShopPaymentEvent,
} from "./payment-contract.js";
import {
  NpShopPaymentAdjustmentConflictError,
  NpShopPaymentAdjustmentContractError,
  NpShopPaymentAdjustmentVerificationError,
  npIsShopPaymentAdjustmentEvent,
  npRequireFreshShopPaymentAdjustmentEvent,
} from "./payment-adjustment-contract.js";
import {
  NpShopPaymentDisputeConflictError,
  NpShopPaymentDisputeContractError,
  NpShopPaymentDisputeVerificationError,
  npIsShopPaymentDisputeEvent,
  npRequireFreshShopPaymentDisputeEvent,
} from "./payment-dispute-contract.js";
import {
  npApplyShopPaymentAdjustmentEvent,
  npApplyShopPaymentDisputeEvent,
  npApplyShopPaymentEvent,
} from "./order-service.js";
import type { NpShopRuntime } from "./runtime.js";

const noStoreHeaders = { "Cache-Control": "private, no-store" } as const;

export function createShopPaymentApiHandler(runtime: NpShopRuntime) {
  const adapter = runtime.paymentAdapter;
  if (!adapter) throw new Error("Shop payment API requires a configured payment adapter.");

  return async function shopPaymentApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      if (request.bodyMode !== "raw" || request.rawBody === undefined) {
        throw new NpShopPaymentContractError("Invalid Shop payment callback body", [
          "payment callbacks require the exact raw request bytes.",
        ]);
      }
      const receivedAt = new Date();
      const verified = await adapter.verifyWebhook({
        rawBody: request.rawBody,
        headers: request.headers,
        receivedAt: receivedAt.toISOString(),
      });
      if (verified === null) throw new NpShopPaymentVerificationError();
      if (npIsIgnoredPaymentWebhook(verified)) {
        return {
          status: 200,
          body: { ignored: true, reason: verified.reason },
          headers: noStoreHeaders,
        };
      }
      if (npIsShopPaymentAdjustmentEvent(verified)) {
        const event = npRequireFreshShopPaymentAdjustmentEvent(verified, receivedAt);
        const result = await npApplyShopPaymentAdjustmentEvent(
          runtime,
          adapter.id,
          event,
          receivedAt,
        );
        return {
          status: 200,
          body: {
            adjustment: {
              providerId: result.receipt.providerId,
              eventId: result.receipt.event.eventId,
              outcome: result.receipt.outcome,
              orderStatus: result.receipt.orderStatus,
              orderRevision: result.receipt.orderRevision,
              processedAt: result.receipt.processedAt,
            },
            duplicate: result.duplicate,
          },
          headers: noStoreHeaders,
        };
      }
      if (npIsShopPaymentDisputeEvent(verified)) {
        const event = npRequireFreshShopPaymentDisputeEvent(verified, receivedAt);
        const result = await npApplyShopPaymentDisputeEvent(adapter.id, event, receivedAt);
        return {
          status: 200,
          body: {
            dispute: {
              providerId: result.receipt.providerId,
              eventId: result.receipt.event.eventId,
              disputeReference: result.receipt.event.disputeReference,
              status: result.receipt.event.status,
              outcome: result.receipt.outcome,
              orderStatus: result.receipt.orderStatus,
              orderRevision: result.receipt.orderRevision,
              processedAt: result.receipt.processedAt,
            },
            duplicate: result.duplicate,
          },
          headers: noStoreHeaders,
        };
      }
      const event = npRequireFreshShopPaymentEvent(verified, receivedAt);
      const result = await npApplyShopPaymentEvent(runtime, adapter.id, event, receivedAt);
      return {
        status: 200,
        body: {
          receipt: {
            providerId: result.receipt.providerId,
            eventId: result.receipt.event.eventId,
            outcome: result.receipt.outcome,
            orderStatus: result.receipt.orderStatus,
            orderRevision: result.receipt.orderRevision,
            processedAt: result.receipt.processedAt,
          },
          duplicate: result.duplicate,
        },
        headers: noStoreHeaders,
      };
    } catch (error) {
      if (error instanceof NpShopPaymentVerificationError) {
        return {
          status: 401,
          body: { error: "payment_verification_failed", message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentAdjustmentVerificationError) {
        return {
          status: 401,
          body: { error: "payment_adjustment_verification_failed", message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentDisputeVerificationError) {
        return {
          status: 401,
          body: { error: "payment_dispute_verification_failed", message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentConflictError) {
        return {
          status: 409,
          body: { error: error.code, message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentAdjustmentConflictError) {
        return {
          status: 409,
          body: { error: error.code, message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentDisputeConflictError) {
        return {
          status: 409,
          body: { error: error.code, message: error.message },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentAdjustmentContractError) {
        return {
          status: 400,
          body: { error: "invalid_payment_adjustment", message: error.issues.join(" ") },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentDisputeContractError) {
        return {
          status: 400,
          body: { error: "invalid_payment_dispute", message: error.issues.join(" ") },
          headers: noStoreHeaders,
        };
      }
      if (error instanceof NpShopPaymentContractError) {
        return {
          status: 400,
          body: { error: "invalid_payment_event", message: error.issues.join(" ") },
          headers: noStoreHeaders,
        };
      }
      throw error;
    }
  };
}
