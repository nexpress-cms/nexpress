import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
  type NpShopCartOwner,
} from "./cart-service.js";
import type { NpShopRuntime } from "./runtime.js";

export const NP_SHOP_CART_COOKIE = "np-shop-cart";
const MEMBER_CSRF_COOKIE = "np-mb-csrf";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

interface GuestIdentity {
  token: string;
  owner: Extract<NpShopCartOwner, { kind: "guest" }>;
}

function secret(): string {
  const value = process.env.NP_SECRET;
  if (!value || value.length < 32) {
    throw new Error("NP_SECRET must contain at least 32 characters for Shop cart cookies.");
  }
  return value;
}

function sign(purpose: string, value: string): string {
  return createHmac("sha256", secret()).update(`${purpose}:${value}`).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const segment of (header ?? "").split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

function parseGuestIdentity(cookie: string | undefined): GuestIdentity | null {
  if (!cookie) return null;
  const separator = cookie.indexOf(".");
  if (separator < 1) return null;
  const token = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{32,64}$/u.test(token) || !safeEqual(signature, sign("cart", token))) {
    return null;
  }
  return {
    token,
    owner: {
      kind: "guest",
      idHash: createHash("sha256").update(token).digest("hex"),
    },
  };
}

function createGuestIdentity(): GuestIdentity {
  const token = randomBytes(24).toString("base64url");
  return {
    token,
    owner: {
      kind: "guest",
      idHash: createHash("sha256").update(token).digest("hex"),
    },
  };
}

function serializeGuestCookie(identity: GuestIdentity): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NP_SHOP_CART_COOKIE}=${identity.token}.${sign("cart", identity.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE.toString()}${secure}`;
}

function clearGuestCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NP_SHOP_CART_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function guestCsrfToken(identity: GuestIdentity): string {
  return sign("cart-csrf", identity.token);
}

function requireCsrf(
  request: NpRouteRequest,
  cookies: Record<string, string>,
  identity: GuestIdentity | null,
): void {
  const supplied = request.headers["x-csrf-token"];
  const expected = request.member
    ? cookies[MEMBER_CSRF_COOKIE]
    : identity && guestCsrfToken(identity);
  if (!supplied || !expected || !safeEqual(supplied, expected)) {
    throw new NpShopCartContractError("Invalid cart request", [
      "A current cart CSRF token is required.",
    ]);
  }
}

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
      const cookies = parseCookies(request.headers.cookie);
      const cookieIdentity = parseGuestIdentity(cookies[NP_SHOP_CART_COOKIE]);
      const identity = cookieIdentity ?? (request.member ? null : createGuestIdentity());
      const memberOwner = request.member
        ? ({ kind: "member", memberId: request.member.id } as const)
        : null;
      const owner: NpShopCartOwner = memberOwner ?? (identity as GuestIdentity).owner;
      let quote;
      let responseCookie =
        !request.member && identity !== null ? serializeGuestCookie(identity) : undefined;

      if (request.method === "GET" || request.method === "HEAD") {
        if (memberOwner && cookieIdentity) {
          quote = await npMergeShopGuestCart(runtime, memberOwner, cookieIdentity.owner);
          responseCookie = clearGuestCookie();
        } else {
          quote = await npQuoteShopCart(runtime, owner);
        }
      } else {
        requireCsrf(request, cookies, identity);
        if (request.method === "POST") {
          const input = npRequireShopCartAddInput(request.body);
          quote = await npAddShopCartLine(
            runtime,
            owner,
            input.productId,
            input.variantSku,
            input.quantity,
            input.expectedRevision,
          );
        } else if (request.method === "PATCH") {
          const input = npRequireShopCartSetQuantityInput(request.body);
          quote = await npSetShopCartQuantity(
            runtime,
            owner,
            input.lineKey,
            input.quantity,
            input.expectedRevision,
          );
        } else if (request.method === "DELETE") {
          const input = npRequireShopCartDeleteInput(request.body);
          quote = await npDeleteShopCartLine(runtime, owner, input.lineKey, input.expectedRevision);
        } else {
          return { status: 405, body: { error: "method_not_allowed" } };
        }
      }

      return {
        status: 200,
        body: {
          quote,
          csrfToken: request.member
            ? (cookies[MEMBER_CSRF_COOKIE] ?? null)
            : guestCsrfToken(identity as GuestIdentity),
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
