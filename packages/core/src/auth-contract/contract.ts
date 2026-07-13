import {
  npAuthTokenAudiences,
  npAuthTokenUses,
  npMemberStatuses,
  npUserRoles,
  type NpAuthTokenAudience,
  type NpAuthTokenPayloadBase,
  type NpAuthUser,
  type NpMemberAuthUser,
  type NpMemberSelf,
  type NpMemberSessionRecord,
  type NpMemberSessionUser,
  type NpMemberStatus,
  type NpMemberTokenPayload,
  type NpStaffSessionRecord,
  type NpStaffSessionUser,
  type NpStaffTokenPayload,
  type NpStaffInviteResult,
  type NpStaffUserItem,
  type NpStaffUserList,
  type NpUserRole,
} from "./types.js";

export const npAuthCanonicalDatePattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
export const npAuthUuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
export const npMemberHandlePattern = "^[a-z0-9][a-z0-9_-]{2,29}$";
export const npAuthSingleUseTokenPattern = "^[0-9a-f]{64}$";
export const npAuthContractLimits = {
  emailLength: 320,
  nameLength: 200,
  displayNameLength: 80,
  handleLength: 30,
  bioLength: 500,
  userAgentLength: 2048,
  ipLength: 64,
  pageLimit: 100,
  passwordMinLength: 8,
  passwordMaxLength: 1024,
  secretMinLength: 32,
  secretMaxLength: 1024,
  accessTokenTtlSeconds: 60 * 60 * 24 * 31,
  refreshTokenTtlSeconds: 60 * 60 * 24 * 365,
  loginAttempts: 100,
  lockoutTtlSeconds: 60 * 60 * 24 * 30,
  inviteTtlHours: 24 * 365,
  resetTtlMinutes: 60 * 24 * 30,
  verifyTtlHours: 24 * 365,
  oauthStateTtlSeconds: 60 * 60,
} as const;

export const npAuthRuntimeDefaults = {
  accessTokenTtlSeconds: 60 * 60 * 2,
  refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
  maxLoginAttempts: 5,
  lockoutTtlSeconds: 60 * 15,
  inviteTtlHours: 24 * 7,
  resetTtlMinutes: 60,
  verifyTtlHours: 24,
  oauthStateTtlSeconds: 600,
} as const;

export type NpAuthContractIssueCode = "shape" | "unknown-field" | "invalid-field" | "invariant";

export interface NpAuthContractIssue {
  readonly code: NpAuthContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpAuthContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: NpAuthContractIssue[] };

const uuidPattern = new RegExp(npAuthUuidPattern, "u");
const memberHandlePattern = new RegExp(npMemberHandlePattern, "u");
const authSingleUseTokenPattern = new RegExp(npAuthSingleUseTokenPattern, "u");
const canonicalDatePattern = new RegExp(npAuthCanonicalDatePattern, "u");
const tokenHashPattern = /^[0-9a-f]{64}$/u;
const tokenIdPattern = /^[A-Za-z0-9_-]{20,128}$/u;
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const userRoleSet = new Set<string>(npUserRoles);
const memberStatusSet = new Set<string>(npMemberStatuses);
const tokenUseSet = new Set<string>(npAuthTokenUses);
const tokenAudienceSet = new Set<string>(npAuthTokenAudiences);

const authUserKeys = new Set(["id", "email", "name", "role", "tokenVersion"]);
const staffSessionUserKeys = new Set(["id", "email", "name", "role"]);
const staffUserItemKeys = new Set([
  "id",
  "email",
  "name",
  "role",
  "avatar",
  "createdAt",
  "updatedAt",
]);
const staffUserListKeys = new Set([
  "docs",
  "totalDocs",
  "totalPages",
  "page",
  "limit",
  "hasNextPage",
  "hasPrevPage",
]);
const staffInviteResultKeys = new Set(["id", "email", "name", "role", "inviteExpiresAt"]);
const memberAuthUserKeys = new Set([
  "id",
  "email",
  "handle",
  "displayName",
  "status",
  "tokenVersion",
]);
const memberSessionUserKeys = new Set(["id", "handle", "email", "displayName"]);
const memberSelfKeys = new Set([
  "id",
  "handle",
  "email",
  "displayName",
  "emailVerified",
  "avatar",
  "bio",
  "status",
  "reputation",
  "createdAt",
]);
const tokenPayloadKeys = new Set(["sub", "aud", "ver", "use", "sid", "jti", "iat", "exp"]);
const staffSessionRecordKeys = new Set([
  "id",
  "userId",
  "accessTokenHash",
  "refreshTokenHash",
  "accessExpiresAt",
  "refreshExpiresAt",
  "userAgent",
  "ip",
  "createdAt",
  "updatedAt",
]);
const memberSessionRecordKeys = new Set([
  "id",
  "memberId",
  "accessTokenHash",
  "refreshTokenHash",
  "accessExpiresAt",
  "refreshExpiresAt",
  "userAgent",
  "ip",
  "createdAt",
  "updatedAt",
]);

