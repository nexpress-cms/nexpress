import type { NpShopOrderDraftShipping } from "./types.js";
import {
  NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
  npAnalyzeShopReturnLogisticsRequest,
  type NpShopReturnLogisticsItem,
  type NpShopReturnLogisticsMode,
  type NpShopReturnLogisticsRequest,
} from "./return-logistics-contract.js";
import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT =
  "np.shop-return-postage-quote-request.v1" as const;
export const NP_SHOP_RETURN_POSTAGE_QUOTE_RESULT_CONTRACT =
  "np.shop-return-postage-quote-result.v1" as const;
export const NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT = "np.shop-return-postage-quote.v1" as const;
export const NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT = "np.shop-return-postage-method.v1" as const;
export const NP_SHOP_RETURN_POSTAGE_STORAGE_CONTRACT = "np.shop-return-postage-storage.v1" as const;
export const NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT = "np.shop-return-postage-private.v1" as const;
export const NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT = "np.shop-return-postage-health.v1" as const;
export const NP_SHOP_QUOTED_RETURN_LOGISTICS_REQUEST_CONTRACT =
  "np.shop-return-logistics-request.v2" as const;

export const npShopReturnPostageStatuses = ["quoted", "selected"] as const;
export type NpShopReturnPostageStatus = (typeof npShopReturnPostageStatuses)[number];

export const npShopReturnPostageLimits = Object.freeze({
  providerIdLength: 32,
  methodIdLength: 64,
  methodLabelLength: 120,
  maximumMethods: 20,
  maximumAmountMinor: 2_147_483_647,
  maximumTransitDays: 365,
  maximumQuoteLifetimeSeconds: 60 * 60,
  privateTtlSeconds: 60 * 60,
  futureToleranceSeconds: 30,
  adminListSize: 50,
  diagnosticSampleSize: 500,
  cleanupBatchSize: 100,
});

export interface NpShopReturnPostageEstimate {
  minimumDays: number;
  maximumDays: number;
}

export interface NpShopReturnPostageQuoteMethod {
  id: string;
  label: string;
  amountMinor: number;
  estimatedTransit: NpShopReturnPostageEstimate | null;
}

export interface NpShopReturnPostageMethod {
  contract: typeof NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT;
  providerId: string;
  quoteId: string;
  methodId: string;
  label: string;
  currency: NpShopCurrency;
  amountMinor: number;
  estimatedTransit: NpShopReturnPostageEstimate | null;
  quotedAt: string;
  quoteExpiresAt: string;
}

export interface NpShopReturnPostageQuoteRequest {
  contract: typeof NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT;
  quoteId: string;
  returnId: string;
  orderId: string;
  originalShipmentId: string;
  originalBookingReference: string;
  returnLocationReference: string;
  currency: NpShopCurrency;
  mode: NpShopReturnLogisticsMode;
  items: NpShopReturnLogisticsItem[];
  origin: NpShopOrderDraftShipping;
  readyAt: string | null;
  closeAt: string | null;
  requestedAt: string;
  maximumExpiresAt: string;
}

export interface NpShopReturnPostageQuoteResult {
  contract: typeof NP_SHOP_RETURN_POSTAGE_QUOTE_RESULT_CONTRACT;
  quoteId: string;
  methods: NpShopReturnPostageQuoteMethod[];
  expiresAt: string;
}

export interface NpShopReturnPostageQuote {
  contract: typeof NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT;
  id: string;
  returnId: string;
  orderId: string;
  providerId: string;
  status: NpShopReturnPostageStatus;
  revision: number;
  currency: NpShopCurrency;
  mode: NpShopReturnLogisticsMode;
  methods: NpShopReturnPostageQuoteMethod[];
  selectedMethod: NpShopReturnPostageMethod | null;
  readyAt: string | null;
  closeAt: string | null;
  quotedAt: string;
  expiresAt: string;
}

