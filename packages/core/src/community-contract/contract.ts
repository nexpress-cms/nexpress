import { npAuthContractLimits, npMemberHandlePattern } from "../auth-contract/contract.js";
import { npMemberStatuses } from "../auth-contract/types.js";
import { npCollectionDocumentStatuses } from "../collection-contract/types.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  npCommunityAuditActorKinds,
  npCommunityBanKinds,
  npCommunityBanScopes,
  npCommunityCapabilities,
  npCommunityCommentSorts,
  npCommunityCommentStatuses,
  npCommunityDocumentAudiences,
  npCommunityDigestCadences,
  npCommunityFollowActivityKinds,
  npCommunityModerationVerdictKinds,
  npCommunityReportResolutionActions,
  npCommunityReportStatuses,
  npCommunityScopes,
  npCommunityThreadModerationActions,
  npMemberProfileActivityKinds,
  type AuditActor,
  type AuditActorKind,
  type AuditEventRow,
  type BanKind,
  type BanScope,
  type CommunityRoleDefinition,
  type NpCommunityScopeOptionWire,
  type NpAuditEventWireRow,
  type NpAuditPageWire,
  type NpBanRow,
  type NpBanWireRow,
  type NpCommentAuthor,
  type NpCommentListItemWire,
  type NpCommentListWire,
  type NpCommentRow,
  type NpCommentWireRow,
  type NpContentEngagementSummary,
  type NpContentViewReceiptWire,
  type NpContentViewRow,
  type NpCommunityContractIssue,
  type NpCommunityContractResult,
  type NpCommunityDocumentAudience,
  type NpCommunityJsonObject,
  type NpCommunityJsonValue,
  type NpCommunityRuntimeDiagnostic,
  type NpCommunitySettings,
  type NpCommunitySettingsPatch,
  type NpFollowRow,
  type NpFollowActivityNotificationPayload,
  type NpFollowActivityKind,
  type NpFollowTarget,
  type NpFollowWireRow,
  type NpEngagementTarget,
  type NpMarkNotificationsReadRequest,
  type NpMarkNotificationsReadWire,
  type NpMemberMuteSummary,
  type NpMemberMuteRow,
  type NpMemberProfileActivityItemWire,
  type NpMemberProfileActivityKind,
  type NpMemberProfileActivityPageWire,
  type NpMemberProfileActivityQuery,
  type NpMemberProfileCommentActivityWire,
  type NpMemberProfileDocumentActivityWire,
  type NpMemberPurgeResult,
  type NpMemberRoleGrantRow,
  type NpMemberRoleGrantWireRow,
  type NpModerationReportPageWire,
  type NpModerationReportWireRow,
  type NpModerationCheckContext,
  type NpModerationVerdict,
  type NpNotificationKindMeta,
  type NpNotificationListWire,
  type NpNotificationPrefs,
  type NpNotificationRow,
  type NpNotificationWireRow,
  type NpPageWire,
  type NpPublicMemberProfileWire,
  type NpReactionRow,
  type NpReactionSummaryWire,
  type NpReactionWireRow,
  type NpReportPageWire,
  type NpReportResolutionAction,
  type NpReportRow,
  type NpReportStatus,
  type NpReportTarget,
  type NpReportWireRow,
  type NpReportTargetContextKind,
  type NpReportTargetContextWire,
  type NpThreadModerationAction,
  type NpThreadModerationRequest,
  type NpResolveReportRequest,
  type NpReputationEvent,
  type RecordAuditEventInput,
} from "./types.js";

export const npCommunityContractLimits = {
  idLength: 128,
  targetTypeLength: 80,
  targetIdLength: 512,
  bodyLength: 5_000,
  htmlLength: 100_000,
  reasonLength: 1_000,
  labelLength: 120,
  descriptionLength: 500,
  roleLength: 80,
  sourceLength: 160,
  actionLength: 120,
  reactionKinds: 32,
  notificationKinds: 256,
  pageRows: 200,
  markReadIds: 200,
  jsonDepth: 16,
  jsonNodes: 5_000,
  jsonObjectKeys: 500,
  jsonKeyLength: 160,
  jsonStringLength: 16_000,
  diagnostics: 100,
  profileActivityPageRows: 50,
  profileActivityExcerptLength: 240,
} as const;

export const npCommunityReactionKindPattern = "^[a-z][a-z0-9_-]{0,29}$";
export const npCommunityKindPattern = "^[a-z][a-z0-9_-]{0,39}(?:\\.[a-z][a-z0-9_-]{0,39})*$";
export const npCommunityRolePattern = "^[a-z][a-z0-9_-]{0,79}$";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REACTION_KIND_PATTERN = new RegExp(npCommunityReactionKindPattern, "u");
const KIND_PATTERN = new RegExp(npCommunityKindPattern, "u");
const ROLE_PATTERN = new RegExp(npCommunityRolePattern, "u");
const MEMBER_HANDLE_PATTERN = new RegExp(npMemberHandlePattern, "u");
const VIEWER_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ENGAGEMENT_TARGET_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ENGAGEMENT_TARGET_TYPE_MAX_LENGTH = 63;
const COMMENT_STATUSES = new Set<string>(npCommunityCommentStatuses);
const DOCUMENT_STATUSES = new Set<string>(npCollectionDocumentStatuses);
const COMMENT_SORTS = new Set<string>(npCommunityCommentSorts);
const DOCUMENT_AUDIENCES = new Set<string>(npCommunityDocumentAudiences);
const FOLLOW_ACTIVITY_KINDS = new Set<string>(npCommunityFollowActivityKinds);
const REPORT_STATUSES = new Set<string>(npCommunityReportStatuses);
const REPORT_RESOLUTION_ACTIONS = new Set<string>(npCommunityReportResolutionActions);
const REPORT_CONTEXT_KINDS = new Set<string>(["comment", "document", "member", "missing"]);
const BAN_SCOPES = new Set<string>(npCommunityBanScopes);
const BAN_KINDS = new Set<string>(npCommunityBanKinds);
const SCOPES = new Set<string>(npCommunityScopes);
const DIGEST_CADENCES = new Set<string>(npCommunityDigestCadences);
const VERDICT_KINDS = new Set<string>(npCommunityModerationVerdictKinds);
const AUDIT_ACTORS = new Set<string>(npCommunityAuditActorKinds);
const CAPABILITIES = new Set<string>(npCommunityCapabilities);
const THREAD_MODERATION_ACTIONS = new Set<string>(npCommunityThreadModerationActions);
const MEMBER_STATUSES = new Set<string>(npMemberStatuses);
const PROFILE_ACTIVITY_KINDS = new Set<string>(npMemberProfileActivityKinds);

export class NpCommunityContractError extends Error {
  readonly contractIssues: NpCommunityContractIssue[];

  constructor(message: string, issues: NpCommunityContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpCommunityContractError";
    this.contractIssues = issues;
  }
}

function fail(
  path: string,
  message: string,
  code: NpCommunityContractIssue["code"] = "invalid-field",
): never {
  throw new NpCommunityContractError("Invalid community contract", [{ code, path, message }]);
}

function analyze<T>(parser: () => T): NpCommunityContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      return { ok: false, issues: error.contractIssues };
    }
    return {
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "community",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function npRequireCommunityContract<T>(
  result: NpCommunityContractResult<T>,
  message = "Invalid community contract",
): T {
  if (result.ok) return result.value;
  throw new NpCommunityContractError(message, result.issues);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function plainDataKeys(value: Record<string, unknown>, path: string): string[] {
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(path, "must not contain symbol properties", "shape");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(`${path}.${key}`, "must be an enumerable plain data property", "shape");
    }
    keys.push(key);
  }
  return keys;
}

function optionalRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(path, "must be a plain object", "shape");
  const keys = plainDataKeys(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "is not supported", "unknown-field");
  }
  const present = new Set(keys);
  for (const key of required) {
    if (!present.has(key)) fail(`${path}.${key}`, "is required", "shape");
  }
  return value;
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  return optionalRecord(value, path, keys);
}

function boundedString(
  value: unknown,
  path: string,
  max: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string {
  if (typeof value !== "string") fail(path, "must be text");
  const parsed = options.trim ? value.trim() : value;
  if (parsed.length > max || (!options.allowEmpty && parsed.length === 0)) {
    fail(path, `must be ${options.allowEmpty ? "bounded" : "non-empty bounded"} text`);
  }
  if (options.trim && parsed !== value)
    fail(path, "must not contain leading or trailing whitespace");
  if (
    Array.from(parsed).some((character) => {
      const code = character.charCodeAt(0);
      return code === 0 || code === 0x7f;
    })
  ) {
    fail(path, "must not contain NUL or DEL control characters");
  }
  return parsed;
}

function boundedNullableString(value: unknown, path: string, max: number): string | null {
  return value === null ? null : boundedString(value, path, max);
}

function uuid(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 36);
  if (!UUID_PATTERN.test(parsed)) fail(path, "must be a UUID");
  return parsed;
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

export function npRequireCommunityId(value: unknown, path = "community.id"): string {
  return uuid(value, path);
}

function siteId(value: unknown, path: string): string {
  if (!npIsCanonicalSiteId(value)) fail(path, "must be a canonical site id");
  return value;
}

function nullableSiteId(value: unknown, path: string): string | null {
  return value === null ? null : siteId(value, path);
}

function canonicalIso(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a canonical UTC ISO timestamp");
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    fail(path, "must be a canonical UTC ISO timestamp");
  }
  return value;
}

function nullableIso(value: unknown, path: string): string | null {
  return value === null ? null : canonicalIso(value, path);
}

export function npRequireCommunityTimestamp(value: unknown, path = "community.timestamp"): string {
  return canonicalIso(value, path);
}

function validDate(value: unknown, path: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail(path, "must be a valid Date");
  return new Date(value.valueOf());
}

function nullableDate(value: unknown, path: string): Date | null {
  return value === null ? null : validDate(value, path);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(path, "must be a non-negative safe integer");
  }
  return value;
}

function safeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(path, "must be a safe integer");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail(path, "must be a positive safe integer");
  return parsed;
}

function enumString<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail(path, `must be one of: ${Array.from(allowed).join(", ")}`);
  }
  return value as T;
}

function safeArrayValues(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array", "shape");
  if (value.length > max) fail(path, `may contain at most ${max.toString()} entries`, "limit");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length),
    )
  ) {
    fail(path, "must be a dense array without custom properties", "shape");
  }
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(`${path}[${index.toString()}]`, "must be an enumerable data item", "shape");
    }
    out.push(descriptor.value);
  }
  return out;
}

function normalizeJson(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  state: { nodes: number },
): NpCommunityJsonValue {
  state.nodes += 1;
  if (state.nodes > npCommunityContractLimits.jsonNodes) {
    fail(path, "exceeds the community JSON node limit", "limit");
  }
  if (depth > npCommunityContractLimits.jsonDepth) {
    fail(path, "exceeds the community JSON depth limit", "limit");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return boundedString(value, path, npCommunityContractLimits.jsonStringLength, {
      allowEmpty: true,
    });
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must be a finite number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value === null) fail(path, "must be JSON-compatible");
  if (ancestors.has(value)) fail(path, "must not contain circular references", "shape");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return safeArrayValues(value, path, npCommunityContractLimits.jsonNodes).map((entry, index) =>
        normalizeJson(entry, `${path}[${index.toString()}]`, depth + 1, ancestors, state),
      );
    }
    if (!isPlainRecord(value)) fail(path, "must be JSON-compatible", "shape");
    const keys = plainDataKeys(value, path);
    if (keys.length > npCommunityContractLimits.jsonObjectKeys) {
      fail(path, "contains too many object keys", "limit");
    }
    const result: NpCommunityJsonObject = {};
    for (const key of keys) {
      boundedString(key, `${path}.<key>`, npCommunityContractLimits.jsonKeyLength);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const normalized = normalizeJson(
        descriptor && "value" in descriptor ? descriptor.value : undefined,
        `${path}.${key}`,
        depth + 1,
        ancestors,
        state,
      );
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: normalized,
        writable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function npRequireCommunityJsonObject(
  value: unknown,
  path = "community.payload",
): NpCommunityJsonObject {
  const parsed = normalizeJson(value, path, 0, new WeakSet(), { nodes: 0 });
  if (Array.isArray(parsed) || parsed === null || typeof parsed !== "object") {
    fail(path, "must be a JSON object", "shape");
  }
  return parsed;
}

function reactionKind(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 30);
  if (!REACTION_KIND_PATTERN.test(parsed)) fail(path, "must be a canonical reaction kind");
  return parsed;
}

