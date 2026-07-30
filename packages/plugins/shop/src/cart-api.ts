import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopCartContractError,
  npRequireShopCartAddInput,
  npRequireShopCartDeleteInput,
  npRequireShopCartSetQuantityInput,
} from "./cart-contract.js";
import {
  NpShopCartRevisionError,
  npAddShopCartLine,
  npDeleteShopCartLine,
  npMergeShopGuestCart,
  npQuoteShopCart,
  npSetShopCartQuantity,
} from "./cart-service.js";
import {
  npClearShopGuestCookie,
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(error: NpShopCartRevisionError | NpShopCartContractError): NpRouteResponse {
  if (error instanceof NpShopCartRevisionError) {
    return {
      status: 409,
      body: {
        error: "cart_revision_conflict",
        message: error.message,
        actualRevision: error.actualRevision,
      },
      headers: { "Cache-Control": "private, no-store" },
    };
  }
  return {
    status: 400,
    body: { error: "invalid_cart_request", message: error.issues.join(" ") },
    headers: { "Cache-Control": "private, no-store" },
  };
}

export function createShopCartApiHandler(runtime: NpShopRuntime) {
  return async function shopCartApiHandler(request: NpRouteRequest): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      let quote;
      let responseCookie = resolved.responseCookie;

      if (request.method === "GET" || request.method === "HEAD") {
        if (resolved.memberOwner && resolved.cookieIdentity) {
          quote = await npMergeShopGuestCart(
            runtime,
            resolved.memberOwner,
            resolved.cookieIdentity.owner,
          );
          responseCookie = npClearShopGuestCookie();
        } else {
          quote = await npQuoteShopCart(runtime, resolved.owner);
        }
      } else {
        npRequireShopMutationCsrf(request, resolved);
        if (request.method === "POST") {
          const input = npRequireShopCartAddInput(request.body);
          quote = await npAddShopCartLine(
            runtime,
            resolved.owner,
            input.productId,
            input.variantSku,
            input.quantity,
            input.expectedRevision,
          );
        } else if (request.method === "PATCH") {
          const input = npRequireShopCartSetQuantityInput(request.body);
          quote = await npSetShopCartQuantity(
            runtime,
            resolved.owner,
            input.lineKey,
            input.quantity,
            input.expectedRevision,
          );
        } else if (request.method === "DELETE") {
          const input = npRequireShopCartDeleteInput(request.body);
          quote = await npDeleteShopCartLine(
            runtime,
            resolved.owner,
            input.lineKey,
            input.expectedRevision,
          );
        } else {
          return { status: 405, body: { error: "method_not_allowed" } };
        }
      }

      return {
        status: 200,
        body: {
          quote,
          csrfToken: npShopRequestCsrfToken(request, resolved),
        },
        headers: {
          "Cache-Control": "private, no-store",
          ...(responseCookie ? { "Set-Cookie": responseCookie } : {}),
        },
      };
    } catch (error) {
      if (error instanceof NpShopCartRevisionError || error instanceof NpShopCartContractError) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