export interface NpShopStoredReturnPostage extends Omit<NpShopReturnPostageQuote, "contract"> {
  contract: typeof NP_SHOP_RETURN_POSTAGE_STORAGE_CONTRACT;
  ownerSegment: string;
  returnRevision: number;
  originalShipmentId: string;
  originalBookingReference: string;
  purgeAt: string;
}

export interface NpShopStoredReturnPostagePrivate {
  contract: typeof NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT;
  quoteId: string;
  returnId: string;
  orderId: string;
  ownerSegment: string;
  origin: NpShopOrderDraftShipping;
  createdAt: string;
  expiresAt: string;
}

export interface NpShopReturnPostageQuoteInput {
  orderId: string;
  returnId: string;
  expectedReturnRevision: number;
  mode: NpShopReturnLogisticsMode;
  origin: NpShopOrderDraftShipping;
  readyAt: string | null;
  closeAt: string | null;
}

export interface NpShopReturnPostageSelectInput {
  orderId: string;
  returnId: string;
  quoteId: string;
  expectedRevision: number;
  methodId: string;
}

export interface NpShopQuotedReturnLogisticsCreateInput {
  orderId: string;
  returnId: string;
  expectedReturnRevision: number;
  postageQuoteId: string;
  expectedPostageRevision: number;
}

export interface NpShopQuotedReturnLogisticsRequest extends Omit<
  NpShopReturnLogisticsRequest,
  "contract"
> {
  contract: typeof NP_SHOP_QUOTED_RETURN_LOGISTICS_REQUEST_CONTRACT;
  postageMethod: NpShopReturnPostageMethod;
}

export interface NpShopReturnPostageHealth {
  contract: typeof NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT;
  providerId: string;
  status: "ok" | "error";
  errorCode: "provider-error" | "invalid-result" | null;
  attemptedAt: string;
  succeededAt: string | null;
}

export class NpShopReturnPostageContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopReturnPostageContractError";
    this.issues = issues;
  }
}

export class NpShopReturnPostageConflictError extends Error {
  readonly code:
    | "return_postage_not_supported"
    | "return_postage_not_found"
    | "return_postage_revision_conflict"
    | "return_postage_return_conflict"
    | "return_postage_expired"
    | "return_postage_method_not_found";

  constructor(code: NpShopReturnPostageConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopReturnPostageConflictError";
    this.code = code;
  }
}

export class NpShopReturnPostageUnavailableError extends Error {
  constructor(message = "Return shipping methods are temporarily unavailable.") {
    super(message);
    this.name = "NpShopReturnPostageUnavailableError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const guestOwnerPattern = /^guest:[0-9a-f]{64}$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const methodPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

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

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerPattern.test(value) ||
      (value.startsWith("member:") && isUuid(value.slice("member:".length))))
  );
}

function isCurrency(value: unknown): value is NpShopCurrency {
  return (npShopCurrencies as readonly unknown[]).includes(value);
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <= maximum
  );
}

function analyzeEstimate(value: unknown, path: string, issues: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) {
    issues.push(`${path} must be null or a plain object.`);
    return;
  }
  exactKeys(value, ["minimumDays", "maximumDays"], path, issues);
  for (const key of ["minimumDays", "maximumDays"] as const) {
    if (
      !Number.isSafeInteger(value[key]) ||
      (value[key] as number) < 0 ||
      (value[key] as number) > npShopReturnPostageLimits.maximumTransitDays
    ) {
      issues.push(`${path}.${key} is invalid.`);
    }
  }
  if (
    Number.isSafeInteger(value.minimumDays) &&
    Number.isSafeInteger(value.maximumDays) &&
    (value.minimumDays as number) > (value.maximumDays as number)
  ) {
    issues.push(`${path}.minimumDays must not exceed maximumDays.`);
  }
}