function notificationKind(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 81);
  if (!KIND_PATTERN.test(parsed)) fail(path, "must be a canonical notification kind");
  return parsed;
}

export function npRequireNotificationKind(
  value: unknown,
  path = "community.notificationKind",
): string {
  return notificationKind(value, path);
}

function opaqueTarget(value: unknown, path: string): string {
  return boundedString(value, path, npCommunityContractLimits.targetIdLength, { trim: true });
}

function targetType(value: unknown, path: string): string {
  return boundedString(value, path, npCommunityContractLimits.targetTypeLength, { trim: true });
}

function engagementTargetType(value: unknown, path: string): string {
  const parsed = boundedString(value, path, ENGAGEMENT_TARGET_TYPE_MAX_LENGTH, { trim: true });
  if (!ENGAGEMENT_TARGET_TYPE_PATTERN.test(parsed)) {
    fail(path, "must be comment or a canonical collection slug");
  }
  return parsed;
}

function reportTargetType(value: unknown, path: string): NpReportTarget {
  return engagementTargetType(value, path);
}

function calendarDate(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 10);
  if (!CALENDAR_DATE_PATTERN.test(parsed)) fail(path, "must be a canonical calendar date");
  const date = new Date(`${parsed}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== parsed) {
    fail(path, "must be a real canonical calendar date");
  }
  return parsed;
}

function stringArray(
  value: unknown,
  path: string,
  max: number,
  parser: (entry: unknown, path: string) => string,
): string[] {
  const result = safeArrayValues(value, path, max).map((entry, index) =>
    parser(entry, `${path}[${index.toString()}]`),
  );
  if (new Set(result).size !== result.length)
    fail(path, "must not contain duplicates", "duplicate");
  return result;
}

function nullableQuota(value: unknown, path: string): number | null {
  if (value === null) return null;
  const parsed = nonNegativeInteger(value, path);
  if (parsed > 1_000_000) fail(path, "must not exceed 1000000", "limit");
  return parsed;
}

export function npRequireCommunitySettings(value: unknown): NpCommunitySettings {
  const raw = exactRecord(value, "community.settings", [
    "reactionKinds",
    "registrationEnabled",
    "memberUploadQuota",
  ]);
  const quota = exactRecord(raw.memberUploadQuota, "community.settings.memberUploadQuota", [
    "perDay",
    "total",
  ]);
  if (typeof raw.registrationEnabled !== "boolean") {
    fail("community.settings.registrationEnabled", "must be a boolean");
  }
  return {
    reactionKinds: stringArray(
      raw.reactionKinds,
      "community.settings.reactionKinds",
      npCommunityContractLimits.reactionKinds,
      reactionKind,
    ),
    registrationEnabled: raw.registrationEnabled,
    memberUploadQuota: {
      perDay: nullableQuota(quota.perDay, "community.settings.memberUploadQuota.perDay"),
      total: nullableQuota(quota.total, "community.settings.memberUploadQuota.total"),
    },
  };
}

export function npAnalyzeCommunitySettings(
  value: unknown,
): NpCommunityContractResult<NpCommunitySettings> {
  return analyze(() => npRequireCommunitySettings(value));
}

export function npRequireCommunitySettingsPatch(value: unknown): NpCommunitySettingsPatch {
  const raw = optionalRecord(
    value,
    "community.settingsPatch",
    [],
    ["reactionKinds", "registrationEnabled", "memberUploadQuota"],
  );
  const patch: NpCommunitySettingsPatch = {};
  if ("reactionKinds" in raw) {
    patch.reactionKinds = stringArray(
      raw.reactionKinds,
      "community.settingsPatch.reactionKinds",
      npCommunityContractLimits.reactionKinds,
      reactionKind,
    );
  }
  if ("registrationEnabled" in raw) {
    if (typeof raw.registrationEnabled !== "boolean") {
      fail("community.settingsPatch.registrationEnabled", "must be a boolean");
    }
    patch.registrationEnabled = raw.registrationEnabled;
  }
  if ("memberUploadQuota" in raw) {
    const quota = optionalRecord(
      raw.memberUploadQuota,
      "community.settingsPatch.memberUploadQuota",
      [],
      ["perDay", "total"],
    );
    const memberUploadQuota: Partial<NpCommunitySettings["memberUploadQuota"]> = {};
    if ("perDay" in quota) {
      memberUploadQuota.perDay = nullableQuota(
        quota.perDay,
        "community.settingsPatch.memberUploadQuota.perDay",
      );
    }
    if ("total" in quota) {
      memberUploadQuota.total = nullableQuota(
        quota.total,
        "community.settingsPatch.memberUploadQuota.total",
      );
    }
    patch.memberUploadQuota = memberUploadQuota;
  }
  return patch;
}

export function npRequireNotificationKindMeta(
  value: unknown,
  path = "community.notificationKind",
): NpNotificationKindMeta {
  const raw = exactRecord(value, path, ["kind", "label", "description"]);
  return {
    kind: notificationKind(raw.kind, `${path}.kind`),
    label: boundedString(raw.label, `${path}.label`, npCommunityContractLimits.labelLength, {
      trim: true,
    }),
    description: boundedString(
      raw.description,
      `${path}.description`,
      npCommunityContractLimits.descriptionLength,
      { trim: true },
    ),
  };
}

export function npRequireNotificationKindCatalog(value: unknown): NpNotificationKindMeta[] {
  const result = safeArrayValues(
    value,
    "community.notificationKinds",
    npCommunityContractLimits.notificationKinds,
  ).map((entry, index) =>
    npRequireNotificationKindMeta(entry, `community.notificationKinds[${index.toString()}]`),
  );
  const seen = new Set<string>();
  for (const meta of result) {
    if (seen.has(meta.kind)) {
      fail("community.notificationKinds", `contains duplicate kind ${meta.kind}`, "duplicate");
    }
    seen.add(meta.kind);
  }
  return result;
}

function lastDigestAtBySite(
  value: unknown,
  path: string,
): Record<string, Partial<Record<(typeof npCommunityDigestCadences)[number], string>>> {
  if (!isPlainRecord(value)) fail(path, "must be a plain object", "shape");
  const result: Record<
    string,
    Partial<Record<(typeof npCommunityDigestCadences)[number], string>>
  > = {};
  for (const key of plainDataKeys(value, path)) {
    siteId(key, `${path}.<siteId>`);
    const rawCadences = optionalRecord(value[key], `${path}.${key}`, [], npCommunityDigestCadences);
    const parsed: Partial<Record<(typeof npCommunityDigestCadences)[number], string>> = {};
    for (const cadence of plainDataKeys(rawCadences, `${path}.${key}`)) {
      parsed[cadence as (typeof npCommunityDigestCadences)[number]] = canonicalIso(
        rawCadences[cadence],
        `${path}.${key}.${cadence}`,
      );
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: parsed,
      writable: true,
    });
  }
  return result;
}

export function npRequireNotificationPrefs(
  value: unknown,
  options: { knownKinds?: ReadonlySet<string> } = {},
): NpNotificationPrefs {
  const raw = optionalRecord(
    value,
    "community.notificationPrefs",
    [],
    ["disabled", "digest", "lastDigestAt", "lastDigestAtBySite"],
  );
  const disabled = stringArray(
    raw.disabled ?? [],
    "community.notificationPrefs.disabled",
    npCommunityContractLimits.notificationKinds,
    notificationKind,
  );
  if (options.knownKinds) {
    const unknown = disabled.find((kind) => !options.knownKinds?.has(kind));
    if (unknown) fail("community.notificationPrefs.disabled", `contains unknown kind ${unknown}`);
  }
  return {
    disabled,
    digest:
      raw.digest === undefined
        ? "off"
        : enumString(raw.digest, "community.notificationPrefs.digest", DIGEST_CADENCES),
    lastDigestAt:
      raw.lastDigestAt === undefined
        ? null
        : nullableIso(raw.lastDigestAt, "community.notificationPrefs.lastDigestAt"),
    lastDigestAtBySite: lastDigestAtBySite(
      raw.lastDigestAtBySite ?? {},
      "community.notificationPrefs.lastDigestAtBySite",
    ),
  };
}

export function npAnalyzeNotificationPrefs(
  value: unknown,
  options: { knownKinds?: ReadonlySet<string> } = {},
): NpCommunityContractResult<NpNotificationPrefs> {
  return analyze(() => npRequireNotificationPrefs(value, options));
}

export function npRequireNotificationPrefsPatch(
  value: unknown,
  knownKinds: ReadonlySet<string>,
): { disabled?: string[]; digest?: (typeof npCommunityDigestCadences)[number] } {
  const raw = optionalRecord(value, "community.notificationPrefsPatch", [], ["disabled", "digest"]);
  if (plainDataKeys(raw, "community.notificationPrefsPatch").length === 0) {
    fail("community.notificationPrefsPatch", "must change disabled or digest", "invariant");
  }
  const patch: { disabled?: string[]; digest?: (typeof npCommunityDigestCadences)[number] } = {};
  if ("disabled" in raw) {
    const disabled = stringArray(
      raw.disabled,
      "community.notificationPrefsPatch.disabled",
      npCommunityContractLimits.notificationKinds,
      notificationKind,
    );
    const unknown = disabled.find((kind) => !knownKinds.has(kind));
    if (unknown)
      fail("community.notificationPrefsPatch.disabled", `contains unknown kind ${unknown}`);
    patch.disabled = disabled;
  }
  if ("digest" in raw) {
    patch.digest = enumString<(typeof npCommunityDigestCadences)[number]>(
      raw.digest,
      "community.notificationPrefsPatch.digest",
      DIGEST_CADENCES,
    );
  }
  return patch;
}

export function npRequireModerationCheckContext(value: unknown): NpModerationCheckContext {
  const raw = optionalRecord(
    value,
    "community.moderationContext",
    ["memberId", "targetType", "targetId"],
    ["parentId"],
  );
  return {
    memberId: uuid(raw.memberId, "community.moderationContext.memberId"),
    targetType: targetType(raw.targetType, "community.moderationContext.targetType"),
    // Member document creates run moderation before the generated document id
    // exists, so the empty string is the intentional pre-insert sentinel.
    targetId: boundedString(raw.targetId, "community.moderationContext.targetId", 512, {
      allowEmpty: true,
    }),
    ...(raw.parentId !== undefined
      ? { parentId: nullableUuid(raw.parentId, "community.moderationContext.parentId") }
      : {}),
  };
}

export function npRequireModerationVerdict(value: unknown): NpModerationVerdict {
  const raw = optionalRecord(
    value,
    "community.moderationVerdict",
    ["kind"],
    ["reason", "metadata"],
  );
  const kind = enumString<NpModerationVerdict["kind"]>(
    raw.kind,
    "community.moderationVerdict.kind",
    VERDICT_KINDS,
  );
  const result: NpModerationVerdict = { kind };
  if (raw.reason !== undefined) {
    result.reason = boundedString(
      raw.reason,
      "community.moderationVerdict.reason",
      npCommunityContractLimits.reasonLength,
      { trim: true },
    );
  }
  if (raw.metadata !== undefined) {
    result.metadata = npRequireCommunityJsonObject(
      raw.metadata,
      "community.moderationVerdict.metadata",
    );
  }
  return result;
}

export function npAnalyzeModerationVerdict(
  value: unknown,
): NpCommunityContractResult<NpModerationVerdict> {
  return analyze(() => npRequireModerationVerdict(value));
}

function requireEventBase(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("community.reputationEvent", "must be a plain object", "shape");
  plainDataKeys(value, "community.reputationEvent");
  return value;
}

export function npRequireReputationEvent(value: unknown): NpReputationEvent {
  const base = requireEventBase(value);
  const kind = boundedString(base.kind, "community.reputationEvent.kind", 40);
  switch (kind) {
    case "comment.created": {
      const raw = exactRecord(base, "community.reputationEvent", [
        "kind",
        "commentId",
        "memberId",
        "targetType",
        "targetId",
      ]);
      return {
        kind,
        commentId: uuid(raw.commentId, "community.reputationEvent.commentId"),
        memberId: uuid(raw.memberId, "community.reputationEvent.memberId"),
        targetType: targetType(raw.targetType, "community.reputationEvent.targetType"),
        targetId: opaqueTarget(raw.targetId, "community.reputationEvent.targetId"),
      };
    }
    case "comment.hidden": {
      const raw = optionalRecord(
        base,
        "community.reputationEvent",
        ["kind", "commentId", "memberId", "byStaff"],
        ["reason"],
      );
      if (typeof raw.byStaff !== "boolean")
        fail("community.reputationEvent.byStaff", "must be a boolean");
      return {
        kind,
        commentId: uuid(raw.commentId, "community.reputationEvent.commentId"),
        memberId: uuid(raw.memberId, "community.reputationEvent.memberId"),
        byStaff: raw.byStaff,
        ...(raw.reason !== undefined
          ? {
              reason:
                raw.reason === null
                  ? null
                  : boundedString(
                      raw.reason,
                      "community.reputationEvent.reason",
                      npCommunityContractLimits.reasonLength,
                      { trim: true },
                    ),
            }
          : {}),
      };
    }
    case "comment.deleted": {
      const raw = exactRecord(base, "community.reputationEvent", [
        "kind",
        "commentId",
        "memberId",
        "byStaff",
      ]);
      if (typeof raw.byStaff !== "boolean")
        fail("community.reputationEvent.byStaff", "must be a boolean");
      return {
        kind,
        commentId: uuid(raw.commentId, "community.reputationEvent.commentId"),
        memberId: uuid(raw.memberId, "community.reputationEvent.memberId"),
        byStaff: raw.byStaff,
      };
    }
    case "reaction.received":
    case "reaction.removed": {
      const raw = exactRecord(base, "community.reputationEvent", [
        "kind",
        "reactionKind",
        "recipientId",
        "reactorId",
        "targetType",
        "targetId",
      ]);
      return {
        kind,
        reactionKind: reactionKind(raw.reactionKind, "community.reputationEvent.reactionKind"),
        recipientId: uuid(raw.recipientId, "community.reputationEvent.recipientId"),
        reactorId: uuid(raw.reactorId, "community.reputationEvent.reactorId"),
        targetType: targetType(raw.targetType, "community.reputationEvent.targetType"),
        targetId: opaqueTarget(raw.targetId, "community.reputationEvent.targetId"),
      };
    }
    case "document.created":
    case "document.deleted": {
      const raw = exactRecord(base, "community.reputationEvent", [
        "kind",
        "collectionSlug",
        "documentId",
        "memberId",
      ]);
      return {
        kind,
        collectionSlug: targetType(raw.collectionSlug, "community.reputationEvent.collectionSlug"),
        documentId: uuid(raw.documentId, "community.reputationEvent.documentId"),
        memberId: uuid(raw.memberId, "community.reputationEvent.memberId"),
      };
    }
    default:
      fail("community.reputationEvent.kind", `unsupported reputation event ${kind}`);
  }
}

export function npRequireReputationDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    fail("community.reputationDelta", "must be a finite safe integer");
  }
  return value;
}

export function npRequireCommunityRoleDefinition(
  value: unknown,
  path = "community.role",
): CommunityRoleDefinition {
  const raw = optionalRecord(
    value,
    path,
    ["role", "scopeType", "capabilities"],
    ["label", "source"],
  );
  const role = boundedString(raw.role, `${path}.role`, npCommunityContractLimits.roleLength);
  if (!ROLE_PATTERN.test(role)) fail(`${path}.role`, "must be a canonical role id");
  const capabilities = stringArray(
    raw.capabilities,
    `${path}.capabilities`,
    npCommunityCapabilities.length,
    (entry, entryPath) => enumString(entry, entryPath, CAPABILITIES),
  ) as CommunityRoleDefinition["capabilities"];
  return {
    role,
    scopeType: enumString(raw.scopeType, `${path}.scopeType`, SCOPES),
    capabilities,
    ...(raw.label !== undefined
      ? {
          label: boundedString(raw.label, `${path}.label`, npCommunityContractLimits.labelLength, {
            trim: true,
          }),
        }
      : {}),
    ...(raw.source !== undefined
      ? {
          source: boundedString(
            raw.source,
            `${path}.source`,
            npCommunityContractLimits.sourceLength,
            {
              trim: true,
            },
          ),
        }
      : {}),
  };
}

export function npRequireCommunityRoleCatalog(value: unknown): CommunityRoleDefinition[] {
  const roles = safeArrayValues(value, "community.roles", 128).map((entry, index) =>
    npRequireCommunityRoleDefinition(entry, `community.roles[${index.toString()}]`),
  );
  const seen = new Set<string>();
  for (const role of roles) {
    const key = `${role.scopeType}:${role.role}`;
    if (seen.has(key)) fail("community.roles", `contains duplicate role ${key}`, "duplicate");
    seen.add(key);
  }
  return roles;
}

function parseCommentCommon(
  value: unknown,
  path: string,
  wire: boolean,
): NpCommentRow | NpCommentWireRow {
  const raw = optionalRecord(
    value,
    path,
    [
      "id",
      "targetType",
      "targetId",
      "parentId",
      "memberId",
      "bodyMd",
      "bodyHtml",
      "status",
      "hiddenByUserId",
      "hiddenByMemberId",
      "hiddenReason",
      "editedAt",
      "siteId",
      "createdAt",
    ],
    ["authorStatus"],
  );
  const common = {
    id: uuid(raw.id, `${path}.id`),
    targetType: engagementTargetType(raw.targetType, `${path}.targetType`),
    targetId: uuid(raw.targetId, `${path}.targetId`),
    parentId: nullableUuid(raw.parentId, `${path}.parentId`),
    memberId: uuid(raw.memberId, `${path}.memberId`),
    bodyMd: boundedString(raw.bodyMd, `${path}.bodyMd`, npCommunityContractLimits.bodyLength, {
      allowEmpty: true,
    }),
    bodyHtml: boundedString(
      raw.bodyHtml,
      `${path}.bodyHtml`,
      npCommunityContractLimits.htmlLength,
      {
        allowEmpty: true,
      },
    ),
    status: enumString<NpCommentRow["status"]>(raw.status, `${path}.status`, COMMENT_STATUSES),
    hiddenByUserId: nullableUuid(raw.hiddenByUserId, `${path}.hiddenByUserId`),
    hiddenByMemberId: nullableUuid(raw.hiddenByMemberId, `${path}.hiddenByMemberId`),
    hiddenReason: boundedNullableString(
      raw.hiddenReason,
      `${path}.hiddenReason`,
      npCommunityContractLimits.reasonLength,
    ),
    siteId: siteId(raw.siteId, `${path}.siteId`),
    ...(raw.authorStatus !== undefined
      ? {
          authorStatus:
            raw.authorStatus === null
              ? null
              : enumString(raw.authorStatus, `${path}.authorStatus`, MEMBER_STATUSES),
        }
      : {}),
  };
  if (wire) {
    return {
      ...common,
      editedAt: nullableIso(raw.editedAt, `${path}.editedAt`),
      createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`),
    };
  }
  return {
    ...common,
    editedAt: nullableDate(raw.editedAt, `${path}.editedAt`),
    createdAt: validDate(raw.createdAt, `${path}.createdAt`),
  };
}

