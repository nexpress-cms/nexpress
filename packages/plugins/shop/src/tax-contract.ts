import {
  NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT,
  npAnalyzeShopDeliveryMethod,
  npAnalyzeShopShippingQuoteRequest,
  type NpShopDeliveryMethod,
} from "./shipping-contract.js";
import type {
  NpShopCheckoutIntentLine,
  NpShopCurrency,
  NpShopOrderDraftShipping,
} from "./types.js";

export const NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT = "np.shop-tax-quote-request.v1" as const;
export const NP_SHOP_TAX_QUOTE_RESULT_CONTRACT = "np.shop-tax-quote-result.v1" as const;
export const NP_SHOP_TAX_QUOTE_CONTRACT = "np.shop-tax-quote.v1" as const;
export const NP_SHOP_TAX_HEALTH_CONTRACT = "np.shop-tax-health.v1" as const;

export const npShopTaxLimits = Object.freeze({
  providerIdLength: 32,
  quoteIdLength: 200,
  componentIdLength: 64,
  componentLabelLength: 120,
  maximumComponents: 20,
  maximumQuoteLifetimeSeconds: 60 * 60,
});

export interface NpShopTaxComponent {
  id: string;
  label: string;
  amountMinor: number;
}

export interface NpShopTaxQuoteRequest {
  contract: typeof NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT;
  draftId: string;
  draftRevision: number;
  currency: NpShopCurrency;
  subtotalMinor: number;
  shippingMinor: number;
  totalBeforeTaxMinor: number;
  totalUnits: number;
  lines: NpShopCheckoutIntentLine[];
  destination: NpShopOrderDraftShipping;
  deliveryMethod: NpShopDeliveryMethod | null;
  requestedAt: string;
  maximumExpiresAt: string;
}

export interface NpShopTaxQuoteResult {
  contract: typeof NP_SHOP_TAX_QUOTE_RESULT_CONTRACT;
  quoteId: string;
  components: NpShopTaxComponent[];
  amountMinor: number;
  expiresAt: string;
}

export interface NpShopTaxQuote {
  contract: typeof NP_SHOP_TAX_QUOTE_CONTRACT;
  providerId: string;
  quoteId: string;
  components: NpShopTaxComponent[];
  amountMinor: number;
  quotedAt: string;
  expiresAt: string;
}

export interface NpShopTaxAdapter {
  /** Stable lowercase identifier persisted with the PII-free tax snapshot. */
  id: string;
  /**
   * Return only taxes added to the checkout total. The request contains a
   * private destination and must stay server-side; results must not echo it.
   */
  quoteTax(input: NpShopTaxQuoteRequest): NpShopTaxQuoteResult | Promise<NpShopTaxQuoteResult>;
}

export interface NpShopTaxHealth {
  contract: typeof NP_SHOP_TAX_HEALTH_CONTRACT;
  providerId: string;
  status: "ok" | "error";
  errorCode: "provider-error" | "invalid-result" | null;
  attemptedAt: string;
  succeededAt: string | null;
}

export class NpShopTaxContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopTaxContractError";
    this.issues = issues;
  }
}

export class NpShopTaxUnavailableError extends Error {
  constructor(message = "Tax calculation is temporarily unavailable.") {
    super(message);
    this.name = "NpShopTaxUnavailableError";
  }
}

const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

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

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
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

function analyzeComponent(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "label", "amountMinor"], path, issues);
  if (
    !isBoundedText(value.id, npShopTaxLimits.componentIdLength) ||
    !opaqueIdPattern.test(value.id)
  ) {
    issues.push(`${path}.id is invalid.`);
  }
  if (!isBoundedText(value.label, npShopTaxLimits.componentLabelLength)) {
    issues.push(`${path}.label is invalid.`);
  }
  if (!isNonNegativeSafeInteger(value.amountMinor)) {
    issues.push(`${path}.amountMinor is invalid.`);
  }
}

function analyzeComponents(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length > npShopTaxLimits.maximumComponents) {
    issues.push(
      `${path} must contain at most ${npShopTaxLimits.maximumComponents.toString()} components.`,
    );
    return;
  }
  value.forEach((component, index) =>
    analyzeComponent(component, `${path}[${index.toString()}]`, issues),
  );
  const ids = value
    .filter(isRecord)
    .map((component) => component.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) issues.push(`${path} component ids must be unique.`);
}

function analyzeQuoteFields(value: Record<string, unknown>, path: string, issues: string[]): void {
  if (
    !isBoundedText(value.quoteId, npShopTaxLimits.quoteIdLength) ||
    !opaqueIdPattern.test(value.quoteId)
  ) {
    issues.push(`${path}.quoteId is invalid.`);
  }
  analyzeComponents(value.components, `${path}.components`, issues);
  if (!isNonNegativeSafeInteger(value.amountMinor)) {
    issues.push(`${path}.amountMinor is invalid.`);
  }
  if (Array.isArray(value.components) && isNonNegativeSafeInteger(value.amountMinor)) {
    const total = value.components.reduce(
      (sum, component) =>
        isRecord(component) && isNonNegativeSafeInteger(component.amountMinor)
          ? sum + component.amountMinor
          : sum,
      0,
    );
    if (!Number.isSafeInteger(total) || total !== value.amountMinor) {
      issues.push(`${path}.amountMinor must equal the component total.`);
    }
  }
}

