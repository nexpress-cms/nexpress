import {
  npShopCurrencies,
  npShopCartIssueCodes,
  type NpShopCartIssueCode,
  type NpShopCurrency,
  type NpShopCartQuote,
} from "./types.js";
import {
  npAnalyzeShopPromotionSnapshot,
  npNormalizeShopCouponCodes,
} from "./promotion-contract.js";

export const npShopCartLimits = {
  maximumLines: 50,
  maximumQuantityPerLine: 99,
  guestTtlSeconds: 60 * 60 * 24 * 30,
  memberTtlSeconds: 60 * 60 * 24 * 180,
  cleanupBatchSize: 500,
  maximumProductNameLength: 180,
  maximumVariantNameLength: 120,
  maximumProductSlugLength: 180,
} as const;

export const NP_SHOP_CART_STORAGE_CONTRACT = "np.shop-cart.v1" as const;
export const NP_SHOP_CART_QUOTE_CONTRACT = "np.shop-cart-quote.v1" as const;
export const NP_SHOP_CART_READD_CONTRACT = "np.shop-cart-readd.v1" as const;

export const npShopCartReAddIssueCodes = [
  "product-unavailable",
  "variant-unavailable",
  "cart-line-limit",
  "quantity-limit",
] as const;

export type NpShopCartReAddIssueCode = (typeof npShopCartReAddIssueCodes)[number];

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const storageKeys = [
  "contract",
  "revision",
  "lines",
  "couponCodes",
  "createdAt",
  "updatedAt",
] as const;
const storageLineKeys = [
  "key",
  "productId",
  "productSlug",
  "productName",
  "variantSku",
  "variantName",
  "quantity",
  "currency",
  "unitPriceMinor",
] as const;
const quoteKeys = [
  "contract",
  "revision",
  "lines",
  "promotions",
  "totals",
  "totalUnits",
  "ready",
  "issues",
  "fingerprint",
  "updatedAt",
] as const;
const quoteLineKeys = [
  ...storageLineKeys,
  "lineTotalMinor",
  "imageUrl",
  "available",
  "stockQuantity",
  "issues",
] as const;
const quoteTotalKeys = ["currency", "subtotalMinor", "discountMinor", "totalMinor"] as const;
const reAddResultKeys = [
  "contract",
  "orderId",
  "cartRevision",
  "addedUnits",
  "skippedUnits",
  "lines",
] as const;
const reAddLineKeys = [
  "lineKey",
  "productId",
  "variantSku",
  "requestedQuantity",
  "addedQuantity",
  "skippedQuantity",
  "issue",
] as const;
const reAddResponseKeys = ["result", "csrfToken"] as const;

export interface NpShopCartStoredLine {
  key: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantSku: string | null;
  variantName: string | null;
  quantity: number;
  currency: NpShopCurrency;
  unitPriceMinor: number;
}

export interface NpShopCartStorageValue {
  contract: typeof NP_SHOP_CART_STORAGE_CONTRACT;
  revision: number;
  lines: NpShopCartStoredLine[];
  couponCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NpShopCartAddInput {
  productId: string;
  variantSku: string | null;
  quantity: number;
  expectedRevision: number;
}

export interface NpShopCartSetQuantityInput {
  lineKey: string;
  quantity: number;
  expectedRevision: number;
}

export interface NpShopCartDeleteInput {
  lineKey: string | null;
  expectedRevision: number;
}

export interface NpShopCartSetCouponsInput {
  couponCodes: string[];
  expectedRevision: number;
}

export interface NpShopCartReAddInput {
  orderId: string;
  expectedCartRevision: number;
}

export interface NpShopCartReAddLineResult {
  lineKey: string;
  productId: string;
  variantSku: string | null;
  requestedQuantity: number;
  addedQuantity: number;
  skippedQuantity: number;
  issue: NpShopCartReAddIssueCode | null;
}

export interface NpShopCartReAddResult {
  contract: typeof NP_SHOP_CART_READD_CONTRACT;
  orderId: string;
  cartRevision: number;
  addedUnits: number;
  skippedUnits: number;
  lines: NpShopCartReAddLineResult[];
}

export interface NpShopCartReAddResponse {
  result: NpShopCartReAddResult;
  csrfToken: string | null;
}

export interface NpShopCartReAddExpectedLine {
  key: string;
  productId: string;
  variantSku: string | null;
  quantity: number;
}

export class NpShopCartContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopCartContractError";
    this.issues = issues;
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

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isQuantity(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= npShopCartLimits.maximumQuantityPerLine
  );
}