function analyzeQuoteMethod(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["id", "label", "amountMinor", "estimatedTransit"], path, issues);
  if (
    !isText(value.id, npShopReturnPostageLimits.methodIdLength) ||
    !methodPattern.test(value.id)
  ) {
    issues.push(`${path}.id is invalid.`);
  }
  if (!isText(value.label, npShopReturnPostageLimits.methodLabelLength)) {
    issues.push(`${path}.label is invalid.`);
  }
  if (
    !Number.isSafeInteger(value.amountMinor) ||
    (value.amountMinor as number) < 0 ||
    (value.amountMinor as number) > npShopReturnPostageLimits.maximumAmountMinor
  ) {
    issues.push(`${path}.amountMinor is invalid.`);
  }
  analyzeEstimate(value.estimatedTransit, `${path}.estimatedTransit`, issues);
}

function analyzeMethods(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopReturnPostageLimits.maximumMethods
  ) {
    issues.push(
      `${path} must contain 1-${npShopReturnPostageLimits.maximumMethods.toString()} methods.`,
    );
    return;
  }
  value.forEach((method, index) =>
    analyzeQuoteMethod(method, `${path}[${index.toString()}]`, issues),
  );
  const ids = value
    .filter(isRecord)
    .map((method) => method.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(ids).size !== ids.length) issues.push(`${path} ids must be unique.`);
}

export function npAnalyzeShopReturnPostageMethod(value: unknown): string[] {
  if (!isRecord(value)) return ["return postage method must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "providerId",
      "quoteId",
      "methodId",
      "label",
      "currency",
      "amountMinor",
      "estimatedTransit",
      "quotedAt",
      "quoteExpiresAt",
    ],
    "return postage method",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_METHOD_CONTRACT) {
    issues.push("return postage method.contract is invalid.");
  }
  if (
    !isText(value.providerId, npShopReturnPostageLimits.providerIdLength) ||
    !providerPattern.test(value.providerId)
  ) {
    issues.push("return postage method.providerId is invalid.");
  }
  if (!isUuid(value.quoteId)) issues.push("return postage method.quoteId is invalid.");
  if (
    !isText(value.methodId, npShopReturnPostageLimits.methodIdLength) ||
    !methodPattern.test(value.methodId)
  ) {
    issues.push("return postage method.methodId is invalid.");
  }
  if (!isText(value.label, npShopReturnPostageLimits.methodLabelLength)) {
    issues.push("return postage method.label is invalid.");
  }
  if (!isCurrency(value.currency)) issues.push("return postage method.currency is invalid.");
  if (
    !Number.isSafeInteger(value.amountMinor) ||
    (value.amountMinor as number) < 0 ||
    (value.amountMinor as number) > npShopReturnPostageLimits.maximumAmountMinor
  ) {
    issues.push("return postage method.amountMinor is invalid.");
  }
  analyzeEstimate(value.estimatedTransit, "return postage method.estimatedTransit", issues);
  if (!isIso(value.quotedAt)) issues.push("return postage method.quotedAt is invalid.");
  if (!isIso(value.quoteExpiresAt)) {
    issues.push("return postage method.quoteExpiresAt is invalid.");
  }
  if (
    isIso(value.quotedAt) &&
    isIso(value.quoteExpiresAt) &&
    value.quoteExpiresAt <= value.quotedAt
  ) {
    issues.push("return postage method expiry must follow quotedAt.");
  }
  return issues;
}

export function npRequireShopReturnPostageMethod(value: unknown): NpShopReturnPostageMethod {
  const issues = npAnalyzeShopReturnPostageMethod(value);
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage method", issues);
  }
  return value as NpShopReturnPostageMethod;
}