export class NpAuthContractError extends Error {
  readonly issues: NpAuthContractIssue[];

  constructor(message: string, issues: NpAuthContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpAuthContractError";
    this.issues = issues;
  }
}

/** Resolve one canonical bounded positive-integer auth setting. */
export function npReadAuthPositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(fallback) || fallback <= 0 || fallback > maximum) {
    throw new Error(`${name} fallback must be between 1 and ${maximum.toString()}.`);
  }
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum.toString()}.`);
  }
  return parsed;
}

function issue(code: NpAuthContractIssueCode, path: string, message: string): NpAuthContractIssue {
  return { code, path, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function pushUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpAuthContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported auth field "${key}".`));
    }
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function npIsCanonicalAuthId(value: unknown): value is string {
  return isUuid(value);
}

function isCanonicalEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= npAuthContractLimits.emailLength &&
    value === value.trim() &&
    value === value.toLowerCase() &&
    emailPattern.test(value)
  );
}

export function npIsCanonicalAuthEmail(value: unknown): boolean {
  return isCanonicalEmail(value);
}

export function npIsCanonicalMemberHandle(value: unknown): boolean {
  return typeof value === "string" && memberHandlePattern.test(value);
}

export function npIsAuthSingleUseToken(value: unknown): value is string {
  return typeof value === "string" && authSingleUseTokenPattern.test(value);
}

export function npIsAuthPasswordCandidate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= npAuthContractLimits.passwordMaxLength
  );
}

export function npIsAuthNewPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= npAuthContractLimits.passwordMinLength &&
    value.length <= npAuthContractLimits.passwordMaxLength
  );
}

export function npRequireAuthSecret(value: unknown, name = "NP_SECRET"): string {
  if (
    typeof value !== "string" ||
    value.length < npAuthContractLimits.secretMinLength ||
    value.length > npAuthContractLimits.secretMaxLength
  ) {
    throw new Error(
      `${name} must contain ${npAuthContractLimits.secretMinLength.toString()} through ${npAuthContractLimits.secretMaxLength.toString()} characters.`,
    );
  }
  return value;
}

function isTrimmedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    canonicalDatePattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

export function npIsUserRole(value: unknown): value is NpUserRole {
  return typeof value === "string" && userRoleSet.has(value);
}

export function npIsMemberStatus(value: unknown): value is NpMemberStatus {
  return typeof value === "string" && memberStatusSet.has(value);
}

export function npAnalyzeAuthUser(value: unknown, path = "user"): NpAuthContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "auth user must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, authUserKeys, path, issues);
  if (!isUuid(value.id)) issues.push(issue("invalid-field", `${path}.id`, "must be a UUID."));
  if (!isCanonicalEmail(value.email)) {
    issues.push(issue("invalid-field", `${path}.email`, "must be a canonical lowercase email."));
  }
  if (!isTrimmedString(value.name, npAuthContractLimits.nameLength)) {
    issues.push(issue("invalid-field", `${path}.name`, "must be a non-empty trimmed name."));
  }
  if (!npIsUserRole(value.role)) {
    issues.push(issue("invalid-field", `${path}.role`, "must be a registered staff role."));
  }
  if (!isNonNegativeInteger(value.tokenVersion)) {
    issues.push(issue("invalid-field", `${path}.tokenVersion`, "must be a non-negative integer."));
  }
  return issues;
}

export function npIsAuthUser(value: unknown): value is NpAuthUser {
  return npAnalyzeAuthUser(value).length === 0;
}

export function npRequireAuthUser(value: unknown, path = "user"): NpAuthUser {
  const issues = npAnalyzeAuthUser(value, path);
  if (issues.length > 0) throw new NpAuthContractError("Invalid auth user", issues);
  return value as NpAuthUser;
}