function isQuantityPart(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= npShopCartLimits.maximumQuantityPerLine
  );
}

function isPrice(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2_147_483_647
  );
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && canonicalUuidPattern.test(value);
}

export function npShopCartLineKey(productId: string, variantSku: string | null): string {
  if (!canonicalUuidPattern.test(productId)) {
    throw new NpShopCartContractError("Invalid shop cart line key", [
      "productId must be a canonical UUID.",
    ]);
  }
  const normalizedVariant = variantSku?.trim().toUpperCase() ?? null;
  return `${productId}:${normalizedVariant ?? "_"}`;
}

export function npAnalyzeShopCartStorageValue(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["cart must be a plain object."];
  exactKeys(value, storageKeys, "cart", issues);
  if (value.contract !== NP_SHOP_CART_STORAGE_CONTRACT) {
    issues.push(`cart.contract must equal "${NP_SHOP_CART_STORAGE_CONTRACT}".`);
  }
  if (!isRevision(value.revision) || value.revision < 1) {
    issues.push("cart.revision must be a positive safe integer.");
  }
  if (!isCanonicalIso(value.createdAt)) issues.push("cart.createdAt must be canonical UTC ISO.");
  if (!isCanonicalIso(value.updatedAt)) issues.push("cart.updatedAt must be canonical UTC ISO.");
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.updatedAt) &&
    value.updatedAt < value.createdAt
  ) {
    issues.push("cart.updatedAt must not precede cart.createdAt.");
  }
  if (!Array.isArray(value.lines)) {
    issues.push("cart.lines must be an array.");
    return issues;
  }
  if (value.lines.length > npShopCartLimits.maximumLines) {
    issues.push(`cart.lines may contain at most ${npShopCartLimits.maximumLines.toString()} rows.`);
  }
  const seen = new Set<string>();
  value.lines.forEach((entry, index) => {
    const path = `cart.lines[${index.toString()}]`;
    if (!isRecord(entry)) {
      issues.push(`${path} must be a plain object.`);
      return;
    }
    exactKeys(entry, storageLineKeys, path, issues);
    if (!isBoundedText(entry.key, 38, 110)) issues.push(`${path}.key is invalid.`);
    if (!isBoundedText(entry.productId, 36, 36) || !canonicalUuidPattern.test(entry.productId)) {
      issues.push(`${path}.productId must be a canonical UUID.`);
    }
    if (!isBoundedText(entry.productSlug, 1, npShopCartLimits.maximumProductSlugLength)) {
      issues.push(`${path}.productSlug is invalid.`);
    }
    if (!isBoundedText(entry.productName, 1, npShopCartLimits.maximumProductNameLength)) {
      issues.push(`${path}.productName is invalid.`);
    }
    if (
      entry.variantSku !== null &&
      (!isBoundedText(entry.variantSku, 1, 64) ||
        entry.variantSku !== entry.variantSku.toUpperCase())
    ) {
      issues.push(`${path}.variantSku must be null or canonical uppercase text.`);
    }
    if (
      entry.variantName !== null &&
      !isBoundedText(entry.variantName, 1, npShopCartLimits.maximumVariantNameLength)
    ) {
      issues.push(`${path}.variantName is invalid.`);
    }
    if (!isQuantity(entry.quantity)) issues.push(`${path}.quantity is invalid.`);
    if (!(npShopCurrencies as readonly unknown[]).includes(entry.currency)) {
      issues.push(`${path}.currency is invalid.`);
    }
    if (!isPrice(entry.unitPriceMinor)) issues.push(`${path}.unitPriceMinor is invalid.`);
    if (
      typeof entry.productId === "string" &&
      (entry.variantSku === null || typeof entry.variantSku === "string")
    ) {
      try {
        const expectedKey = npShopCartLineKey(entry.productId, entry.variantSku);
        if (entry.key !== expectedKey)
          issues.push(`${path}.key does not match its product option.`);
      } catch {
        // The field-specific productId issue above is sufficient.
      }
    }
    if (typeof entry.key === "string") {
      if (seen.has(entry.key)) issues.push(`${path}.key is duplicated.`);
      seen.add(entry.key);
    }
  });
  try {
    const couponCodes = npNormalizeShopCouponCodes(value.couponCodes);
    if (JSON.stringify(couponCodes) !== JSON.stringify(value.couponCodes)) {
      issues.push("cart.couponCodes must be unique, canonical, and sorted.");
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "cart.couponCodes is invalid.");
  }
  return issues;
}

