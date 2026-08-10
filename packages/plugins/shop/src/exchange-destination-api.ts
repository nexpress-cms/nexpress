import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopExchangeDestinationConflictError,
  NpShopExchangeDestinationContractError,
  npRequireShopExchangeDestinationSubmitInput,
} from "./exchange-destination-contract.js";
import { npSubmitShopExchangeDestination } from "./order-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";

function errorResponse(
  error:
    | NpShopCartContractError
    | NpShopExchangeDestinationContractError
    | NpShopExchangeDestinationConflictError,
): NpRouteResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopExchangeDestinationConflictError) {
    return { status: 409, body: { error: error.code, message: error.message }, headers };
  }
  return {
    status: 400,
    body: {
      error: "invalid_exchange_destination_request",
      message: error.issues.join(" "),
    },
    headers,
  };
}

export function createShopExchangeDestinationApiHandler() {
  return async function shopExchangeDestinationApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const csrfToken = npShopRequestCsrfToken(request, resolved);
      const headers = {
        "Cache-Control": "private, no-store",
        ...(resolved.responseCookie ? { "Set-Cookie": resolved.responseCookie } : {}),
      };
      npRequireShopMutationCsrf(request, resolved);
      if (request.method !== "POST") {
        return {
          status: 405,
          body: { error: "method_not_allowed" },
          headers: { ...headers, Allow: "POST" },
        };
      }
      const exchange = await npSubmitShopExchangeDestination(
        resolved.owner,
        npRequireShopExchangeDestinationSubmitInput(request.body),
      );
      return { status: 200, body: { exchange, csrfToken }, headers };
    } catch (error) {
      if (
        error instanceof NpShopCartContractError ||
        error instanceof NpShopExchangeDestinationContractError ||
        error instanceof NpShopExchangeDestinationConflictError
      ) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
