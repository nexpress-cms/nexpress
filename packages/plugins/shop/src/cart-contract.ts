import {
  npShopCurrencies,
  npShopCartIssueCodes,
  type NpShopCartIssueCode,
  type NpShopCurrency,
  type NpShopCartQuote,
} from "./types.js";

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

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const storageKeys = ["contract", "revision", "lines", "createdAt", "updatedAt"] as const;
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
const quoteTotalKeys = ["currency", "subtotalMinor"] as const;

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
    });
    if (
      seenCurrencies.size !== computedTotals.size ||
      [...computedTotals.keys()].some((currency) => !seenCurrencies.has(currency))
    ) {
      issues.push("quote.totals must cover every line currency exactly once.");
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
