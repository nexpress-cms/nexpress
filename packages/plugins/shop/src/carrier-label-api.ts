import {
  NpAuthError,
  NpConflictError,
  NpServiceUnavailableError,
  NpValidationError,
} from "@nexpress/core";
import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopCarrierConflictError,
  NpShopCarrierContractError,
  NpShopCarrierProviderError,
  NpShopCarrierUnavailableError,
  npRequireShopCarrierLabelReadInput,
  type NpShopCarrierLabelFormat,
  type NpShopCarrierLabelReadInput,
} from "./carrier-contract.js";
import { npReadShopCarrierShippingLabel } from "./order-service.js";
import type { NpShopRuntime } from "./runtime.js";

const mediaTypes: Record<NpShopCarrierLabelFormat, string> = {
  pdf: "application/pdf",
  png: "image/png",
  zpl: "application/vnd.zebra-zpl",
};

export function createShopCarrierLabelApiHandler(runtime: NpShopRuntime) {
  return async function shopCarrierLabelApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    if (!request.user) throw new NpAuthError("Staff authentication required");
    // GET registrations also serve HEAD. Do not fetch potentially PII-bearing
    // provider bytes or write delivery audits when the framework will discard
    // the body.
    if (request.method === "HEAD") return { status: 204 };
    let input: NpShopCarrierLabelReadInput;
    try {
      input = npRequireShopCarrierLabelReadInput(request.query);
    } catch (error) {
      if (error instanceof NpShopCarrierContractError) {
        throw new NpValidationError(
          "Invalid carrier label request",
          error.issues.map((message) => ({ field: "carrierLabel", message })),
        );
      }
      throw error;
    }
    try {
      const label = await npReadShopCarrierShippingLabel(runtime, input, request.user.id);
      return {
        status: 200,
        body: label.content,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="shop-label-${label.shipmentId}.${label.format}"`,
          "Content-Type": mediaTypes[label.format],
          "X-Content-Type-Options": "nosniff",
        },
      };
    } catch (error) {
      if (error instanceof NpShopCarrierConflictError) {
        throw new NpConflictError(error.message, { code: error.code });
      }
      if (
        error instanceof NpShopCarrierProviderError ||
        error instanceof NpShopCarrierUnavailableError
      ) {
        throw new NpServiceUnavailableError("The carrier label provider is unavailable.");
      }
      if (error instanceof NpShopCarrierContractError) {
        throw new NpServiceUnavailableError(
          "The carrier label provider returned an invalid response.",
        );
      }
      throw error;
    }
  };
}
