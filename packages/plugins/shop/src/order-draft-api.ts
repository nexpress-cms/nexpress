import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import {
  NpShopOrderDraftConflictError,
  NpShopOrderDraftContractError,
  NpShopOrderDraftExpiredError,
  NpShopOrderDraftNotFoundError,
  npRequireShopOrderDraftCreateInput,
  npRequireShopOrderDraftDeleteInput,
  npRequireShopOrderDraftReadQuery,
  npRequireShopOrderDraftUpdateInput,
} from "./order-draft-contract.js";
import {
  npCreateShopOrderDraft,
  npDeleteShopOrderDraft,
  npReadShopOrderDraft,
  npUpdateShopOrderDraft,
} from "./order-draft-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(
  error:
    | NpShopCartContractError
    | NpShopOrderDraftContractError
    | NpShopOrderDraftConflictError
    | NpShopOrderDraftNotFoundError
    | NpShopOrderDraftExpiredError,
): NpRouteResponse {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopOrderDraftConflictError) {
    return {
      status: 409,
      body: { error: error.code, message: error.message },
      headers,
    };
  }
  if (error instanceof NpShopOrderDraftExpiredError) {
    return {
      status: 410,
      body: { error: "order_draft_expired", message: error.message },
      headers,
    };
  }
  if (error instanceof NpShopOrderDraftNotFoundError) {
    return {
      status: 404,
      body: { error: "order_draft_not_found", message: error.message },
      headers,
    };
  }
  return {
    status: 400,
    body: {
      error: "invalid_order_draft_request",
      message: error.issues.join(" "),
    },
    headers,
  };
}

export function createShopOrderDraftApiHandler(runtime: NpShopRuntime) {
  return async function shopOrderDraftApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const responseCookie = resolved.responseCookie;
      const csrfToken = npShopRequestCsrfToken(request, resolved);
      const headers = {
        "Cache-Control": "private, no-store",
        ...(responseCookie ? { "Set-Cookie": responseCookie } : {}),
      };

      if (request.method === "GET" || request.method === "HEAD") {
        const draftId = npRequireShopOrderDraftReadQuery(request.query);
        const draft = await npReadShopOrderDraft(runtime, resolved.owner, draftId);
        return { status: 200, body: { draft, csrfToken }, headers };
      }

      npRequireShopMutationCsrf(request, resolved);
      if (request.method === "POST") {
        const input = npRequireShopOrderDraftCreateInput(request.body);
        const draft = await npCreateShopOrderDraft(runtime, resolved.owner, input);
        return { status: 200, body: { draft, csrfToken }, headers };
      }
      if (request.method === "PATCH") {
        const input = npRequireShopOrderDraftUpdateInput(request.body);
        const draft = await npUpdateShopOrderDraft(runtime, resolved.owner, input);
        return { status: 200, body: { draft, csrfToken }, headers };
      }
      if (request.method === "DELETE") {
        const input = npRequireShopOrderDraftDeleteInput(request.body);
        await npDeleteShopOrderDraft(resolved.owner, input.draftId);
        return { status: 200, body: { deleted: true, csrfToken }, headers };
      }
      return { status: 405, body: { error: "method_not_allowed" } };
    } catch (error) {
      if (
        error instanceof NpShopCartContractError ||
        error instanceof NpShopOrderDraftContractError ||
        error instanceof NpShopOrderDraftConflictError ||
        error instanceof NpShopOrderDraftNotFoundError ||
        error instanceof NpShopOrderDraftExpiredError
      ) {
        return errorResponse(error);
      }
      throw error;
    }
  };
}