export function npRequireCommentRow(value: unknown): NpCommentRow {
  return parseCommentCommon(value, "community.comment", false) as NpCommentRow;
}

export function npRequireCommentWireRow(value: unknown): NpCommentWireRow {
  return parseCommentCommon(value, "community.comment", true) as NpCommentWireRow;
}

export function npToCommentWireRow(value: unknown): NpCommentWireRow {
  const row = npRequireCommentRow(value);
  return npRequireCommentWireRow({
    ...row,
    editedAt: row.editedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

function npRequireCommentAuthor(value: unknown, path: string): NpCommentAuthor {
  const raw = exactRecord(value, path, ["handle", "displayName", "avatarUrl"]);
  const handle = boundedString(raw.handle, `${path}.handle`, 30);
  if (!MEMBER_HANDLE_PATTERN.test(handle)) {
    fail(`${path}.handle`, "must be a canonical member handle");
  }
  const displayName = boundedString(raw.displayName, `${path}.displayName`, 120, {
    allowEmpty: true,
  });
  let avatarUrl: string | null = null;
  if (raw.avatarUrl !== null) {
    const candidate = boundedString(raw.avatarUrl, `${path}.avatarUrl`, 2_048);
    const local = candidate.startsWith("/") && !candidate.startsWith("//");
    let parsed: URL;
    try {
      parsed = new URL(candidate, "https://nexpress.invalid");
    } catch {
      fail(`${path}.avatarUrl`, "must be a valid HTTP(S) or local URL");
    }
    if (
      parsed.username ||
      parsed.password ||
      (local && (candidate.includes("\\") || parsed.origin !== "https://nexpress.invalid")) ||
      (!local &&
        (!/^https?:\/\//iu.test(candidate) ||
          (parsed.protocol !== "http:" && parsed.protocol !== "https:")))
    ) {
      fail(`${path}.avatarUrl`, "must be an HTTP(S) URL or a local absolute path");
    }
    avatarUrl = candidate;
  }
  return { handle, displayName, avatarUrl };
}

export function npRequirePublicMemberProfileWire(value: unknown): NpPublicMemberProfileWire {
  const path = "community.publicMemberProfile";
  const raw = exactRecord(value, path, [
    "id",
    "handle",
    "displayName",
    "avatarUrl",
    "bio",
    "reputation",
    "joinedAt",
  ]);
  const author = npRequireCommentAuthor(
    {
      handle: raw.handle,
      displayName: raw.displayName,
      avatarUrl: raw.avatarUrl,
    },
    path,
  );
  if (author.displayName.length === 0) {
    fail(`${path}.displayName`, "must not be empty");
  }
  if (author.displayName.length > npAuthContractLimits.displayNameLength) {
    fail(`${path}.displayName`, "exceeds the public member display-name limit", "limit");
  }
  const bio = boundedNullableString(raw.bio, `${path}.bio`, npAuthContractLimits.bioLength);
  return {
    id: uuid(raw.id, `${path}.id`),
    ...author,
    bio,
    reputation: safeInteger(raw.reputation, `${path}.reputation`),
    joinedAt: canonicalIso(raw.joinedAt, `${path}.joinedAt`),
  };
}

function profileActivityHref(value: unknown, path: string): string | null {
  if (value === null) return null;
  try {
    return npRequireNotificationHref(value);
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      fail(path, error.message);
    }
    throw error;
  }
}

function npRequireMemberProfileDocumentActivityWire(
  value: unknown,
): NpMemberProfileDocumentActivityWire {
  const path = "community.memberProfileActivity.document";
  const raw = exactRecord(value, path, [
    "kind",
    "collectionSlug",
    "collectionLabel",
    "documentId",
    "title",
    "href",
    "createdAt",
    "updatedAt",
  ]);
  if (raw.kind !== "document") fail(`${path}.kind`, 'must be "document"');
  return {
    kind: "document",
    collectionSlug: targetType(raw.collectionSlug, `${path}.collectionSlug`),
    collectionLabel: boundedString(raw.collectionLabel, `${path}.collectionLabel`, 120),
    documentId: uuid(raw.documentId, `${path}.documentId`),
    title: boundedString(raw.title, `${path}.title`, 240),
    href: profileActivityHref(raw.href, `${path}.href`),
    createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`),
    updatedAt: canonicalIso(raw.updatedAt, `${path}.updatedAt`),
  };
}

function npRequireMemberProfileCommentActivityWire(
  value: unknown,
): NpMemberProfileCommentActivityWire {
  const path = "community.memberProfileActivity.comment";
  const raw = exactRecord(value, path, [
    "kind",
    "commentId",
    "targetType",
    "targetId",
    "targetTitle",
    "href",
    "excerpt",
    "createdAt",
    "editedAt",
  ]);
  if (raw.kind !== "comment") fail(`${path}.kind`, 'must be "comment"');
  return {
    kind: "comment",
    commentId: uuid(raw.commentId, `${path}.commentId`),
    targetType: targetType(raw.targetType, `${path}.targetType`),
    targetId: uuid(raw.targetId, `${path}.targetId`),
    targetTitle: boundedString(raw.targetTitle, `${path}.targetTitle`, 240),
    href: profileActivityHref(raw.href, `${path}.href`),
    excerpt: boundedString(
      raw.excerpt,
      `${path}.excerpt`,
      npCommunityContractLimits.profileActivityExcerptLength,
      { allowEmpty: true },
    ),
    createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`),
    editedAt: nullableIso(raw.editedAt, `${path}.editedAt`),
  };
}

export function npRequireMemberProfileActivityItemWire(
  value: unknown,
): NpMemberProfileActivityItemWire {
  if (!isPlainRecord(value)) fail("community.memberProfileActivity", "must be a plain object");
  if (value.kind === "document") return npRequireMemberProfileDocumentActivityWire(value);
  if (value.kind === "comment") return npRequireMemberProfileCommentActivityWire(value);
  fail("community.memberProfileActivity.kind", "must be document or comment");
}

export function npRequireMemberProfileActivityQuery(value: unknown): NpMemberProfileActivityQuery {
  const path = "community.memberProfileActivityQuery";
  const raw = exactRecord(value, path, ["kind", "page", "limit"]);
  const limit = positiveInteger(raw.limit, `${path}.limit`);
  if (limit > npCommunityContractLimits.profileActivityPageRows) {
    fail(`${path}.limit`, "exceeds profile activity page limit", "limit");
  }
  const page = positiveInteger(raw.page, `${path}.page`);
  if (page > 10_000) fail(`${path}.page`, "exceeds profile activity page bound", "limit");
  return {
    kind: enumString<NpMemberProfileActivityKind>(raw.kind, `${path}.kind`, PROFILE_ACTIVITY_KINDS),
    page,
    limit,
  };
}

export function npRequireMemberProfileActivityPageWire(
  value: unknown,
): NpMemberProfileActivityPageWire {
  const path = "community.memberProfileActivityPage";
  const raw = exactRecord(value, path, [
    "kind",
    "items",
    "totalDocs",
    "totalPages",
    "page",
    "limit",
    "hasNextPage",
    "hasPrevPage",
  ]);
  const kind = enumString<NpMemberProfileActivityKind>(
    raw.kind,
    `${path}.kind`,
    PROFILE_ACTIVITY_KINDS,
  );
  const parsed = pageWire(
    {
      docs: raw.items,
      totalDocs: raw.totalDocs,
      totalPages: raw.totalPages,
      page: raw.page,
      limit: raw.limit,
      hasNextPage: raw.hasNextPage,
      hasPrevPage: raw.hasPrevPage,
    },
    path,
    npRequireMemberProfileActivityItemWire,
  );
  if (parsed.limit > npCommunityContractLimits.profileActivityPageRows) {
    fail(`${path}.limit`, "exceeds profile activity page limit", "limit");
  }
  for (const [index, item] of parsed.docs.entries()) {
    if ((kind === "documents") !== (item.kind === "document")) {
      fail(`${path}.items.${index.toString()}.kind`, "does not match the activity page kind");
    }
  }
  return { kind, items: parsed.docs, ...withoutDocs(parsed) };
}

function withoutDocs<T>(page: NpPageWire<T>): Omit<NpPageWire<T>, "docs"> {
  const { docs: _docs, ...rest } = page;
  return rest;
}

export function npRequireCommentListItemWire(value: unknown): NpCommentListItemWire {
  const raw = optionalRecord(
    value,
    "community.commentListItem",
    [
      "id",
      "targetType",
      "targetId",
      "parentId",
      "memberId",
      "bodyMd",
      "bodyHtml",
      "status",
      "hiddenByUserId",
      "hiddenByMemberId",
      "hiddenReason",
      "editedAt",
      "siteId",
      "createdAt",
      "author",
      "reactions",
    ],
    ["authorStatus"],
  );
  const comment = npRequireCommentWireRow({
    id: raw.id,
    targetType: raw.targetType,
    targetId: raw.targetId,
    parentId: raw.parentId,
    memberId: raw.memberId,
    bodyMd: raw.bodyMd,
    bodyHtml: raw.bodyHtml,
    status: raw.status,
    hiddenByUserId: raw.hiddenByUserId,
    hiddenByMemberId: raw.hiddenByMemberId,
    hiddenReason: raw.hiddenReason,
    editedAt: raw.editedAt,
    siteId: raw.siteId,
    createdAt: raw.createdAt,
    ...(raw.authorStatus !== undefined ? { authorStatus: raw.authorStatus } : {}),
  });
  return {
    ...comment,
    author:
      raw.author === null
        ? null
        : npRequireCommentAuthor(raw.author, "community.commentListItem.author"),
    reactions: npRequireReactionSummaryWire(raw.reactions),
  };
}

export function npToCommentListItemWire(value: unknown): NpCommentListItemWire {
  const raw = optionalRecord(
    value,
    "community.commentListItem",
    ["author", "reactions"],
    [
      "id",
      "targetType",
      "targetId",
      "parentId",
      "memberId",
      "bodyMd",
      "bodyHtml",
      "status",
      "hiddenByUserId",
      "hiddenByMemberId",
      "hiddenReason",
      "editedAt",
      "siteId",
      "createdAt",
      "authorStatus",
    ],
  );
  const { author, reactions, ...commentInput } = raw;
  const comment = npToCommentWireRow(commentInput);
  return npRequireCommentListItemWire({
    ...comment,
    author,
    reactions,
  });
}

function parseReactionCommon(
  value: unknown,
  path: string,
  wire: boolean,
): NpReactionRow | NpReactionWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "targetType",
    "targetId",
    "memberId",
    "kind",
    "siteId",
    "createdAt",
  ]);
  const common = {
    id: uuid(raw.id, `${path}.id`),
    targetType: targetType(raw.targetType, `${path}.targetType`),
    targetId: uuid(raw.targetId, `${path}.targetId`),
    memberId: uuid(raw.memberId, `${path}.memberId`),
    kind: reactionKind(raw.kind, `${path}.kind`),
    siteId: siteId(raw.siteId, `${path}.siteId`),
  };
  return wire
    ? { ...common, createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`) }
    : { ...common, createdAt: validDate(raw.createdAt, `${path}.createdAt`) };
}

export function npRequireReactionRow(value: unknown): NpReactionRow {
  return parseReactionCommon(value, "community.reaction", false) as NpReactionRow;
}

export function npRequireReactionWireRow(value: unknown): NpReactionWireRow {
  return parseReactionCommon(value, "community.reaction", true) as NpReactionWireRow;
}

export function npToReactionWireRow(value: unknown): NpReactionWireRow {
  const row = npRequireReactionRow(value);
  return npRequireReactionWireRow({ ...row, createdAt: row.createdAt.toISOString() });
}

export function npRequireContentViewRow(value: unknown): NpContentViewRow {
  const raw = exactRecord(value, "community.contentView", [
    "id",
    "targetType",
    "targetId",
    "viewerHash",
    "viewedOn",
    "siteId",
    "createdAt",
  ]);
  const viewerHash = boundedString(raw.viewerHash, "community.contentView.viewerHash", 64);
  if (!VIEWER_HASH_PATTERN.test(viewerHash)) {
    fail("community.contentView.viewerHash", "must be a lowercase SHA-256 digest");
  }
  return {
    id: uuid(raw.id, "community.contentView.id"),
    targetType: engagementTargetType(raw.targetType, "community.contentView.targetType"),
    targetId: uuid(raw.targetId, "community.contentView.targetId"),
    viewerHash,
    viewedOn: calendarDate(raw.viewedOn, "community.contentView.viewedOn"),
    siteId: siteId(raw.siteId, "community.contentView.siteId"),
    createdAt: validDate(raw.createdAt, "community.contentView.createdAt"),
  };
}

function parseFollowCommon(
  value: unknown,
  path: string,
  wire: boolean,
): NpFollowRow | NpFollowWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "followerId",
    "targetType",
    "targetId",
    "siteId",
    "createdAt",
  ]);
  const common = {
    id: uuid(raw.id, `${path}.id`),
    followerId: uuid(raw.followerId, `${path}.followerId`),
    targetType: targetType(raw.targetType, `${path}.targetType`),
    targetId: uuid(raw.targetId, `${path}.targetId`),
    siteId: siteId(raw.siteId, `${path}.siteId`),
  };
  return wire
    ? { ...common, createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`) }
    : { ...common, createdAt: validDate(raw.createdAt, `${path}.createdAt`) };
}