function analyzeStaffSessionUserAt(value: unknown, path: string): NpAuthContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "staff user must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, staffSessionUserKeys, path, issues);
  if (!isUuid(value.id)) issues.push(issue("invalid-field", `${path}.id`, "must be a UUID."));
  if (!isCanonicalEmail(value.email)) {
    issues.push(issue("invalid-field", `${path}.email`, "must be a canonical lowercase email."));
  }
  if (!isTrimmedString(value.name, npAuthContractLimits.nameLength)) {
    issues.push(issue("invalid-field", `${path}.name`, "must be a non-empty trimmed name."));
  }
  if (!npIsUserRole(value.role)) {
    issues.push(issue("invalid-field", `${path}.role`, "must be a registered staff role."));
  }
  return issues;
}

export function npAnalyzeStaffSessionUser(value: unknown): NpAuthContractIssue[] {
  return analyzeStaffSessionUserAt(value, "user");
}

export function npIsStaffSessionUser(value: unknown): value is NpStaffSessionUser {
  return npAnalyzeStaffSessionUser(value).length === 0;
}

export function npRequireStaffSessionUser(value: unknown): NpStaffSessionUser {
  const issues = npAnalyzeStaffSessionUser(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid staff session user", issues);
  return value as NpStaffSessionUser;
}

export function npAnalyzeStaffUserItem(value: unknown, path = "user"): NpAuthContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", path, "staff user item must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, staffUserItemKeys, path, issues);
  const sessionProjection = {
    id: value.id,
    email: value.email,
    name: value.name,
    role: value.role,
  };
  issues.push(...analyzeStaffSessionUserAt(sessionProjection, path));
  if (!(value.avatar === null || isUuid(value.avatar))) {
    issues.push(issue("invalid-field", `${path}.avatar`, "must be a UUID or null."));
  }
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (!isIsoDate(value[field])) {
      issues.push(issue("invalid-field", `${path}.${field}`, "must be a canonical UTC timestamp."));
    }
  }
  if (
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt) &&
    value.updatedAt < value.createdAt
  ) {
    issues.push(issue("invariant", `${path}.updatedAt`, "must not precede createdAt."));
  }
  return issues;
}

export function npIsStaffUserItem(value: unknown): value is NpStaffUserItem {
  return npAnalyzeStaffUserItem(value).length === 0;
}

export function npRequireStaffUserItem(value: unknown): NpStaffUserItem {
  const issues = npAnalyzeStaffUserItem(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid staff user item", issues);
  return value as NpStaffUserItem;
}

export function npAnalyzeStaffUserList(value: unknown): NpAuthContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "users", "staff user list must be a plain object.")];
  }
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, staffUserListKeys, "users", issues);
  if (!Array.isArray(value.docs)) {
    issues.push(issue("invalid-field", "users.docs", "must be an array."));
  } else {
    value.docs.forEach((item, index) => {
      issues.push(...npAnalyzeStaffUserItem(item, `users.docs[${index.toString()}]`));
    });
  }
  for (const field of ["totalDocs", "totalPages"] as const) {
    if (!isNonNegativeInteger(value[field])) {
      issues.push(issue("invalid-field", `users.${field}`, "must be a non-negative integer."));
    }
  }
  for (const field of ["page", "limit"] as const) {
    if (!isPositiveInteger(value[field])) {
      issues.push(issue("invalid-field", `users.${field}`, "must be a positive integer."));
    }
  }
  if (isPositiveInteger(value.limit) && value.limit > npAuthContractLimits.pageLimit) {
    issues.push(issue("invalid-field", "users.limit", "must not exceed 100."));
  }
  for (const field of ["hasNextPage", "hasPrevPage"] as const) {
    if (typeof value[field] !== "boolean") {
      issues.push(issue("invalid-field", `users.${field}`, "must be boolean."));
    }
  }
  if (
    Array.isArray(value.docs) &&
    isPositiveInteger(value.limit) &&
    value.docs.length > value.limit
  ) {
    issues.push(issue("invariant", "users.docs", "must not contain more rows than limit."));
  }
  if (
    isNonNegativeInteger(value.totalDocs) &&
    isNonNegativeInteger(value.totalPages) &&
    isPositiveInteger(value.limit)
  ) {
    const expectedTotalPages = value.totalDocs === 0 ? 0 : Math.ceil(value.totalDocs / value.limit);
    if (value.totalPages !== expectedTotalPages) {
      issues.push(issue("invariant", "users.totalPages", "must equal ceil(totalDocs / limit)."));
    }
  }
  if (
    isPositiveInteger(value.page) &&
    isNonNegativeInteger(value.totalPages) &&
    typeof value.hasNextPage === "boolean" &&
    value.hasNextPage !== value.page < value.totalPages
  ) {
    issues.push(issue("invariant", "users.hasNextPage", "does not match page and totalPages."));
  }
  if (
    isPositiveInteger(value.page) &&
    isNonNegativeInteger(value.totalDocs) &&
    typeof value.hasPrevPage === "boolean" &&
    value.hasPrevPage !== (value.page > 1 && value.totalDocs > 0)
  ) {
    issues.push(issue("invariant", "users.hasPrevPage", "does not match page and totalDocs."));
  }
  return issues;
}

