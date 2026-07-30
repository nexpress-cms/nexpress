import { npShopOrderLimits } from "./order-contract.js";
import { npShopSkuPattern } from "./runtime.js";
import type { NpShopCheckoutIntentLine } from "./types.js";

export const NP_SHOP_INVENTORY_RESERVATION_CONTRACT = "np.shop-inventory-reservation.v1" as const;

export const npShopInventoryReservationLimits = {
  diagnosticSampleSize: 500,
  adminListSize: 50,
  cleanupBatchSize: 500,
} as const;

export interface NpShopInventoryReservation {
  contract: typeof NP_SHOP_INVENTORY_RESERVATION_CONTRACT;
  orderId: string;
  ownerSegment: string;
  productId: string;
  variantSku: string | null;
  quantity: number;
  createdAt: string;
  expiresAt: string;
}

export class NpShopInventoryReservationContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopInventoryReservationContractError";
    this.issues = issues;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const guestOwnerSegmentPattern = /^guest:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerSegmentPattern.test(value) ||
      (value.startsWith("member:") && isCanonicalUuid(value.slice("member:".length))))
  );
}

export function npShopInventoryStockKey(productId: string, variantSku: string | null): string {
  return `${productId}:${variantSku ?? "_"}`;
}

export function npShopInventoryReservationStorageKey(
  productId: string,
  variantSku: string | null,
  orderId: string,
): string {
  return `inventory-reservation:${npShopInventoryStockKey(productId, variantSku)}:${orderId}`;
}

export function npAnalyzeShopInventoryReservation(value: unknown): string[] {
  if (!isRecord(value)) return ["reservation must be a plain object."];
  const issues: string[] = [];
  const keys = [
    "contract",
    "orderId",
    "ownerSegment",
    "productId",
    "variantSku",
    "quantity",
    "createdAt",
    "expiresAt",
  ] as const;
  for (const key of Object.keys(value)) {
    if (!keys.includes(key as (typeof keys)[number])) {
      issues.push(`reservation.${key} is not supported.`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push(`reservation.${key} is required.`);
  }
  if (value.contract !== NP_SHOP_INVENTORY_RESERVATION_CONTRACT) {
    issues.push(`reservation.contract must equal "${NP_SHOP_INVENTORY_RESERVATION_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.orderId)) issues.push("reservation.orderId is invalid.");
  if (!isOwnerSegment(value.ownerSegment)) issues.push("reservation.ownerSegment is invalid.");
  if (!isCanonicalUuid(value.productId)) issues.push("reservation.productId is invalid.");
  if (
    value.variantSku !== null &&
    (typeof value.variantSku !== "string" || !npShopSkuPattern.test(value.variantSku))
  ) {
    issues.push("reservation.variantSku is invalid.");
  }
  if (!Number.isSafeInteger(value.quantity) || (value.quantity as number) < 1) {
    issues.push("reservation.quantity is invalid.");
  }
  if (!isCanonicalIso(value.createdAt)) issues.push("reservation.createdAt is invalid.");
  if (!isCanonicalIso(value.expiresAt)) issues.push("reservation.expiresAt is invalid.");
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopOrderLimits.pendingTtlSeconds * 1_000
  ) {
    issues.push("reservation.expiresAt must equal the fixed pending lifetime.");
  }
  return issues;
}

export function npRequireShopInventoryReservation(value: unknown): NpShopInventoryReservation {
  const issues = npAnalyzeShopInventoryReservation(value);
  if (issues.length > 0) {
    throw new NpShopInventoryReservationContractError("Invalid Shop inventory reservation", issues);
  }
  return value as NpShopInventoryReservation;
}

export function npShopReservationLineMatches(
  reservation: NpShopInventoryReservation,
  line: NpShopCheckoutIntentLine,
): boolean {
  return (
    reservation.productId === line.productId &&
    reservation.variantSku === line.variantSku &&
    reservation.quantity === line.quantity
  );
}
