import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { NpRouteRequest } from "@nexpress/plugin-sdk";

import { NpShopCartContractError } from "./cart-contract.js";
import type { NpShopCartOwner } from "./cart-service.js";

export const NP_SHOP_CART_COOKIE = "np-shop-cart";
const MEMBER_CSRF_COOKIE = "np-mb-csrf";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export interface NpShopGuestIdentity {
  token: string;
  owner: Extract<NpShopCartOwner, { kind: "guest" }>;
}

export interface NpShopRequestIdentity {
  cookies: Record<string, string>;
  cookieIdentity: NpShopGuestIdentity | null;
  identity: NpShopGuestIdentity | null;
  memberOwner: Extract<NpShopCartOwner, { kind: "member" }> | null;
  owner: NpShopCartOwner;
  responseCookie: string | undefined;
}

function secret(): string {
  const value = process.env.NP_SECRET;
  if (!value || value.length < 32) {
    throw new Error("NP_SECRET must contain at least 32 characters for Shop browser identity.");
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

function parseGuestIdentity(cookie: string | undefined): NpShopGuestIdentity | null {
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

function createGuestIdentity(): NpShopGuestIdentity {
  const token = randomBytes(24).toString("base64url");
  return {
    token,
    owner: {
      kind: "guest",
      idHash: createHash("sha256").update(token).digest("hex"),
    },
  };
}

function serializeGuestCookie(identity: NpShopGuestIdentity): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NP_SHOP_CART_COOKIE}=${identity.token}.${sign("cart", identity.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE.toString()}${secure}`;
}

export function npClearShopGuestCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NP_SHOP_CART_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function guestCsrfToken(identity: NpShopGuestIdentity): string {
  return sign("cart-csrf", identity.token);
}

export function npResolveShopRequestIdentity(request: NpRouteRequest): NpShopRequestIdentity {
  const cookies = parseCookies(request.headers.cookie);
  const cookieIdentity = parseGuestIdentity(cookies[NP_SHOP_CART_COOKIE]);
  const identity = cookieIdentity ?? (request.member ? null : createGuestIdentity());
  const memberOwner = request.member
    ? ({ kind: "member", memberId: request.member.id } as const)
    : null;
  return {
    cookies,
    cookieIdentity,
    identity,
    memberOwner,
    owner: memberOwner ?? (identity as NpShopGuestIdentity).owner,
    responseCookie:
      !request.member && identity !== null ? serializeGuestCookie(identity) : undefined,
  };
}

export function npRequireShopMutationCsrf(
  request: NpRouteRequest,
  resolved: NpShopRequestIdentity,
): void {
  const supplied = request.headers["x-csrf-token"];
  const expected = request.member
    ? resolved.cookies[MEMBER_CSRF_COOKIE]
    : resolved.identity && guestCsrfToken(resolved.identity);
  if (!supplied || !expected || !safeEqual(supplied, expected)) {
    throw new NpShopCartContractError("Invalid Shop request", [
      "A current Shop CSRF token is required.",
    ]);
  }
}

export function npShopRequestCsrfToken(
  request: NpRouteRequest,
  resolved: NpShopRequestIdentity,
): string | null {
  return request.member
    ? (resolved.cookies[MEMBER_CSRF_COOKIE] ?? null)
    : guestCsrfToken(resolved.identity as NpShopGuestIdentity);
}
