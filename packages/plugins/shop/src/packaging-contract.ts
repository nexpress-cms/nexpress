import {
  npAnalyzeShopFulfillmentParcels,
  npShopFulfillmentParcelLimits,
  type NpShopFulfillmentParcel,
} from "./parcel-contract.js";

export const NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT =
  "np.shop-packaging-proposal-request.v1" as const;
export const NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT =
  "np.shop-packaging-proposal-result.v1" as const;
export const NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT =
  "np.shop-packaging-proposal-health.v1" as const;

export const npShopPackagingProposalLimits = Object.freeze({
  maximumLines: 100,
  lineKeyLength: npShopFulfillmentParcelLimits.lineKeyLength,
  productSlugLength: 160,
  variantSkuLength: 80,
  providerIdLength: 32,
  maximumProposalAgeSeconds: 60,
  futureToleranceSeconds: 30,
});

export type NpShopPackagingProposalTarget = "outbound" | "replacement";

export interface NpShopPackagingProposalLine {
  readonly lineKey: string;
  readonly productId: string;
  readonly productSlug: string;
  readonly variantSku: string | null;
  readonly quantity: number;
}

interface NpShopPackagingProposalRequestBase {
  readonly contract: typeof NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT;
  readonly proposalId: string;
  readonly orderId: string;
  readonly sourceRevision: number;
  readonly expectedParcelRevision: number | null;
  readonly lines: readonly NpShopPackagingProposalLine[];
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export type NpShopPackagingProposalRequest = NpShopPackagingProposalRequestBase &
  (
    | { readonly target: "outbound"; readonly exchangeId: null }
    | { readonly target: "replacement"; readonly exchangeId: string }
  );

interface NpShopPackagingProposalResultBase {
  readonly contract: typeof NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT;
  readonly proposalId: string;
  readonly orderId: string;
  readonly sourceRevision: number;
  readonly expectedParcelRevision: number | null;
  readonly parcels: NpShopFulfillmentParcel[];
  readonly proposedAt: string;
  readonly expiresAt: string;
}

export type NpShopPackagingProposalResult = NpShopPackagingProposalResultBase &
  (
    | { readonly target: "outbound"; readonly exchangeId: null }
    | { readonly target: "replacement"; readonly exchangeId: string }
  );

export type NpShopPackagingProposalResultFor<TRequest extends NpShopPackagingProposalRequest> =
  TRequest extends NpShopPackagingProposalRequest
    ? NpShopPackagingProposalResultBase & Pick<TRequest, "target" | "exchangeId">
    : never;

export function npCreateShopPackagingProposalResult<
  TRequest extends NpShopPackagingProposalRequest,
>(
  request: TRequest,
  proposal: Pick<NpShopPackagingProposalResultBase, "parcels" | "proposedAt">,
): NpShopPackagingProposalResultFor<TRequest> {
  const common = {
    contract: NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT,
    proposalId: request.proposalId,
    orderId: request.orderId,
    sourceRevision: request.sourceRevision,
    expectedParcelRevision: request.expectedParcelRevision,
    parcels: proposal.parcels,
    proposedAt: proposal.proposedAt,
    expiresAt: request.expiresAt,
  };
  return (
    request.target === "outbound"
      ? { ...common, target: "outbound", exchangeId: null }
      : { ...common, target: "replacement", exchangeId: request.exchangeId }
  ) as NpShopPackagingProposalResultFor<TRequest>;
}

export interface NpShopPackagingProposalHealth {
  contract: typeof NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT;
  providerId: string;
  target: NpShopPackagingProposalTarget;
  status: "ok" | "error";
  errorCode: "provider-error" | "invalid-result" | null;
  attemptedAt: string;
}

interface NpShopPackagingProposalInputBase {
  orderId: string;
  expectedSourceRevision: number;
  expectedParcelRevision: number | null;
}

export type NpShopPackagingProposalInput = NpShopPackagingProposalInputBase &
  ({ target: "outbound"; exchangeId: null } | { target: "replacement"; exchangeId: string });

export interface NpShopPackagingAdapter {
  readonly id: string;
  /**
   * Calculate parcels without reserving provider resources, creating warehouse
   * work, charging money, or otherwise mutating provider state.
   */
  proposeParcels<TRequest extends NpShopPackagingProposalRequest>(
    input: TRequest,
  ):
    | NpShopPackagingProposalResultFor<TRequest>
    | Promise<NpShopPackagingProposalResultFor<TRequest>>;
}

export class NpShopPackagingProposalContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopPackagingProposalContractError";
    this.issues = issues;
  }
}

