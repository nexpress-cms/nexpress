import {
  npShopCheckoutIntentStatuses,
  npShopCurrencies,
  type NpShopCheckoutIntent,
  type NpShopCheckoutIntentStatus,
} from "./types.js";
import { npShopCartLineKey } from "./cart-contract.js";
import { npAnalyzeShopPromotionSnapshot } from "./promotion-contract.js";

export const NP_SHOP_CHECKOUT_INTENT_CONTRACT = "np.shop-checkout-intent.v1" as const;

export const npShopCheckoutLimits = {
  ttlSeconds: 60 * 15,
  cleanupBatchSize: 500,
  maximumLines: 50,
  maximumActivePerOwner: 5,
  maximumRetainedPerOwner: 20,
} as const;

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const canonicalSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const intentKeys = [
  "contract",
  "id",
  "status",
  "cartRevision",
  "cartFingerprint",
  "currency",
  "subtotalMinor",
  "discountMinor",
  "totalMinor",
  "promotions",
  "totalUnits",
  "lines",
  "createdAt",
  "expiresAt",
  "cancelledAt",
] as const;
const lineKeys = [
  "key",
  "productId",
  "productSlug",
  "productName",
  "variantSku",
  "variantName",
  "quantity",
  "unitPriceMinor",
  "lineTotalMinor",
] as const;

export interface NpShopCheckoutCreateInput {
  idempotencyKey: string;
  expectedRevision: number;
  expectedFingerprint: string;
}

export interface NpShopCheckoutCancelInput {
  intentId: string;
}

export class NpShopCheckoutContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCheckoutContractError";
    this.issues = issues;
  }
}

export class NpShopCheckoutConflictError extends Error {
  readonly code: "checkout_cart_conflict" | "checkout_idempotency_conflict";

  constructor(code: "checkout_cart_conflict" | "checkout_idempotency_conflict", message: string) {
    super(message);
    this.name = "NpShopCheckoutConflictError";
    this.code = code;
  }
}