function analyzePublicQuote(value: Record<string, unknown>, path: string, issues: string[]): void {
  if (!isUuid(value.id)) issues.push(`${path}.id is invalid.`);
  if (!isUuid(value.returnId)) issues.push(`${path}.returnId is invalid.`);
  if (!isUuid(value.orderId)) issues.push(`${path}.orderId is invalid.`);
  if (
    !isText(value.providerId, npShopReturnPostageLimits.providerIdLength) ||
    !providerPattern.test(value.providerId)
  ) {
    issues.push(`${path}.providerId is invalid.`);
  }
  if (!(npShopReturnPostageStatuses as readonly unknown[]).includes(value.status)) {
    issues.push(`${path}.status is invalid.`);
  }
  if (!isRevision(value.revision)) issues.push(`${path}.revision is invalid.`);
  if (!isCurrency(value.currency)) issues.push(`${path}.currency is invalid.`);
  if (value.mode !== "dropoff" && value.mode !== "pickup") issues.push(`${path}.mode is invalid.`);
  analyzeMethods(value.methods, `${path}.methods`, issues);
  if (value.selectedMethod !== null) {
    issues.push(
      ...npAnalyzeShopReturnPostageMethod(value.selectedMethod).map((issue) =>
        issue.replace("return postage method", `${path}.selectedMethod`),
      ),
    );
  }
  if (value.status === "selected" && value.selectedMethod === null) {
    issues.push(`${path} selected status requires selectedMethod.`);
  }
  if (value.status === "quoted" && value.selectedMethod !== null) {
    issues.push(`${path} quoted status cannot contain selectedMethod.`);
  }
  if (isRecord(value.selectedMethod)) {
    const selectedMethod = value.selectedMethod;
    if (
      selectedMethod.providerId !== value.providerId ||
      selectedMethod.quoteId !== value.id ||
      selectedMethod.currency !== value.currency ||
      selectedMethod.quotedAt !== value.quotedAt ||
      selectedMethod.quoteExpiresAt !== value.expiresAt
    ) {
      issues.push(`${path}.selectedMethod does not match its quote.`);
    }
    const selected = Array.isArray(value.methods)
      ? value.methods.find((method) => isRecord(method) && method.id === selectedMethod.methodId)
      : undefined;
    const selectedEstimate = isRecord(selected) ? selected.estimatedTransit : undefined;
    const frozenEstimate = selectedMethod.estimatedTransit;
    const estimateMatches =
      (selectedEstimate === null && frozenEstimate === null) ||
      (isRecord(selectedEstimate) &&
        isRecord(frozenEstimate) &&
        selectedEstimate.minimumDays === frozenEstimate.minimumDays &&
        selectedEstimate.maximumDays === frozenEstimate.maximumDays);
    if (
      !isRecord(selected) ||
      selected.label !== selectedMethod.label ||
      selected.amountMinor !== selectedMethod.amountMinor ||
      !estimateMatches
    ) {
      issues.push(`${path}.selectedMethod does not match a quoted method.`);
    }
  }
  if (value.mode === "dropoff" && (value.readyAt !== null || value.closeAt !== null)) {
    issues.push(`${path} dropoff mode cannot contain a pickup window.`);
  }
  if (value.mode === "pickup" && (!isIso(value.readyAt) || !isIso(value.closeAt))) {
    issues.push(`${path} pickup mode requires a canonical window.`);
  }
  if (!isIso(value.quotedAt)) issues.push(`${path}.quotedAt is invalid.`);
  if (!isIso(value.expiresAt)) issues.push(`${path}.expiresAt is invalid.`);
  if (isIso(value.quotedAt) && isIso(value.expiresAt)) {
    const lifetime = new Date(value.expiresAt).getTime() - new Date(value.quotedAt).getTime();
    if (lifetime <= 0 || lifetime > npShopReturnPostageLimits.maximumQuoteLifetimeSeconds * 1_000) {
      issues.push(`${path} lifetime is invalid.`);
    }
  }
}