export function npIsStaffUserList(value: unknown): value is NpStaffUserList {
  return npAnalyzeStaffUserList(value).length === 0;
}

export function npRequireStaffUserList(value: unknown): NpStaffUserList {
  const issues = npAnalyzeStaffUserList(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid staff user list", issues);
  return value as NpStaffUserList;
}

export function npAnalyzeStaffInviteResult(value: unknown): NpAuthContractIssue[] {
  if (!isPlainRecord(value)) {
    return [issue("shape", "invite", "staff invitation result must be a plain object.")];
  }
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, staffInviteResultKeys, "invite", issues);
  issues.push(
    ...analyzeStaffSessionUserAt(
      { id: value.id, email: value.email, name: value.name, role: value.role },
      "invite",
    ),
  );
  if (!isIsoDate(value.inviteExpiresAt)) {
    issues.push(
      issue("invalid-field", "invite.inviteExpiresAt", "must be a canonical UTC timestamp."),
    );
  }
  return issues;
}

export function npRequireStaffInviteResult(value: unknown): NpStaffInviteResult {
  const issues = npAnalyzeStaffInviteResult(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid staff invitation result", issues);
  return value as NpStaffInviteResult;
}

export function npAnalyzeMemberAuthUser(value: unknown, path = "member"): NpAuthContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", path, "member auth user must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, memberAuthUserKeys, path, issues);
  if (!isUuid(value.id)) issues.push(issue("invalid-field", `${path}.id`, "must be a UUID."));
  if (!isCanonicalEmail(value.email)) {
    issues.push(issue("invalid-field", `${path}.email`, "must be a canonical lowercase email."));
  }
  if (typeof value.handle !== "string" || !memberHandlePattern.test(value.handle)) {
    issues.push(issue("invalid-field", `${path}.handle`, "must be a canonical member handle."));
  }
  if (!isTrimmedString(value.displayName, npAuthContractLimits.displayNameLength)) {
    issues.push(
      issue("invalid-field", `${path}.displayName`, "must contain 1 through 80 characters."),
    );
  }
  if (!npIsMemberStatus(value.status)) {
    issues.push(issue("invalid-field", `${path}.status`, "must be a registered member status."));
  }
  if (!isNonNegativeInteger(value.tokenVersion)) {
    issues.push(issue("invalid-field", `${path}.tokenVersion`, "must be a non-negative integer."));
  }
  return issues;
}

export function npIsMemberAuthUser(value: unknown): value is NpMemberAuthUser {
  return npAnalyzeMemberAuthUser(value).length === 0;
}

function analyzeMemberSessionUserAt(value: unknown, path: string): NpAuthContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "member user must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, memberSessionUserKeys, path, issues);
  if (!isUuid(value.id)) issues.push(issue("invalid-field", `${path}.id`, "must be a UUID."));
  if (!isCanonicalEmail(value.email)) {
    issues.push(issue("invalid-field", `${path}.email`, "must be a canonical lowercase email."));
  }
  if (typeof value.handle !== "string" || !memberHandlePattern.test(value.handle)) {
    issues.push(issue("invalid-field", `${path}.handle`, "must be a canonical member handle."));
  }
  if (!isTrimmedString(value.displayName, npAuthContractLimits.displayNameLength)) {
    issues.push(
      issue("invalid-field", `${path}.displayName`, "must contain 1 through 80 characters."),
    );
  }
  return issues;
}

