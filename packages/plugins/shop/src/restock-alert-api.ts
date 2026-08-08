import { NpForbiddenError } from "@nexpress/core";
import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopRestockAlertContractError,
  npRequireShopRestockAlertInput,
} from "./restock-alert-contract.js";
import {
  npCancelShopRestockAlert,
  npListShopRestockAlerts,
  npSubscribeShopRestockAlert,
} from "./restock-alert-service.js";
import { npRequireShopMutationCsrf, npResolveShopRequestIdentity } from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function requireMember(request: NpRouteRequest): string {
  if (!request.member) throw new NpForbiddenError("shop restock alert", "write");
  return request.member.id;
}

function errorResponse(error: unknown): NpRouteResponse | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopRestockAlertContractError) {
    const conflict =
      error.message === "Product is already available" ||
      error.message === "Product does not support restock alerts" ||
      error.message === "Restock alert is already processing";
    return {
      status: conflict ? 409 : 400,
      body: { error: "invalid_restock_alert", message: error.issues.join(" ") },
      headers,
    };
  }
  if (error instanceof NpForbiddenError) {
    return {
      status: 403,
      body: { error: "restock_alert_forbidden", message: error.message },
      headers,
    };
  }
  if (error instanceof NpShopCartContractError) {
    return {
      status: 403,
      body: { error: "restock_alert_csrf", message: error.issues.join(" ") },
      headers,
    };
  }
  return null;
}

export function createShopRestockAlertApiHandler(runtime: NpShopRuntime) {
  return async function shopRestockAlertApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const memberId = requireMember(request);
      const headers = { "Cache-Control": "private, no-store" };
      if (request.method === "GET" || request.method === "HEAD") {
        const input = npRequireShopRestockAlertInput({
          productId: request.query.productId,
          variantSku: null,
        });
        return {
          status: 200,
          body: { alerts: await npListShopRestockAlerts(memberId, input.productId) },
          headers,
        };
      }
      npRequireShopMutationCsrf(request, resolved);
      const input = npRequireShopRestockAlertInput(request.body);
      if (request.method === "POST") {
        return {
          status: 200,
          body: { alert: await npSubscribeShopRestockAlert(runtime, memberId, input) },
          headers,
        };
      }
      if (request.method === "DELETE") {
        await npCancelShopRestockAlert(memberId, input);
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