export function npRequireShopCartStorageValue(value: unknown): NpShopCartStorageValue {
  const issues = npAnalyzeShopCartStorageValue(value);
  if (issues.length > 0) throw new NpShopCartContractError("Invalid stored shop cart", issues);
  return value as NpShopCartStorageValue;
}

function requireInputRecord(
  value: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new NpShopCartContractError(`Invalid ${context}`, [`${context} must be a plain object.`]);
  }
  const issues: string[] = [];
  exactKeys(value, keys, context, issues);
  if (issues.length > 0) throw new NpShopCartContractError(`Invalid ${context}`, issues);
  return value;
}

function requireExpectedRevision(value: unknown, context: string): number {
  if (!isRevision(value)) {
    throw new NpShopCartContractError(`Invalid ${context}`, [
      `${context}.expectedRevision must be a non-negative safe integer.`,
    ]);
  }
  return value;
}

export function npRequireShopCartAddInput(value: unknown): NpShopCartAddInput {
  const input = requireInputRecord(
    value,
    ["productId", "variantSku", "quantity", "expectedRevision"],
    "cart add request",
  );
  if (typeof input.productId !== "string" || !canonicalUuidPattern.test(input.productId)) {
    throw new NpShopCartContractError("Invalid cart add request", [
      "cart add request.productId must be a canonical UUID.",
    ]);
  }
  if (
    input.variantSku !== null &&
    (typeof input.variantSku !== "string" ||
      input.variantSku.trim() !== input.variantSku ||
      input.variantSku.length < 1 ||
      input.variantSku.length > 64)
  ) {
    throw new NpShopCartContractError("Invalid cart add request", [
      "cart add request.variantSku must be null or 1–64 characters.",
    ]);
  }
  if (!isQuantity(input.quantity)) {
    throw new NpShopCartContractError("Invalid cart add request", [
      `cart add request.quantity must be 1–${npShopCartLimits.maximumQuantityPerLine.toString()}.`,
    ]);
  }
  return {
    productId: input.productId,
    variantSku: typeof input.variantSku === "string" ? input.variantSku.trim().toUpperCase() : null,
    quantity: input.quantity,
    expectedRevision: requireExpectedRevision(input.expectedRevision, "cart add request"),
  };
}