export function npAnalyzeShopReturnPostageQuote(value: unknown): string[] {
  if (!isRecord(value)) return ["return postage quote must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "id",
      "returnId",
      "orderId",
      "providerId",
      "status",
      "revision",
      "currency",
      "mode",
      "methods",
      "selectedMethod",
      "readyAt",
      "closeAt",
      "quotedAt",
      "expiresAt",
    ],
    "return postage quote",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT) {
    issues.push("return postage quote.contract is invalid.");
  }
  analyzePublicQuote(value, "return postage quote", issues);
  return issues;
}

export function npRequireShopReturnPostageQuote(value: unknown): NpShopReturnPostageQuote {
  const issues = npAnalyzeShopReturnPostageQuote(value);
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote", issues);
  }
  return value as NpShopReturnPostageQuote;
}

export function npAnalyzeStoredShopReturnPostage(value: unknown): string[] {
  if (!isRecord(value)) return ["stored return postage must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "id",
      "returnId",
      "orderId",
      "providerId",
      "status",
      "revision",
      "currency",
      "mode",
      "methods",
      "selectedMethod",
      "readyAt",
      "closeAt",
      "quotedAt",
      "expiresAt",
      "ownerSegment",
      "returnRevision",
      "originalShipmentId",
      "originalBookingReference",
      "purgeAt",
    ],
    "stored return postage",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_STORAGE_CONTRACT) {
    issues.push("stored return postage.contract is invalid.");
  }
  analyzePublicQuote(value, "stored return postage", issues);
  if (!isOwnerSegment(value.ownerSegment))
    issues.push("stored return postage.ownerSegment is invalid.");
  if (!isRevision(value.returnRevision))
    issues.push("stored return postage.returnRevision is invalid.");
  if (!isUuid(value.originalShipmentId)) {
    issues.push("stored return postage.originalShipmentId is invalid.");
  }
  if (!isText(value.originalBookingReference, 200)) {
    issues.push("stored return postage.originalBookingReference is invalid.");
  }
  if (!isIso(value.purgeAt)) issues.push("stored return postage.purgeAt is invalid.");
  if (isIso(value.expiresAt) && isIso(value.purgeAt) && value.expiresAt > value.purgeAt) {
    issues.push("stored return postage cannot outlive its order.");
  }
  return issues;
}

export function npRequireStoredShopReturnPostage(value: unknown): NpShopStoredReturnPostage {
  const issues = npAnalyzeStoredShopReturnPostage(value);
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid stored return postage", issues);
  }
  return value as NpShopStoredReturnPostage;
}

export function npProjectShopReturnPostage(
  value: NpShopStoredReturnPostage,
): NpShopReturnPostageQuote {
  return npRequireShopReturnPostageQuote({
    contract: NP_SHOP_RETURN_POSTAGE_QUOTE_CONTRACT,
    id: value.id,
    returnId: value.returnId,
    orderId: value.orderId,
    providerId: value.providerId,
    status: value.status,
    revision: value.revision,
    currency: value.currency,
    mode: value.mode,
    methods: value.methods,
    selectedMethod: value.selectedMethod,
    readyAt: value.readyAt,
    closeAt: value.closeAt,
    quotedAt: value.quotedAt,
    expiresAt: value.expiresAt,
  });
}

function analyzeShipping(value: unknown, path: string, issues: string[]): void {
  const probe = {
    contract: NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
    logisticsId: "00000000-0000-4000-8000-000000000000",
    returnId: "00000000-0000-4000-8000-000000000001",
    orderId: "00000000-0000-4000-8000-000000000002",
    originalShipmentId: "00000000-0000-4000-8000-000000000003",
    originalBookingReference: "probe",
    mode: "dropoff",
    returnLocationReference: "probe",
    items: [
      {
        lineKey: "probe",
        productId: "00000000-0000-4000-8000-000000000004",
        productName: "Probe",
        variantSku: null,
        variantName: null,
        quantity: 1,
      },
    ],
    origin: value,
    readyAt: null,
    closeAt: null,
    requestedAt: "2026-01-01T00:00:00.000Z",
  };
  issues.push(
    ...npAnalyzeShopReturnLogisticsRequest(probe)
      .filter((issue) => issue.includes("origin"))
      .map((issue) => issue.replace("return logistics request.origin", path)),
  );
}

