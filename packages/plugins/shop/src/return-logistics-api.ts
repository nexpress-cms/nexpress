import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopReturnLogisticsConflictError,
  NpShopReturnLogisticsContractError,
  NpShopReturnLogisticsProviderError,
  npRequireShopReturnLogisticsCreateInput,
  npRequireShopReturnLogisticsExistingInput,
} from "./return-logistics-contract.js";
import {
  NpShopReturnPostageConflictError,
  NpShopReturnPostageContractError,
  npRequireShopQuotedReturnLogisticsCreateInput,
} from "./return-postage-contract.js";
import {
  npCancelShopReturnLogistics,
  npCreateShopReturnLogistics,
  npResumeShopReturnLogistics,
} from "./return-logistics-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(error: unknown): NpRouteResponse | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopReturnLogisticsConflictError) {
    return { status: 409, body: { error: error.code, message: error.message }, headers };
  }
  if (error instanceof NpShopReturnLogisticsContractError) {
    return {
      status: 400,
      body: { error: "invalid_return_logistics", message: error.issues.join(" ") },
      headers,
    };
  }
  if (error instanceof NpShopReturnLogisticsProviderError) {
    return {
      status: 503,
      body: {
        error: "return_logistics_provider_unavailable",
        message: "The return logistics provider is temporarily unavailable.",
      },
      headers,
    };
  }
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
  return null;
}

export function createShopReturnLogisticsApiHandler(runtime: NpShopRuntime) {
  return async function shopReturnLogisticsApiHandler(
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
        const body = request.body;
        const result = await npCreateShopReturnLogistics(
          runtime,
          resolved.owner,
          body &&
            typeof body === "object" &&
            !Array.isArray(body) &&
            Object.hasOwn(body, "postageQuoteId")
            ? npRequireShopQuotedReturnLogisticsCreateInput(body)
            : npRequireShopReturnLogisticsCreateInput(body),
        );
        return { status: 200, body: { ...result, csrfToken }, headers };
      }
      if (request.method === "DELETE") {
        const result = await npCancelShopReturnLogistics(
          runtime,
          resolved.owner,
          npRequireShopReturnLogisticsExistingInput(request.body),
        );
        return { status: 200, body: { ...result, csrfToken }, headers };
      }
      if (request.method === "PATCH") {
        const result = await npResumeShopReturnLogistics(
          runtime,
          resolved.owner,
          npRequireShopReturnLogisticsExistingInput(request.body),
        );
        return { status: 200, body: { ...result, csrfToken }, headers };
      }
      return {
        status: 405,
        body: { error: "method_not_allowed" },
        headers: { ...headers, Allow: "POST, PATCH, DELETE" },
      };
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
