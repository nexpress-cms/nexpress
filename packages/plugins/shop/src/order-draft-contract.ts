import { npAnalyzeShopCheckoutIntent } from "./checkout-contract.js";
import {
  npAnalyzeShopDeliveryMethod,
  npAnalyzeShopShippingQuote,
  type NpShopShippingMethodSelectInput,
} from "./shipping-contract.js";
import {
  npShopOrderDraftStatuses,
  type NpShopOrderDraft,
  type NpShopOrderDraftCustomer,
  type NpShopOrderDraftShipping,
  type NpShopOrderDraftStatus,
} from "./types.js";

export const NP_SHOP_ORDER_DRAFT_CONTRACT = "np.shop-order-draft.v1" as const;

export const npShopOrderDraftLimits = {
  ttlSeconds: 60 * 60 * 24,
  cleanupBatchSize: 500,
  maximumActivePerOwner: 3,
  fullNameLength: 120,
  emailLength: 254,
  phoneLength: 32,
  addressLength: 200,
  localityLength: 100,
  postalCodeLength: 20,
} as const;

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const phonePattern = /^\+?[0-9 ()-]{7,32}$/u;
const countryCodePattern = /^[A-Z]{2}$/u;
const draftKeys = [
  "contract",
  "id",
  "status",
  "revision",
  "checkoutIntentId",
  "cartRevision",
  "cartFingerprint",
  "currency",
  "subtotalMinor",
  "shippingMinor",
  "totalMinor",
  "totalUnits",
  "lines",
  "customer",
  "shipping",
  "shippingQuote",
  "deliveryMethod",
  "sourceCreatedAt",
  "sourceExpiresAt",
  "createdAt",
  "updatedAt",
  "expiresAt",
] as const;
const customerKeys = ["fullName", "email", "phone"] as const;
const shippingKeys = [
  "recipientName",
  "phone",
  "countryCode",
  "postalCode",
  "addressLine1",
  "addressLine2",
  "locality",
  "administrativeArea",
] as const;

export interface NpShopOrderDraftCreateInput {
  idempotencyKey: string;
  checkoutIntentId: string;
}

export interface NpShopOrderDraftUpdateInput {
  draftId: string;
  expectedRevision: number;
  customer: NpShopOrderDraftCustomer;
  shipping: NpShopOrderDraftShipping;
}

export interface NpShopOrderDraftDeleteInput {
  draftId: string;
}

export class NpShopOrderDraftContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopOrderDraftContractError";
    this.issues = issues;
  }
}

export class NpShopOrderDraftConflictError extends Error {
  readonly code:
    | "order_draft_revision_conflict"
    | "order_draft_idempotency_conflict"
    | "order_draft_source_stale";

  constructor(
    code:
      | "order_draft_revision_conflict"
      | "order_draft_idempotency_conflict"
      | "order_draft_source_stale",
    message: string,
  ) {
    super(message);
    this.name = "NpShopOrderDraftConflictError";
    this.code = code;
  }
}

export class NpShopOrderDraftNotFoundError extends Error {
  constructor() {
    super("The order draft does not exist for this browser identity.");
    this.name = "NpShopOrderDraftNotFoundError";
  }
}

export class NpShopOrderDraftExpiredError extends Error {
  constructor() {
    super("The order draft expired and its private data was deleted.");
    this.name = "NpShopOrderDraftExpiredError";
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

function analyzeCustomer(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, customerKeys, path, issues);
  if (!isBoundedText(value.fullName, npShopOrderDraftLimits.fullNameLength)) {
    issues.push(`${path}.fullName is invalid.`);
  }
  if (
    !isBoundedText(value.email, npShopOrderDraftLimits.emailLength) ||
    !emailPattern.test(value.email) ||
    value.email !== value.email.toLowerCase()
  ) {
    issues.push(`${path}.email is invalid.`);
  }
  if (
    !isBoundedText(value.phone, npShopOrderDraftLimits.phoneLength) ||
    !phonePattern.test(value.phone)
  ) {
    issues.push(`${path}.phone is invalid.`);
  }
}

function analyzeShipping(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, shippingKeys, path, issues);
  if (!isBoundedText(value.recipientName, npShopOrderDraftLimits.fullNameLength)) {
    issues.push(`${path}.recipientName is invalid.`);
  }
  if (
    !isBoundedText(value.phone, npShopOrderDraftLimits.phoneLength) ||
    !phonePattern.test(value.phone)
  ) {
    issues.push(`${path}.phone is invalid.`);
  }
  if (typeof value.countryCode !== "string" || !countryCodePattern.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isBoundedText(value.postalCode, npShopOrderDraftLimits.postalCodeLength)) {
    issues.push(`${path}.postalCode is invalid.`);
  }
  if (!isBoundedText(value.addressLine1, npShopOrderDraftLimits.addressLength)) {
    issues.push(`${path}.addressLine1 is invalid.`);
  }
  if (
    value.addressLine2 !== null &&
    !isBoundedText(value.addressLine2, npShopOrderDraftLimits.addressLength)
  ) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isBoundedText(value.locality, npShopOrderDraftLimits.localityLength)) {
    issues.push(`${path}.locality is invalid.`);
  }
  if (
    value.administrativeArea !== null &&
    !isBoundedText(value.administrativeArea, npShopOrderDraftLimits.localityLength)
  ) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