export function npRequireFollowRow(value: unknown): NpFollowRow {
  return parseFollowCommon(value, "community.follow", false) as NpFollowRow;
}

export function npRequireFollowWireRow(value: unknown): NpFollowWireRow {
  return parseFollowCommon(value, "community.follow", true) as NpFollowWireRow;
}

export function npToFollowWireRow(value: unknown): NpFollowWireRow {
  const row = npRequireFollowRow(value);
  return npRequireFollowWireRow({ ...row, createdAt: row.createdAt.toISOString() });
}

function parseNotificationCommon(
  value: unknown,
  path: string,
  wire: boolean,
): NpNotificationRow | NpNotificationWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "memberId",
    "kind",
    "payload",
    "readAt",
    "siteId",
    "createdAt",
  ]);
  const kind = notificationKind(raw.kind, `${path}.kind`);
  const common = {
    id: uuid(raw.id, `${path}.id`),
    memberId: uuid(raw.memberId, `${path}.memberId`),
    kind,
    payload: npRequireNotificationPayload(kind, raw.payload),
    siteId: siteId(raw.siteId, `${path}.siteId`),
  };
  return wire
    ? {
        ...common,
        readAt: nullableIso(raw.readAt, `${path}.readAt`),
        createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`),
      }
    : {
        ...common,
        readAt: nullableDate(raw.readAt, `${path}.readAt`),
        createdAt: validDate(raw.createdAt, `${path}.createdAt`),
      };
}

export function npRequireNotificationPayload(kind: string, value: unknown): NpCommunityJsonObject {
  const checkedKind = notificationKind(kind, "community.notification.kind");
  if (checkedKind === "follow.activity") {
    return { ...npRequireFollowActivityNotificationPayload(value) };
  }
  return npRequireCommunityJsonObject(value, "community.notification.payload");
}

export function npRequireNotificationRow(value: unknown): NpNotificationRow {
  return parseNotificationCommon(value, "community.notification", false) as NpNotificationRow;
}

export function npRequireNotificationWireRow(value: unknown): NpNotificationWireRow {
  return parseNotificationCommon(value, "community.notification", true) as NpNotificationWireRow;
}

export function npToNotificationWireRow(value: unknown): NpNotificationWireRow {
  const row = npRequireNotificationRow(value);
  return npRequireNotificationWireRow({
    ...row,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

function parseReportCommon(
  value: unknown,
  path: string,
  wire: boolean,
): NpReportRow | NpReportWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "reporterId",
    "targetType",
    "targetId",
    "reason",
    "resolvedAt",
    "resolvedByUserId",
    "resolvedByMemberId",
    "resolution",
    "siteId",
    "createdAt",
  ]);
  const common = {
    id: uuid(raw.id, `${path}.id`),
    reporterId: uuid(raw.reporterId, `${path}.reporterId`),
    targetType: reportTargetType(raw.targetType, `${path}.targetType`),
    targetId: uuid(raw.targetId, `${path}.targetId`),
    reason: boundedString(raw.reason, `${path}.reason`, npCommunityContractLimits.reasonLength, {
      trim: true,
    }),
    resolvedByUserId: nullableUuid(raw.resolvedByUserId, `${path}.resolvedByUserId`),
    resolvedByMemberId: nullableUuid(raw.resolvedByMemberId, `${path}.resolvedByMemberId`),
    resolution:
      raw.resolution === null
        ? null
        : enumString<NpReportResolutionAction>(
            raw.resolution,
            `${path}.resolution`,
            REPORT_RESOLUTION_ACTIONS,
          ),
    siteId: siteId(raw.siteId, `${path}.siteId`),
  };
  if ((raw.resolvedAt === null) !== (raw.resolution === null)) {
    fail(path, "resolvedAt and resolution must be null or populated together", "invariant");
  }
  const resolutionActors =
    Number(common.resolvedByUserId !== null) + Number(common.resolvedByMemberId !== null);
  if (raw.resolvedAt === null && resolutionActors !== 0) {
    fail(path, "unresolved reports cannot name a resolution actor", "invariant");
  }
  if (raw.resolvedAt !== null && resolutionActors !== 1) {
    fail(path, "resolved reports require exactly one resolution actor", "invariant");
  }
  return wire
    ? {
        ...common,
        resolvedAt: nullableIso(raw.resolvedAt, `${path}.resolvedAt`),
        createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`),
      }
    : {
        ...common,
        resolvedAt: nullableDate(raw.resolvedAt, `${path}.resolvedAt`),
        createdAt: validDate(raw.createdAt, `${path}.createdAt`),
      };
}

