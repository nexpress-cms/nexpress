import type { NpShopOrderDraftShipping } from "./types.js";

export const NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT =
  "np.shop-exchange-destination-private.v1" as const;
export const NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT =
  "np.shop-exchange-destination-authority.v1" as const;

export const npShopExchangeDestinationLimits = Object.freeze({
  authorityTtlSeconds: 15 * 60,
  privateRetentionSeconds: 24 * 60 * 60,
  authorityTokenLength: 2_048,
  recipientNameLength: 120,
  phoneLength: 40,
  postalCodeLength: 32,
  addressLength: 200,
  localityLength: 120,
});

export interface NpShopStoredExchangeDestinationPrivate {
  contract: typeof NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT;
  orderId: string;
  exchangeId: string;
  ownerSegment: string;
  exchangeRevision: number;
  destinationRevision: number;
  destination: NpShopOrderDraftShipping;
  submittedAt: string;
  accessedAt: string | null;
  updatedAt: string;
  expiresAt: string;
}

export interface NpShopExchangeDestinationAuthority {
  contract: typeof NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT;
  orderId: string;
  exchangeId: string;
  orderRevision: number;
  exchangeRevision: number;
  destinationRevision: number;
  token: string;
  issuedAt: string;
  expiresAt: string;
}

export interface NpShopExchangeDestinationSubmitInput {
  orderId: string;
  exchangeId: string;
  orderRevision: number;
  exchangeRevision: number;
  destinationRevision: number;
  authorityToken: string;
  destination: NpShopOrderDraftShipping;
}

export interface NpShopExchangeDestinationReadInput {
  orderId: string;
  exchangeId: string;
  orderRevision: number;
  exchangeRevision: number;
  destinationRevision: number;
}

export class NpShopExchangeDestinationContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopExchangeDestinationContractError";
    this.issues = issues;
  }
}

export class NpShopExchangeDestinationConflictError extends Error {
  readonly code:
    | "exchange_destination_not_found"
    | "exchange_destination_authority_invalid"
    | "exchange_destination_revision_conflict"
    | "exchange_destination_unavailable"
    | "exchange_destination_expired"
    | "exchange_destination_already_submitted"
    | "exchange_destination_access_required";

  constructor(code: NpShopExchangeDestinationConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopExchangeDestinationConflictError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const guestOwnerPattern = /^guest:[0-9a-f]{64}$/u;
const countryCodePattern = /^[A-Z]{2}$/u;
const phonePattern = /^[0-9+(). -]+$/u;

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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isOwner(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (guestOwnerPattern.test(value) ||
      (value.startsWith("member:") && isUuid(value.slice("member:".length))))
  );
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
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
  if (!isText(value.recipientName, npShopExchangeDestinationLimits.recipientNameLength)) {
    issues.push(`${path}.recipientName is invalid.`);
  }
  if (
    !isText(value.phone, npShopExchangeDestinationLimits.phoneLength) ||
    !phonePattern.test(value.phone)
  ) {
    issues.push(`${path}.phone is invalid.`);
  }
  if (typeof value.countryCode !== "string" || !countryCodePattern.test(value.countryCode)) {
    issues.push(`${path}.countryCode is invalid.`);
  }
  if (!isText(value.postalCode, npShopExchangeDestinationLimits.postalCodeLength)) {
    issues.push(`${path}.postalCode is invalid.`);
  }
  if (!isText(value.addressLine1, npShopExchangeDestinationLimits.addressLength)) {
    issues.push(`${path}.addressLine1 is invalid.`);
  }
  if (
    value.addressLine2 !== null &&
    !isText(value.addressLine2, npShopExchangeDestinationLimits.addressLength)
  ) {
    issues.push(`${path}.addressLine2 is invalid.`);
  }
  if (!isText(value.locality, npShopExchangeDestinationLimits.localityLength)) {
    issues.push(`${path}.locality is invalid.`);
  }
  if (
    value.administrativeArea !== null &&
    !isText(value.administrativeArea, npShopExchangeDestinationLimits.localityLength)
  ) {
    issues.push(`${path}.administrativeArea is invalid.`);
  }
}

function normalizeText(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeNullableText(value: unknown): unknown {
  if (value === null) return null;
  const normalized = normalizeText(value);
  return normalized === "" ? null : normalized;
}

function requireDestination(value: unknown): NpShopOrderDraftShipping {
  if (!isRecord(value)) {
    throw new NpShopExchangeDestinationContractError("Invalid exchange destination", [
      "destination must be a plain object.",
    ]);
  }
  const normalized = {
    recipientName: normalizeText(value.recipientName),
    phone: normalizeText(value.phone),
    countryCode:
      typeof value.countryCode === "string"
        ? value.countryCode.trim().toUpperCase()
        : value.countryCode,
    postalCode: normalizeText(value.postalCode),
    addressLine1: normalizeText(value.addressLine1),
    addressLine2: normalizeNullableText(value.addressLine2),
    locality: normalizeText(value.locality),
    administrativeArea: normalizeNullableText(value.administrativeArea),
  };
  const issues: string[] = [];
  analyzeDestination(normalized, "destination", issues);
  if (issues.length) {
    throw new NpShopExchangeDestinationContractError("Invalid exchange destination", issues);
  }
  return normalized as NpShopOrderDraftShipping;
}

const privateKeys = [
  "contract",
  "orderId",
  "exchangeId",
  "ownerSegment",
  "exchangeRevision",
  "destinationRevision",
  "destination",
  "submittedAt",
  "accessedAt",
  "updatedAt",
  "expiresAt",
] as const;

export function npAnalyzeStoredShopExchangeDestinationPrivate(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange destination must be a plain object."];
  const issues: string[] = [];
  exactKeys(value, privateKeys, "exchange destination", issues);
  if (value.contract !== NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT) {
    issues.push(
      `exchange destination.contract must equal "${NP_SHOP_EXCHANGE_DESTINATION_PRIVATE_CONTRACT}".`,
    );
  }
  for (const key of ["orderId", "exchangeId"] as const) {
    if (!isUuid(value[key])) issues.push(`exchange destination.${key} is invalid.`);
  }
  if (!isOwner(value.ownerSegment)) issues.push("exchange destination.ownerSegment is invalid.");
  for (const key of ["exchangeRevision", "destinationRevision"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`exchange destination.${key} is invalid.`);
    }
  }
  analyzeDestination(value.destination, "exchange destination.destination", issues);
  for (const key of ["submittedAt", "updatedAt", "expiresAt"] as const) {
    if (!isIso(value[key])) issues.push(`exchange destination.${key} is invalid.`);
  }
  if (value.accessedAt !== null && !isIso(value.accessedAt)) {
    issues.push("exchange destination.accessedAt is invalid.");
  }
  if (isIso(value.submittedAt) && isIso(value.updatedAt) && value.updatedAt < value.submittedAt) {
    issues.push("exchange destination.updatedAt cannot precede submittedAt.");
  }
  if (
    isIso(value.submittedAt) &&
    isIso(value.expiresAt) &&
    (value.expiresAt <= value.submittedAt ||
      new Date(value.expiresAt).getTime() - new Date(value.submittedAt).getTime() >
        npShopExchangeDestinationLimits.privateRetentionSeconds * 1_000)
  ) {
    issues.push("exchange destination must expire within 24 hours of submission.");
  }
  if (isIso(value.updatedAt) && isIso(value.expiresAt) && value.updatedAt > value.expiresAt) {
    issues.push("exchange destination.updatedAt cannot follow expiresAt.");
  }
  if (
    isIso(value.accessedAt) &&
    isIso(value.submittedAt) &&
    isIso(value.updatedAt) &&
    (value.accessedAt < value.submittedAt || value.accessedAt > value.updatedAt)
  ) {
    issues.push("exchange destination.accessedAt is outside its retained interval.");
  }
  return issues;
}

export function npRequireStoredShopExchangeDestinationPrivate(
  value: unknown,
): NpShopStoredExchangeDestinationPrivate {
  const issues = npAnalyzeStoredShopExchangeDestinationPrivate(value);
  if (issues.length) {
    throw new NpShopExchangeDestinationContractError("Invalid stored exchange destination", issues);
  }
  return value as NpShopStoredExchangeDestinationPrivate;
}

export function npAnalyzeShopExchangeDestinationAuthority(value: unknown): string[] {
  if (!isRecord(value)) return ["exchange destination authority must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "orderId",
      "exchangeId",
      "orderRevision",
      "exchangeRevision",
      "destinationRevision",
      "token",
      "issuedAt",
      "expiresAt",
    ],
    "exchange destination authority",
    issues,
  );
  if (value.contract !== NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT) {
    issues.push(
      `exchange destination authority.contract must equal "${NP_SHOP_EXCHANGE_DESTINATION_AUTHORITY_CONTRACT}".`,
    );
  }
  for (const key of ["orderId", "exchangeId"] as const) {
    if (!isUuid(value[key])) issues.push(`exchange destination authority.${key} is invalid.`);
  }
  for (const key of ["orderRevision", "exchangeRevision"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`exchange destination authority.${key} is invalid.`);
    }
  }
  if (
    !Number.isSafeInteger(value.destinationRevision) ||
    (value.destinationRevision as number) < 0
  ) {
    issues.push("exchange destination authority.destinationRevision is invalid.");
  }
  if (
    !isText(value.token, npShopExchangeDestinationLimits.authorityTokenLength) ||
    !/^[A-Za-z0-9_.-]+$/u.test(value.token)
  ) {
    issues.push("exchange destination authority.token is invalid.");
  }
  for (const key of ["issuedAt", "expiresAt"] as const) {
    if (!isIso(value[key])) issues.push(`exchange destination authority.${key} is invalid.`);
  }
  if (
    isIso(value.issuedAt) &&
    isIso(value.expiresAt) &&
    (value.expiresAt <= value.issuedAt ||
      new Date(value.expiresAt).getTime() - new Date(value.issuedAt).getTime() >
        npShopExchangeDestinationLimits.authorityTtlSeconds * 1_000)
  ) {
    issues.push("exchange destination authority exceeds its 15-minute lifetime.");
  }
  return issues;
}