export function npIsShopOrderDraftStatus(value: unknown): value is NpShopOrderDraftStatus {
  return (npShopOrderDraftStatuses as readonly unknown[]).includes(value);
}

export function npAnalyzeShopOrderDraft(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["draft must be a plain object."];
  exactKeys(value, draftKeys, "draft", issues);
  if (value.contract !== NP_SHOP_ORDER_DRAFT_CONTRACT) {
    issues.push(`draft.contract must equal "${NP_SHOP_ORDER_DRAFT_CONTRACT}".`);
  }
  if (!isCanonicalUuid(value.id)) issues.push("draft.id must be a canonical UUID.");
  if (!npIsShopOrderDraftStatus(value.status)) issues.push("draft.status is invalid.");
  if (!isPositiveSafeInteger(value.revision)) {
    issues.push("draft.revision must be a positive safe integer.");
  }
  if (!isCanonicalUuid(value.checkoutIntentId)) {
    issues.push("draft.checkoutIntentId must be a canonical UUID.");
  }
  if (!isPositiveSafeInteger(value.cartRevision)) {
    issues.push("draft.cartRevision must be a positive safe integer.");
  }
  if (typeof value.cartFingerprint !== "string" || !digestPattern.test(value.cartFingerprint)) {
    issues.push("draft.cartFingerprint must be a lowercase SHA-256 digest.");
  }
  for (const [key, path] of [
    ["sourceCreatedAt", "draft.sourceCreatedAt"],
    ["sourceExpiresAt", "draft.sourceExpiresAt"],
    ["createdAt", "draft.createdAt"],
    ["updatedAt", "draft.updatedAt"],
    ["expiresAt", "draft.expiresAt"],
  ] as const) {
    if (!isCanonicalIso(value[key])) issues.push(`${path} must be canonical UTC ISO.`);
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.expiresAt) &&
    new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime() !==
      npShopOrderDraftLimits.ttlSeconds * 1_000
  ) {
    issues.push(
      `draft.expiresAt must be exactly ${npShopOrderDraftLimits.ttlSeconds.toString()} seconds after draft.createdAt.`,
    );
  }
  if (
    isCanonicalIso(value.createdAt) &&
    isCanonicalIso(value.updatedAt) &&
    isCanonicalIso(value.expiresAt) &&
    (value.updatedAt < value.createdAt || value.updatedAt >= value.expiresAt)
  ) {
    issues.push("draft.updatedAt must fall within the draft lifetime.");
  }
  if (
    isCanonicalIso(value.sourceCreatedAt) &&
    isCanonicalIso(value.createdAt) &&
    value.createdAt < value.sourceCreatedAt
  ) {
    issues.push("draft.createdAt must not precede source checkout creation.");
  }
  if (
    isCanonicalIso(value.sourceExpiresAt) &&
    isCanonicalIso(value.createdAt) &&
    value.createdAt >= value.sourceExpiresAt
  ) {
    issues.push("draft.createdAt must precede source checkout expiry.");
  }

  const checkoutIssues = npAnalyzeShopCheckoutIntent({
    contract: "np.shop-checkout-intent.v1",
    id: value.checkoutIntentId,
    status: "open",
    cartRevision: value.cartRevision,
    cartFingerprint: value.cartFingerprint,
    currency: value.currency,
    subtotalMinor: value.subtotalMinor,
    totalUnits: value.totalUnits,
    lines: value.lines,
    createdAt: value.sourceCreatedAt,
    expiresAt: value.sourceExpiresAt,
    cancelledAt: null,
  });
  issues.push(
    ...checkoutIssues.map((issue) =>
      issue.replace(/^intent\./u, "draft.").replace(/^intent /u, "draft "),
    ),
  );

  if (!Number.isSafeInteger(value.shippingMinor) || (value.shippingMinor as number) < 0) {
    issues.push("draft.shippingMinor is invalid.");
  }
  if (!Number.isSafeInteger(value.totalMinor) || (value.totalMinor as number) < 0) {
    issues.push("draft.totalMinor is invalid.");
  }
  if (
    Number.isSafeInteger(value.subtotalMinor) &&
    Number.isSafeInteger(value.shippingMinor) &&
    Number.isSafeInteger(value.totalMinor) &&
    (value.subtotalMinor as number) + (value.shippingMinor as number) !== value.totalMinor
  ) {
    issues.push("draft.totalMinor must equal subtotalMinor plus shippingMinor.");
  }

  if (value.customer !== null) analyzeCustomer(value.customer, "draft.customer", issues);
  if (value.shipping !== null) analyzeShipping(value.shipping, "draft.shipping", issues);
  if (value.shippingQuote !== null) {
    issues.push(
      ...npAnalyzeShopShippingQuote(value.shippingQuote).map(
        (issue) => `draft.${issue.replace(/^shipping quote/u, "shippingQuote")}`,
      ),
    );
  }
  if (value.deliveryMethod !== null) {
    issues.push(
      ...npAnalyzeShopDeliveryMethod(value.deliveryMethod).map(
        (issue) => `draft.${issue.replace(/^delivery method/u, "deliveryMethod")}`,
      ),
    );
  }
  if ((value.customer === null) !== (value.shipping === null)) {
    issues.push("draft.customer and draft.shipping must both be null or both be present.");
  }
  if (
    value.status === "collecting" &&
    (value.customer !== null ||
      value.shipping !== null ||
      value.shippingQuote !== null ||
      value.deliveryMethod !== null)
  ) {
    issues.push("draft.collecting state must not contain customer, shipping, or quote data.");
  }
  if (
    value.status === "shipping-selection-required" &&
    (value.customer === null ||
      value.shipping === null ||
      value.shippingQuote === null ||
      value.deliveryMethod !== null)
  ) {
    issues.push(
      "draft.shipping-selection-required state requires private data and one unselected quote.",
    );
  }
  if (value.status === "reviewable" && (value.customer === null || value.shipping === null)) {
    issues.push("draft.reviewable state requires customer and shipping data.");
  }
  if (
    value.status === "reviewable" &&
    (value.shippingQuote === null) !== (value.deliveryMethod === null)
  ) {
    issues.push("draft.reviewable state requires a selected method for its shipping quote.");
  }
  if (isRecord(value.shippingQuote) && isRecord(value.deliveryMethod)) {
    const selectedMethodId = value.deliveryMethod.methodId;
    const selected = Array.isArray(value.shippingQuote.methods)
      ? value.shippingQuote.methods.find(
          (method) => isRecord(method) && method.id === selectedMethodId,
        )
      : undefined;
    if (
      !isRecord(selected) ||
      value.deliveryMethod.providerId !== value.shippingQuote.providerId ||
      value.deliveryMethod.quoteId !== value.shippingQuote.quoteId ||
      value.deliveryMethod.label !== selected.label ||
      value.deliveryMethod.amountMinor !== selected.amountMinor ||
      JSON.stringify(value.deliveryMethod.estimatedDelivery) !==
        JSON.stringify(selected.estimatedDelivery) ||
      value.deliveryMethod.quotedAt !== value.shippingQuote.quotedAt ||
      value.deliveryMethod.quoteExpiresAt !== value.shippingQuote.expiresAt
    ) {
      issues.push("draft.deliveryMethod must exactly snapshot one quoted shipping method.");
    }
  }
  if (
    isRecord(value.deliveryMethod) &&
    Number.isSafeInteger(value.shippingMinor) &&
    value.deliveryMethod.amountMinor !== value.shippingMinor
  ) {
    issues.push("draft.shippingMinor must equal the selected delivery method amount.");
  }
  if (value.deliveryMethod === null && value.shippingMinor !== 0) {
    issues.push("draft without a delivery method must have zero shippingMinor.");
  }
  if (
    isRecord(value.shippingQuote) &&
    isCanonicalIso(value.shippingQuote.expiresAt) &&
    isCanonicalIso(value.expiresAt) &&
    value.shippingQuote.expiresAt > value.expiresAt
  ) {
    issues.push("draft shipping quote must not outlive the private draft.");
  }
  return issues;
}