export function npRequireShopCartSetQuantityInput(value: unknown): NpShopCartSetQuantityInput {
  const input = requireInputRecord(
    value,
    ["lineKey", "quantity", "expectedRevision"],
    "cart quantity request",
  );
  if (!isBoundedText(input.lineKey, 38, 110)) {
    throw new NpShopCartContractError("Invalid cart quantity request", [
      "cart quantity request.lineKey is invalid.",
    ]);
  }
  if (!isQuantity(input.quantity)) {
    throw new NpShopCartContractError("Invalid cart quantity request", [
      `cart quantity request.quantity must be 1–${npShopCartLimits.maximumQuantityPerLine.toString()}.`,
    ]);
  }
  return {
    lineKey: input.lineKey,
    quantity: input.quantity,
    expectedRevision: requireExpectedRevision(input.expectedRevision, "cart quantity request"),
  };
}

export function npRequireShopCartDeleteInput(value: unknown): NpShopCartDeleteInput {
  const input = requireInputRecord(value, ["lineKey", "expectedRevision"], "cart delete request");
  if (input.lineKey !== null && !isBoundedText(input.lineKey, 38, 110)) {
    throw new NpShopCartContractError("Invalid cart delete request", [
      "cart delete request.lineKey must be null or a canonical line key.",
    ]);
  }
  return {
    lineKey: input.lineKey,
    expectedRevision: requireExpectedRevision(input.expectedRevision, "cart delete request"),
  };
}

export function npRequireShopCartSetCouponsInput(value: unknown): NpShopCartSetCouponsInput {
  const input = requireInputRecord(
    value,
    ["couponCodes", "expectedRevision"],
    "cart coupon request",
  );
  try {
    return {
      couponCodes: npNormalizeShopCouponCodes(input.couponCodes),
      expectedRevision: requireExpectedRevision(input.expectedRevision, "cart coupon request"),
    };
  } catch (error) {
    throw new NpShopCartContractError("Invalid cart coupon request", [
      error instanceof Error ? error.message : "cart coupon request.couponCodes is invalid.",
    ]);
  }
}

export function npRequireShopCartReAddInput(value: unknown): NpShopCartReAddInput {
  const input = requireInputRecord(
    value,
    ["orderId", "expectedCartRevision"],
    "cart re-add request",
  );
  const issues: string[] = [];
  if (typeof input.orderId !== "string" || !canonicalUuidPattern.test(input.orderId)) {
    issues.push("cart re-add request.orderId must be a canonical UUID.");
  }
  if (!isRevision(input.expectedCartRevision)) {
    issues.push("cart re-add request.expectedCartRevision must be a non-negative safe integer.");
  }
  if (issues.length > 0) {
    throw new NpShopCartContractError("Invalid cart re-add request", issues);
  }
  return input as unknown as NpShopCartReAddInput;
}