export function npRequireShopExchangeDestinationAuthority(
  value: unknown,
): NpShopExchangeDestinationAuthority {
  const issues = npAnalyzeShopExchangeDestinationAuthority(value);
  if (issues.length) {
    throw new NpShopExchangeDestinationContractError(
      "Invalid exchange destination authority",
      issues,
    );
  }
  return value as NpShopExchangeDestinationAuthority;
}

export function npRequireShopExchangeDestinationSubmitInput(
  value: unknown,
): NpShopExchangeDestinationSubmitInput {
  if (!isRecord(value)) {
    throw new NpShopExchangeDestinationContractError("Invalid exchange destination request", [
      "request must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "orderId",
      "exchangeId",
      "orderRevision",
      "exchangeRevision",
      "destinationRevision",
      "authorityToken",
      "destination",
    ],
    "exchange destination request",
    issues,
  );
  for (const key of ["orderId", "exchangeId"] as const) {
    if (!isUuid(value[key])) issues.push(`exchange destination request.${key} is invalid.`);
  }
  for (const key of ["orderRevision", "exchangeRevision"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) {
      issues.push(`exchange destination request.${key} is invalid.`);
    }
  }
  if (
    !Number.isSafeInteger(value.destinationRevision) ||
    (value.destinationRevision as number) < 0
  ) {
    issues.push("exchange destination request.destinationRevision is invalid.");
  }
  if (
    !isText(value.authorityToken, npShopExchangeDestinationLimits.authorityTokenLength) ||
    !/^[A-Za-z0-9_.-]+$/u.test(value.authorityToken)
  ) {
    issues.push("exchange destination request.authorityToken is invalid.");
  }
  if (issues.length) {
    throw new NpShopExchangeDestinationContractError(
      "Invalid exchange destination request",
      issues,
    );
  }
  return {
    orderId: value.orderId as string,
    exchangeId: value.exchangeId as string,
    orderRevision: value.orderRevision as number,
    exchangeRevision: value.exchangeRevision as number,
    destinationRevision: value.destinationRevision as number,
    authorityToken: value.authorityToken as string,
    destination: requireDestination(value.destination),
  };
}

export function npRequireShopExchangeDestinationReadInput(
  value: unknown,
): NpShopExchangeDestinationReadInput {
  if (!isRecord(value) || !isRecord(value.row) || !isRecord(value.values)) {
    throw new NpShopExchangeDestinationContractError("Invalid exchange destination action", [
      "payload, row, and values must be plain objects.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  exactKeys(
    value.row,
    ["id", "exchangeId", "orderRevision", "exchangeRevision", "destinationRevision"],
    "payload.row",
    issues,
  );
  exactKeys(value.values, [], "payload.values", issues);
  for (const key of ["id", "exchangeId"] as const) {
    if (!isUuid(value.row[key])) issues.push(`payload.row.${key} is invalid.`);
  }
  for (const key of ["orderRevision", "exchangeRevision", "destinationRevision"] as const) {
    if (!Number.isSafeInteger(value.row[key]) || (value.row[key] as number) < 1) {
      issues.push(`payload.row.${key} is invalid.`);
    }
  }
  if (issues.length) {
    throw new NpShopExchangeDestinationContractError("Invalid exchange destination action", issues);
  }
  return {
    orderId: value.row.id as string,
    exchangeId: value.row.exchangeId as string,
    orderRevision: value.row.orderRevision as number,
    exchangeRevision: value.row.exchangeRevision as number,
    destinationRevision: value.row.destinationRevision as number,
  };
}