export function npRequireShopOrderDraft(value: unknown): NpShopOrderDraft {
  const issues = npAnalyzeShopOrderDraft(value);
  if (issues.length > 0) {
    throw new NpShopOrderDraftContractError("Invalid Shop order draft", issues);
  }
  return value as NpShopOrderDraft;
}

function requireInput(
  value: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new NpShopOrderDraftContractError(`Invalid ${context}`, [
      `${context} must be a plain object.`,
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, keys, context, issues);
  if (issues.length > 0) throw new NpShopOrderDraftContractError(`Invalid ${context}`, issues);
  return value;
}

function normalizeText(value: unknown): unknown {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : value;
}

function normalizeNullableText(value: unknown): unknown {
  if (value === null) return null;
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function requireCustomer(value: unknown, context: string): NpShopOrderDraftCustomer {
  const input = requireInput(value, customerKeys, context);
  const normalized = {
    fullName: normalizeText(input.fullName),
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : input.email,
    phone: normalizeText(input.phone),
  };
  const issues: string[] = [];
  analyzeCustomer(normalized, context, issues);
  if (issues.length > 0) throw new NpShopOrderDraftContractError(`Invalid ${context}`, issues);
  return normalized as NpShopOrderDraftCustomer;
}

function requireShipping(value: unknown, context: string): NpShopOrderDraftShipping {
  const input = requireInput(value, shippingKeys, context);
  const normalized = {
    recipientName: normalizeText(input.recipientName),
    phone: normalizeText(input.phone),
    countryCode:
      typeof input.countryCode === "string"
        ? input.countryCode.trim().toUpperCase()
        : input.countryCode,
    postalCode: normalizeText(input.postalCode),
    addressLine1: normalizeText(input.addressLine1),
    addressLine2: normalizeNullableText(input.addressLine2),
    locality: normalizeText(input.locality),
    administrativeArea: normalizeNullableText(input.administrativeArea),
  };
  const issues: string[] = [];
  analyzeShipping(normalized, context, issues);
  if (issues.length > 0) throw new NpShopOrderDraftContractError(`Invalid ${context}`, issues);
  return normalized as NpShopOrderDraftShipping;
}

export function npRequireShopOrderDraftCreateInput(value: unknown): NpShopOrderDraftCreateInput {
  const input = requireInput(
    value,
    ["idempotencyKey", "checkoutIntentId"],
    "order draft create request",
  );
  const issues: string[] = [];
  if (!isCanonicalUuid(input.idempotencyKey)) {
    issues.push("order draft create request.idempotencyKey must be a canonical UUID.");
  }
  if (!isCanonicalUuid(input.checkoutIntentId)) {
    issues.push("order draft create request.checkoutIntentId must be a canonical UUID.");
  }
  if (issues.length > 0) {
    throw new NpShopOrderDraftContractError("Invalid order draft create request", issues);
  }
  return input as unknown as NpShopOrderDraftCreateInput;
}

export function npRequireShopOrderDraftUpdateInput(value: unknown): NpShopOrderDraftUpdateInput {
  const input = requireInput(
    value,
    ["draftId", "expectedRevision", "customer", "shipping"],
    "order draft update request",
  );
  const issues: string[] = [];
  if (!isCanonicalUuid(input.draftId)) {
    issues.push("order draft update request.draftId must be a canonical UUID.");
  }
  if (!isPositiveSafeInteger(input.expectedRevision)) {
    issues.push("order draft update request.expectedRevision must be a positive safe integer.");
  }
  if (issues.length > 0) {
    throw new NpShopOrderDraftContractError("Invalid order draft update request", issues);
  }
  if (!isCanonicalUuid(input.draftId) || !isPositiveSafeInteger(input.expectedRevision)) {
    throw new NpShopOrderDraftContractError("Invalid order draft update request", [
      "order draft update request identifiers are invalid.",
    ]);
  }
  return {
    draftId: input.draftId,
    expectedRevision: input.expectedRevision,
    customer: requireCustomer(input.customer, "order draft update request.customer"),
    shipping: requireShipping(input.shipping, "order draft update request.shipping"),
  };
}

export type { NpShopShippingMethodSelectInput };

export function npRequireShopOrderDraftDeleteInput(value: unknown): NpShopOrderDraftDeleteInput {
  const input = requireInput(value, ["draftId"], "order draft delete request");
  if (!isCanonicalUuid(input.draftId)) {
    throw new NpShopOrderDraftContractError("Invalid order draft delete request", [
      "order draft delete request.draftId must be a canonical UUID.",
    ]);
  }
  return { draftId: input.draftId };
}

export function npRequireShopOrderDraftId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    throw new NpShopOrderDraftContractError("Invalid order draft id", [
      "Order draft id must be a canonical UUID.",
    ]);
  }
  return value;
}

export function npRequireShopOrderDraftReadQuery(value: unknown): string {
  const query = requireInput(value, ["id"], "order draft read query");
  return npRequireShopOrderDraftId(query.id);
}
