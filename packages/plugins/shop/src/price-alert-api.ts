import { NpForbiddenError } from "@nexpress/core";
import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopPriceAlertContractError,
  npRequireShopPriceAlertInput,
} from "./price-alert-contract.js";
import {
  npCancelShopPriceAlert,
  npListShopPriceAlerts,
  npSubscribeShopPriceAlert,
} from "./price-alert-service.js";
import { npRequireShopMutationCsrf, npResolveShopRequestIdentity } from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function requireMember(request: NpRouteRequest): string {
  if (!request.member) throw new NpForbiddenError("shop price alert", "write");
  return request.member.id;
}

function errorResponse(error: unknown): NpRouteResponse | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopPriceAlertContractError) {
    const conflict =
      error.message === "Price cannot decrease" ||
      error.message === "Price target is unavailable" ||
      error.message === "Price alert is already processing";
    return {
      status: conflict ? 409 : 400,
      body: { error: "invalid_price_alert", message: error.issues.join(" ") },
      headers,
    };
  }
  if (error instanceof NpForbiddenError) {
    return {
      status: 403,
      body: { error: "price_alert_forbidden", message: error.message },
      headers,
    };
  }
  if (error instanceof NpShopCartContractError) {
    return {
      status: 403,
      body: { error: "price_alert_csrf", message: error.issues.join(" ") },
      headers,
    };
  }
  return null;
}

export function createShopPriceAlertApiHandler(runtime: NpShopRuntime) {
  return async function shopPriceAlertApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const memberId = requireMember(request);
      const headers = { "Cache-Control": "private, no-store" };
      if (request.method === "GET" || request.method === "HEAD") {
        const input = npRequireShopPriceAlertInput({
          productId: request.query.productId,
          variantSku: null,
        });
        return {
          status: 200,
          body: { alerts: await npListShopPriceAlerts(memberId, input.productId) },
          headers,
        };
      }
      npRequireShopMutationCsrf(request, resolved);
      const input = npRequireShopPriceAlertInput(request.body);
      if (request.method === "POST") {
        return {
          status: 200,
          body: { alert: await npSubscribeShopPriceAlert(runtime, memberId, input) },
          headers,
        };
      }
      if (request.method === "DELETE") {
        await npCancelShopPriceAlert(memberId, input);
        return { status: 200, body: { alert: null }, headers };
      }
      return {
        status: 405,
        body: { error: "method_not_allowed" },
        headers: { ...headers, Allow: "GET, HEAD, POST, DELETE" },
      };
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