export function npAnalyzeMemberSessionUser(value: unknown): NpAuthContractIssue[] {
  return analyzeMemberSessionUserAt(value, "member");
}

export function npIsMemberSessionUser(value: unknown): value is NpMemberSessionUser {
  return npAnalyzeMemberSessionUser(value).length === 0;
}

export function npRequireMemberSessionUser(value: unknown): NpMemberSessionUser {
  const issues = npAnalyzeMemberSessionUser(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid member session user", issues);
  return value as NpMemberSessionUser;
}

export function npAnalyzeMemberSelf(value: unknown): NpAuthContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", "member", "member self must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, memberSelfKeys, "member", issues);
  issues.push(
    ...analyzeMemberSessionUserAt(
      {
        id: value.id,
        handle: value.handle,
        email: value.email,
        displayName: value.displayName,
      },
      "member",
    ),
  );
  if (typeof value.emailVerified !== "boolean") {
    issues.push(issue("invalid-field", "member.emailVerified", "must be boolean."));
  }
  if (!(value.avatar === null || isUuid(value.avatar))) {
    issues.push(issue("invalid-field", "member.avatar", "must be a UUID or null."));
  }
  if (!(value.bio === null || (typeof value.bio === "string" && value.bio.length <= 500))) {
    issues.push(issue("invalid-field", "member.bio", "must be null or at most 500 characters."));
  }
  if (value.status !== "active") {
    issues.push(issue("invariant", "member.status", 'must be "active" for an authenticated self.'));
  }
  if (!isInteger(value.reputation)) {
    issues.push(issue("invalid-field", "member.reputation", "must be an integer."));
  }
  if (!isIsoDate(value.createdAt)) {
    issues.push(issue("invalid-field", "member.createdAt", "must be a canonical UTC timestamp."));
  }
  return issues;
}

export function npIsMemberSelf(value: unknown): value is NpMemberSelf {
  return npAnalyzeMemberSelf(value).length === 0;
}

export function npRequireMemberSelf(value: unknown): NpMemberSelf {
  const issues = npAnalyzeMemberSelf(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid member self profile", issues);
  return value as NpMemberSelf;
}

function analyzeTokenPayload<TAudience extends NpAuthTokenAudience>(
  value: unknown,
  audience: TAudience,
): NpAuthContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", "token", "token payload must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, tokenPayloadKeys, "token", issues);
  if (!isUuid(value.sub)) issues.push(issue("invalid-field", "token.sub", "must be a UUID."));
  if (!tokenAudienceSet.has(String(value.aud)) || value.aud !== audience) {
    issues.push(issue("invalid-field", "token.aud", `must be ${audience}.`));
  }
  if (!isNonNegativeInteger(value.ver)) {
    issues.push(issue("invalid-field", "token.ver", "must be a non-negative integer."));
  }
  if (typeof value.use !== "string" || !tokenUseSet.has(value.use)) {
    issues.push(issue("invalid-field", "token.use", "must be access or refresh."));
  }
  if (!isUuid(value.sid)) issues.push(issue("invalid-field", "token.sid", "must be a UUID."));
  if (typeof value.jti !== "string" || !tokenIdPattern.test(value.jti)) {
    issues.push(issue("invalid-field", "token.jti", "must be a canonical token id."));
  }
  if (!isNonNegativeInteger(value.iat)) {
    issues.push(issue("invalid-field", "token.iat", "must be a non-negative integer."));
  }
  if (!isPositiveInteger(value.exp)) {
    issues.push(issue("invalid-field", "token.exp", "must be a positive integer."));
  }
  if (isNonNegativeInteger(value.iat) && isPositiveInteger(value.exp) && value.exp <= value.iat) {
    issues.push(issue("invariant", "token.exp", "must be later than iat."));
  }
  return issues;
}

export function npAnalyzeStaffTokenPayload(value: unknown): NpAuthContractIssue[] {
  return analyzeTokenPayload(value, "staff");
}

