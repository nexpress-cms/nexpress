import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError, npRequireShopCartReAddInput } from "./cart-contract.js";
import { NpShopCartRevisionError } from "./cart-service.js";
import { NpShopOrderConflictError, NpShopOrderNotFoundError } from "./order-contract.js";
import { npReAddShopOrderLines } from "./order-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(
  error:
    | NpShopCartContractError
    | NpShopCartRevisionError
    | NpShopOrderConflictError
    | NpShopOrderNotFoundError,
): NpRouteResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopCartRevisionError) {
    return {
      status: 409,
      body: {
        error: "cart_revision_conflict",
        message: error.message,
        actualRevision: error.actualRevision,
      },
      headers,
    };
  }
  if (error instanceof NpShopOrderConflictError) {
    return { status: 409, body: { error: error.code, message: error.message }, headers };
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
    body: { error: "invalid_cart_readd_request", message: error.issues.join(" ") },
    headers,
  };
}

export function createShopCartReAddApiHandler(runtime: NpShopRuntime) {
  return async function shopCartReAddApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      if (request.method !== "POST") {
        return {
          status: 405,
          body: { error: "method_not_allowed" },
          headers: { Allow: "POST", "Cache-Control": "private, no-store" },
        };
      }
      const resolved = npResolveShopRequestIdentity(request);
      npRequireShopMutationCsrf(request, resolved);
      const result = await npReAddShopOrderLines(
        runtime,
        resolved.owner,
        npRequireShopCartReAddInput(request.body),
      );
      return {
        status: 200,
        body: { result, csrfToken: npShopRequestCsrfToken(request, resolved) },
        headers: {
          "Cache-Control": "private, no-store",
          ...(resolved.responseCookie ? { "Set-Cookie": resolved.responseCookie } : {}),
        },
      };
    } catch (error) {
      if (
        error instanceof NpShopCartContractError ||
        error instanceof NpShopCartRevisionError ||
        error instanceof NpShopOrderConflictError ||
        error instanceof NpShopOrderNotFoundError
      ) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
