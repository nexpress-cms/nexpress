import type { NpShopCheckoutIntentLine } from "./types.js";
import { npShopCurrencies, type NpShopCurrency, type NpShopOrderDraftShipping } from "./types.js";

export const NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT = "np.shop-shipping-quote-request.v1" as const;
export const NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT = "np.shop-shipping-quote-result.v1" as const;
export const NP_SHOP_SHIPPING_QUOTE_CONTRACT = "np.shop-shipping-quote.v1" as const;
export const NP_SHOP_DELIVERY_METHOD_CONTRACT = "np.shop-delivery-method.v1" as const;
export const NP_SHOP_SHIPPING_HEALTH_CONTRACT = "np.shop-shipping-health.v1" as const;

export const npShopShippingLimits = Object.freeze({
  providerIdLength: 32,
  quoteIdLength: 200,
  methodIdLength: 64,
  methodLabelLength: 120,
  maximumMethods: 20,
  maximumEstimateDays: 365,
  maximumQuoteLifetimeSeconds: 60 * 60,
});

export interface NpShopShippingEstimate {
  minimumDays: number;
  maximumDays: number;
}

export interface NpShopShippingMethod {
  id: string;
  label: string;
  amountMinor: number;
  estimatedDelivery: NpShopShippingEstimate | null;
}

export interface NpShopShippingQuoteRequest {
  contract: typeof NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT;
  draftId: string;
  draftRevision: number;
  currency: NpShopCurrency;
  subtotalMinor: number;
  totalUnits: number;
  lines: NpShopCheckoutIntentLine[];
  destination: NpShopOrderDraftShipping;
  requestedAt: string;
  maximumExpiresAt: string;
}

export interface NpShopShippingQuoteResult {
  contract: typeof NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT;
  quoteId: string;
  methods: NpShopShippingMethod[];
  expiresAt: string;
}

export interface NpShopShippingQuote {
  contract: typeof NP_SHOP_SHIPPING_QUOTE_CONTRACT;
  providerId: string;
  quoteId: string;
  methods: NpShopShippingMethod[];
  quotedAt: string;
  expiresAt: string;
}

export interface NpShopDeliveryMethod {
  contract: typeof NP_SHOP_DELIVERY_METHOD_CONTRACT;
  providerId: string;
  quoteId: string;
  methodId: string;
  label: string;
  amountMinor: number;
  estimatedDelivery: NpShopShippingEstimate | null;
  quotedAt: string;
  quoteExpiresAt: string;
}

export interface NpShopShippingAdapter {
  /** Stable lowercase identifier persisted with the PII-free delivery snapshot. */
  id: string;
  /**
   * Return exact delivery methods for one private draft destination. The
   * request contains PII and must stay server-side. Results must not echo it.
   */
  quoteShipping(
    input: NpShopShippingQuoteRequest,
  ): NpShopShippingQuoteResult | Promise<NpShopShippingQuoteResult>;
}

export interface NpShopShippingMethodSelectInput {
  draftId: string;
  expectedRevision: number;
  methodId: string;
}

export interface NpShopShippingHealth {
  contract: typeof NP_SHOP_SHIPPING_HEALTH_CONTRACT;
  providerId: string;
  status: "ok" | "error";
  errorCode: "provider-error" | "invalid-result" | null;
  attemptedAt: string;
  succeededAt: string | null;
}

export class NpShopShippingContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopShippingContractError";
    this.issues = issues;
  }
}

export class NpShopShippingUnavailableError extends Error {
  constructor(message = "Shipping methods are temporarily unavailable.") {
    super(message);
    this.name = "NpShopShippingUnavailableError";
  }
}

const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const countryCodePattern = /^[A-Z]{2}$/u;
const phonePattern = /^\+?[0-9 ()-]{7,32}$/u;

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

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function analyzeEstimate(value: unknown, path: string, issues: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) {
    issues.push(`${path} must be null or a plain object.`);
    return;
  }
  exactKeys(value, ["minimumDays", "maximumDays"], path, issues);
  if (
    !isNonNegativeSafeInteger(value.minimumDays) ||
    value.minimumDays > npShopShippingLimits.maximumEstimateDays
  ) {
    issues.push(`${path}.minimumDays is invalid.`);
  }
  if (
    !isNonNegativeSafeInteger(value.maximumDays) ||
    value.maximumDays > npShopShippingLimits.maximumEstimateDays
  ) {
    issues.push(`${path}.maximumDays is invalid.`);
  }
  if (
    isNonNegativeSafeInteger(value.minimumDays) &&
    isNonNegativeSafeInteger(value.maximumDays) &&
    value.minimumDays > value.maximumDays
  ) {
    issues.push(`${path}.minimumDays must not exceed maximumDays.`);
  }
}