export function npRequireShopReturnPostageQuoteInput(
  value: unknown,
): NpShopReturnPostageQuoteInput {
  if (!isRecord(value)) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote input", [
      "return postage quote input must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["orderId", "returnId", "expectedReturnRevision", "mode", "origin", "readyAt", "closeAt"],
    "return postage quote input",
    issues,
  );
  if (!isUuid(value.orderId)) issues.push("return postage quote input.orderId is invalid.");
  if (!isUuid(value.returnId)) issues.push("return postage quote input.returnId is invalid.");
  if (!isRevision(value.expectedReturnRevision)) {
    issues.push("return postage quote input.expectedReturnRevision is invalid.");
  }
  if (value.mode !== "dropoff" && value.mode !== "pickup") {
    issues.push("return postage quote input.mode is invalid.");
  }
  analyzeShipping(value.origin, "return postage quote input.origin", issues);
  if (value.mode === "dropoff" && (value.readyAt !== null || value.closeAt !== null)) {
    issues.push("return postage quote input dropoff mode cannot contain a pickup window.");
  }
  if (value.mode === "pickup" && (!isIso(value.readyAt) || !isIso(value.closeAt))) {
    issues.push("return postage quote input pickup mode requires a canonical window.");
  }
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote input", issues);
  }
  return value as unknown as NpShopReturnPostageQuoteInput;
}

export function npRequireShopReturnPostageSelectInput(
  value: unknown,
): NpShopReturnPostageSelectInput {
  if (!isRecord(value)) {
    throw new NpShopReturnPostageContractError("Invalid return postage selection", [
      "return postage selection must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["orderId", "returnId", "quoteId", "expectedRevision", "methodId"],
    "return postage selection",
    issues,
  );
  for (const key of ["orderId", "returnId", "quoteId"] as const) {
    if (!isUuid(value[key])) issues.push(`return postage selection.${key} is invalid.`);
  }
  if (!isRevision(value.expectedRevision)) {
    issues.push("return postage selection.expectedRevision is invalid.");
  }
  if (
    !isText(value.methodId, npShopReturnPostageLimits.methodIdLength) ||
    !methodPattern.test(value.methodId)
  ) {
    issues.push("return postage selection.methodId is invalid.");
  }
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage selection", issues);
  }
  return value as unknown as NpShopReturnPostageSelectInput;
}

export function npRequireShopQuotedReturnLogisticsCreateInput(
  value: unknown,
): NpShopQuotedReturnLogisticsCreateInput {
  if (!isRecord(value)) {
    throw new NpShopReturnPostageContractError("Invalid quoted return logistics input", [
      "quoted return logistics input must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["orderId", "returnId", "expectedReturnRevision", "postageQuoteId", "expectedPostageRevision"],
    "quoted return logistics input",
    issues,
  );
  for (const key of ["orderId", "returnId", "postageQuoteId"] as const) {
    if (!isUuid(value[key])) issues.push(`quoted return logistics input.${key} is invalid.`);
  }
  for (const key of ["expectedReturnRevision", "expectedPostageRevision"] as const) {
    if (!isRevision(value[key])) issues.push(`quoted return logistics input.${key} is invalid.`);
  }
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid quoted return logistics input", issues);
  }
  return value as unknown as NpShopQuotedReturnLogisticsCreateInput;
}

export function npRequireShopReturnPostageQuoteResult(
  value: unknown,
  context: { quoteId: string; requestedAt: string; maximumExpiresAt: string },
): NpShopReturnPostageQuoteResult {
  if (!isRecord(value)) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote result", [
      "return postage quote result must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "quoteId", "methods", "expiresAt"],
    "return postage quote result",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_QUOTE_RESULT_CONTRACT) {
    issues.push("return postage quote result.contract is invalid.");
  }
  if (value.quoteId !== context.quoteId) {
    issues.push("return postage quote result.quoteId does not match the request.");
  }
  analyzeMethods(value.methods, "return postage quote result.methods", issues);
  if (!isIso(value.expiresAt)) issues.push("return postage quote result.expiresAt is invalid.");
  if (
    isIso(value.expiresAt) &&
    (value.expiresAt <= context.requestedAt || value.expiresAt > context.maximumExpiresAt)
  ) {
    issues.push("return postage quote result expiry is outside the allowed window.");
  }
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote result", issues);
  }
  return value as unknown as NpShopReturnPostageQuoteResult;
}

