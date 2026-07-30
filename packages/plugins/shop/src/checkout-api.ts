import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopCheckoutConflictError,
  NpShopCheckoutContractError,
  NpShopCheckoutNotFoundError,
  npRequireShopCheckoutCancelInput,
  npRequireShopCheckoutCreateInput,
  npRequireShopCheckoutReadQuery,
} from "./checkout-contract.js";
import {
  npCancelShopCheckoutIntent,
  npCreateShopCheckoutIntent,
  npReadShopCheckoutIntent,
} from "./checkout-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(
  error:
    | NpShopCartContractError
    | NpShopCheckoutContractError
    | NpShopCheckoutConflictError
    | NpShopCheckoutNotFoundError,
): NpRouteResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopCheckoutConflictError) {
    return {
      status: 409,
      body: { error: error.code, message: error.message },
      headers,
    };
  }
  if (error instanceof NpShopCheckoutNotFoundError) {
    return {
      status: 404,
      body: { error: "checkout_intent_not_found", message: error.message },
      headers,
    };
  }
  return {
    status: 400,
    body: {
      error: "invalid_checkout_request",
      message: error.issues.join(" "),
    },
    headers,
  };
}

export function createShopCheckoutApiHandler(runtime: NpShopRuntime) {
  return async function shopCheckoutApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const responseCookie = resolved.responseCookie;
      let intent;

      if (request.method === "GET" || request.method === "HEAD") {
        const intentId = npRequireShopCheckoutReadQuery(request.query);
        intent = await npReadShopCheckoutIntent(runtime, resolved.owner, intentId);
      } else {
        npRequireShopMutationCsrf(request, resolved);
        if (request.method === "POST") {
          const input = npRequireShopCheckoutCreateInput(request.body);
          intent = await npCreateShopCheckoutIntent(runtime, resolved.owner, input);
        } else if (request.method === "DELETE") {
          const input = npRequireShopCheckoutCancelInput(request.body);
          intent = await npCancelShopCheckoutIntent(runtime, resolved.owner, input.intentId);
        } else {
          return { status: 405, body: { error: "method_not_allowed" } };
        }
      }

      return {
        status: 200,
        body: {
          intent,
          csrfToken: npShopRequestCsrfToken(request, resolved),
        },
        headers: {
          "Cache-Control": "private, no-store",
          ...(responseCookie ? { "Set-Cookie": responseCookie } : {}),
        },
      };
    } catch (error) {
      if (
        error instanceof NpShopCartContractError ||
        error instanceof NpShopCheckoutContractError ||
        error instanceof NpShopCheckoutConflictError ||
        error instanceof NpShopCheckoutNotFoundError
      ) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