export function npRequireStaffTokenPayload(value: unknown): NpStaffTokenPayload {
  const issues = npAnalyzeStaffTokenPayload(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid staff token", issues);
  return value as NpStaffTokenPayload;
}

export function npAnalyzeMemberTokenPayload(value: unknown): NpAuthContractIssue[] {
  return analyzeTokenPayload(value, "member");
}

export function npRequireMemberTokenPayload(value: unknown): NpMemberTokenPayload {
  const issues = npAnalyzeMemberTokenPayload(value);
  if (issues.length > 0) throw new NpAuthContractError("Invalid member token", issues);
  return value as NpMemberTokenPayload;
}

function analyzeSessionRecord(
  value: unknown,
  subjectField: "userId" | "memberId",
  allowed: ReadonlySet<string>,
  path: string,
): NpAuthContractIssue[] {
  if (!isPlainRecord(value))
    return [issue("shape", path, "session record must be a plain object.")];
  const issues: NpAuthContractIssue[] = [];
  pushUnknownFields(value, allowed, path, issues);
  if (!isUuid(value.id)) issues.push(issue("invalid-field", `${path}.id`, "must be a UUID."));
  if (!isUuid(value[subjectField])) {
    issues.push(issue("invalid-field", `${path}.${subjectField}`, "must be a UUID."));
  }
  for (const field of ["accessTokenHash", "refreshTokenHash"] as const) {
    if (typeof value[field] !== "string" || !tokenHashPattern.test(value[field])) {
      issues.push(issue("invalid-field", `${path}.${field}`, "must be a SHA-256 hex digest."));
    }
  }
  if (
    typeof value.accessTokenHash === "string" &&
    typeof value.refreshTokenHash === "string" &&
    value.accessTokenHash === value.refreshTokenHash
  ) {
    issues.push(
      issue("invariant", `${path}.refreshTokenHash`, "must differ from accessTokenHash."),
    );
  }
  for (const field of ["accessExpiresAt", "refreshExpiresAt", "createdAt", "updatedAt"] as const) {
    if (!isValidDate(value[field])) {
      issues.push(issue("invalid-field", `${path}.${field}`, "must be a valid Date."));
    }
  }
  if (
    isValidDate(value.accessExpiresAt) &&
    isValidDate(value.refreshExpiresAt) &&
    value.refreshExpiresAt < value.accessExpiresAt
  ) {
    issues.push(
      issue("invariant", `${path}.refreshExpiresAt`, "must not precede accessExpiresAt."),
    );
  }
  if (
    isValidDate(value.createdAt) &&
    isValidDate(value.updatedAt) &&
    value.updatedAt < value.createdAt
  ) {
    issues.push(issue("invariant", `${path}.updatedAt`, "must not precede createdAt."));
  }
  for (const field of ["accessExpiresAt", "refreshExpiresAt"] as const) {
    if (
      isValidDate(value.createdAt) &&
      isValidDate(value[field]) &&
      value[field] <= value.createdAt
    ) {
      issues.push(issue("invariant", `${path}.${field}`, "must be later than createdAt."));
    }
  }
  for (const field of ["userAgent", "ip"] as const) {
    const max =
      field === "userAgent" ? npAuthContractLimits.userAgentLength : npAuthContractLimits.ipLength;
    if (!(
      value[field] === null ||
      (typeof value[field] === "string" && value[field].length <= max)
    )) {
      issues.push(
        issue(
          "invalid-field",
          `${path}.${field}`,
          `must be null or at most ${max.toString()} characters.`,
        ),
      );
    }
  }
  return issues;
}

export function npAnalyzeStaffSessionRecord(
  value: unknown,
  path = "staffSession",
): NpAuthContractIssue[] {
  return analyzeSessionRecord(value, "userId", staffSessionRecordKeys, path);
}

export function npIsStaffSessionRecord(value: unknown): value is NpStaffSessionRecord {
  return npAnalyzeStaffSessionRecord(value).length === 0;
}

export function npAnalyzeMemberSessionRecord(
  value: unknown,
  path = "memberSession",
): NpAuthContractIssue[] {
  return analyzeSessionRecord(value, "memberId", memberSessionRecordKeys, path);
}

export function npIsMemberSessionRecord(value: unknown): value is NpMemberSessionRecord {
  return npAnalyzeMemberSessionRecord(value).length === 0;
}

export function npRequireTokenPayload<TAudience extends NpAuthTokenAudience>(
  value: unknown,
  audience: TAudience,
): NpAuthTokenPayloadBase<TAudience> {
  const issues = analyzeTokenPayload(value, audience);
  if (issues.length > 0) throw new NpAuthContractError("Invalid auth token", issues);
  return value as NpAuthTokenPayloadBase<TAudience>;
}
