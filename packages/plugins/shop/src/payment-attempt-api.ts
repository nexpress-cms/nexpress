import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopPaymentAttemptConflictError,
  NpShopPaymentAttemptContractError,
  NpShopPaymentAttemptNotFoundError,
  NpShopPaymentProviderError,
  npRequireShopPaymentAttemptConfirmInput,
  npRequireShopPaymentAttemptCreateInput,
} from "./payment-attempt-contract.js";
import {
  npConfirmShopPaymentAttempt,
  npPrepareShopPaymentAttempt,
  npReadShopPaymentAttempt,
} from "./payment-attempt-service.js";
import { NpShopOrderContractError, NpShopOrderNotFoundError } from "./order-contract.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function errorResponse(error: unknown): NpRouteResponse | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopPaymentAttemptConflictError) {
    return { status: 409, body: { error: error.code, message: error.message }, headers };
  }
  if (
    error instanceof NpShopPaymentAttemptNotFoundError ||
    error instanceof NpShopOrderNotFoundError
  ) {
    return {
      status: 404,
      body: { error: "payment_attempt_not_found", message: error.message },
      headers,
    };
  }
  if (
    error instanceof NpShopPaymentAttemptContractError ||
    error instanceof NpShopOrderContractError
  ) {
    return {
      status: 400,
      body: {
        error: "invalid_payment_attempt_request",
        message: error.issues.join(" "),
      },
      headers,
    };
  }
  if (error instanceof NpShopPaymentProviderError) {
    return {
      status: 502,
      body: {
        error: error.code,
        message: error.message,
        retryable: error.retryable,
      },
      headers,
    };
  }
  return null;
}

export function createShopPaymentAttemptApiHandler(runtime: NpShopRuntime) {
  if (!runtime.paymentInitiationAdapter) {
    throw new Error("Shop payment attempt API requires an initiation-capable adapter.");
  }
  return async function shopPaymentAttemptApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const csrfToken = npShopRequestCsrfToken(request, resolved);
      const headers = {
        "Cache-Control": "private, no-store",
        ...(resolved.responseCookie ? { "Set-Cookie": resolved.responseCookie } : {}),
      };
      if (request.method === "GET" || request.method === "HEAD") {
        const orderId = request.query.orderId;
        const attemptId = request.query.attemptId;
        if (orderId === undefined && attemptId === undefined) {
          return { status: 200, body: { attempt: null, csrfToken }, headers };
        }
        if (typeof orderId !== "string" || typeof attemptId !== "string") {
          throw new NpShopPaymentAttemptContractError("Invalid payment attempt lookup", [
            "Payment attempt lookup requires both orderId and attemptId.",
          ]);
        }
        const attempt = await npReadShopPaymentAttempt(resolved.owner, orderId, attemptId);
        return { status: 200, body: { attempt, csrfToken }, headers };
      }

      npRequireShopMutationCsrf(request, resolved);
      if (request.method === "POST") {
        const attempt = await npPrepareShopPaymentAttempt(
          runtime,
          resolved.owner,
          npRequireShopPaymentAttemptCreateInput(request.body),
        );
        return { status: 200, body: { attempt, csrfToken }, headers };
      }
      if (request.method === "PATCH") {
        const result = await npConfirmShopPaymentAttempt(
          runtime,
          resolved.owner,
          npRequireShopPaymentAttemptConfirmInput(request.body),
        );
        return { status: 200, body: { ...result, csrfToken }, headers };
      }
      return {
        status: 405,
        body: { error: "method_not_allowed" },
        headers: { ...headers, Allow: "GET, HEAD, POST, PATCH" },
      };
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
