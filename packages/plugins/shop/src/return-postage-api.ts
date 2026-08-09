import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopReturnPostageConflictError,
  NpShopReturnPostageContractError,
  NpShopReturnPostageUnavailableError,
  npRequireShopReturnPostageQuoteInput,
  npRequireShopReturnPostageSelectInput,
} from "./return-postage-contract.js";
import { npQuoteShopReturnPostage, npSelectShopReturnPostage } from "./return-postage-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(error: unknown): NpRouteResponse | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopReturnPostageConflictError) {
    return { status: 409, body: { error: error.code, message: error.message }, headers };
  }
  if (error instanceof NpShopReturnPostageContractError) {
    return {
      status: 400,
      body: { error: "invalid_return_postage", message: error.issues.join(" ") },
      headers,
    };
  }
  if (error instanceof NpShopReturnPostageUnavailableError) {
    return {
      status: 503,
      body: {
        error: "return_postage_provider_unavailable",
        message: "Return shipping methods are temporarily unavailable.",
      },
      headers,
    };
  }
  return null;
}

export function createShopReturnPostageApiHandler(runtime: NpShopRuntime) {
  return async function shopReturnPostageApiHandler(
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
      if (request.method === "POST") {
        const quote = await npQuoteShopReturnPostage(
          runtime,
          resolved.owner,
          npRequireShopReturnPostageQuoteInput(request.body),
        );
        return { status: 200, body: { quote, csrfToken }, headers };
      }
      if (request.method === "PATCH") {
        const quote = await npSelectShopReturnPostage(
          runtime,
          resolved.owner,
          npRequireShopReturnPostageSelectInput(request.body),
        );
        return { status: 200, body: { quote, csrfToken }, headers };
      }
      return {
        status: 405,
        body: { error: "method_not_allowed" },
        headers: { ...headers, Allow: "POST, PATCH" },
      };
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