export function npAnalyzeShopCartReAddResult(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["cart re-add result must be a plain object."];
  exactKeys(value, reAddResultKeys, "cart re-add result", issues);
  if (value.contract !== NP_SHOP_CART_READD_CONTRACT) {
    issues.push(`cart re-add result.contract must equal "${NP_SHOP_CART_READD_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.orderId)) issues.push("cart re-add result.orderId is invalid.");
  if (!isRevision(value.cartRevision)) {
    issues.push("cart re-add result.cartRevision is invalid.");
  }
  if (!Number.isSafeInteger(value.addedUnits) || (value.addedUnits as number) < 0) {
    issues.push("cart re-add result.addedUnits is invalid.");
  }
  if (!Number.isSafeInteger(value.skippedUnits) || (value.skippedUnits as number) < 0) {
    issues.push("cart re-add result.skippedUnits is invalid.");
  }
  if (!Array.isArray(value.lines)) {
    issues.push("cart re-add result.lines must be an array.");
    return issues;
  }
  if (value.lines.length < 1 || value.lines.length > npShopCartLimits.maximumLines) {
    issues.push(
      `cart re-add result.lines must contain 1–${npShopCartLimits.maximumLines.toString()} rows.`,
    );
  }
  const seen = new Set<string>();
  let addedUnits = 0;
  let skippedUnits = 0;
  value.lines.forEach((entry, index) => {
    const path = `cart re-add result.lines[${index.toString()}]`;
    if (!isRecord(entry)) {
      issues.push(`${path} must be a plain object.`);
      return;
    }
    exactKeys(entry, reAddLineKeys, path, issues);
    if (!isCanonicalUuid(entry.productId)) issues.push(`${path}.productId is invalid.`);
    if (
      entry.variantSku !== null &&
      (!isBoundedText(entry.variantSku, 1, 64) ||
        entry.variantSku !== entry.variantSku.toUpperCase())
    ) {
      issues.push(`${path}.variantSku is invalid.`);
    }
    if (!isBoundedText(entry.lineKey, 38, 110)) {
      issues.push(`${path}.lineKey is invalid.`);
    } else {
      if (seen.has(entry.lineKey)) issues.push(`${path}.lineKey is duplicated.`);
      seen.add(entry.lineKey);
      if (
        typeof entry.productId === "string" &&
        (entry.variantSku === null || typeof entry.variantSku === "string")
      ) {
        try {
          if (entry.lineKey !== npShopCartLineKey(entry.productId, entry.variantSku)) {
            issues.push(`${path}.lineKey does not match its product option.`);
          }
        } catch {
          // Field-specific identity issues above are sufficient.
        }
      }
    }
    if (!isQuantity(entry.requestedQuantity)) {
      issues.push(`${path}.requestedQuantity is invalid.`);
    }
    if (!isQuantityPart(entry.addedQuantity)) issues.push(`${path}.addedQuantity is invalid.`);
    if (!isQuantityPart(entry.skippedQuantity)) {
      issues.push(`${path}.skippedQuantity is invalid.`);
    }
    if (
      isQuantity(entry.requestedQuantity) &&
      isQuantityPart(entry.addedQuantity) &&
      isQuantityPart(entry.skippedQuantity) &&
      entry.addedQuantity + entry.skippedQuantity !== entry.requestedQuantity
    ) {
      issues.push(`${path} quantities must exactly allocate the requested quantity.`);
    }
    if (
      entry.issue !== null &&
      !(npShopCartReAddIssueCodes as readonly unknown[]).includes(entry.issue)
    ) {
      issues.push(`${path}.issue is invalid.`);
    }
    if (entry.skippedQuantity === 0 && entry.issue !== null) {
      issues.push(`${path}.issue must be null when no quantity was skipped.`);
    }
    if (
      typeof entry.skippedQuantity === "number" &&
      entry.skippedQuantity > 0 &&
      entry.issue === null
    ) {
      issues.push(`${path}.issue is required when quantity was skipped.`);
    }
    if (
      ["product-unavailable", "variant-unavailable", "cart-line-limit"].includes(
        entry.issue as string,
      ) &&
      entry.addedQuantity !== 0
    ) {
      issues.push(`${path}.addedQuantity must be zero for a wholly unavailable line.`);
    }
    if (isQuantityPart(entry.addedQuantity)) addedUnits += entry.addedQuantity;
    if (isQuantityPart(entry.skippedQuantity)) skippedUnits += entry.skippedQuantity;
  });
  if (Number.isSafeInteger(value.addedUnits) && value.addedUnits !== addedUnits) {
    issues.push("cart re-add result.addedUnits does not match its lines.");
  }
  if (Number.isSafeInteger(value.skippedUnits) && value.skippedUnits !== skippedUnits) {
    issues.push("cart re-add result.skippedUnits does not match its lines.");
  }
  return issues;
}

export function npRequireShopCartReAddResult(value: unknown): NpShopCartReAddResult {
  const issues = npAnalyzeShopCartReAddResult(value);
  if (issues.length > 0) throw new NpShopCartContractError("Invalid cart re-add result", issues);
  return value as NpShopCartReAddResult;
}

export function npAnalyzeShopCartReAddResponse(
  value: unknown,
  expected: NpShopCartReAddInput,
  expectedLines: readonly NpShopCartReAddExpectedLine[],
): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["cart re-add response must be a plain object."];
  exactKeys(value, reAddResponseKeys, "cart re-add response", issues);
  if (
    value.csrfToken !== null &&
    (typeof value.csrfToken !== "string" || !isBoundedText(value.csrfToken, 1, 512))
  ) {
    issues.push("cart re-add response.csrfToken must be a bounded string or null.");
  }
  const resultIssues = npAnalyzeShopCartReAddResult(value.result);
  issues.push(...resultIssues);
  if (resultIssues.length > 0) return issues;

  const result = value.result as NpShopCartReAddResult;
  if (result.orderId !== expected.orderId) {
    issues.push("cart re-add response.result.orderId does not match the request.");
  }
  const expectedRevision =
    result.addedUnits > 0 ? expected.expectedCartRevision + 1 : expected.expectedCartRevision;
  if (!Number.isSafeInteger(expectedRevision) || result.cartRevision !== expectedRevision) {
    issues.push("cart re-add response.result.cartRevision does not match the request outcome.");
  }
  if (result.lines.length !== expectedLines.length) {
    issues.push("cart re-add response.result.lines does not match the order snapshot.");
    return issues;
  }
  if (new Set(expectedLines.map((line) => line.key)).size !== expectedLines.length) {
    issues.push("cart re-add expected order lines must have unique keys.");
    return issues;
  }
  result.lines.forEach((line, index) => {
    const source = expectedLines[index];
    if (
      !source ||
      line.lineKey !== source.key ||
      line.productId !== source.productId ||
      line.variantSku !== source.variantSku ||
      line.requestedQuantity !== source.quantity
    ) {
      issues.push(
        `cart re-add response.result.lines[${index.toString()}] mismatches the ordered order snapshot.`,
      );
    }
  });
  return issues;
}

export function npRequireShopCartReAddResponse(
  value: unknown,
  expected: NpShopCartReAddInput,
  expectedLines: readonly NpShopCartReAddExpectedLine[],
): NpShopCartReAddResponse {
  const issues = npAnalyzeShopCartReAddResponse(value, expected, expectedLines);
  if (issues.length > 0) throw new NpShopCartContractError("Invalid cart re-add response", issues);
  return value as NpShopCartReAddResponse;
}

export function npIsShopCartIssueCode(value: unknown): value is NpShopCartIssueCode {
  return (npShopCartIssueCodes as readonly unknown[]).includes(value);
}

function analyzeIssueCodes(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!npIsShopCartIssueCode(entry)) {
      issues.push(`${path}[${index.toString()}] is invalid.`);
    } else if (seen.has(entry)) {
      issues.push(`${path}[${index.toString()}] is duplicated.`);
    } else {
      seen.add(entry);
    }
  });
}

export function npAnalyzeShopCartQuote(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["quote must be a plain object."];
  exactKeys(value, quoteKeys, "quote", issues);
  if (value.contract !== NP_SHOP_CART_QUOTE_CONTRACT) {
    issues.push(`quote.contract must equal "${NP_SHOP_CART_QUOTE_CONTRACT}".`);
  }
  if (!isRevision(value.revision)) issues.push("quote.revision is invalid.");
  if (!Number.isSafeInteger(value.totalUnits) || (value.totalUnits as number) < 0) {
    issues.push("quote.totalUnits is invalid.");
  }
  if (typeof value.ready !== "boolean") issues.push("quote.ready must be boolean.");
  if (typeof value.fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(value.fingerprint)) {
    issues.push("quote.fingerprint must be a lowercase SHA-256 digest.");
  }
  if (value.updatedAt !== null && !isCanonicalIso(value.updatedAt)) {
    issues.push("quote.updatedAt must be null or canonical UTC ISO.");
  }
  analyzeIssueCodes(value.issues, "quote.issues", issues);
  issues.push(...npAnalyzeShopPromotionSnapshot(value.promotions, "quote.promotions"));
  const quoteLineKeysSeen = new Set<string>();
  let computedUnits = 0;
  const computedTotals = new Map<string, number>();
  const computedIssues = new Set<NpShopCartIssueCode>();
  if (!Array.isArray(value.lines)) {
    issues.push("quote.lines must be an array.");
  } else {
    if (value.lines.length > npShopCartLimits.maximumLines) {
      issues.push(
        `quote.lines may contain at most ${npShopCartLimits.maximumLines.toString()} rows.`,
      );
    }
    value.lines.forEach((entry, index) => {
      const path = `quote.lines[${index.toString()}]`;
      if (!isRecord(entry)) {
        issues.push(`${path} must be a plain object.`);
        return;
      }
      exactKeys(entry, quoteLineKeys, path, issues);
      if (typeof entry.key === "string") {
        if (quoteLineKeysSeen.has(entry.key)) issues.push(`${path}.key is duplicated.`);
        quoteLineKeysSeen.add(entry.key);
      }
      const storedIssues = npAnalyzeShopCartStorageValue({
        contract: NP_SHOP_CART_STORAGE_CONTRACT,
        revision: 1,
        lines: [
          {
            key: entry.key,
            productId: entry.productId,
            productSlug: entry.productSlug ?? "unavailable",
            productName: entry.productName,
            variantSku: entry.variantSku,
            variantName: entry.variantName,
            quantity: entry.quantity,
            currency: entry.currency,
            unitPriceMinor: entry.unitPriceMinor,
          },
        ],
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        couponCodes: [],
      });
      issues.push(
        ...storedIssues
          .filter((issue) => issue.startsWith("cart.lines[0]"))
          .map((issue) => issue.replace("cart.lines[0]", path)),
      );
      if (
        entry.productSlug !== null &&
        !isBoundedText(entry.productSlug, 1, npShopCartLimits.maximumProductSlugLength)
      ) {
        issues.push(`${path}.productSlug is invalid.`);
      }
      if (!Number.isSafeInteger(entry.lineTotalMinor) || (entry.lineTotalMinor as number) < 0) {
        issues.push(`${path}.lineTotalMinor is invalid.`);
      } else if (
        Number.isSafeInteger(entry.unitPriceMinor) &&
        Number.isSafeInteger(entry.quantity) &&
        entry.lineTotalMinor !== (entry.unitPriceMinor as number) * (entry.quantity as number)
      ) {
        issues.push(`${path}.lineTotalMinor does not match price times quantity.`);
      }
      if (
        entry.imageUrl !== null &&
        (typeof entry.imageUrl !== "string" || entry.imageUrl.length > 2_048)
      ) {
        issues.push(`${path}.imageUrl is invalid.`);
      }
      if (typeof entry.available !== "boolean") issues.push(`${path}.available must be boolean.`);
      if (
        entry.stockQuantity !== null &&
        (!Number.isSafeInteger(entry.stockQuantity) || (entry.stockQuantity as number) < 0)
      ) {
        issues.push(`${path}.stockQuantity is invalid.`);
      }
      analyzeIssueCodes(entry.issues, `${path}.issues`, issues);
      if (isQuantity(entry.quantity)) computedUnits += entry.quantity;
      if (
        (npShopCurrencies as readonly unknown[]).includes(entry.currency) &&
        Number.isSafeInteger(entry.lineTotalMinor) &&
        (entry.lineTotalMinor as number) >= 0
      ) {
        computedTotals.set(
          entry.currency as string,
          (computedTotals.get(entry.currency as string) ?? 0) + (entry.lineTotalMinor as number),
        );
      }
      if (Array.isArray(entry.issues)) {
        for (const issue of entry.issues) {
          if (npIsShopCartIssueCode(issue)) computedIssues.add(issue);
        }
      }
    });
  }
  if (Number.isSafeInteger(value.totalUnits) && value.totalUnits !== computedUnits) {
    issues.push("quote.totalUnits does not match its lines.");
  }
  if (!Array.isArray(value.totals)) {
    issues.push("quote.totals must be an array.");
  } else {
    const seenCurrencies = new Set<string>();
    value.totals.forEach((entry, index) => {
      const path = `quote.totals[${index.toString()}]`;
      if (!isRecord(entry)) {
        issues.push(`${path} must be a plain object.`);
        return;
      }
      exactKeys(entry, quoteTotalKeys, path, issues);
      if (!(npShopCurrencies as readonly unknown[]).includes(entry.currency)) {
        issues.push(`${path}.currency is invalid.`);
      } else if (seenCurrencies.has(entry.currency as string)) {
        issues.push(`${path}.currency is duplicated.`);
      } else {
        seenCurrencies.add(entry.currency as string);
      }
      if (!Number.isSafeInteger(entry.subtotalMinor) || (entry.subtotalMinor as number) < 0) {
        issues.push(`${path}.subtotalMinor is invalid.`);
      } else if (
        typeof entry.currency === "string" &&
        computedTotals.get(entry.currency) !== entry.subtotalMinor
      ) {
        issues.push(`${path}.subtotalMinor does not match its lines.`);
      }
      if (!Number.isSafeInteger(entry.discountMinor) || (entry.discountMinor as number) < 0) {
        issues.push(`${path}.discountMinor is invalid.`);
      }
      if (
        !Number.isSafeInteger(entry.totalMinor) ||
        (entry.totalMinor as number) < 0 ||
        entry.totalMinor !== (entry.subtotalMinor as number) - (entry.discountMinor as number)
      ) {
        issues.push(`${path}.totalMinor must equal subtotalMinor minus discountMinor.`);
      }
    });
    if (
      seenCurrencies.size !== computedTotals.size ||
      [...computedTotals.keys()].some((currency) => !seenCurrencies.has(currency))
    ) {
      issues.push("quote.totals must cover every line currency exactly once.");
    }
  }
  if (
    Array.isArray(value.totals) &&
    value.totals.length === 1 &&
    isRecord(value.totals[0]) &&
    isRecord(value.promotions) &&
    value.totals[0].discountMinor !== value.promotions.discountMinor
  ) {
    issues.push("quote.totals[0].discountMinor must equal quote.promotions.discountMinor.");
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
      if (amount === undefined) {
        issues.push("quote.promotions references an unknown line key.");
      } else if (discount > amount) {
        issues.push("quote.promotions line discounts exceed the line total.");
      }
    }
  }
  if (Array.isArray(value.issues)) {
    const declaredIssues = new Set(
      value.issues.filter((entry): entry is NpShopCartIssueCode => npIsShopCartIssueCode(entry)),
    );
    if (
      declaredIssues.size !== computedIssues.size ||
      [...computedIssues].some((issue) => !declaredIssues.has(issue))
    ) {
      issues.push("quote.issues must equal the union of line issues.");
    }
  }
  if (typeof value.ready === "boolean" && Array.isArray(value.lines)) {
    const blockingIssues = new Set<NpShopCartIssueCode>([
      "product-unavailable",
      "variant-required",
      "variant-unavailable",
      "insufficient-stock",
      "mixed-currency",
    ]);
    const expectedReady =
      value.lines.length > 0 && ![...computedIssues].some((issue) => blockingIssues.has(issue));
    if (value.ready !== expectedReady) {
      issues.push("quote.ready does not match its blocking issues.");
    }
  }
  return issues;
}

export function npRequireShopCartQuote(value: unknown): NpShopCartQuote {
  const issues = npAnalyzeShopCartQuote(value);
  if (issues.length > 0) throw new NpShopCartContractError("Invalid shop cart quote", issues);
  return value as NpShopCartQuote;
}