function analyzeMethod(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "label", "amountMinor", "estimatedDelivery"], path, issues);
  if (
    !isBoundedText(value.id, npShopShippingLimits.methodIdLength) ||
    !opaqueIdPattern.test(value.id)
  ) {
    issues.push(`${path}.id is invalid.`);
  }
  if (!isBoundedText(value.label, npShopShippingLimits.methodLabelLength)) {
    issues.push(`${path}.label is invalid.`);
  }
  if (!isNonNegativeSafeInteger(value.amountMinor)) {
    issues.push(`${path}.amountMinor is invalid.`);
  }
  analyzeEstimate(value.estimatedDelivery, `${path}.estimatedDelivery`, issues);
}

function analyzeMethods(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopShippingLimits.maximumMethods
  ) {
    issues.push(
      `${path} must contain between 1 and ${npShopShippingLimits.maximumMethods.toString()} methods.`,
    );
    return;
  }
  value.forEach((method, index) => analyzeMethod(method, `${path}[${index.toString()}]`, issues));
  const ids = value
    .filter(isRecord)
    .map((method) => method.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) issues.push(`${path} method ids must be unique.`);
}

function analyzeRequestLine(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(
    value,
    [
      "key",
      "productId",
      "productSlug",
      "productName",
      "variantSku",
      "variantName",
      "quantity",
      "unitPriceMinor",
      "lineTotalMinor",
    ],
    path,
    issues,
  );
  if (!isBoundedText(value.key, 200)) issues.push(`${path}.key is invalid.`);
  if (typeof value.productId !== "string" || !canonicalUuidPattern.test(value.productId)) {
    issues.push(`${path}.productId is invalid.`);
  }
  if (!isBoundedText(value.productSlug, 200)) issues.push(`${path}.productSlug is invalid.`);
  if (!isBoundedText(value.productName, 180)) issues.push(`${path}.productName is invalid.`);
  if (value.variantSku !== null && !isBoundedText(value.variantSku, 64)) {
    issues.push(`${path}.variantSku is invalid.`);
  }
  if (value.variantName !== null && !isBoundedText(value.variantName, 120)) {
    issues.push(`${path}.variantName is invalid.`);
  }
  if (!isPositiveSafeInteger(value.quantity) || value.quantity > 99) {
    issues.push(`${path}.quantity is invalid.`);
  }
  if (!isNonNegativeSafeInteger(value.unitPriceMinor)) {
    issues.push(`${path}.unitPriceMinor is invalid.`);
  }
  if (!isNonNegativeSafeInteger(value.lineTotalMinor)) {
    issues.push(`${path}.lineTotalMinor is invalid.`);
  }
  if (
    isPositiveSafeInteger(value.quantity) &&
    isNonNegativeSafeInteger(value.unitPriceMinor) &&
    isNonNegativeSafeInteger(value.lineTotalMinor) &&
    value.quantity * value.unitPriceMinor !== value.lineTotalMinor
  ) {
    issues.push(`${path}.lineTotalMinor does not match quantity and unit price.`);
  }
}

function analyzeDestination(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(
    value,
    [
      "recipientName",
      "phone",
      "countryCode",
      "postalCode",
      "addressLine1",
      "addressLine2",
      "locality",
      "administrativeArea",
    ],
    path,
    issues,
  );
  if (!isBoundedText(value.recipientName, 120)) issues.push(`${path}.recipientName is invalid.`);
  if (!isBoundedText(value.phone, 32) || !phonePattern.test(value.phone)) {
    issues.push(`${path}.phone is invalid.`);
  }
  if (typeof value.countryCode !== "string" || !countryCodePattern.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isBoundedText(value.postalCode, 20)) issues.push(`${path}.postalCode is invalid.`);
  if (!isBoundedText(value.addressLine1, 200)) issues.push(`${path}.addressLine1 is invalid.`);
  if (value.addressLine2 !== null && !isBoundedText(value.addressLine2, 200)) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isBoundedText(value.locality, 100)) issues.push(`${path}.locality is invalid.`);
  if (value.administrativeArea !== null && !isBoundedText(value.administrativeArea, 100)) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

