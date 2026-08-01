import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopReturnConflictError,
  NpShopReturnContractError,
  npRequireShopReturnCancelInput,
  npRequireShopReturnRequestInput,
} from "./return-contract.js";
import { npCancelShopReturn, npRequestShopReturn } from "./order-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";

function errorResponse(
  error: NpShopCartContractError | NpShopReturnContractError | NpShopReturnConflictError,
): NpRouteResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopReturnConflictError) {
    return { status: 409, body: { error: error.code, message: error.message }, headers };
  }
  return {
    status: 400,
    body: {
      error: "invalid_return_request",
      message: error.issues.join(" "),
    },
    headers,
  };
}

export function createShopReturnApiHandler() {
  return async function shopReturnApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const csrfToken = npShopRequestCsrfToken(request, resolved);
      const headers = {
        "Cache-Control": "private, no-store",
        ...(resolved.responseCookie ? { "Set-Cookie": resolved.responseCookie } : {}),
      };
      npRequireShopMutationCsrf(request, resolved);
      if (request.method === "POST") {
        const returnRequest = await npRequestShopReturn(
          resolved.owner,
          npRequireShopReturnRequestInput(request.body),
        );
        return { status: 200, body: { returnRequest, csrfToken }, headers };
      }
      if (request.method === "DELETE") {
        const returnRequest = await npCancelShopReturn(
          resolved.owner,
          npRequireShopReturnCancelInput(request.body),
        );
        return { status: 200, body: { returnRequest, csrfToken }, headers };
      }
      return {
        status: 405,
        body: { error: "method_not_allowed" },
        headers: { ...headers, Allow: "POST, DELETE" },
      };
    } catch (error) {
      if (
        error instanceof NpShopCartContractError ||
        error instanceof NpShopReturnContractError ||
        error instanceof NpShopReturnConflictError
      ) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