export class NpShopCheckoutNotFoundError extends Error {
  constructor() {
    super("The checkout intent does not exist for this browser identity.");
    this.name = "NpShopCheckoutNotFoundError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isSafeNonNegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

export function npIsShopCheckoutIntentStatus(value: unknown): value is NpShopCheckoutIntentStatus {
  return (npShopCheckoutIntentStatuses as readonly unknown[]).includes(value);
}

export function npAnalyzeShopCheckoutIntent(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["intent must be a plain object."];
  exactKeys(value, intentKeys, "intent", issues);
  if (value.contract !== NP_SHOP_CHECKOUT_INTENT_CONTRACT) {
    issues.push(`intent.contract must equal "${NP_SHOP_CHECKOUT_INTENT_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.id)) issues.push("intent.id must be a canonical UUID.");
  if (!npIsShopCheckoutIntentStatus(value.status)) issues.push("intent.status is invalid.");
  if (!isSafeNonNegative(value.cartRevision) || value.cartRevision < 1) {
    issues.push("intent.cartRevision must be a positive safe integer.");
  }
  if (typeof value.cartFingerprint !== "string" || !digestPattern.test(value.cartFingerprint)) {
    issues.push("intent.cartFingerprint must be a lowercase SHA-256 digest.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("intent.currency is invalid.");
  }
  if (!isSafeNonNegative(value.subtotalMinor)) issues.push("intent.subtotalMinor is invalid.");
  if (!isSafeNonNegative(value.discountMinor)) issues.push("intent.discountMinor is invalid.");
  if (!isSafeNonNegative(value.totalMinor)) issues.push("intent.totalMinor is invalid.");
  if (
    isSafeNonNegative(value.subtotalMinor) &&
    isSafeNonNegative(value.discountMinor) &&
    isSafeNonNegative(value.totalMinor) &&
    value.subtotalMinor - value.discountMinor !== value.totalMinor
  ) {
    issues.push("intent.totalMinor must equal subtotalMinor minus discountMinor.");
  }
  issues.push(...npAnalyzeShopPromotionSnapshot(value.promotions, "intent.promotions"));
  if (!isSafeNonNegative(value.totalUnits) || value.totalUnits < 1) {
    issues.push("intent.totalUnits must be a positive safe integer.");
  }
  if (!isCanonicalIso(value.createdAt)) issues.push("intent.createdAt must be canonical UTC ISO.");
  if (!isCanonicalIso(value.expiresAt)) issues.push("intent.expiresAt must be canonical UTC ISO.");
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopCheckoutLimits.ttlSeconds * 1_000
  ) {
    issues.push(
      `intent.expiresAt must be exactly ${npShopCheckoutLimits.ttlSeconds.toString()} seconds after intent.createdAt.`,
    );
  }
  if (value.cancelledAt !== null && !isCanonicalIso(value.cancelledAt)) {
    issues.push("intent.cancelledAt must be null or canonical UTC ISO.");
  }
  if (value.status === "cancelled" && value.cancelledAt === null) {
    issues.push("intent.cancelledAt is required when status is cancelled.");
  }
  if (value.status !== "cancelled" && value.cancelledAt !== null) {
    issues.push("intent.cancelledAt must be null unless status is cancelled.");
  }
  if (
    isCanonicalIso(value.cancelledAt) &&
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.expiresAt) &&
    (value.cancelledAt < value.createdAt || value.cancelledAt >= value.expiresAt)
  ) {
    issues.push("intent.cancelledAt must fall before expiry and not precede creation.");
  }
  if (!Array.isArray(value.lines)) {
    issues.push("intent.lines must be an array.");
    return issues;
  }
  if (value.lines.length < 1 || value.lines.length > npShopCheckoutLimits.maximumLines) {
    issues.push(
      `intent.lines must contain 1–${npShopCheckoutLimits.maximumLines.toString()} rows.`,
    );
  }
  let computedSubtotal = 0;
  let computedUnits = 0;
  const seen = new Set<string>();
  value.lines.forEach((entry, index) => {
    const path = `intent.lines[${index.toString()}]`;
    if (!isRecord(entry)) {
      issues.push(`${path} must be a plain object.`);
      return;
    }
    exactKeys(entry, lineKeys, path, issues);
    if (!isBoundedText(entry.key, 110)) issues.push(`${path}.key is invalid.`);
    if (typeof entry.key === "string") {
      if (seen.has(entry.key)) issues.push(`${path}.key is duplicated.`);
      seen.add(entry.key);
    }
    if (!isCanonicalUuid(entry.productId)) issues.push(`${path}.productId is invalid.`);
    if (!isBoundedText(entry.productSlug, 180) || !canonicalSlugPattern.test(entry.productSlug)) {
      issues.push(`${path}.productSlug is invalid.`);
    }
    if (!isBoundedText(entry.productName, 180)) issues.push(`${path}.productName is invalid.`);
    if (
      entry.variantSku !== null &&
      (!isBoundedText(entry.variantSku, 64) || entry.variantSku !== entry.variantSku.toUpperCase())
    ) {
      issues.push(`${path}.variantSku is invalid.`);
    }
    if (entry.variantName !== null && !isBoundedText(entry.variantName, 120)) {
      issues.push(`${path}.variantName is invalid.`);
    }
    if (
      typeof entry.productId === "string" &&
      (entry.variantSku === null || typeof entry.variantSku === "string")
    ) {
      try {
        if (entry.key !== npShopCartLineKey(entry.productId, entry.variantSku)) {
          issues.push(`${path}.key does not match its product option.`);
        }
      } catch {
        // The productId and variantSku diagnostics above identify the malformed fields.
      }
    }
    if (
      !Number.isSafeInteger(entry.quantity) ||
      (entry.quantity as number) < 1 ||
      (entry.quantity as number) > 99
    ) {
      issues.push(`${path}.quantity is invalid.`);
    }
    if (!isSafeNonNegative(entry.unitPriceMinor) || entry.unitPriceMinor > 2_147_483_647) {
      issues.push(`${path}.unitPriceMinor is invalid.`);
    }
    if (!isSafeNonNegative(entry.lineTotalMinor)) {
      issues.push(`${path}.lineTotalMinor is invalid.`);
    } else if (
      Number.isSafeInteger(entry.unitPriceMinor) &&
      Number.isSafeInteger(entry.quantity) &&
      entry.lineTotalMinor !== (entry.unitPriceMinor as number) * (entry.quantity as number)
    ) {
      issues.push(`${path}.lineTotalMinor does not match price times quantity.`);
    }
    if (isSafeNonNegative(entry.lineTotalMinor)) computedSubtotal += entry.lineTotalMinor;
    if (Number.isSafeInteger(entry.quantity) && (entry.quantity as number) > 0) {
      computedUnits += entry.quantity as number;
    }
  });
  if (isSafeNonNegative(value.subtotalMinor) && value.subtotalMinor !== computedSubtotal) {
    issues.push("intent.subtotalMinor does not match its lines.");
  }
  if (isSafeNonNegative(value.totalUnits) && value.totalUnits !== computedUnits) {
    issues.push("intent.totalUnits does not match its lines.");
  }
  if (
    isRecord(value.promotions) &&
    isSafeNonNegative(value.discountMinor) &&
    value.promotions.discountMinor !== value.discountMinor
  ) {
    issues.push("intent.discountMinor must equal promotions.discountMinor.");
  }
  if (isRecord(value.promotions) && Array.isArray(value.promotions.applied)) {
    const lineAmounts = new Map(
      Array.isArray(value.lines)
        ? value.lines
            .filter(isRecord)
            .filter(
              (line) => typeof line.key === "string" && Number.isSafeInteger(line.lineTotalMinor),
            )
            .map((line) => [line.key as string, line.lineTotalMinor as number])
        : [],
    );
    const discounts = new Map<string, number>();
    for (const promotion of value.promotions.applied) {
      if (!isRecord(promotion) || !Array.isArray(promotion.lineDiscounts)) continue;
      for (const line of promotion.lineDiscounts) {
        if (!isRecord(line) || typeof line.lineKey !== "string") continue;
        discounts.set(
          line.lineKey,
          (discounts.get(line.lineKey) ?? 0) +
            (Number.isSafeInteger(line.discountMinor) ? (line.discountMinor as number) : 0),
        );
      }
    }
    for (const [lineKey, discount] of discounts) {
      const amount = lineAmounts.get(lineKey);
      if (amount === undefined) issues.push("intent.promotions references an unknown line key.");
      else if (discount > amount) {
        issues.push("intent.promotions line discounts exceed the line total.");
      }
    }
  }
  return issues;
}

export function npRequireShopCheckoutIntent(value: unknown): NpShopCheckoutIntent {
  const issues = npAnalyzeShopCheckoutIntent(value);
  if (issues.length > 0) {
    throw new NpShopCheckoutContractError("Invalid Shop checkout intent", issues);
  }
  return value as NpShopCheckoutIntent;
}

function requireInput(
  value: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new NpShopCheckoutContractError(`Invalid ${context}`, [
      `${context} must be a plain object.`,
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, keys, context, issues);
  if (issues.length > 0) throw new NpShopCheckoutContractError(`Invalid ${context}`, issues);
  return value;
}

export function npRequireShopCheckoutCreateInput(value: unknown): NpShopCheckoutCreateInput {
  const input = requireInput(
    value,
    ["idempotencyKey", "expectedRevision", "expectedFingerprint"],
    "checkout create request",
  );
  const issues: string[] = [];
  if (!isCanonicalUuid(input.idempotencyKey)) {
    issues.push("checkout create request.idempotencyKey must be a canonical UUID.");
  }
  if (!isSafeNonNegative(input.expectedRevision) || input.expectedRevision < 1) {
    issues.push("checkout create request.expectedRevision must be a positive safe integer.");
  }
  if (
    typeof input.expectedFingerprint !== "string" ||
    !digestPattern.test(input.expectedFingerprint)
  ) {
    issues.push("checkout create request.expectedFingerprint must be a SHA-256 digest.");
  }
  if (issues.length > 0) {
    throw new NpShopCheckoutContractError("Invalid checkout create request", issues);
  }
  return input as unknown as NpShopCheckoutCreateInput;
}

export function npRequireShopCheckoutCancelInput(value: unknown): NpShopCheckoutCancelInput {
  const input = requireInput(value, ["intentId"], "checkout cancel request");
  if (!isCanonicalUuid(input.intentId)) {
    throw new NpShopCheckoutContractError("Invalid checkout cancel request", [
      "checkout cancel request.intentId must be a canonical UUID.",
    ]);
  }
  return { intentId: input.intentId };
}

export function npRequireShopCheckoutIntentId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    throw new NpShopCheckoutContractError("Invalid checkout intent id", [
      "Checkout intent id must be a canonical UUID.",
    ]);
  }
  return value;
}

export function npRequireShopCheckoutReadQuery(value: unknown): string {
  const query = requireInput(value, ["id"], "checkout read query");
  return npRequireShopCheckoutIntentId(query.id);
}