export function npRequireShopReturnPostageQuoteRequest(
  value: unknown,
): NpShopReturnPostageQuoteRequest {
  if (!isRecord(value)) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote request", [
      "return postage quote request must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "quoteId",
      "returnId",
      "orderId",
      "originalShipmentId",
      "originalBookingReference",
      "returnLocationReference",
      "currency",
      "mode",
      "items",
      "origin",
      "readyAt",
      "closeAt",
      "requestedAt",
      "maximumExpiresAt",
    ],
    "return postage quote request",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_QUOTE_REQUEST_CONTRACT) {
    issues.push("return postage quote request.contract is invalid.");
  }
  const logisticsProbe = {
    contract: NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
    logisticsId: value.quoteId,
    returnId: value.returnId,
    orderId: value.orderId,
    originalShipmentId: value.originalShipmentId,
    originalBookingReference: value.originalBookingReference,
    returnLocationReference: value.returnLocationReference,
    mode: value.mode,
    items: value.items,
    origin: value.origin,
    readyAt: value.readyAt,
    closeAt: value.closeAt,
    requestedAt: value.requestedAt,
  };
  issues.push(
    ...npAnalyzeShopReturnLogisticsRequest(logisticsProbe).map((issue) =>
      issue.replace("return logistics request", "return postage quote request"),
    ),
  );
  if (!isCurrency(value.currency)) issues.push("return postage quote request.currency is invalid.");
  if (!isIso(value.maximumExpiresAt)) {
    issues.push("return postage quote request.maximumExpiresAt is invalid.");
  }
  if (
    isIso(value.requestedAt) &&
    isIso(value.maximumExpiresAt) &&
    (value.maximumExpiresAt <= value.requestedAt ||
      new Date(value.maximumExpiresAt).getTime() - new Date(value.requestedAt).getTime() >
        npShopReturnPostageLimits.maximumQuoteLifetimeSeconds * 1_000)
  ) {
    issues.push("return postage quote request maximum expiry is invalid.");
  }
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage quote request", issues);
  }
  return value as unknown as NpShopReturnPostageQuoteRequest;
}

export function npRequireShopQuotedReturnLogisticsRequest(
  value: unknown,
): NpShopQuotedReturnLogisticsRequest {
  if (!isRecord(value)) {
    throw new NpShopReturnPostageContractError("Invalid quoted return logistics request", [
      "quoted return logistics request must be a plain object.",
    ]);
  }
  const { postageMethod, ...base } = value;
  const issues = npAnalyzeShopReturnLogisticsRequest({
    ...base,
    contract: NP_SHOP_RETURN_LOGISTICS_REQUEST_CONTRACT,
  }).map((issue) => issue.replace("return logistics request", "quoted return logistics request"));
  if (value.contract !== NP_SHOP_QUOTED_RETURN_LOGISTICS_REQUEST_CONTRACT) {
    issues.push("quoted return logistics request.contract is invalid.");
  }
  issues.push(
    ...npAnalyzeShopReturnPostageMethod(postageMethod).map((issue) =>
      issue.replace("return postage method", "quoted return logistics request.postageMethod"),
    ),
  );
  if (
    isRecord(postageMethod) &&
    isIso(postageMethod.quotedAt) &&
    isIso(postageMethod.quoteExpiresAt) &&
    isIso(base.requestedAt) &&
    (postageMethod.quotedAt > base.requestedAt || postageMethod.quoteExpiresAt <= base.requestedAt)
  ) {
    issues.push("quoted return logistics request.postageMethod must be live at creation.");
  }
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid quoted return logistics request", issues);
  }
  return value as unknown as NpShopQuotedReturnLogisticsRequest;
}