export class NpShopPackagingProposalUnavailableError extends Error {
  constructor(message = "Packaging proposals are temporarily unavailable.") {
    super(message);
    this.name = "NpShopPackagingProposalUnavailableError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const providerPattern = /^[a-z][a-z0-9-]{0,31}$/u;

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
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function analyzeUuid(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) issues.push(`${path} is invalid.`);
}

function analyzeTargetIdentity(
  target: unknown,
  exchangeId: unknown,
  path: string,
  issues: string[],
): void {
  if (target !== "outbound" && target !== "replacement") {
    issues.push(`${path}.target is invalid.`);
  }
  if (exchangeId !== null) analyzeUuid(exchangeId, `${path}.exchangeId`, issues);
  if (
    (target === "outbound" && exchangeId !== null) ||
    (target === "replacement" && exchangeId === null)
  ) {
    issues.push(`${path} exchange identity does not match its target.`);
  }
}

function analyzeExpectedParcelRevision(value: unknown, path: string, issues: string[]): void {
  if (value !== null && !isRevision(value)) issues.push(`${path} is invalid.`);
}

function analyzeLine(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be a plain object.`);
    return;
  }
  exactKeys(value, ["lineKey", "productId", "productSlug", "variantSku", "quantity"], path, issues);
  if (
    typeof value.lineKey !== "string" ||
    value.lineKey.length < 1 ||
    value.lineKey.length > npShopPackagingProposalLimits.lineKeyLength ||
    value.lineKey.trim() !== value.lineKey
  ) {
    issues.push(`${path}.lineKey is invalid.`);
  }
  analyzeUuid(value.productId, `${path}.productId`, issues);
  if (
    typeof value.productSlug !== "string" ||
    value.productSlug.length < 1 ||
    value.productSlug.length > npShopPackagingProposalLimits.productSlugLength ||
    value.productSlug.trim() !== value.productSlug
  ) {
    issues.push(`${path}.productSlug is invalid.`);
  }
  if (
    value.variantSku !== null &&
    (typeof value.variantSku !== "string" ||
      value.variantSku.length < 1 ||
      value.variantSku.length > npShopPackagingProposalLimits.variantSkuLength ||
      value.variantSku.trim() !== value.variantSku)
  ) {
    issues.push(`${path}.variantSku is invalid.`);
  }
  if (
    !Number.isSafeInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    (value.quantity as number) > npShopFulfillmentParcelLimits.maximumQuantity
  ) {
    issues.push(`${path}.quantity is invalid.`);
  }
}

function analyzeLines(value: unknown, path: string, issues: string[]): void {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > npShopPackagingProposalLimits.maximumLines
  ) {
    issues.push(`${path} must contain between 1 and 100 lines.`);
    return;
  }
  value.forEach((line, index) => analyzeLine(line, `${path}[${index.toString()}]`, issues));
  const keys = value
    .filter(isRecord)
    .map((line) => line.lineKey)
    .filter((key): key is string => typeof key === "string");
  if (new Set(keys).size !== keys.length) issues.push(`${path} line keys must be unique.`);
}

export function npRequireShopPackagingProviderId(value: unknown): string {
  if (typeof value !== "string" || !providerPattern.test(value)) {
    throw new NpShopPackagingProposalContractError("Invalid Shop packaging provider id", [
      "provider id must be a lowercase slug with at most 32 characters.",
    ]);
  }
  return value;
}

export function npAnalyzeShopPackagingProposalRequest(value: unknown): string[] {
  if (!isRecord(value)) return ["packaging proposal request must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "proposalId",
      "orderId",
      "target",
      "exchangeId",
      "sourceRevision",
      "expectedParcelRevision",
      "lines",
      "requestedAt",
      "expiresAt",
    ],
    "packaging proposal request",
    issues,
  );
  if (value.contract !== NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT) {
    issues.push("packaging proposal request.contract is invalid.");
  }
  analyzeUuid(value.proposalId, "packaging proposal request.proposalId", issues);
  analyzeUuid(value.orderId, "packaging proposal request.orderId", issues);
  analyzeTargetIdentity(value.target, value.exchangeId, "packaging proposal request", issues);
  if (!isRevision(value.sourceRevision)) {
    issues.push("packaging proposal request.sourceRevision is invalid.");
  }
  analyzeExpectedParcelRevision(
    value.expectedParcelRevision,
    "packaging proposal request.expectedParcelRevision",
    issues,
  );
  analyzeLines(value.lines, "packaging proposal request.lines", issues);
  if (!isIso(value.requestedAt)) issues.push("packaging proposal request.requestedAt is invalid.");
  if (!isIso(value.expiresAt)) issues.push("packaging proposal request.expiresAt is invalid.");
  if (isIso(value.requestedAt) && isIso(value.expiresAt)) {
    const duration = new Date(value.expiresAt).getTime() - new Date(value.requestedAt).getTime();
    if (
      duration < 1 ||
      duration > npShopPackagingProposalLimits.maximumProposalAgeSeconds * 1_000
    ) {
      issues.push("packaging proposal request expiry is invalid.");
    }
  }
  return issues;
}

export function npRequireShopPackagingProposalRequest(
  value: unknown,
): NpShopPackagingProposalRequest {
  const issues = npAnalyzeShopPackagingProposalRequest(value);
  if (issues.length) {
    throw new NpShopPackagingProposalContractError(
      "Invalid Shop packaging proposal request",
      issues,
    );
  }
  return value as NpShopPackagingProposalRequest;
}

export function npAnalyzeShopPackagingProposalResult(value: unknown): string[] {
  if (!isRecord(value)) return ["packaging proposal result must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    [
      "contract",
      "proposalId",
      "orderId",
      "target",
      "exchangeId",
      "sourceRevision",
      "expectedParcelRevision",
      "parcels",
      "proposedAt",
      "expiresAt",
    ],
    "packaging proposal result",
    issues,
  );
  if (value.contract !== NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT) {
    issues.push("packaging proposal result.contract is invalid.");
  }
  analyzeUuid(value.proposalId, "packaging proposal result.proposalId", issues);
  analyzeUuid(value.orderId, "packaging proposal result.orderId", issues);
  analyzeTargetIdentity(value.target, value.exchangeId, "packaging proposal result", issues);
  if (!isRevision(value.sourceRevision)) {
    issues.push("packaging proposal result.sourceRevision is invalid.");
  }
  analyzeExpectedParcelRevision(
    value.expectedParcelRevision,
    "packaging proposal result.expectedParcelRevision",
    issues,
  );
  issues.push(
    ...npAnalyzeShopFulfillmentParcels(value.parcels, "packaging proposal result.parcels"),
  );
  if (!isIso(value.proposedAt)) issues.push("packaging proposal result.proposedAt is invalid.");
  if (!isIso(value.expiresAt)) issues.push("packaging proposal result.expiresAt is invalid.");
  if (
    isIso(value.proposedAt) &&
    isIso(value.expiresAt) &&
    new Date(value.proposedAt).getTime() > new Date(value.expiresAt).getTime()
  ) {
    issues.push("packaging proposal result.proposedAt cannot follow expiresAt.");
  }
  return issues;
}

export function npRequireShopPackagingProposalResult(
  value: unknown,
): NpShopPackagingProposalResult {
  const issues = npAnalyzeShopPackagingProposalResult(value);
  if (issues.length) {
    throw new NpShopPackagingProposalContractError(
      "Invalid Shop packaging proposal result",
      issues,
    );
  }
  return value as NpShopPackagingProposalResult;
}

export function npAnalyzeShopPackagingProposalResultForRequest(
  requestValue: unknown,
  resultValue: unknown,
  evaluatedAt: unknown,
): string[] {
  const issues = [
    ...npAnalyzeShopPackagingProposalRequest(requestValue),
    ...npAnalyzeShopPackagingProposalResult(resultValue),
  ];
  const evaluationDate = evaluatedAt instanceof Date ? evaluatedAt : null;
  if (!evaluationDate || Number.isNaN(evaluationDate.getTime())) {
    issues.push("evaluatedAt is invalid.");
  }
  if (issues.length) return issues;
  const request = requestValue as NpShopPackagingProposalRequest;
  const result = resultValue as NpShopPackagingProposalResult;
  for (const key of [
    "proposalId",
    "orderId",
    "target",
    "exchangeId",
    "sourceRevision",
    "expectedParcelRevision",
    "expiresAt",
  ] as const) {
    if (result[key] !== request[key]) issues.push(`result.${key} must match the request.`);
  }
  const proposedAt = new Date(result.proposedAt).getTime();
  const requestedAt = new Date(request.requestedAt).getTime();
  const expiresAt = new Date(request.expiresAt).getTime();
  if (proposedAt < requestedAt) issues.push("result.proposedAt cannot precede requestedAt.");
  if (proposedAt > expiresAt || evaluationDate!.getTime() > expiresAt) {
    issues.push("the packaging proposal expired before it could be accepted.");
  }
  if (
    proposedAt >
    evaluationDate!.getTime() + npShopPackagingProposalLimits.futureToleranceSeconds * 1_000
  ) {
    issues.push("result.proposedAt is too far in the future.");
  }
  const expected = new Map(request.lines.map((line) => [line.lineKey, line.quantity]));
  const allocated = new Map<string, number>();
  for (const parcel of result.parcels) {
    for (const item of parcel.items) {
      allocated.set(item.lineKey, (allocated.get(item.lineKey) ?? 0) + item.quantity);
    }
  }
  if (
    allocated.size !== expected.size ||
    [...expected].some(([lineKey, quantity]) => allocated.get(lineKey) !== quantity) ||
    [...allocated.keys()].some((lineKey) => !expected.has(lineKey))
  ) {
    issues.push("result.parcels must allocate every requested line and exact quantity.");
  }
  return issues;
}

export function npAnalyzeShopPackagingProposalHealth(value: unknown): string[] {
  if (!isRecord(value)) return ["packaging proposal health must be a plain object."];
  const issues: string[] = [];
  exactKeys(
    value,
    ["contract", "providerId", "target", "status", "errorCode", "attemptedAt"],
    "packaging proposal health",
    issues,
  );
  if (value.contract !== NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT) {
    issues.push("packaging proposal health.contract is invalid.");
  }
  if (typeof value.providerId !== "string" || !providerPattern.test(value.providerId)) {
    issues.push("packaging proposal health.providerId is invalid.");
  }
  if (value.target !== "outbound" && value.target !== "replacement") {
    issues.push("packaging proposal health.target is invalid.");
  }
  if (value.status !== "ok" && value.status !== "error") {
    issues.push("packaging proposal health.status is invalid.");
  }
  if (
    value.errorCode !== null &&
    value.errorCode !== "provider-error" &&
    value.errorCode !== "invalid-result"
  ) {
    issues.push("packaging proposal health.errorCode is invalid.");
  }
  if ((value.status === "ok") !== (value.errorCode === null)) {
    issues.push("packaging proposal health error does not match status.");
  }
  if (!isIso(value.attemptedAt)) issues.push("packaging proposal health.attemptedAt is invalid.");
  return issues;
}

export function npRequireShopPackagingProposalHealth(
  value: unknown,
): NpShopPackagingProposalHealth {
  const issues = npAnalyzeShopPackagingProposalHealth(value);
  if (issues.length) {
    throw new NpShopPackagingProposalContractError(
      "Invalid Shop packaging proposal health",
      issues,
    );
  }
  return value as NpShopPackagingProposalHealth;
}

function requireActionEnvelope(value: unknown): {
  row: Record<string, unknown>;
  values: Record<string, unknown>;
} {
  if (!isRecord(value)) {
    throw new NpShopPackagingProposalContractError("Invalid Shop packaging proposal action", [
      "payload must be a plain object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], "payload", issues);
  if (!isRecord(value.row)) issues.push("payload.row must be a plain object.");
  if (!isRecord(value.values)) issues.push("payload.values must be a plain object.");
  if (issues.length) {
    throw new NpShopPackagingProposalContractError(
      "Invalid Shop packaging proposal action",
      issues,
    );
  }
  return {
    row: value.row as Record<string, unknown>,
    values: value.values as Record<string, unknown>,
  };
}

function analyzeActionRevisions(
  row: Record<string, unknown>,
  sourceField: "fulfillmentRevision" | "exchangeRevision",
  issues: string[],
): void {
  if (!isRevision(row[sourceField])) issues.push(`payload.row.${sourceField} is invalid.`);
  analyzeExpectedParcelRevision(row.parcelRevision, "payload.row.parcelRevision", issues);
}

export function npRequireShopFulfillmentPackagingProposalInput(
  value: unknown,
): NpShopPackagingProposalInput {
  const { row, values } = requireActionEnvelope(value);
  const issues: string[] = [];
  exactKeys(row, ["id", "fulfillmentRevision", "parcelRevision"], "payload.row", issues);
  exactKeys(values, [], "payload.values", issues);
  analyzeUuid(row.id, "payload.row.id", issues);
  analyzeActionRevisions(row, "fulfillmentRevision", issues);
  if (issues.length) {
    throw new NpShopPackagingProposalContractError(
      "Invalid fulfillment packaging proposal action",
      issues,
    );
  }
  return {
    orderId: row.id as string,
    target: "outbound",
    exchangeId: null,
    expectedSourceRevision: row.fulfillmentRevision as number,
    expectedParcelRevision: row.parcelRevision as number | null,
  };
}

export function npRequireShopExchangePackagingProposalInput(
  value: unknown,
): NpShopPackagingProposalInput {
  const { row, values } = requireActionEnvelope(value);
  const issues: string[] = [];
  exactKeys(row, ["id", "exchangeId", "exchangeRevision", "parcelRevision"], "payload.row", issues);
  exactKeys(values, [], "payload.values", issues);
  analyzeUuid(row.id, "payload.row.id", issues);
  analyzeUuid(row.exchangeId, "payload.row.exchangeId", issues);
  analyzeActionRevisions(row, "exchangeRevision", issues);
  if (issues.length) {
    throw new NpShopPackagingProposalContractError(
      "Invalid replacement packaging proposal action",
      issues,
    );
  }
  return {
    orderId: row.id as string,
    target: "replacement",
    exchangeId: row.exchangeId as string,
    expectedSourceRevision: row.exchangeRevision as number,
    expectedParcelRevision: row.parcelRevision as number | null,
  };
}