export function npRequireShopShippingProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerIdPattern.test(value)) {
    throw new NpShopShippingContractError("Invalid Shop shipping provider id", [
      "shipping provider id must be a lowercase segment of at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopShippingQuote(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["shipping quote must be a plain object."];
  exactKeys(
    value,
    ["contract", "providerId", "quoteId", "methods", "quotedAt", "expiresAt"],
    "shipping quote",
    issues,
  );
  if (value.contract !== NP_SHOP_SHIPPING_QUOTE_CONTRACT) {
    issues.push(`shipping quote.contract must equal "${NP_SHOP_SHIPPING_QUOTE_CONTRACT}".`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("shipping quote.providerId is invalid.");
  }
  if (
    !isBoundedText(value.quoteId, npShopShippingLimits.quoteIdLength) ||
    !opaqueIdPattern.test(value.quoteId)
  ) {
    issues.push("shipping quote.quoteId is invalid.");
  }
  analyzeMethods(value.methods, "shipping quote.methods", issues);
  if (!isCanonicalIso(value.quotedAt)) issues.push("shipping quote.quotedAt is invalid.");
  if (!isCanonicalIso(value.expiresAt)) issues.push("shipping quote.expiresAt is invalid.");
  if (
    isCanonicalIso(value.quotedAt) &&
    isCanonicalIso(value.expiresAt) &&
    (value.expiresAt <= value.quotedAt ||
      new Date(value.expiresAt).getTime() - new Date(value.quotedAt).getTime() >
        npShopShippingLimits.maximumQuoteLifetimeSeconds * 1_000)
  ) {
    issues.push("shipping quote expiry must follow quotedAt within the maximum lifetime.");
  }
  return issues;
}

export function npRequireShopShippingQuote(value: unknown): NpShopShippingQuote {
  const issues = npAnalyzeShopShippingQuote(value);
  if (issues.length > 0) {
    throw new NpShopShippingContractError("Invalid Shop shipping quote", issues);
  }
  return value as NpShopShippingQuote;
}

export function npRequireShopShippingQuoteResult(
  value: unknown,
  context: { providerId: string; requestedAt: string; maximumExpiresAt: string },
): NpShopShippingQuote {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopShippingContractError("Invalid Shop shipping quote result", [
      "shipping quote result must be a plain object.",
    ]);
  }
  exactKeys(
    value,
    ["contract", "quoteId", "methods", "expiresAt"],
    "shipping quote result",
    issues,
  );
  if (value.contract !== NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT) {
    issues.push(
      `shipping quote result.contract must equal "${NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT}".`,
    );
  }
  if (
    !isBoundedText(value.quoteId, npShopShippingLimits.quoteIdLength) ||
    !opaqueIdPattern.test(value.quoteId)
  ) {
    issues.push("shipping quote result.quoteId is invalid.");
  }
  analyzeMethods(value.methods, "shipping quote result.methods", issues);
  if (!isCanonicalIso(value.expiresAt)) {
    issues.push("shipping quote result.expiresAt is invalid.");
  } else if (
    !isCanonicalIso(context.requestedAt) ||
    !isCanonicalIso(context.maximumExpiresAt) ||
    value.expiresAt <= context.requestedAt ||
    value.expiresAt > context.maximumExpiresAt ||
    new Date(value.expiresAt).getTime() - new Date(context.requestedAt).getTime() >
      npShopShippingLimits.maximumQuoteLifetimeSeconds * 1_000
  ) {
    issues.push("shipping quote result.expiresAt exceeds the allowed quote window.");
  }
  if (issues.length > 0) {
    throw new NpShopShippingContractError("Invalid Shop shipping quote result", issues);
  }
  return npRequireShopShippingQuote({
    contract: NP_SHOP_SHIPPING_QUOTE_CONTRACT,
    providerId: context.providerId,
    quoteId: value.quoteId,
    methods: value.methods,
    quotedAt: context.requestedAt,
    expiresAt: value.expiresAt,
  });
}

export function npAnalyzeShopDeliveryMethod(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["delivery method must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "providerId",
      "quoteId",
      "methodId",
      "label",
      "amountMinor",
      "estimatedDelivery",
      "quotedAt",
      "quoteExpiresAt",
    ],
    "delivery method",
    issues,
  );
  if (value.contract !== NP_SHOP_DELIVERY_METHOD_CONTRACT) {
    issues.push(`delivery method.contract must equal "${NP_SHOP_DELIVERY_METHOD_CONTRACT}".`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("delivery method.providerId is invalid.");
  }
  if (
    !isBoundedText(value.quoteId, npShopShippingLimits.quoteIdLength) ||
    !opaqueIdPattern.test(value.quoteId)
  ) {
    issues.push("delivery method.quoteId is invalid.");
  }
  analyzeMethod(
    {
      id: value.methodId,
      label: value.label,
      amountMinor: value.amountMinor,
      estimatedDelivery: value.estimatedDelivery,
    },
    "delivery method",
    issues,
  );
  if (!isCanonicalIso(value.quotedAt)) issues.push("delivery method.quotedAt is invalid.");
  if (!isCanonicalIso(value.quoteExpiresAt)) {
    issues.push("delivery method.quoteExpiresAt is invalid.");
  } else if (isCanonicalIso(value.quotedAt) && value.quoteExpiresAt <= value.quotedAt) {
    issues.push("delivery method.quoteExpiresAt must follow quotedAt.");
  }
  return issues;
}

export function npRequireShopDeliveryMethod(value: unknown): NpShopDeliveryMethod {
  const issues = npAnalyzeShopDeliveryMethod(value);
  if (issues.length > 0) {
    throw new NpShopShippingContractError("Invalid Shop delivery method", issues);
  }
  return value as NpShopDeliveryMethod;
}

export function npRequireShopShippingMethodSelectInput(
  value: unknown,
): NpShopShippingMethodSelectInput {
  if (!isRecord(value)) {
    throw new NpShopShippingContractError("Invalid shipping method selection", [
      "shipping method selection must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["draftId", "expectedRevision", "methodId"],
    "shipping method selection",
    issues,
  );
  if (typeof value.draftId !== "string" || !canonicalUuidPattern.test(value.draftId)) {
    issues.push("shipping method selection.draftId is invalid.");
  }
  if (!isPositiveSafeInteger(value.expectedRevision)) {
    issues.push("shipping method selection.expectedRevision is invalid.");
  }
  if (
    !isBoundedText(value.methodId, npShopShippingLimits.methodIdLength) ||
    !opaqueIdPattern.test(value.methodId)
  ) {
    issues.push("shipping method selection.methodId is invalid.");
  }
  if (issues.length > 0) {
    throw new NpShopShippingContractError("Invalid shipping method selection", issues);
  }
  return value as unknown as NpShopShippingMethodSelectInput;
}

export function npAnalyzeShopShippingQuoteRequest(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["shipping quote request must be a plain object."];
  exactKeys(
    value,
    [
      "contract",
      "draftId",
      "draftRevision",
      "currency",
      "subtotalMinor",
      "totalUnits",
      "lines",
      "destination",
      "requestedAt",
      "maximumExpiresAt",
    ],
    "shipping quote request",
    issues,
  );
  if (value.contract !== NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT) {
    issues.push(
      `shipping quote request.contract must equal "${NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT}".`,
    );
  }
  if (typeof value.draftId !== "string" || !canonicalUuidPattern.test(value.draftId)) {
    issues.push("shipping quote request.draftId is invalid.");
  }
  if (!isPositiveSafeInteger(value.draftRevision)) {
    issues.push("shipping quote request.draftRevision is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("shipping quote request.currency is invalid.");
  }
  if (!isNonNegativeSafeInteger(value.subtotalMinor)) {
    issues.push("shipping quote request.subtotalMinor is invalid.");
  }
  if (!isPositiveSafeInteger(value.totalUnits)) {
    issues.push("shipping quote request.totalUnits is invalid.");
  }
  if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 100) {
    issues.push("shipping quote request.lines is invalid.");
  } else {
    value.lines.forEach((line, index) =>
      analyzeRequestLine(line, `shipping quote request.lines[${index.toString()}]`, issues),
    );
    const lineKeys = value.lines
      .filter(isRecord)
      .map((line) => line.key)
      .filter((key): key is string => typeof key === "string");
    if (new Set(lineKeys).size !== lineKeys.length) {
      issues.push("shipping quote request line keys must be unique.");
    }
    const subtotal = value.lines.reduce(
      (sum, line) =>
        isRecord(line) && isNonNegativeSafeInteger(line.lineTotalMinor)
          ? sum + line.lineTotalMinor
          : sum,
      0,
    );
    const units = value.lines.reduce(
      (sum, line) =>
        isRecord(line) && isPositiveSafeInteger(line.quantity) ? sum + line.quantity : sum,
      0,
    );
    if (isNonNegativeSafeInteger(value.subtotalMinor) && subtotal !== value.subtotalMinor) {
      issues.push("shipping quote request.subtotalMinor does not match its lines.");
    }
    if (isPositiveSafeInteger(value.totalUnits) && units !== value.totalUnits) {
      issues.push("shipping quote request.totalUnits does not match its lines.");
    }
  }
  analyzeDestination(value.destination, "shipping quote request.destination", issues);
  if (!isCanonicalIso(value.requestedAt)) {
    issues.push("shipping quote request.requestedAt is invalid.");
  }
  if (!isCanonicalIso(value.maximumExpiresAt)) {
    issues.push("shipping quote request.maximumExpiresAt is invalid.");
  }
  if (
    isCanonicalIso(value.requestedAt) &&
    isCanonicalIso(value.maximumExpiresAt) &&
    (value.maximumExpiresAt <= value.requestedAt ||
      new Date(value.maximumExpiresAt).getTime() - new Date(value.requestedAt).getTime() >
        npShopShippingLimits.maximumQuoteLifetimeSeconds * 1_000)
  ) {
    issues.push("shipping quote request maximum expiry is outside the allowed window.");
  }
  return issues;
}

export function npRequireShopShippingQuoteRequest(value: unknown): NpShopShippingQuoteRequest {
  const issues = npAnalyzeShopShippingQuoteRequest(value);
  if (issues.length > 0) {
    throw new NpShopShippingContractError("Invalid Shop shipping quote request", issues);
  }
  return value as NpShopShippingQuoteRequest;
}

export function npAnalyzeShopShippingHealth(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["shipping health must be a plain object."];
  exactKeys(
    value,
    ["contract", "providerId", "status", "errorCode", "attemptedAt", "succeededAt"],
    "shipping health",
    issues,
  );
  if (value.contract !== NP_SHOP_SHIPPING_HEALTH_CONTRACT) {
    issues.push(`shipping health.contract must equal "${NP_SHOP_SHIPPING_HEALTH_CONTRACT}".`);
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("shipping health.providerId is invalid.");
  }
  if (value.status !== "ok" && value.status !== "error") {
    issues.push("shipping health.status is invalid.");
  }
  if (
    value.errorCode !== null &&
    value.errorCode !== "provider-error" &&
    value.errorCode !== "invalid-result"
  ) {
    issues.push("shipping health.errorCode is invalid.");
  }
  if (!isCanonicalIso(value.attemptedAt)) issues.push("shipping health.attemptedAt is invalid.");
  if (value.succeededAt !== null && !isCanonicalIso(value.succeededAt)) {
    issues.push("shipping health.succeededAt is invalid.");
  }
  if (
    value.status === "ok" &&
    (value.errorCode !== null || value.succeededAt !== value.attemptedAt)
  ) {
    issues.push("successful shipping health requires the current success timestamp and no error.");
  }
  if (value.status === "error" && value.errorCode === null) {
    issues.push("failed shipping health requires a closed error code.");
  }
  if (
    isCanonicalIso(value.attemptedAt) &&
    isCanonicalIso(value.succeededAt) &&
    value.succeededAt > value.attemptedAt
  ) {
    issues.push("shipping health.succeededAt cannot follow attemptedAt.");
  }
  return issues;
}

export function npRequireShopShippingHealth(value: unknown): NpShopShippingHealth {
  const issues = npAnalyzeShopShippingHealth(value);
  if (issues.length > 0) {
    throw new NpShopShippingContractError("Invalid Shop shipping health", issues);
  }
  return value as NpShopShippingHealth;
}