export function npRequireShopTaxProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopTaxContractError("Invalid Shop tax provider id", [
      "tax provider id must be a lowercase segment of at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopTaxQuote(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tax quote must be a plain object."];
  exactKeys(
    value,
    ["contract", "providerId", "quoteId", "components", "amountMinor", "quotedAt", "expiresAt"],
    "tax quote",
    issues,
  );
  if (value.contract !== NP_SHOP_TAX_QUOTE_CONTRACT) {
    issues.push(`tax quote.contract must equal "${NP_SHOP_TAX_QUOTE_CONTRACT}".`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("tax quote.providerId is invalid.");
  }
  analyzeQuoteFields(value, "tax quote", issues);
  if (!isCanonicalIso(value.quotedAt)) issues.push("tax quote.quotedAt is invalid.");
  if (!isCanonicalIso(value.expiresAt)) issues.push("tax quote.expiresAt is invalid.");
  if (
    isCanonicalIso(value.quotedAt) &&
    isCanonicalIso(value.expiresAt) &&
    (value.expiresAt <= value.quotedAt ||
      new Date(value.expiresAt).getTime() - new Date(value.quotedAt).getTime() >
        npShopTaxLimits.maximumQuoteLifetimeSeconds * 1_000)
  ) {
    issues.push("tax quote expiry must follow quotedAt within the maximum lifetime.");
  }
  return issues;
}

export function npRequireShopTaxQuote(value: unknown): NpShopTaxQuote {
  const issues = npAnalyzeShopTaxQuote(value);
  if (issues.length > 0) throw new NpShopTaxContractError("Invalid Shop tax quote", issues);
  return value as NpShopTaxQuote;
}

export function npRequireShopTaxQuoteResult(
  value: unknown,
  context: { providerId: string; requestedAt: string; maximumExpiresAt: string },
): NpShopTaxQuote {
  if (!isRecord(value)) {
    throw new NpShopTaxContractError("Invalid Shop tax quote result", [
      "tax quote result must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "quoteId", "components", "amountMinor", "expiresAt"],
    "tax quote result",
    issues,
  );
  if (value.contract !== NP_SHOP_TAX_QUOTE_RESULT_CONTRACT) {
    issues.push(`tax quote result.contract must equal "${NP_SHOP_TAX_QUOTE_RESULT_CONTRACT}".`);
  }
  analyzeQuoteFields(value, "tax quote result", issues);
  if (!isCanonicalIso(value.expiresAt)) {
    issues.push("tax quote result.expiresAt is invalid.");
  } else if (
    !isCanonicalIso(context.requestedAt) ||
    !isCanonicalIso(context.maximumExpiresAt) ||
    value.expiresAt <= context.requestedAt ||
    value.expiresAt > context.maximumExpiresAt ||
    new Date(value.expiresAt).getTime() - new Date(context.requestedAt).getTime() >
      npShopTaxLimits.maximumQuoteLifetimeSeconds * 1_000
  ) {
    issues.push("tax quote result.expiresAt exceeds the allowed quote window.");
  }
  if (issues.length > 0) {
    throw new NpShopTaxContractError("Invalid Shop tax quote result", issues);
  }
  return npRequireShopTaxQuote({
    contract: NP_SHOP_TAX_QUOTE_CONTRACT,
    providerId: context.providerId,
    quoteId: value.quoteId,
    components: value.components,
    amountMinor: value.amountMinor,
    quotedAt: context.requestedAt,
    expiresAt: value.expiresAt,
  });
}

export function npAnalyzeShopTaxQuoteRequest(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tax quote request must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "draftId",
      "draftRevision",
      "currency",
      "subtotalMinor",
      "shippingMinor",
      "totalBeforeTaxMinor",
      "totalUnits",
      "lines",
      "destination",
      "deliveryMethod",
      "requestedAt",
      "maximumExpiresAt",
    ],
    "tax quote request",
    issues,
  );
  if (value.contract !== NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT) {
    issues.push(`tax quote request.contract must equal "${NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT}".`);
  }
  issues.push(
    ...npAnalyzeShopShippingQuoteRequest({
      contract: NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT,
      draftId: value.draftId,
      draftRevision: value.draftRevision,
      currency: value.currency,
      subtotalMinor: value.subtotalMinor,
      totalUnits: value.totalUnits,
      lines: value.lines,
      destination: value.destination,
      requestedAt: value.requestedAt,
      maximumExpiresAt: value.maximumExpiresAt,
    }).map((issue) => issue.replaceAll("shipping quote request", "tax quote request")),
  );
  if (!isNonNegativeSafeInteger(value.shippingMinor)) {
    issues.push("tax quote request.shippingMinor is invalid.");
  }
  if (!isNonNegativeSafeInteger(value.totalBeforeTaxMinor)) {
    issues.push("tax quote request.totalBeforeTaxMinor is invalid.");
  }
  if (
    isNonNegativeSafeInteger(value.subtotalMinor) &&
    isNonNegativeSafeInteger(value.shippingMinor) &&
    isNonNegativeSafeInteger(value.totalBeforeTaxMinor) &&
    (value.subtotalMinor + value.shippingMinor !== value.totalBeforeTaxMinor ||
      !Number.isSafeInteger(value.subtotalMinor + value.shippingMinor))
  ) {
    issues.push(
      "tax quote request.totalBeforeTaxMinor must equal subtotalMinor plus shippingMinor.",
    );
  }
  if (value.deliveryMethod !== null) {
    issues.push(
      ...npAnalyzeShopDeliveryMethod(value.deliveryMethod).map((issue) =>
        issue.replace(/^delivery method/u, "tax quote request.deliveryMethod"),
      ),
    );
  }
  if (
    isRecord(value.deliveryMethod) &&
    isNonNegativeSafeInteger(value.shippingMinor) &&
    value.deliveryMethod.amountMinor !== value.shippingMinor
  ) {
    issues.push("tax quote request.shippingMinor must match its delivery method.");
  }
  if (value.deliveryMethod === null && value.shippingMinor !== 0) {
    issues.push("tax quote request without a delivery method must have zero shippingMinor.");
  }
  if (
    isRecord(value.deliveryMethod) &&
    isCanonicalIso(value.deliveryMethod.quoteExpiresAt) &&
    isCanonicalIso(value.maximumExpiresAt) &&
    value.maximumExpiresAt > value.deliveryMethod.quoteExpiresAt
  ) {
    issues.push("tax quote request cannot outlive its delivery method quote.");
  }
  return issues;
}

export function npRequireShopTaxQuoteRequest(value: unknown): NpShopTaxQuoteRequest {
  const issues = npAnalyzeShopTaxQuoteRequest(value);
  if (issues.length > 0) {
    throw new NpShopTaxContractError("Invalid Shop tax quote request", issues);
  }
  return value as NpShopTaxQuoteRequest;
}

export function npAnalyzeShopTaxHealth(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["tax health must be a plain object."];
  exactKeys(
    value,
    ["contract", "providerId", "status", "errorCode", "attemptedAt", "succeededAt"],
    "tax health",
    issues,
  );
  if (value.contract !== NP_SHOP_TAX_HEALTH_CONTRACT) {
    issues.push(`tax health.contract must equal "${NP_SHOP_TAX_HEALTH_CONTRACT}".`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("tax health.providerId is invalid.");
  }
  if (value.status !== "ok" && value.status !== "error") {
    issues.push("tax health.status is invalid.");
  }
  if (
    value.errorCode !== null &&
    value.errorCode !== "provider-error" &&
    value.errorCode !== "invalid-result"
  ) {
    issues.push("tax health.errorCode is invalid.");
  }
  if (!isCanonicalIso(value.attemptedAt)) issues.push("tax health.attemptedAt is invalid.");
  if (value.succeededAt !== null && !isCanonicalIso(value.succeededAt)) {
    issues.push("tax health.succeededAt is invalid.");
  }
  if (
    value.status === "ok" &&
    (value.errorCode !== null || value.succeededAt !== value.attemptedAt)
  ) {
    issues.push("successful tax health requires the current success timestamp and no error.");
  }
  if (value.status === "error" && value.errorCode === null) {
    issues.push("failed tax health requires a closed error code.");
  }
  if (
    isCanonicalIso(value.attemptedAt) &&
    isCanonicalIso(value.succeededAt) &&
    value.succeededAt > value.attemptedAt
  ) {
    issues.push("tax health.succeededAt cannot follow attemptedAt.");
  }
  return issues;
}

export function npRequireShopTaxHealth(value: unknown): NpShopTaxHealth {
  const issues = npAnalyzeShopTaxHealth(value);
  if (issues.length > 0) throw new NpShopTaxContractError("Invalid Shop tax health", issues);
  return value as NpShopTaxHealth;
}

export function npShopTaxMaximumExpiry(
  requestedAt: Date,
  draftExpiresAt: string,
  deliveryMethod: NpShopDeliveryMethod | null,
): Date {
  return new Date(
    Math.min(
      requestedAt.getTime() + npShopTaxLimits.maximumQuoteLifetimeSeconds * 1_000,
      new Date(draftExpiresAt).getTime(),
      deliveryMethod ? new Date(deliveryMethod.quoteExpiresAt).getTime() : Number.POSITIVE_INFINITY,
    ),
  );
}