export function npAnalyzeStoredShopReturnPostagePrivate(value: unknown): string[] {
  if (!isRecord(value)) return ["private return postage must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "quoteId",
      "returnId",
      "orderId",
      "ownerSegment",
      "origin",
      "createdAt",
      "expiresAt",
    ],
    "private return postage",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_PRIVATE_CONTRACT) {
    issues.push("private return postage.contract is invalid.");
  }
  for (const key of ["quoteId", "returnId", "orderId"] as const) {
    if (!isUuid(value[key])) issues.push(`private return postage.${key} is invalid.`);
  }
  if (!isOwnerSegment(value.ownerSegment))
    issues.push("private return postage.ownerSegment is invalid.");
  analyzeShipping(value.origin, "private return postage.origin", issues);
  if (!isIso(value.createdAt)) issues.push("private return postage.createdAt is invalid.");
  if (!isIso(value.expiresAt)) issues.push("private return postage.expiresAt is invalid.");
  if (isIso(value.createdAt) && isIso(value.expiresAt)) {
    const lifetime = new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime();
    if (lifetime <= 0 || lifetime > npShopReturnPostageLimits.privateTtlSeconds * 1_000) {
      issues.push("private return postage lifetime is invalid.");
    }
  }
  return issues;
}

export function npRequireStoredShopReturnPostagePrivate(
  value: unknown,
): NpShopStoredReturnPostagePrivate {
  const issues = npAnalyzeStoredShopReturnPostagePrivate(value);
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid private return postage", issues);
  }
  return value as NpShopStoredReturnPostagePrivate;
}

export function npAnalyzeShopReturnPostageHealth(value: unknown): string[] {
  if (!isRecord(value)) return ["return postage health must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "providerId", "status", "errorCode", "attemptedAt", "succeededAt"],
    "return postage health",
    issues,
  );
  if (value.contract !== NP_SHOP_RETURN_POSTAGE_HEALTH_CONTRACT) {
    issues.push("return postage health.contract is invalid.");
  }
  if (
    !isText(value.providerId, npShopReturnPostageLimits.providerIdLength) ||
    !providerPattern.test(value.providerId)
  ) {
    issues.push("return postage health.providerId is invalid.");
  }
  if (value.status !== "ok" && value.status !== "error") {
    issues.push("return postage health.status is invalid.");
  }
  if (
    value.errorCode !== null &&
    value.errorCode !== "provider-error" &&
    value.errorCode !== "invalid-result"
  ) {
    issues.push("return postage health.errorCode is invalid.");
  }
  if (!isIso(value.attemptedAt)) issues.push("return postage health.attemptedAt is invalid.");
  if (value.succeededAt !== null && !isIso(value.succeededAt)) {
    issues.push("return postage health.succeededAt is invalid.");
  }
  if (
    value.status === "ok" &&
    (value.errorCode !== null || value.succeededAt !== value.attemptedAt)
  ) {
    issues.push("successful return postage health requires the current success timestamp.");
  }
  if (value.status === "error" && value.errorCode === null) {
    issues.push("failed return postage health requires a closed error code.");
  }
  return issues;
}

export function npRequireShopReturnPostageHealth(value: unknown): NpShopReturnPostageHealth {
  const issues = npAnalyzeShopReturnPostageHealth(value);
  if (issues.length > 0) {
    throw new NpShopReturnPostageContractError("Invalid return postage health", issues);
  }
  return value as NpShopReturnPostageHealth;
}