export function npRequireReportRow(value: unknown): NpReportRow {
  return parseReportCommon(value, "community.report", false) as NpReportRow;
}

export function npRequireReportWireRow(value: unknown): NpReportWireRow {
  return parseReportCommon(value, "community.report", true) as NpReportWireRow;
}

export function npToReportWireRow(value: unknown): NpReportWireRow {
  const row = npRequireReportRow(value);
  return npRequireReportWireRow({
    ...row,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

export function npRequireReportTargetContextWire(value: unknown): NpReportTargetContextWire {
  const raw = exactRecord(value, "community.reportTargetContext", [
    "kind",
    "label",
    "excerpt",
    "status",
    "href",
    "collectionSlug",
    "documentId",
    "authorMemberId",
  ]);
  const kind = enumString<NpReportTargetContextKind>(
    raw.kind,
    "community.reportTargetContext.kind",
    REPORT_CONTEXT_KINDS,
  );
  const href =
    raw.href === null ? null : boundedString(raw.href, "community.reportTargetContext.href", 512);
  if (href !== null && !href.startsWith("/admin/")) {
    fail("community.reportTargetContext.href", "must be an internal Admin path");
  }
  const collectionSlug =
    raw.collectionSlug === null
      ? null
      : engagementTargetType(raw.collectionSlug, "community.reportTargetContext.collectionSlug");
  const documentId =
    raw.documentId === null
      ? null
      : uuid(raw.documentId, "community.reportTargetContext.documentId");
  const authorMemberId =
    raw.authorMemberId === null
      ? null
      : uuid(raw.authorMemberId, "community.reportTargetContext.authorMemberId");
  if (kind === "document" && (collectionSlug === null || documentId === null || href === null)) {
    fail(
      "community.reportTargetContext",
      "document targets require collectionSlug, documentId, and href",
      "invariant",
    );
  }
  if (kind === "comment" && (collectionSlug === null || documentId === null || href === null)) {
    fail(
      "community.reportTargetContext",
      "comment targets require their parent collection, document, and href",
      "invariant",
    );
  }
  if (
    kind === "member" &&
    (href === null || collectionSlug !== null || documentId !== null || authorMemberId === null)
  ) {
    fail(
      "community.reportTargetContext",
      "member targets require only their author id and Admin href",
      "invariant",
    );
  }
  if (
    kind === "missing" &&
    (href !== null || collectionSlug !== null || documentId !== null || authorMemberId !== null)
  ) {
    fail(
      "community.reportTargetContext",
      "missing targets cannot expose stale identifiers or links",
      "invariant",
    );
  }
  const status =
    raw.status === null
      ? null
      : kind === "comment"
        ? enumString<string>(raw.status, "community.reportTargetContext.status", COMMENT_STATUSES)
        : kind === "document"
          ? enumString<string>(
              raw.status,
              "community.reportTargetContext.status",
              DOCUMENT_STATUSES,
            )
          : kind === "member"
            ? enumString<string>(
                raw.status,
                "community.reportTargetContext.status",
                MEMBER_STATUSES,
              )
            : boundedString(raw.status, "community.reportTargetContext.status", 40);
  if ((kind === "missing") !== (status === null)) {
    fail(
      "community.reportTargetContext.status",
      "resolved targets require a status and missing targets require null",
      "invariant",
    );
  }
  return {
    kind,
    label: boundedString(
      raw.label,
      "community.reportTargetContext.label",
      npCommunityContractLimits.labelLength,
    ),
    excerpt: boundedNullableString(
      raw.excerpt,
      "community.reportTargetContext.excerpt",
      npCommunityContractLimits.descriptionLength,
    ),
    status,
    href,
    collectionSlug,
    documentId,
    authorMemberId,
  };
}

export function npRequireModerationReportWireRow(value: unknown): NpModerationReportWireRow {
  const raw = exactRecord(value, "community.moderationReport", [
    "id",
    "reporterId",
    "targetType",
    "targetId",
    "reason",
    "resolvedAt",
    "resolvedByUserId",
    "resolvedByMemberId",
    "resolution",
    "siteId",
    "createdAt",
    "target",
  ]);
  const report = npRequireReportWireRow({
    id: raw.id,
    reporterId: raw.reporterId,
    targetType: raw.targetType,
    targetId: raw.targetId,
    reason: raw.reason,
    resolvedAt: raw.resolvedAt,
    resolvedByUserId: raw.resolvedByUserId,
    resolvedByMemberId: raw.resolvedByMemberId,
    resolution: raw.resolution,
    siteId: raw.siteId,
    createdAt: raw.createdAt,
  });
  return { ...report, target: npRequireReportTargetContextWire(raw.target) };
}

function parseBanCommon(value: unknown, path: string, wire: boolean): NpBanRow | NpBanWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "memberId",
    "scopeType",
    "scopeId",
    "kind",
    "expiresAt",
    "reason",
    "byUserId",
    "byMemberId",
    "siteId",
    "createdAt",
  ]);
  const scopeType = enumString<BanScope>(raw.scopeType, `${path}.scopeType`, BAN_SCOPES);
  const kind = enumString<BanKind>(raw.kind, `${path}.kind`, BAN_KINDS);
  const scopeId =
    raw.scopeId === null
      ? null
      : boundedString(raw.scopeId, `${path}.scopeId`, 160, { trim: true });
  if ((scopeType === "site") !== (scopeId === null)) {
    fail(
      `${path}.scopeId`,
      "must be null for site bans and populated for scoped bans",
      "invariant",
    );
  }
  if ((raw.byUserId === null) === (raw.byMemberId === null)) {
    fail(path, "must contain exactly one ban actor", "invariant");
  }
  if (kind === "temporary" && raw.expiresAt === null) {
    fail(`${path}.expiresAt`, "temporary bans require expiresAt", "invariant");
  }
  if (kind === "permanent" && raw.expiresAt !== null) {
    fail(`${path}.expiresAt`, "permanent bans must not expire", "invariant");
  }
  const common = {
    id: uuid(raw.id, `${path}.id`),
    memberId: uuid(raw.memberId, `${path}.memberId`),
    scopeType,
    scopeId,
    kind,
    reason: boundedNullableString(
      raw.reason,
      `${path}.reason`,
      npCommunityContractLimits.reasonLength,
    ),
    byUserId: nullableUuid(raw.byUserId, `${path}.byUserId`),
    byMemberId: nullableUuid(raw.byMemberId, `${path}.byMemberId`),
    siteId: siteId(raw.siteId, `${path}.siteId`),
  };
  return wire
    ? {
        ...common,
        expiresAt: nullableIso(raw.expiresAt, `${path}.expiresAt`),
        createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`),
      }
    : {
        ...common,
        expiresAt: nullableDate(raw.expiresAt, `${path}.expiresAt`),
        createdAt: validDate(raw.createdAt, `${path}.createdAt`),
      };
}

export function npRequireBanRow(value: unknown): NpBanRow {
  return parseBanCommon(value, "community.ban", false) as NpBanRow;
}

export function npRequireBanWireRow(value: unknown): NpBanWireRow {
  return parseBanCommon(value, "community.ban", true) as NpBanWireRow;
}

export function npToBanWireRow(value: unknown): NpBanWireRow {
  const row = npRequireBanRow(value);
  return npRequireBanWireRow({
    ...row,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

function parseRoleGrantCommon(
  value: unknown,
  path: string,
  wire: boolean,
): NpMemberRoleGrantRow | NpMemberRoleGrantWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "memberId",
    "role",
    "scopeType",
    "scopeId",
    "grantedBy",
    "grantedAt",
    "expiresAt",
    "siteId",
  ]);
  const scopeType = enumString<NpMemberRoleGrantRow["scopeType"]>(
    raw.scopeType,
    `${path}.scopeType`,
    SCOPES,
  );
  const scopeId =
    raw.scopeId === null
      ? null
      : boundedString(raw.scopeId, `${path}.scopeId`, 160, { trim: true });
  if ((scopeType === "site") !== (scopeId === null)) {
    fail(`${path}.scopeId`, "must be null for site grants and populated otherwise", "invariant");
  }
  const role = boundedString(raw.role, `${path}.role`, npCommunityContractLimits.roleLength);
  if (!ROLE_PATTERN.test(role)) fail(`${path}.role`, "must be a canonical role id");
  const common = {
    id: uuid(raw.id, `${path}.id`),
    memberId: uuid(raw.memberId, `${path}.memberId`),
    role,
    scopeType,
    scopeId,
    grantedBy: nullableUuid(raw.grantedBy, `${path}.grantedBy`),
    siteId: siteId(raw.siteId, `${path}.siteId`),
  };
  return wire
    ? {
        ...common,
        grantedAt: canonicalIso(raw.grantedAt, `${path}.grantedAt`),
        expiresAt: nullableIso(raw.expiresAt, `${path}.expiresAt`),
      }
    : {
        ...common,
        grantedAt: validDate(raw.grantedAt, `${path}.grantedAt`),
        expiresAt: nullableDate(raw.expiresAt, `${path}.expiresAt`),
      };
}

export function npRequireMemberRoleGrantRow(value: unknown): NpMemberRoleGrantRow {
  return parseRoleGrantCommon(value, "community.roleGrant", false) as NpMemberRoleGrantRow;
}

export function npRequireMemberRoleGrantWireRow(value: unknown): NpMemberRoleGrantWireRow {
  return parseRoleGrantCommon(value, "community.roleGrant", true) as NpMemberRoleGrantWireRow;
}

export function npToMemberRoleGrantWireRow(value: unknown): NpMemberRoleGrantWireRow {
  const row = npRequireMemberRoleGrantRow(value);
  return npRequireMemberRoleGrantWireRow({
    ...row,
    grantedAt: row.grantedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  });
}

export function npRequireRecordAuditEventInput(value: unknown): RecordAuditEventInput {
  const raw = optionalRecord(
    value,
    "community.auditInput",
    ["actor", "action"],
    ["targetType", "targetId", "payload", "siteId"],
  );
  const actorBase = optionalRecord(
    raw.actor,
    "community.auditInput.actor",
    ["kind"],
    ["userId", "memberId"],
  );
  const kind = enumString<AuditActorKind>(
    actorBase.kind,
    "community.auditInput.actor.kind",
    AUDIT_ACTORS,
  );
  let actor: AuditActor;
  if (kind === "staff") {
    const checked = exactRecord(actorBase, "community.auditInput.actor", ["kind", "userId"]);
    actor = { kind, userId: uuid(checked.userId, "community.auditInput.actor.userId") };
  } else if (kind === "member") {
    const checked = exactRecord(actorBase, "community.auditInput.actor", ["kind", "memberId"]);
    actor = { kind, memberId: uuid(checked.memberId, "community.auditInput.actor.memberId") };
  } else {
    exactRecord(actorBase, "community.auditInput.actor", ["kind"]);
    actor = { kind };
  }

  const checkedTargetType =
    raw.targetType === undefined
      ? null
      : targetType(raw.targetType, "community.auditInput.targetType");
  const checkedTargetId =
    raw.targetId === undefined ? null : opaqueTarget(raw.targetId, "community.auditInput.targetId");
  if ((checkedTargetType === null) !== (checkedTargetId === null)) {
    fail(
      "community.auditInput",
      "targetType and targetId must be omitted or populated together",
      "invariant",
    );
  }

  return {
    actor,
    action: boundedString(
      raw.action,
      "community.auditInput.action",
      npCommunityContractLimits.actionLength,
      { trim: true },
    ),
    ...(checkedTargetType !== null && checkedTargetId !== null
      ? { targetType: checkedTargetType, targetId: checkedTargetId }
      : {}),
    ...(raw.payload === undefined
      ? {}
      : { payload: npRequireCommunityJsonObject(raw.payload, "community.auditInput.payload") }),
    ...(raw.siteId === undefined
      ? {}
      : { siteId: nullableSiteId(raw.siteId, "community.auditInput.siteId") }),
  };
}

function parseAuditCommon(
  value: unknown,
  path: string,
  wire: boolean,
): AuditEventRow | NpAuditEventWireRow {
  const raw = exactRecord(value, path, [
    "id",
    "actorKind",
    "actorUserId",
    "actorMemberId",
    "action",
    "targetType",
    "targetId",
    "payload",
    "siteId",
    "createdAt",
  ]);
  const actorKind = enumString<AuditEventRow["actorKind"]>(
    raw.actorKind,
    `${path}.actorKind`,
    AUDIT_ACTORS,
  );
  const actorUserId = nullableUuid(raw.actorUserId, `${path}.actorUserId`);
  const actorMemberId = nullableUuid(raw.actorMemberId, `${path}.actorMemberId`);
  if (
    (actorKind === "staff" && (actorUserId === null || actorMemberId !== null)) ||
    (actorKind === "member" && (actorMemberId === null || actorUserId !== null)) ||
    (actorKind === "system" && (actorUserId !== null || actorMemberId !== null))
  ) {
    fail(path, "actor ids do not match actorKind", "invariant");
  }
  const common = {
    id: uuid(raw.id, `${path}.id`),
    actorKind,
    actorUserId,
    actorMemberId,
    action: boundedString(raw.action, `${path}.action`, npCommunityContractLimits.actionLength, {
      trim: true,
    }),
    targetType: raw.targetType === null ? null : targetType(raw.targetType, `${path}.targetType`),
    targetId: raw.targetId === null ? null : opaqueTarget(raw.targetId, `${path}.targetId`),
    payload: npRequireCommunityJsonObject(raw.payload, `${path}.payload`),
    siteId: nullableSiteId(raw.siteId, `${path}.siteId`),
  };
  if ((common.targetType === null) !== (common.targetId === null)) {
    fail(path, "targetType and targetId must be null or populated together", "invariant");
  }
  return wire
    ? { ...common, createdAt: canonicalIso(raw.createdAt, `${path}.createdAt`) }
    : { ...common, createdAt: validDate(raw.createdAt, `${path}.createdAt`) };
}

export function npRequireAuditEventRow(value: unknown): AuditEventRow {
  return parseAuditCommon(value, "community.auditEvent", false) as AuditEventRow;
}

export function npRequireAuditEventWireRow(value: unknown): NpAuditEventWireRow {
  return parseAuditCommon(value, "community.auditEvent", true) as NpAuditEventWireRow;
}

export function npToAuditEventWireRow(value: unknown): NpAuditEventWireRow {
  const row = npRequireAuditEventRow(value);
  return npRequireAuditEventWireRow({ ...row, createdAt: row.createdAt.toISOString() });
}

function pageWire<T>(value: unknown, path: string, parseRow: (value: unknown) => T): NpPageWire<T> {
  const raw = exactRecord(value, path, [
    "docs",
    "totalDocs",
    "totalPages",
    "page",
    "limit",
    "hasNextPage",
    "hasPrevPage",
  ]);
  const docs = safeArrayValues(raw.docs, `${path}.docs`, npCommunityContractLimits.pageRows).map(
    parseRow,
  );
  const totalDocs = nonNegativeInteger(raw.totalDocs, `${path}.totalDocs`);
  const totalPages = nonNegativeInteger(raw.totalPages, `${path}.totalPages`);
  const page = positiveInteger(raw.page, `${path}.page`);
  const limit = positiveInteger(raw.limit, `${path}.limit`);
  if (limit > npCommunityContractLimits.pageRows) fail(`${path}.limit`, "exceeds page row limit");
  if (typeof raw.hasNextPage !== "boolean" || typeof raw.hasPrevPage !== "boolean") {
    fail(path, "pagination flags must be booleans");
  }
  const expectedPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);
  if (totalPages !== expectedPages)
    fail(`${path}.totalPages`, "does not match totalDocs and limit", "invariant");
  if (docs.length > totalDocs) fail(`${path}.docs`, "cannot exceed totalDocs", "invariant");
  if (docs.length > limit) fail(`${path}.docs`, "cannot exceed the page limit", "invariant");
  if (raw.hasNextPage !== page < totalPages) {
    fail(`${path}.hasNextPage`, "does not match page and totalPages", "invariant");
  }
  if (raw.hasPrevPage !== (page > 1 && totalDocs > 0)) {
    fail(`${path}.hasPrevPage`, "does not match page and totalDocs", "invariant");
  }
  return {
    docs,
    totalDocs,
    totalPages,
    page,
    limit,
    hasNextPage: raw.hasNextPage,
    hasPrevPage: raw.hasPrevPage,
  };
}

export function npRequireCommentListWire(value: unknown): NpCommentListWire {
  const raw = exactRecord(value, "community.commentList", [
    "comments",
    "totalDocs",
    "limit",
    "offset",
    "hasNextPage",
    "hasPrevPage",
  ]);
  const comments = safeArrayValues(
    raw.comments,
    "community.commentList.comments",
    npCommunityContractLimits.pageRows,
  ).map(npRequireCommentListItemWire);
  const totalDocs = nonNegativeInteger(raw.totalDocs, "community.commentList.totalDocs");
  const limit = nonNegativeInteger(raw.limit, "community.commentList.limit");
  const offset = nonNegativeInteger(raw.offset, "community.commentList.offset");
  if (limit < 1 || limit > npCommunityContractLimits.pageRows) {
    fail("community.commentList.limit", "must be between 1 and the page row limit", "limit");
  }
  if (comments.length > totalDocs)
    fail("community.commentList.comments", "cannot exceed totalDocs", "invariant");
  if (comments.length > limit)
    fail("community.commentList.comments", "cannot exceed limit", "invariant");
  if (typeof raw.hasNextPage !== "boolean" || typeof raw.hasPrevPage !== "boolean") {
    fail("community.commentList", "pagination flags must be booleans");
  }
  const expectedNext = offset + comments.length < totalDocs;
  const expectedPrev = offset > 0 && totalDocs > 0;
  if (raw.hasNextPage !== expectedNext) {
    fail("community.commentList.hasNextPage", "does not match the returned window", "invariant");
  }
  if (raw.hasPrevPage !== expectedPrev) {
    fail("community.commentList.hasPrevPage", "does not match the returned window", "invariant");
  }
  return {
    comments,
    totalDocs,
    limit,
    offset,
    hasNextPage: raw.hasNextPage,
    hasPrevPage: raw.hasPrevPage,
  };
}

export function npRequireReactionSummaryWire(value: unknown): NpReactionSummaryWire {
  const raw = exactRecord(value, "community.reactionSummary", ["counts", "mine"]);
  if (!isPlainRecord(raw.counts))
    fail("community.reactionSummary.counts", "must be a plain object", "shape");
  const counts: Record<string, number> = {};
  const countKeys = plainDataKeys(raw.counts, "community.reactionSummary.counts");
  if (countKeys.length > npCommunityContractLimits.reactionKinds) {
    fail("community.reactionSummary.counts", "has too many reaction kinds", "limit");
  }
  for (const key of countKeys) {
    const checkedKey = reactionKind(key, "community.reactionSummary.counts.<kind>");
    Object.defineProperty(counts, checkedKey, {
      configurable: true,
      enumerable: true,
      value: nonNegativeInteger(raw.counts[key], `community.reactionSummary.counts.${key}`),
      writable: true,
    });
  }
  const mine = stringArray(
    raw.mine,
    "community.reactionSummary.mine",
    npCommunityContractLimits.reactionKinds,
    reactionKind,
  );
  return { counts, mine };
}

function reactionCounts(value: unknown, path: string): Record<string, number> {
  if (!isPlainRecord(value)) fail(path, "must be a plain object", "shape");
  const counts: Record<string, number> = {};
  const keys = plainDataKeys(value, path);
  if (keys.length > npCommunityContractLimits.reactionKinds) {
    fail(path, "has too many reaction kinds", "limit");
  }
  for (const key of keys) {
    const checkedKey = reactionKind(key, `${path}.<kind>`);
    Object.defineProperty(counts, checkedKey, {
      configurable: true,
      enumerable: true,
      value: nonNegativeInteger(value[key], `${path}.${key}`),
      writable: true,
    });
  }
  return counts;
}

export function npRequireContentEngagementSummary(
  value: unknown,
  path = "community.engagementSummary",
): NpContentEngagementSummary {
  const raw = exactRecord(value, path, [
    "targetType",
    "targetId",
    "viewCount",
    "commentCount",
    "reactionCount",
    "reactions",
  ]);
  const reactions = reactionCounts(raw.reactions, `${path}.reactions`);
  const reactionCount = nonNegativeInteger(raw.reactionCount, `${path}.reactionCount`);
  const summedReactions = Object.values(reactions).reduce((sum, count) => sum + count, 0);
  if (reactionCount !== summedReactions) {
    fail(`${path}.reactionCount`, "must equal the sum of per-kind reaction counts", "invariant");
  }
  return {
    targetType: engagementTargetType(raw.targetType, `${path}.targetType`),
    targetId: uuid(raw.targetId, `${path}.targetId`),
    viewCount: nonNegativeInteger(raw.viewCount, `${path}.viewCount`),
    commentCount: nonNegativeInteger(raw.commentCount, `${path}.commentCount`),
    reactionCount,
    reactions,
  };
}

export function npRequireContentEngagementSummaries(value: unknown): NpContentEngagementSummary[] {
  const summaries = safeArrayValues(
    value,
    "community.engagementSummaries",
    npCommunityContractLimits.pageRows,
  ).map((entry, index) =>
    npRequireContentEngagementSummary(entry, `community.engagementSummaries[${index.toString()}]`),
  );
  const keys = summaries.map((summary) => `${summary.targetType}:${summary.targetId}`);
  if (new Set(keys).size !== keys.length) {
    fail("community.engagementSummaries", "must not contain duplicate targets", "duplicate");
  }
  return summaries;
}

export function npRequireContentViewReceiptWire(value: unknown): NpContentViewReceiptWire {
  const raw = exactRecord(value, "community.contentViewReceipt", ["counted", "viewCount"]);
  if (typeof raw.counted !== "boolean") {
    fail("community.contentViewReceipt.counted", "must be a boolean");
  }
  return {
    counted: raw.counted,
    viewCount: nonNegativeInteger(raw.viewCount, "community.contentViewReceipt.viewCount"),
  };
}

export function npRequireNotificationListWire(value: unknown): NpNotificationListWire {
  const raw = exactRecord(value, "community.notificationList", [
    "notifications",
    "totalDocs",
    "unread",
  ]);
  const notifications = safeArrayValues(
    raw.notifications,
    "community.notificationList.notifications",
    npCommunityContractLimits.pageRows,
  ).map(npRequireNotificationWireRow);
  const totalDocs = nonNegativeInteger(raw.totalDocs, "community.notificationList.totalDocs");
  const unread = nonNegativeInteger(raw.unread, "community.notificationList.unread");
  if (notifications.length > totalDocs || unread > totalDocs) {
    fail("community.notificationList", "counts are inconsistent", "invariant");
  }
  return { notifications, totalDocs, unread };
}

export function npRequireReportPageWire(value: unknown): NpReportPageWire {
  return pageWire(value, "community.reportPage", npRequireReportWireRow);
}

export function npRequireModerationReportPageWire(value: unknown): NpModerationReportPageWire {
  return pageWire(value, "community.moderationReportPage", npRequireModerationReportWireRow);
}

export function npRequireAuditPageWire(value: unknown): NpAuditPageWire {
  return pageWire(value, "community.auditPage", npRequireAuditEventWireRow);
}

export function npRequireMarkNotificationsReadRequest(
  value: unknown,
): NpMarkNotificationsReadRequest {
  if (isPlainRecord(value) && value.all === true) {
    exactRecord(value, "community.markRead", ["all"]);
    return { all: true };
  }
  const raw = exactRecord(value, "community.markRead", ["ids"]);
  return {
    ids: stringArray(
      raw.ids,
      "community.markRead.ids",
      npCommunityContractLimits.markReadIds,
      uuid,
    ),
  };
}

export function npRequireMarkNotificationsReadWire(value: unknown): NpMarkNotificationsReadWire {
  const raw = optionalRecord(value, "community.markReadResult", ["marked"], ["all"]);
  const result: NpMarkNotificationsReadWire = {
    marked: nonNegativeInteger(raw.marked, "community.markReadResult.marked"),
  };
  if (raw.all !== undefined) {
    if (raw.all !== true) fail("community.markReadResult.all", "must be true when present");
    result.all = true;
  }
  return result;
}

export function npRequireNotificationPrefsWire(value: unknown): {
  prefs: NpNotificationPrefs;
  kinds: NpNotificationKindMeta[];
} {
  const raw = exactRecord(value, "community.notificationPrefsWire", ["prefs", "kinds"]);
  const kinds = npRequireNotificationKindCatalog(raw.kinds);
  return {
    prefs: npRequireNotificationPrefs(raw.prefs, {
      knownKinds: new Set(kinds.map((entry) => entry.kind)),
    }),
    kinds,
  };
}

export function npRequireNotificationPrefsUpdateWire(
  value: unknown,
  knownKinds?: ReadonlySet<string>,
): { prefs: NpNotificationPrefs } {
  const raw = exactRecord(value, "community.notificationPrefsUpdate", ["prefs"]);
  return { prefs: npRequireNotificationPrefs(raw.prefs, { knownKinds }) };
}

export function npRequireReportRequest(value: unknown): {
  targetType: NpReportTarget;
  targetId: string;
  reason: string;
} {
  const raw = exactRecord(value, "community.reportRequest", ["targetType", "targetId", "reason"]);
  return {
    targetType: reportTargetType(raw.targetType, "community.reportRequest.targetType"),
    targetId: uuid(raw.targetId, "community.reportRequest.targetId"),
    reason: boundedString(
      raw.reason,
      "community.reportRequest.reason",
      npCommunityContractLimits.reasonLength,
      { trim: true },
    ),
  };
}

export function npRequireEngagementTarget(value: unknown): NpEngagementTarget {
  const raw = exactRecord(value, "community.engagementTarget", ["targetType", "targetId"]);
  return {
    targetType: engagementTargetType(raw.targetType, "community.engagementTarget.targetType"),
    targetId: uuid(raw.targetId, "community.engagementTarget.targetId"),
  };
}

export function npRequireReactionTarget(value: unknown): NpEngagementTarget & {
  targetId: string;
  kind: string;
} {
  const raw = optionalRecord(
    value,
    "community.reactionRequest",
    ["targetType", "targetId"],
    ["kind"],
  );
  return {
    targetType: engagementTargetType(raw.targetType, "community.reactionRequest.targetType"),
    targetId: uuid(raw.targetId, "community.reactionRequest.targetId"),
    kind:
      raw.kind === undefined ? "like" : reactionKind(raw.kind, "community.reactionRequest.kind"),
  };
}

export function npRequireFollowTarget(value: unknown): {
  targetType: NpFollowTarget;
  targetId: string;
} {
  const raw = exactRecord(value, "community.followRequest", ["targetType", "targetId"]);
  return {
    targetType: engagementTargetType(raw.targetType, "community.followRequest.targetType"),
    targetId: uuid(raw.targetId, "community.followRequest.targetId"),
  };
}

export function npRequireFollowTargetType(value: unknown): NpFollowTarget {
  return engagementTargetType(value, "community.followRequest.targetType");
}

export function npRequireNotificationHref(value: unknown): string {
  const href = boundedString(value, "community.notification.href", 2048);
  const hasControlCharacter = Array.from(href).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href.includes("\\") ||
    hasControlCharacter
  ) {
    fail("community.notification.href", "must be a local absolute path");
  }
  let parsed: URL;
  try {
    parsed = new URL(href, "https://nexpress.invalid");
  } catch {
    fail("community.notification.href", "must be a valid local absolute path");
  }
  if (parsed.origin !== "https://nexpress.invalid" || parsed.username || parsed.password) {
    fail("community.notification.href", "must stay on the current site");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function npRequireFollowActivityNotificationPayload(
  value: unknown,
): NpFollowActivityNotificationPayload {
  const raw = exactRecord(value, "community.followActivity", [
    "activity",
    "subjectType",
    "subjectId",
    "targetType",
    "targetId",
    "href",
    "commentId",
  ]);
  const activity = enumString<NpFollowActivityKind>(
    raw.activity,
    "community.followActivity.activity",
    FOLLOW_ACTIVITY_KINDS,
  );
  const commentId =
    raw.commentId === null ? null : uuid(raw.commentId, "community.followActivity.commentId");
  if ((activity === "comment.created") !== (commentId !== null)) {
    fail(
      "community.followActivity.commentId",
      activity === "comment.created"
        ? "is required for comment activity"
        : "must be null for document activity",
    );
  }
  return {
    activity,
    subjectType: engagementTargetType(raw.subjectType, "community.followActivity.subjectType"),
    subjectId: uuid(raw.subjectId, "community.followActivity.subjectId"),
    targetType: engagementTargetType(raw.targetType, "community.followActivity.targetType"),
    targetId: uuid(raw.targetId, "community.followActivity.targetId"),
    href: npRequireNotificationHref(raw.href),
    commentId,
  };
}

export function npRequireCommentCreateRequest(value: unknown): {
  bodyMd: string;
  parentId: string | null;
} {
  const raw = optionalRecord(value, "community.commentCreate", ["bodyMd"], ["parentId"]);
  return {
    bodyMd: boundedString(
      raw.bodyMd,
      "community.commentCreate.bodyMd",
      npCommunityContractLimits.bodyLength,
      { trim: true },
    ),
    parentId:
      raw.parentId === undefined
        ? null
        : nullableUuid(raw.parentId, "community.commentCreate.parentId"),
  };
}

export function npRequireCommentUpdateRequest(value: unknown): { bodyMd: string } {
  const raw = exactRecord(value, "community.commentUpdate", ["bodyMd"]);
  return {
    bodyMd: boundedString(
      raw.bodyMd,
      "community.commentUpdate.bodyMd",
      npCommunityContractLimits.bodyLength,
      { trim: true },
    ),
  };
}

export function npRequireCommentHideRequest(value: unknown): { reason?: string | null } {
  const raw = optionalRecord(value, "community.commentHide", [], ["reason"]);
  return raw.reason === undefined
    ? {}
    : {
        reason:
          raw.reason === null
            ? null
            : boundedString(
                raw.reason,
                "community.commentHide.reason",
                npCommunityContractLimits.reasonLength,
                { trim: true },
              ),
      };
}

export function npRequireCommunityPagination(
  value: unknown,
  defaults: { limit?: number; page?: number } = {},
): { limit: number; page: number; offset: number } {
  const raw = optionalRecord(value, "community.pagination", [], ["limit", "page"]);
  const limit =
    raw.limit === undefined
      ? (defaults.limit ?? 50)
      : positiveInteger(raw.limit, "community.pagination.limit");
  const page =
    raw.page === undefined
      ? (defaults.page ?? 1)
      : positiveInteger(raw.page, "community.pagination.page");
  if (limit > npCommunityContractLimits.pageRows) {
    fail("community.pagination.limit", "exceeds page row limit", "limit");
  }
  if (page > 10_000) fail("community.pagination.page", "exceeds page limit", "limit");
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset))
    fail("community.pagination", "offset exceeds safe integer range", "limit");
  return { limit, page, offset };
}

export function npRequireCommunityWindow(
  value: unknown,
  defaults: { limit?: number; offset?: number } = {},
): { limit: number; offset: number } {
  const raw = optionalRecord(value, "community.window", [], ["limit", "offset"]);
  const limit =
    raw.limit === undefined
      ? (defaults.limit ?? 50)
      : positiveInteger(raw.limit, "community.window.limit");
  const offset =
    raw.offset === undefined
      ? (defaults.offset ?? 0)
      : nonNegativeInteger(raw.offset, "community.window.offset");
  if (limit > npCommunityContractLimits.pageRows) {
    fail("community.window.limit", "exceeds page row limit", "limit");
  }
  if (offset > 2_000_000) fail("community.window.offset", "exceeds offset limit", "limit");
  return { limit, offset };
}

export function npRequireBanRequest(value: unknown): {
  memberId: string;
  scopeType: BanScope;
  scopeId: string | null;
  kind: BanKind;
  expiresAt: string | null;
  reason: string | null;
} {
  const raw = optionalRecord(
    value,
    "community.banRequest",
    ["memberId", "scopeType", "kind"],
    ["scopeId", "expiresAt", "reason"],
  );
  const scopeType = enumString<BanScope>(
    raw.scopeType,
    "community.banRequest.scopeType",
    BAN_SCOPES,
  );
  const kind = enumString<BanKind>(raw.kind, "community.banRequest.kind", BAN_KINDS);
  const scopeId =
    raw.scopeId === undefined || raw.scopeId === null
      ? null
      : boundedString(raw.scopeId, "community.banRequest.scopeId", 160, { trim: true });
  const expiresAt =
    raw.expiresAt === undefined || raw.expiresAt === null
      ? null
      : canonicalIso(raw.expiresAt, "community.banRequest.expiresAt");
  if ((scopeType === "site") !== (scopeId === null)) {
    fail(
      "community.banRequest.scopeId",
      "must be null for site bans and populated otherwise",
      "invariant",
    );
  }
  if ((kind === "temporary") !== (expiresAt !== null)) {
    fail(
      "community.banRequest.expiresAt",
      "must be populated only for temporary bans",
      "invariant",
    );
  }
  return {
    memberId: uuid(raw.memberId, "community.banRequest.memberId"),
    scopeType,
    scopeId,
    kind,
    expiresAt,
    reason:
      raw.reason === undefined || raw.reason === null
        ? null
        : boundedString(
            raw.reason,
            "community.banRequest.reason",
            npCommunityContractLimits.reasonLength,
            { trim: true },
          ),
  };
}

export function npRequireRoleGrantRequest(value: unknown): {
  memberId: string;
  role: string;
  scopeType: CommunityRoleDefinition["scopeType"];
  scopeId: string | null;
  expiresAt: string | null;
} {
  const raw = optionalRecord(
    value,
    "community.roleGrantRequest",
    ["memberId", "role", "scopeType"],
    ["scopeId", "expiresAt"],
  );
  const scopeType = enumString<CommunityRoleDefinition["scopeType"]>(
    raw.scopeType,
    "community.roleGrantRequest.scopeType",
    SCOPES,
  );
  const role = boundedString(
    raw.role,
    "community.roleGrantRequest.role",
    npCommunityContractLimits.roleLength,
  );
  if (!ROLE_PATTERN.test(role))
    fail("community.roleGrantRequest.role", "must be a canonical role id");
  const scopeId =
    raw.scopeId === undefined || raw.scopeId === null
      ? null
      : boundedString(raw.scopeId, "community.roleGrantRequest.scopeId", 160, { trim: true });
  if ((scopeType === "site") !== (scopeId === null)) {
    fail(
      "community.roleGrantRequest.scopeId",
      "must be null for site grants and populated otherwise",
      "invariant",
    );
  }
  return {
    memberId: uuid(raw.memberId, "community.roleGrantRequest.memberId"),
    role,
    scopeType,
    scopeId,
    expiresAt:
      raw.expiresAt === undefined || raw.expiresAt === null
        ? null
        : canonicalIso(raw.expiresAt, "community.roleGrantRequest.expiresAt"),
  };
}

export function npRequireResolveReportRequest(value: unknown): NpResolveReportRequest {
  const raw = exactRecord(value, "community.resolveReport", ["action"]);
  return {
    action: enumString<NpReportResolutionAction>(
      raw.action,
      "community.resolveReport.action",
      REPORT_RESOLUTION_ACTIONS,
    ),
  };
}

export function npRequireMuteRequest(value: unknown): { targetId: string } {
  const raw = exactRecord(value, "community.muteRequest", ["targetId"]);
  return { targetId: uuid(raw.targetId, "community.muteRequest.targetId") };
}

export function npRequireOkWire(value: unknown): { ok: true } {
  const raw = exactRecord(value, "community.ok", ["ok"]);
  if (raw.ok !== true) fail("community.ok.ok", "must be true");
  return { ok: true };
}

export function npRequireThreadModerationRequest(value: unknown): NpThreadModerationRequest {
  const raw = optionalRecord(value, "community.threadModeration", ["action"], ["reason"]);
  const reason = raw.reason;
  return {
    action: enumString<NpThreadModerationAction>(
      raw.action,
      "community.threadModeration.action",
      THREAD_MODERATION_ACTIONS,
    ),
    ...(reason === undefined
      ? {}
      : {
          reason:
            reason === null
              ? null
              : boundedString(
                  reason,
                  "community.threadModeration.reason",
                  npCommunityContractLimits.reasonLength,
                  { trim: true },
                ),
        }),
  };
}

export function npRequireRemovedWire(value: unknown): { ok: true; removed: boolean } {
  const raw = exactRecord(value, "community.removed", ["ok", "removed"]);
  if (raw.ok !== true || typeof raw.removed !== "boolean") {
    fail("community.removed", "must contain ok=true and a boolean removed value");
  }
  return { ok: true, removed: raw.removed };
}

export function npRequireFollowingWire(value: unknown): { following: boolean } {
  const raw = exactRecord(value, "community.following", ["following"]);
  if (typeof raw.following !== "boolean")
    fail("community.following.following", "must be a boolean");
  return { following: raw.following };
}

export function npRequireUnreadWire(value: unknown): { unread: number } {
  const raw = exactRecord(value, "community.unread", ["unread"]);
  return { unread: nonNegativeInteger(raw.unread, "community.unread.unread") };
}

export function npRequireBanListWire(value: unknown): { docs: NpBanWireRow[] } {
  const raw = exactRecord(value, "community.banList", ["docs"]);
  return {
    docs: safeArrayValues(
      raw.docs,
      "community.banList.docs",
      npCommunityContractLimits.pageRows,
    ).map(npRequireBanWireRow),
  };
}

export function npRequireRoleGrantListWire(value: unknown): { docs: NpMemberRoleGrantWireRow[] } {
  const raw = exactRecord(value, "community.roleGrantList", ["docs"]);
  return {
    docs: safeArrayValues(
      raw.docs,
      "community.roleGrantList.docs",
      npCommunityContractLimits.pageRows,
    ).map(npRequireMemberRoleGrantWireRow),
  };
}

export function npRequireRoleCatalogWire(value: unknown): { docs: CommunityRoleDefinition[] } {
  const raw = exactRecord(value, "community.roleCatalog", ["docs"]);
  return { docs: npRequireCommunityRoleCatalog(raw.docs) };
}

export function npRequireCommunityScopeOptionWire(
  value: unknown,
  path = "community.scopeOption",
): NpCommunityScopeOptionWire {
  const raw = exactRecord(value, path, ["scopeType", "scopeId", "label", "sourceCollection"]);
  const scopeType = enumString<NpCommunityScopeOptionWire["scopeType"]>(
    raw.scopeType,
    `${path}.scopeType`,
    new Set(["category", "collection", "thread"]),
  );
  const scopeId =
    scopeType === "collection"
      ? engagementTargetType(raw.scopeId, `${path}.scopeId`)
      : uuid(raw.scopeId, `${path}.scopeId`);
  return {
    scopeType,
    scopeId,
    label: boundedString(raw.label, `${path}.label`, npCommunityContractLimits.labelLength),
    sourceCollection: engagementTargetType(raw.sourceCollection, `${path}.sourceCollection`),
  };
}

export function npRequireCommunityScopeCatalogWire(value: unknown): {
  docs: NpCommunityScopeOptionWire[];
} {
  const raw = exactRecord(value, "community.scopeCatalog", ["docs"]);
  return {
    docs: safeArrayValues(
      raw.docs,
      "community.scopeCatalog.docs",
      npCommunityContractLimits.pageRows,
    ).map((entry, index) =>
      npRequireCommunityScopeOptionWire(entry, `community.scopeCatalog.docs[${index.toString()}]`),
    ),
  };
}

export function npRequireMuteSummary(value: unknown): NpMemberMuteSummary {
  const raw = exactRecord(value, "community.mute", [
    "targetId",
    "handle",
    "displayName",
    "createdAt",
  ]);
  return {
    targetId: uuid(raw.targetId, "community.mute.targetId"),
    handle: boundedString(raw.handle, "community.mute.handle", 30),
    displayName: boundedString(raw.displayName, "community.mute.displayName", 120, {
      allowEmpty: true,
    }),
    createdAt: canonicalIso(raw.createdAt, "community.mute.createdAt"),
  };
}

export function npRequireMemberMuteRow(value: unknown): NpMemberMuteRow {
  const raw = exactRecord(value, "community.muteRow", [
    "memberId",
    "targetId",
    "siteId",
    "createdAt",
  ]);
  return {
    memberId: uuid(raw.memberId, "community.muteRow.memberId"),
    targetId: uuid(raw.targetId, "community.muteRow.targetId"),
    siteId: siteId(raw.siteId, "community.muteRow.siteId"),
    createdAt: validDate(raw.createdAt, "community.muteRow.createdAt"),
  };
}

export function npRequireMuteListWire(value: unknown): { mutes: NpMemberMuteSummary[] } {
  const raw = exactRecord(value, "community.muteList", ["mutes"]);
  return {
    mutes: safeArrayValues(
      raw.mutes,
      "community.muteList.mutes",
      npCommunityContractLimits.pageRows,
    ).map(npRequireMuteSummary),
  };
}

export function npRequireFollowListWire(value: unknown): { follows: NpFollowWireRow[] } {
  const raw = exactRecord(value, "community.followList", ["follows"]);
  return {
    follows: safeArrayValues(
      raw.follows,
      "community.followList.follows",
      npCommunityContractLimits.pageRows,
    ).map(npRequireFollowWireRow),
  };
}

export function npRequireMemberPurgeResult(value: unknown): NpMemberPurgeResult {
  const raw = exactRecord(value, "community.memberPurge", ["comments", "documents", "media"]);
  if (!isPlainRecord(raw.documents))
    fail("community.memberPurge.documents", "must be a plain object", "shape");
  const documents: Record<string, number> = {};
  for (const key of plainDataKeys(raw.documents, "community.memberPurge.documents")) {
    const checkedKey = targetType(key, "community.memberPurge.documents.<collection>");
    Object.defineProperty(documents, checkedKey, {
      configurable: true,
      enumerable: true,
      value: nonNegativeInteger(raw.documents[key], `community.memberPurge.documents.${key}`),
      writable: true,
    });
  }
  const media = exactRecord(raw.media, "community.memberPurge.media", ["deleted", "skipped"]);
  return {
    comments: nonNegativeInteger(raw.comments, "community.memberPurge.comments"),
    documents,
    media: {
      deleted: nonNegativeInteger(media.deleted, "community.memberPurge.media.deleted"),
      skipped: nonNegativeInteger(media.skipped, "community.memberPurge.media.skipped"),
    },
  };
}

export function npRequireRuntimeDiagnostics(value: unknown): NpCommunityRuntimeDiagnostic[] {
  return safeArrayValues(value, "community.diagnostics", npCommunityContractLimits.diagnostics).map(
    (entry, index) => {
      const path = `community.diagnostics[${index.toString()}]`;
      const raw = exactRecord(entry, path, ["source", "message", "occurredAt"]);
      const allowed = new Set([
        "roles",
        "notification-kinds",
        "notification-prefs",
        "notifications",
        "spam",
        "profanity",
        "reputation",
        "profiles",
        "audience",
      ]);
      return {
        source: enumString(raw.source, `${path}.source`, allowed),
        message: boundedString(
          raw.message,
          `${path}.message`,
          npCommunityContractLimits.descriptionLength,
        ),
        occurredAt: canonicalIso(raw.occurredAt, `${path}.occurredAt`),
      };
    },
  );
}

export function npIsCommentSort(value: unknown): value is (typeof npCommunityCommentSorts)[number] {
  return typeof value === "string" && COMMENT_SORTS.has(value);
}

export function npIsCommunityDocumentAudience(
  value: unknown,
): value is NpCommunityDocumentAudience {
  return typeof value === "string" && DOCUMENT_AUDIENCES.has(value);
}

export function npRequireCommunityDocumentAudience(
  value: unknown,
  path = "community.document.audience",
): NpCommunityDocumentAudience {
  return enumString(value, path, DOCUMENT_AUDIENCES);
}

export function npIsReportStatus(value: unknown): value is NpReportStatus {
  return typeof value === "string" && REPORT_STATUSES.has(value);
}

export function npIsReportTarget(value: unknown): value is NpReportTarget {
  try {
    reportTargetType(value, "community.reportTarget");
    return true;
  } catch {
    return false;
  }
}
