import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopOrderConflictError,
  NpShopOrderContractError,
  NpShopOrderNotFoundError,
  npRequireShopOrderCancelInput,
  npRequireShopOrderCreateInput,
  npRequireShopOrderId,
} from "./order-contract.js";
import {
  npCancelShopOrder,
  npCreateShopOrder,
  npListShopOrders,
  npReadShopOrder,
} from "./order-service.js";
import { npListShopOrderNotifications } from "./order-notification-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(
  error:
    | NpShopCartContractError
    | NpShopOrderContractError
    | NpShopOrderConflictError
    | NpShopOrderNotFoundError,
): NpRouteResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopOrderConflictError) {
    return {
      status: 409,
      body: { error: error.code, message: error.message },
      headers,
    };
  }
  if (error instanceof NpShopOrderNotFoundError) {
    return {
      status: 404,
      body: { error: "order_not_found", message: error.message },
      headers,
    };
  }
  return {
    status: 400,
    body: {
      error: "invalid_order_request",
      message: error.issues.join(" "),
    },
    headers,
  };
}

export function createShopOrderApiHandler(runtime: NpShopRuntime) {
  return async function shopOrderApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const csrfToken = npShopRequestCsrfToken(request, resolved);
      const headers = {
        "Cache-Control": "private, no-store",
        ...(resolved.responseCookie ? { "Set-Cookie": resolved.responseCookie } : {}),
      };
      if (request.method === "GET" || request.method === "HEAD") {
        const rawId = request.query.id;
        if (rawId === undefined) {
          const list = await npListShopOrders(resolved.owner);
          return { status: 200, body: { list, csrfToken }, headers };
        }
        const orderId = npRequireShopOrderId(rawId);
        const [order, notifications] = await Promise.all([
          npReadShopOrder(resolved.owner, orderId),
          npListShopOrderNotifications(resolved.owner, orderId),
        ]);
        return { status: 200, body: { order, notifications, csrfToken }, headers };
      }

      npRequireShopMutationCsrf(request, resolved);
      if (request.method === "POST") {
        const order = await npCreateShopOrder(
          runtime,
          resolved.owner,
          npRequireShopOrderCreateInput(request.body),
        );
        const notifications = await npListShopOrderNotifications(resolved.owner, order.id);
        return { status: 200, body: { order, notifications, csrfToken }, headers };
      }
      if (request.method === "DELETE") {
        const order = await npCancelShopOrder(
          resolved.owner,
          npRequireShopOrderCancelInput(request.body),
        );
        const notifications = await npListShopOrderNotifications(resolved.owner, order.id);
        return { status: 200, body: { order, notifications, csrfToken }, headers };
      }
      return {
        status: 405,
        body: { error: "method_not_allowed" },
        headers: { ...headers, Allow: "GET, HEAD, POST, DELETE" },
      };
    } catch (error) {
      if (
        error instanceof NpShopCartContractError ||
        error instanceof NpShopOrderContractError ||
        error instanceof NpShopOrderConflictError ||
        error instanceof NpShopOrderNotFoundError
      ) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
