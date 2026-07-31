import type { ReactNode } from "react";

import { npShopCurrencies, type NpShopCurrency } from "./types.js";

export const NP_SHOP_PAYMENT_ATTEMPT_CONTRACT = "np.shop-payment-attempt.v1" as const;
export const NP_SHOP_PAYMENT_HANDOFF_CONTRACT = "np.shop-payment-handoff.v1" as const;

export const npShopPaymentAttemptStoredStatuses = ["prepared", "confirmed"] as const;
export type NpShopPaymentAttemptStoredStatus = (typeof npShopPaymentAttemptStoredStatuses)[number];
export type NpShopPaymentAttemptStatus = NpShopPaymentAttemptStoredStatus | "expired";

export const npShopPaymentHandoffKinds = ["client", "redirect"] as const;
export type NpShopPaymentHandoffKind = (typeof npShopPaymentHandoffKinds)[number];

export const npShopPaymentAttemptLimits = Object.freeze({
  ttlSeconds: 15 * 60,
  maximumActivePerOrder: 5,
  maximumRetainedPerOrder: 100,
  orderNameLength: 100,
  redirectUrlLength: 2_048,
  publicDataBytes: 16 * 1_024,
  publicDataDepth: 5,
  publicDataKeys: 64,
  publicDataArrayItems: 64,
  publicDataStringLength: 2_048,
  confirmationBytes: 8 * 1_024,
  adminListSize: 50,
  diagnosticSampleSize: 500,
});

export type NpShopPaymentJson =
  null | boolean | number | string | NpShopPaymentJson[] | { [key: string]: NpShopPaymentJson };

export interface NpShopPaymentAttemptCreateInput {
  idempotencyKey: string;
  orderId: string;
}

export interface NpShopPaymentAttemptConfirmInput {
  attemptId: string;
  orderId: string;
  confirmation: { [key: string]: NpShopPaymentJson };
}

export type NpShopPaymentHandoff =
  | {
      contract: typeof NP_SHOP_PAYMENT_HANDOFF_CONTRACT;
      providerId: string;
      attemptId: string;
      kind: "client";
      expiresAt: string;
      data: { [key: string]: NpShopPaymentJson };
    }
  | {
      contract: typeof NP_SHOP_PAYMENT_HANDOFF_CONTRACT;
      providerId: string;
      attemptId: string;
      kind: "redirect";
      expiresAt: string;
      url: string;
    };

export interface NpShopStoredPaymentAttempt {
  contract: typeof NP_SHOP_PAYMENT_ATTEMPT_CONTRACT;
  id: string;
  orderId: string;
  providerId: string;
  status: NpShopPaymentAttemptStoredStatus;
  orderRevision: number;
  currency: NpShopCurrency;
  amountMinor: number;
  orderName: string;
  handoff: NpShopPaymentHandoff;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  paymentReference: string | null;
  eventId: string | null;
  purgeAt: string;
}

export interface NpShopPaymentAttempt extends Omit<
  NpShopStoredPaymentAttempt,
  "status" | "orderName"
> {
  status: NpShopPaymentAttemptStatus;
}

export interface NpShopPaymentPrepareInput {
  attemptId: string;
  orderId: string;
  orderName: string;
  currency: NpShopCurrency;
  amountMinor: number;
  expiresAt: string;
  successPath: string;
  failPath: string;
}

export type NpShopPaymentPrepareResult =
  | { kind: "client"; data: { [key: string]: NpShopPaymentJson } }
  | { kind: "redirect"; url: string };

export interface NpShopPaymentConfirmAdapterInput {
  attempt: NpShopPaymentAttempt;
  confirmation: Readonly<{ [key: string]: NpShopPaymentJson }>;
  receivedAt: string;
}

export interface NpShopPaymentLauncherProps {
  attemptApiPath: string;
  orderId: string;
  label: string;
  preparingLabel: string;
  confirmingLabel: string;
  retryLabel: string;
  failedLabel: string;
}

export type NpShopPaymentLauncher = (props: NpShopPaymentLauncherProps) => ReactNode;

export class NpShopPaymentAttemptContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPaymentAttemptContractError";
    this.issues = issues;
  }
}

export class NpShopPaymentAttemptNotFoundError extends Error {
  constructor() {
    super("The payment attempt does not exist for this browser identity.");
    this.name = "NpShopPaymentAttemptNotFoundError";
  }
}

export class NpShopPaymentAttemptConflictError extends Error {
  readonly code:
    | "payment_attempt_conflict"
    | "payment_attempt_expired"
    | "payment_attempt_limit"
    | "payment_attempt_order_changed"
    | "payment_attempt_order_terminal"
    | "payment_attempt_provider_mismatch"
    | "payment_confirmation_mismatch";

  constructor(code: NpShopPaymentAttemptConflictError["code"], message: string) {
    super(message);
    this.name = "NpShopPaymentAttemptConflictError";
    this.code = code;
  }
}

export class NpShopPaymentProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.name = "NpShopPaymentProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/u;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const forbiddenPublicKeys = new Set([
  "__proto__",
  "apikey",
  "authorization",
  "constructor",
  "credential",
  "password",
  "privatekey",
  "prototype",
  "secret",
  "secretkey",
]);
const attemptKeys = [
  "contract",
  "id",
  "orderId",
  "providerId",
  "status",
  "orderRevision",
  "currency",
  "amountMinor",
  "orderName",
  "handoff",
  "createdAt",
  "expiresAt",
  "confirmedAt",
  "paymentReference",
  "eventId",
  "purgeAt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalIsoPattern.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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

function analyzeJson(
  value: unknown,
  path: string,
  limits: { bytes: number },
  issues: string[],
  depth = 0,
  counter = { keys: 0 },
): void {
  if (depth > npShopPaymentAttemptLimits.publicDataDepth) {
    issues.push(`${path} exceeds the maximum depth.`);
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(`${path} must contain finite numbers.`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > npShopPaymentAttemptLimits.publicDataStringLength) {
      issues.push(`${path} contains an oversized string.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > npShopPaymentAttemptLimits.publicDataArrayItems) {
      issues.push(`${path} contains too many items.`);
      return;
    }
    value.forEach((entry, index) =>
      analyzeJson(entry, `${path}[${index.toString()}]`, limits, issues, depth + 1, counter),
    );
    return;
  }
  if (!isRecord(value)) {
    issues.push(`${path} must contain only plain JSON values.`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    counter.keys += 1;
    if (counter.keys > npShopPaymentAttemptLimits.publicDataKeys) {
      issues.push(`${path} contains too many keys.`);
      return;
    }
    const normalizedKey = key.replace(/[-_]/gu, "").toLowerCase();
    if (
      !key ||
      key.length > 80 ||
      forbiddenPublicKeys.has(normalizedKey) ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("password")
    ) {
      issues.push(`${path}.${key || "<empty>"} is not an allowed public key.`);
      continue;
    }
    analyzeJson(entry, `${path}.${key}`, limits, issues, depth + 1, counter);
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limits.bytes) {
      issues.push(`${path} exceeds the byte limit.`);
    }
  } catch {
    issues.push(`${path} cannot be serialized as JSON.`);
  }
}

export function npRequireShopPaymentAttemptCreateInput(
  value: unknown,
): NpShopPaymentAttemptCreateInput {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopPaymentAttemptContractError("Invalid payment attempt request", [
      "payment attempt request must be a plain object.",
    ]);
  }
  exactKeys(value, ["idempotencyKey", "orderId"], "payment attempt request", issues);
  if (
    typeof value.idempotencyKey !== "string" ||
    !canonicalUuidPattern.test(value.idempotencyKey)
  ) {
    issues.push("payment attempt request.idempotencyKey must be a canonical UUID.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("payment attempt request.orderId must be a canonical UUID.");
  }
  if (issues.length > 0) {
    throw new NpShopPaymentAttemptContractError("Invalid payment attempt request", issues);
  }
  return value as unknown as NpShopPaymentAttemptCreateInput;
}

export function npRequireShopPaymentAttemptConfirmInput(
  value: unknown,
): NpShopPaymentAttemptConfirmInput {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopPaymentAttemptContractError("Invalid payment confirmation request", [
      "payment confirmation request must be a plain object.",
    ]);
  }
  exactKeys(value, ["attemptId", "orderId", "confirmation"], "payment confirmation", issues);
  if (typeof value.attemptId !== "string" || !canonicalUuidPattern.test(value.attemptId)) {
    issues.push("payment confirmation.attemptId must be a canonical UUID.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("payment confirmation.orderId must be a canonical UUID.");
  }
  if (!isRecord(value.confirmation)) {
    issues.push("payment confirmation.confirmation must be a plain JSON object.");
  } else {
    analyzeJson(
      value.confirmation,
      "payment confirmation.confirmation",
      { bytes: npShopPaymentAttemptLimits.confirmationBytes },
      issues,
    );
  }
  if (issues.length > 0) {
    throw new NpShopPaymentAttemptContractError("Invalid payment confirmation request", issues);
  }
  return value as unknown as NpShopPaymentAttemptConfirmInput;
}

export function npRequireShopPaymentPrepareResult(value: unknown): NpShopPaymentPrepareResult {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new NpShopPaymentAttemptContractError("Invalid payment provider handoff", [
      "payment provider handoff must be a plain object.",
    ]);
  }
  if (value.kind === "client") {
    exactKeys(value, ["kind", "data"], "payment provider handoff", issues);
    if (!isRecord(value.data)) {
      issues.push("payment provider handoff.data must be a plain JSON object.");
    } else {
      analyzeJson(
        value.data,
        "payment provider handoff.data",
        { bytes: npShopPaymentAttemptLimits.publicDataBytes },
        issues,
      );
    }
  } else if (value.kind === "redirect") {
    exactKeys(value, ["kind", "url"], "payment provider handoff", issues);
    if (
      typeof value.url !== "string" ||
      value.url.length > npShopPaymentAttemptLimits.redirectUrlLength
    ) {
      issues.push("payment provider handoff.url is invalid.");
    } else {
      try {
        const url = new URL(value.url);
        if (url.protocol !== "https:" || url.username || url.password) {
          issues.push("payment provider handoff.url must use HTTPS.");
        }
      } catch {
        issues.push("payment provider handoff.url must be an absolute URL.");
      }
    }
  } else {
    issues.push("payment provider handoff.kind is invalid.");
  }
  if (issues.length > 0) {
    throw new NpShopPaymentAttemptContractError("Invalid payment provider handoff", issues);
  }
  return value.kind === "client"
    ? {
        kind: "client",
        data: JSON.parse(JSON.stringify(value.data)) as { [key: string]: NpShopPaymentJson },
      }
    : { kind: "redirect", url: value.url as string };
}

export function npAnalyzeStoredShopPaymentAttempt(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["payment attempt must be a plain object."];
  exactKeys(value, attemptKeys, "payment attempt", issues);
  if (value.contract !== NP_SHOP_PAYMENT_ATTEMPT_CONTRACT) {
    issues.push(`payment attempt.contract must equal "${NP_SHOP_PAYMENT_ATTEMPT_CONTRACT}".`);
  }
  if (typeof value.id !== "string" || !canonicalUuidPattern.test(value.id)) {
    issues.push("payment attempt.id is invalid.");
  }
  if (typeof value.orderId !== "string" || !canonicalUuidPattern.test(value.orderId)) {
    issues.push("payment attempt.orderId is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerIdPattern.test(value.providerId)) {
    issues.push("payment attempt.providerId is invalid.");
  }
  if (!(npShopPaymentAttemptStoredStatuses as readonly unknown[]).includes(value.status)) {
    issues.push("payment attempt.status is invalid.");
  }
  if (!Number.isSafeInteger(value.orderRevision) || (value.orderRevision as number) < 1) {
    issues.push("payment attempt.orderRevision is invalid.");
  }
  if (!(npShopCurrencies as readonly unknown[]).includes(value.currency)) {
    issues.push("payment attempt.currency is invalid.");
  }
  if (!Number.isSafeInteger(value.amountMinor) || (value.amountMinor as number) < 0) {
    issues.push("payment attempt.amountMinor is invalid.");
  }
  if (
    typeof value.orderName !== "string" ||
    value.orderName.trim() !== value.orderName ||
    value.orderName.length < 1 ||
    value.orderName.length > npShopPaymentAttemptLimits.orderNameLength
  ) {
    issues.push("payment attempt.orderName is invalid.");
  }
  if (!isRecord(value.handoff)) {
    issues.push("payment attempt.handoff is invalid.");
  } else {
    const expected =
      value.handoff.kind === "client"
        ? ["contract", "providerId", "attemptId", "kind", "expiresAt", "data"]
        : ["contract", "providerId", "attemptId", "kind", "expiresAt", "url"];
    exactKeys(value.handoff, expected, "payment attempt.handoff", issues);
    if (value.handoff.contract !== NP_SHOP_PAYMENT_HANDOFF_CONTRACT) {
      issues.push("payment attempt.handoff.contract is invalid.");
    }
    if (value.handoff.providerId !== value.providerId) {
      issues.push("payment attempt.handoff.providerId must match the attempt.");
    }
    if (value.handoff.attemptId !== value.id) {
      issues.push("payment attempt.handoff.attemptId must match the attempt.");
    }
    if (value.handoff.expiresAt !== value.expiresAt) {
      issues.push("payment attempt.handoff.expiresAt must match the attempt.");
    }
    try {
      npRequireShopPaymentPrepareResult(
        value.handoff.kind === "client"
          ? { kind: "client", data: value.handoff.data }
          : { kind: "redirect", url: value.handoff.url },
      );
    } catch (error) {
      if (error instanceof NpShopPaymentAttemptContractError) {
        issues.push(...error.issues.map((issue) => `payment attempt.handoff: ${issue}`));
      }
    }
  }
  for (const field of ["createdAt", "expiresAt", "purgeAt"] as const) {
    if (!isCanonicalIso(value[field])) issues.push(`payment attempt.${field} is invalid.`);
  }
  if (value.confirmedAt !== null && !isCanonicalIso(value.confirmedAt)) {
    issues.push("payment attempt.confirmedAt is invalid.");
  }
  for (const field of ["paymentReference", "eventId"] as const) {
    if (
      value[field] !== null &&
      (typeof value[field] !== "string" || !opaqueReferencePattern.test(value[field]))
    ) {
      issues.push(`payment attempt.${field} is invalid.`);
    }
  }
  if (
    value.status === "prepared" &&
    (value.confirmedAt !== null || value.paymentReference !== null || value.eventId !== null)
  ) {
    issues.push("prepared payment attempts cannot contain confirmation fields.");
  }
  if (
    value.status === "confirmed" &&
    (value.confirmedAt === null || value.paymentReference === null || value.eventId === null)
  ) {
    issues.push("confirmed payment attempts require every confirmation field.");
  }
  if (isCanonicalIso(value.createdAt) && isCanonicalIso(value.expiresAt)) {
    if (new Date(value.expiresAt) <= new Date(value.createdAt)) {
      issues.push("payment attempt.expiresAt must follow creation.");
    }
  }
  if (isCanonicalIso(value.expiresAt) && isCanonicalIso(value.purgeAt)) {
    if (new Date(value.purgeAt) < new Date(value.expiresAt)) {
      issues.push("payment attempt.purgeAt cannot precede expiry.");
    }
  }
  return issues;
}

export function npRequireStoredShopPaymentAttempt(value: unknown): NpShopStoredPaymentAttempt {
  const issues = npAnalyzeStoredShopPaymentAttempt(value);
  if (issues.length > 0) {
    throw new NpShopPaymentAttemptContractError("Invalid stored Shop payment attempt", issues);
  }
  return value as NpShopStoredPaymentAttempt;
}

export function npProjectShopPaymentAttempt(
  attempt: NpShopStoredPaymentAttempt,
  now = new Date(),
): NpShopPaymentAttempt {
  const { orderName: _orderName, status, ...fields } = attempt;
  return {
    ...fields,
    status: status === "prepared" && new Date(attempt.expiresAt) <= now ? "expired" : status,
  };
}
