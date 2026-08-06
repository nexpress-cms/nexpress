import { NpForbiddenError, NpNotFoundError, NpValidationError } from "@nexpress/core";
import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopProductReviewContractError,
  npRequireShopProductReviewCreateInput,
  npRequireShopProductReviewUpdateInput,
} from "./review-contract.js";
import {
  npCreateShopProductReview,
  npDeleteShopProductReview,
  npGetShopProductReviewPage,
  npUpdateShopProductReview,
} from "./review-service.js";
import {
  npRequireShopMutationCsrf,
  npResolveShopRequestIdentity,
  npShopRequestCsrfToken,
} from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

function requireMember(request: NpRouteRequest): string {
  if (!request.member) throw new NpForbiddenError("shop product review", "write");
  return request.member.id;
}

function requireDeleteId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { reviewId?: unknown }).reviewId !== "string" ||
    !(value as { reviewId: string }).reviewId
  ) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      "review.reviewId is required.",
    ]);
  }
  return (value as { reviewId: string }).reviewId;
}

function errorResponse(error: unknown): NpRouteResponse | null {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof NpShopProductReviewContractError) {
    return {
      status: error.message.includes("Duplicate") ? 409 : 400,
      body: { error: "invalid_review_request", message: error.issues.join(" ") },
      headers,
    };
  }
  if (error instanceof NpForbiddenError) {
    return { status: 403, body: { error: "review_forbidden", message: error.message }, headers };
  }
  if (error instanceof NpNotFoundError) {
    return { status: 404, body: { error: "review_not_found", message: error.message }, headers };
  }
  if (error instanceof NpValidationError) {
    return {
      status: 400,
      body: { error: "invalid_review_request", message: error.message },
      headers,
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  ) {
    return {
      status: 409,
      body: {
        error: "review_already_exists",
        message: "This purchased item already has a review.",
      },
      headers,
    };
  }
  return null;
}

export function createShopProductReviewApiHandler(runtime: NpShopRuntime) {
  return async function shopProductReviewApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    try {
      const resolved = npResolveShopRequestIdentity(request);
      const headers = { "Cache-Control": "private, no-store" };
      if (request.method === "GET" || request.method === "HEAD") {
        const productId = request.query.productId;
        const page = Number(request.query.page ?? "1");
        if (typeof productId !== "string" || !productId) {
          throw new NpShopProductReviewContractError("Invalid product review query", [
            "review.productId is required.",
          ]);
        }
        return {
          status: 200,
          body: {
            page: await npGetShopProductReviewPage(
              runtime,
              productId,
              request.member?.id ?? null,
              page,
            ),
            csrfToken: npShopRequestCsrfToken(request, resolved),
          },
          headers,
        };
      }
      npRequireShopMutationCsrf(request, resolved);
      const memberId = requireMember(request);
      if (request.method === "POST") {
        await npCreateShopProductReview(
          runtime,
          memberId,
          npRequireShopProductReviewCreateInput(request.body),
        );
      } else if (request.method === "PATCH") {
        await npUpdateShopProductReview(
          runtime,
          memberId,
          npRequireShopProductReviewUpdateInput(request.body),
        );
      } else if (request.method === "DELETE") {
        await npDeleteShopProductReview(runtime, memberId, requireDeleteId(request.body));
      } else {
        return {
          status: 405,
          body: { error: "method_not_allowed" },
          headers: { ...headers, Allow: "GET, HEAD, POST, PATCH, DELETE" },
        };
      }
      return {
        status: 200,
        body: { ok: true, csrfToken: npShopRequestCsrfToken(request, resolved) },
        headers,
      };
    } catch (error) {
      const response = errorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
