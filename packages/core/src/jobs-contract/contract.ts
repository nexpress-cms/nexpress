import {
  NP_BUILTIN_JOB_TYPES,
  NP_JOB_FAILURE_STATES,
  NP_JOB_LOG_LEVELS,
  NP_JOB_SOURCES,
  NP_JOB_STATES,
  NP_WORKER_STATUSES,
  type NpBuiltinJobPayloadMap,
  type NpBuiltinJobType,
  type NpCancelJobWire,
  type NpEnqueueJobWire,
  type NpJobContractIssue,
  type NpJobContractResult,
  type NpJobData,
  type NpJobJsonValue,
  type NpJobListWire,
  type NpJobLogEntry,
  type NpJobLogInput,
  type NpJobLogsWire,
  type NpJobLogWireEntry,
  type NpJobPayload,
  type NpJobStateCounts,
  type NpJobSummary,
  type NpJobsHealthWire,
  type NpJobsPauseState,
  type NpJobType,
  type NpPauseJobsWire,
  type NpRecentJobFailure,
  type NpResumeJobsWire,
  type NpRetryAllJobsWire,
  type NpRetryJobWire,
  type NpScheduleListWire,
  type NpScheduleSummary,
  type NpWorkerHeartbeat,
  type NpWorkerHealthWireEntry,
} from "./types.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";

export const npJobCanonicalDatePattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
export const npJobTypePattern = "^[A-Za-z0-9][A-Za-z0-9_-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)+$";
export const npJobContractLimits = {
  typeLength: 160,
  // pg-boss stores queue names as text. Plugin schedule names hex-encode two
  // independently validated 128-character ids and can reach 534 characters.
  queueNameLength: 1_024,
  idLength: 200,
  depth: 32,
  nodes: 20_000,
  objectKeys: 1_000,
  keyLength: 160,
  stringLength: 64_000,
  payloadLength: 512_000,
  outputLength: 256_000,
  messageLength: 64_000,
  reasonLength: 1_000,
  resultRows: 1_000,
} as const;

const BUILTIN_TYPES = new Set<string>(NP_BUILTIN_JOB_TYPES);
const JOB_STATES = new Set<string>(NP_JOB_STATES);
const JOB_FAILURE_STATES = new Set<string>(NP_JOB_FAILURE_STATES);
const JOB_SOURCES = new Set<string>(NP_JOB_SOURCES);
const LOG_LEVELS = new Set<string>(NP_JOB_LOG_LEVELS);
const WORKER_STATUSES = new Set<string>(NP_WORKER_STATUSES);
const TYPE_PATTERN = new RegExp(npJobTypePattern, "u");
const ISO_PATTERN = new RegExp(npJobCanonicalDatePattern, "u");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COLLECTION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const PLUGIN_ID_PATTERN = /^(?:@[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+$/u;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const QUEUE_NAME_PATTERN = /^[A-Za-z0-9_.\-/]+$/u;

export class NpJobContractError extends Error {
  readonly issues: NpJobContractIssue[];

  constructor(message: string, issues: NpJobContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpJobContractError";
    this.issues = issues;
  }
}

function fail(path: string, message: string): never {
  throw new NpJobContractError("Invalid job contract", [{ path, message }]);
}

function analyze<T>(parser: () => T): NpJobContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    if (error instanceof NpJobContractError) return { ok: false, issues: error.issues };
    return {
      ok: false,
      issues: [{ path: "jobs", message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export function npRequireJobContract<T>(
  result: NpJobContractResult<T>,
  message = "Invalid job contract",
): T {
  if (result.ok) return result.value;
  throw new NpJobContractError(message, result.issues);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function plainDataKeys(value: Record<string, unknown>, path: string): string[] {
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(path, "must not contain symbol properties");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(`${path}.${key}`, "must be an enumerable plain data property");
    }
    keys.push(key);
  }
  return keys;
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(path, "must be a plain object");
  const actual = plainDataKeys(value, path).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exactly ${expected.join(", ")}`);
  }
  return value;
}

function optionalRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(path, "must be a plain object");
  const keys = plainDataKeys(value, path);
  const allowed = new Set([...required, ...optional]);
  const unknown = keys.find((key) => !allowed.has(key));
  if (unknown) fail(`${path}.${unknown}`, "is not supported");
  const present = new Set(keys);
  const missing = required.find((key) => !present.has(key));
  if (missing) fail(`${path}.${missing}`, "is required");
  return value;
}

function boundedString(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > max ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code === 0 || code === 0x7f;
    })
  ) {
    fail(path, `must be ${allowEmpty ? "bounded" : "non-empty bounded"} text`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(path, "must be a non-negative safe integer");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail(path, "must be a positive safe integer");
  return parsed;
}

function canonicalIso(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !ISO_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(path, "must be a canonical UTC ISO timestamp");
  }
  return value;
}

function nullableIso(value: unknown, path: string): string | null {
  return value === null ? null : canonicalIso(value, path);
}

function uuid(value: unknown, path: string): string {
  const result = boundedString(value, path, 36);
  if (!UUID_PATTERN.test(result)) fail(path, "must be a UUID");
  return result;
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

function absoluteHttpUrl(value: unknown, path: string): string {
  const result = boundedString(value, path, 8_192);
  try {
    const url = new URL(result);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      fail(path, "must be an absolute HTTP(S) URL without credentials");
    }
  } catch (error) {
    if (error instanceof NpJobContractError) throw error;
    fail(path, "must be an absolute HTTP(S) URL");
  }
  return result;
}

function normalizeJson(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  state: { nodes: number },
): NpJobJsonValue {
  state.nodes += 1;
  if (state.nodes > npJobContractLimits.nodes) fail(path, "exceeds the job JSON node limit");
  if (depth > npJobContractLimits.depth) fail(path, "exceeds the job JSON depth limit");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return boundedString(value, path, npJobContractLimits.stringLength, true);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must be a finite number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value === null) fail(path, "must be JSON-compatible");
  if (!Array.isArray(value) && !isPlainRecord(value)) fail(path, "must be JSON-compatible");
  if (ancestors.has(value)) fail(path, "must not contain circular references");
  ancestors.add(value);

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      value.length > npJobContractLimits.nodes ||
      ownKeys.length !== value.length + 1 ||
      ownKeys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(?:0|[1-9]\d*)$/u.test(key) ||
            Number(key) >= value.length),
      )
    ) {
      fail(path, "must be a dense JSON array without extra properties");
    }
    const output: NpJobJsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        fail(`${path}[${index.toString()}]`, "must be a plain JSON array element");
      }
      output.push(
        normalizeJson(
          descriptor.value,
          `${path}[${index.toString()}]`,
          depth + 1,
          ancestors,
          state,
        ),
      );
    }
    ancestors.delete(value);
    return output;
  }

  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length) {
    fail(path, "must not contain symbol or non-enumerable properties");
  }
  const entries = keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      fail(`${path}.${key}`, "must be a plain JSON property");
    }
    return [key, descriptor.value] as const;
  });
  if (entries.length > npJobContractLimits.objectKeys) {
    fail(path, "contains too many object keys");
  }
  const output: Record<string, NpJobJsonValue> = {};
  for (const [key, entry] of entries.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (key.length === 0 || key.length > npJobContractLimits.keyLength) {
      fail(path, "contains an invalid object key");
    }
    Object.defineProperty(output, key, {
      value: normalizeJson(entry, `${path}.${key}`, depth + 1, ancestors, state),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  ancestors.delete(value);
  return output;
}

export function npNormalizeJobData(value: unknown, path = "job.data"): NpJobData {
  if (!isPlainRecord(value)) fail(path, "must be a plain JSON object");
  const normalized = normalizeJson(value, path, 0, new WeakSet(), { nodes: 0 });
  if (!isPlainRecord(normalized)) fail(path, "must be a plain JSON object");
  const length = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
  if (length > npJobContractLimits.payloadLength) {
    fail(path, `must serialize to at most ${npJobContractLimits.payloadLength.toString()} bytes`);
  }
  return normalized;
}

export function npAnalyzeJobData(
  value: unknown,
  path = "job.data",
): NpJobContractResult<NpJobData> {
  return analyze(() => npNormalizeJobData(value, path));
}

export function npRequireJobType(value: unknown, path = "job.type"): NpJobType {
  const type = boundedString(value, path, npJobContractLimits.typeLength);
  if (!TYPE_PATTERN.test(type)) fail(path, "must use canonical namespace:action syntax");
  return type;
}

export function npAnalyzeJobType(value: unknown): NpJobContractResult<NpJobType> {
  return analyze(() => npRequireJobType(value));
}

export function npRequireJobsEnabledFlag(value: unknown, path = "NP_ENABLE_JOBS"): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  fail(path, "must be 1, 0, true, or false");
}

export function npAnalyzeJobsEnabledFlag(value: unknown): NpJobContractResult<boolean> {
  return analyze(() => npRequireJobsEnabledFlag(value));
}

function parseIdentity(
  value: Record<string, unknown>,
  path: string,
): { userId: string | null; memberId: string | null } {
  const rawUserId = value.userId;
  const userId =
    rawUserId === null
      ? null
      : rawUserId === "scheduler"
        ? rawUserId
        : uuid(rawUserId, `${path}.userId`);
  const memberId = nullableUuid(value.memberId, `${path}.memberId`);
  if ((userId === null) === (memberId === null)) {
    fail(path, "must identify exactly one staff/system user or member actor");
  }
  return { userId, memberId };
}

function parseSiteName(value: unknown, path: string): string {
  return boundedString(value, path, 160);
}

function parseEmail(value: unknown, path: string): string {
  const email = boundedString(value, path, 320);
  if (!EMAIL_PATTERN.test(email)) fail(path, "must be a canonical email address");
  return email;
}

function parseBuiltinPayload(
  type: NpBuiltinJobType,
  value: NpJobData,
  dataPath: string,
): NpJobData {
  const path = `${dataPath}(${type})`;
  switch (type) {
    case "content:afterSave": {
      const input = exactRecord(value, path, [
        "siteId",
        "collection",
        "documentId",
        "operation",
        "userId",
        "memberId",
      ]);
      const collection = boundedString(input.collection, `${path}.collection`, 128);
      if (!COLLECTION_PATTERN.test(collection))
        fail(`${path}.collection`, "must be a collection slug");
      if (!npIsCanonicalSiteId(input.siteId)) {
        fail(`${path}.siteId`, "must be a canonical site id");
      }
      const operation = input.operation;
      if (operation !== "create" && operation !== "update") {
        fail(`${path}.operation`, "must be create or update");
      }
      return {
        siteId: input.siteId,
        collection,
        documentId: uuid(input.documentId, `${path}.documentId`),
        operation,
        ...parseIdentity(input, path),
      } satisfies NpBuiltinJobPayloadMap["content:afterSave"];
    }
    case "content:afterDelete": {
      const input = exactRecord(value, path, [
        "siteId",
        "collection",
        "documentId",
        "userId",
        "memberId",
      ]);
      const collection = boundedString(input.collection, `${path}.collection`, 128);
      if (!COLLECTION_PATTERN.test(collection))
        fail(`${path}.collection`, "must be a collection slug");
      if (!npIsCanonicalSiteId(input.siteId)) {
        fail(`${path}.siteId`, "must be a canonical site id");
      }
      return {
        siteId: input.siteId,
        collection,
        documentId: uuid(input.documentId, `${path}.documentId`),
        ...parseIdentity(input, path),
      } satisfies NpBuiltinJobPayloadMap["content:afterDelete"];
    }
    case "search:reindex": {
      const input = exactRecord(value, path, ["collection"]);
      const collection = boundedString(input.collection, `${path}.collection`, 63);
      if (!COLLECTION_PATTERN.test(collection)) {
        fail(`${path}.collection`, "must be a collection slug");
      }
      return { collection } satisfies NpBuiltinJobPayloadMap["search:reindex"];
    }
    case "media:processImage": {
      const input = exactRecord(value, path, ["mediaId"]);
      return {
        mediaId: uuid(input.mediaId, `${path}.mediaId`),
      } satisfies NpBuiltinJobPayloadMap["media:processImage"];
    }
    case "plugin:scheduledTask": {
      const input = exactRecord(value, path, ["siteId", "pluginId", "taskId"]);
      if (!npIsCanonicalSiteId(input.siteId)) {
        fail(`${path}.siteId`, "must be a canonical site id");
      }
      const pluginId = boundedString(input.pluginId, `${path}.pluginId`, 128);
      const taskId = boundedString(input.taskId, `${path}.taskId`, 128);
      if (!PLUGIN_ID_PATTERN.test(pluginId))
        fail(`${path}.pluginId`, "must be a canonical plugin id");
      if (!TASK_ID_PATTERN.test(taskId) || taskId === "." || taskId === "..") {
        fail(`${path}.taskId`, "must be a canonical scheduled task id");
      }
      return {
        siteId: input.siteId,
        pluginId,
        taskId,
      } satisfies NpBuiltinJobPayloadMap["plugin:scheduledTask"];
    }
    case "plugin:scheduledTaskTick": {
      const input = exactRecord(value, path, ["pluginId", "taskId"]);
      const pluginId = boundedString(input.pluginId, `${path}.pluginId`, 128);
      const taskId = boundedString(input.taskId, `${path}.taskId`, 128);
      if (!PLUGIN_ID_PATTERN.test(pluginId)) {
        fail(`${path}.pluginId`, "must be a canonical plugin id");
      }
      if (!TASK_ID_PATTERN.test(taskId) || taskId === "." || taskId === "..") {
        fail(`${path}.taskId`, "must be a canonical scheduled task id");
      }
      return { pluginId, taskId } satisfies NpBuiltinJobPayloadMap["plugin:scheduledTaskTick"];
    }
    case "auth:sendPasswordReset": {
      const input = optionalRecord(
        value,
        path,
        ["email", "name", "purpose", "resetUrl", "expiresAt"],
        ["siteName"],
      );
      if (input.purpose !== "invite" && input.purpose !== "reset") {
        fail(`${path}.purpose`, "must be invite or reset");
      }
      return {
        email: parseEmail(input.email, `${path}.email`),
        name: boundedString(input.name, `${path}.name`, 160),
        purpose: input.purpose,
        resetUrl: absoluteHttpUrl(input.resetUrl, `${path}.resetUrl`),
        expiresAt: canonicalIso(input.expiresAt, `${path}.expiresAt`),
        ...(input.siteName === undefined
          ? {}
          : { siteName: parseSiteName(input.siteName, `${path}.siteName`) }),
      } satisfies NpBuiltinJobPayloadMap["auth:sendPasswordReset"];
    }
    case "members:sendVerifyEmail": {
      const input = optionalRecord(
        value,
        path,
        ["email", "displayName", "verifyUrl", "expiresAt"],
        ["siteName"],
      );
      return {
        email: parseEmail(input.email, `${path}.email`),
        displayName: boundedString(input.displayName, `${path}.displayName`, 160),
        verifyUrl: absoluteHttpUrl(input.verifyUrl, `${path}.verifyUrl`),
        expiresAt: canonicalIso(input.expiresAt, `${path}.expiresAt`),
        ...(input.siteName === undefined
          ? {}
          : { siteName: parseSiteName(input.siteName, `${path}.siteName`) }),
      } satisfies NpBuiltinJobPayloadMap["members:sendVerifyEmail"];
    }
    case "members:sendPasswordReset": {
      const input = optionalRecord(
        value,
        path,
        ["email", "displayName", "resetUrl", "expiresAt"],
        ["siteName"],
      );
      return {
        email: parseEmail(input.email, `${path}.email`),
        displayName: boundedString(input.displayName, `${path}.displayName`, 160),
        resetUrl: absoluteHttpUrl(input.resetUrl, `${path}.resetUrl`),
        expiresAt: canonicalIso(input.expiresAt, `${path}.expiresAt`),
        ...(input.siteName === undefined
          ? {}
          : { siteName: parseSiteName(input.siteName, `${path}.siteName`) }),
      } satisfies NpBuiltinJobPayloadMap["members:sendPasswordReset"];
    }
    case "notifications:sendDigest": {
      const input = optionalRecord(value, path, ["cadence"], ["siteName"]);
      if (input.cadence !== "daily" && input.cadence !== "weekly") {
        fail(`${path}.cadence`, "must be daily or weekly");
      }
      return {
        cadence: input.cadence,
        ...(input.siteName === undefined
          ? {}
          : { siteName: parseSiteName(input.siteName, `${path}.siteName`) }),
      } satisfies NpBuiltinJobPayloadMap["notifications:sendDigest"];
    }
    case "import:wordpressApply": {
      const input = exactRecord(value, path, ["runId"]);
      return {
        runId: uuid(input.runId, `${path}.runId`),
      } satisfies NpBuiltinJobPayloadMap["import:wordpressApply"];
    }
    case "content:publishScheduled":
    case "media:cleanup":
    case "system:revisionPrune":
    case "system:sessionCleanup":
    case "system:jobLogPrune":
      exactRecord(value, path, []);
      return {};
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function npNormalizeJobPayload<TType extends NpJobType>(
  type: TType,
  value: unknown,
  path = "job.data",
): NpJobPayload<TType> {
  const canonicalType = npRequireJobType(type);
  const data = npNormalizeJobData(value, path);
  return (
    BUILTIN_TYPES.has(canonicalType)
      ? parseBuiltinPayload(canonicalType as NpBuiltinJobType, data, path)
      : data
  ) as NpJobPayload<TType>;
}

export function npAnalyzeJobPayload<TType extends NpJobType>(
  type: TType,
  value: unknown,
): NpJobContractResult<NpJobPayload<TType>> {
  return analyze(() => npNormalizeJobPayload(type, value));
}

export function npRequireJobId(value: unknown, path = "job.id"): string {
  return boundedString(value, path, npJobContractLimits.idLength);
}

export function npRequireJobQueueName(value: unknown, path = "job.name"): string {
  const result = boundedString(value, path, npJobContractLimits.queueNameLength);
  if (!QUEUE_NAME_PATTERN.test(result)) {
    fail(path, "must use only pg-boss queue-name characters");
  }
  return result;
}

function parseJobSummary(value: unknown, path: string): NpJobSummary {
  const input = exactRecord(value, path, [
    "id",
    "name",
    "state",
    "data",
    "retryCount",
    "output",
    "createdOn",
    "startedOn",
    "completedOn",
    "source",
  ]);
  if (typeof input.state !== "string" || !JOB_STATES.has(input.state)) {
    fail(`${path}.state`, "must be a supported job state");
  }
  if (typeof input.source !== "string" || !JOB_SOURCES.has(input.source)) {
    fail(`${path}.source`, "must be live or archive");
  }
  const output =
    input.output === null
      ? null
      : boundedString(input.output, `${path}.output`, npJobContractLimits.outputLength, true);
  const createdOn = canonicalIso(input.createdOn, `${path}.createdOn`);
  const startedOn = nullableIso(input.startedOn, `${path}.startedOn`);
  const completedOn = nullableIso(input.completedOn, `${path}.completedOn`);
  if (startedOn && Date.parse(startedOn) < Date.parse(createdOn)) {
    fail(`${path}.startedOn`, "must not precede createdOn");
  }
  if (completedOn && Date.parse(completedOn) < Date.parse(startedOn ?? createdOn)) {
    fail(`${path}.completedOn`, "must not precede the job start");
  }
  const name = npRequireJobQueueName(input.name, `${path}.name`);
  const builtinType = npBuiltinJobTypeForQueueName(name);
  return {
    id: npRequireJobId(input.id, `${path}.id`),
    name,
    state: input.state as NpJobSummary["state"],
    data: builtinType
      ? (npNormalizeJobPayload(builtinType, input.data, `${path}.data`) as NpJobData)
      : npNormalizeJobData(input.data, `${path}.data`),
    retryCount: nonNegativeInteger(input.retryCount, `${path}.retryCount`),
    output,
    createdOn,
    startedOn,
    completedOn,
    source: input.source as NpJobSummary["source"],
  };
}

export function npAnalyzeJobSummary(value: unknown): NpJobContractResult<NpJobSummary> {
  return analyze(() => parseJobSummary(value, "job"));
}

export function npRequireJobSummary(value: unknown): NpJobSummary {
  return parseJobSummary(value, "job");
}

export function npAnalyzeJobListWire(value: unknown): NpJobContractResult<NpJobListWire> {
  return analyze(() => {
    const input = exactRecord(value, "jobs", ["supported", "jobs", "total"]);
    if (typeof input.supported !== "boolean") fail("jobs.supported", "must be boolean");
    if (!Array.isArray(input.jobs)) fail("jobs.jobs", "must be an array");
    const jobs = input.jobs.map((job, index) =>
      parseJobSummary(job, `jobs.jobs[${index.toString()}]`),
    );
    if (new Set(jobs.map((job) => job.id)).size !== jobs.length) {
      fail("jobs.jobs", "must not contain duplicate job ids");
    }
    const total = nonNegativeInteger(input.total, "jobs.total");
    if (total < jobs.length) fail("jobs.total", "must cover every returned job");
    if (!input.supported && (jobs.length > 0 || total !== 0)) {
      fail("jobs", "unsupported responses must contain no jobs");
    }
    return { supported: input.supported, jobs, total };
  });
}

export function npRequireJobListWire(value: unknown): NpJobListWire {
  return npRequireJobContract(npAnalyzeJobListWire(value));
}

function parseSchedule(value: unknown, path: string): NpScheduleSummary {
  const input = exactRecord(value, path, [
    "name",
    "key",
    "cron",
    "timezone",
    "data",
    "createdOn",
    "updatedOn",
  ]);
  const cron = boundedString(input.cron, `${path}.cron`, 256);
  const cronFields = cron.split(" ");
  if (cronFields.length !== 5 || cronFields.some((field) => field.length === 0)) {
    fail(`${path}.cron`, "must use exactly five fields separated by single spaces");
  }
  const timezone =
    input.timezone === null ? null : boundedString(input.timezone, `${path}.timezone`, 100);
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      fail(`${path}.timezone`, "must be a supported IANA time zone");
    }
  }
  const name = npRequireJobQueueName(input.name, `${path}.name`);
  const key = boundedString(input.key, `${path}.key`, 128, true);
  if (key && !QUEUE_NAME_PATTERN.test(key)) {
    fail(`${path}.key`, "must use only pg-boss key characters");
  }
  const builtinType = npBuiltinJobTypeForQueueName(name);
  const createdOn = canonicalIso(input.createdOn, `${path}.createdOn`);
  const updatedOn = nullableIso(input.updatedOn, `${path}.updatedOn`);
  if (updatedOn && Date.parse(updatedOn) < Date.parse(createdOn)) {
    fail(`${path}.updatedOn`, "must not precede createdOn");
  }
  const data = builtinType
    ? (npNormalizeJobPayload(builtinType, input.data, `${path}.data`) as NpJobData)
    : npNormalizeJobData(input.data, `${path}.data`);
  if (builtinType === "notifications:sendDigest" && key !== data.cadence) {
    fail(`${path}.key`, "must match the digest cadence");
  }
  if (
    builtinType === "plugin:scheduledTaskTick" &&
    name !== npPluginScheduledTaskQueueName(data.pluginId, data.taskId)
  ) {
    fail(`${path}.name`, "must match the pluginId and taskId payload");
  }
  if (builtinType === "plugin:scheduledTaskTick" && key !== "") {
    fail(`${path}.key`, "must be empty for a plugin scheduled task");
  }
  return {
    name,
    key,
    cron,
    timezone,
    data,
    createdOn,
    updatedOn,
  };
}

export function npRequireScheduleSummary(value: unknown): NpScheduleSummary {
  return parseSchedule(value, "schedule");
}

export function npAnalyzeScheduleListWire(value: unknown): NpJobContractResult<NpScheduleListWire> {
  return analyze(() => {
    const input = exactRecord(value, "schedules", ["supported", "schedules", "handlers"]);
    if (typeof input.supported !== "boolean") fail("schedules.supported", "must be boolean");
    if (!Array.isArray(input.schedules)) fail("schedules.schedules", "must be an array");
    if (!Array.isArray(input.handlers)) fail("schedules.handlers", "must be an array");
    const schedules = input.schedules.map((entry, index) =>
      parseSchedule(entry, `schedules.schedules[${index.toString()}]`),
    );
    if (
      new Set(schedules.map((schedule) => `${schedule.name}\u0000${schedule.key}`)).size !==
      schedules.length
    ) {
      fail("schedules.schedules", "must not contain duplicate name/key pairs");
    }
    const handlers = input.handlers.map((entry, index) =>
      npRequireJobType(entry, `schedules.handlers[${index.toString()}]`),
    );
    if (new Set(handlers).size !== handlers.length) fail("schedules.handlers", "must be unique");
    const sorted = [...handlers].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (handlers.some((entry, index) => entry !== sorted[index])) {
      fail("schedules.handlers", "must use canonical sorted order");
    }
    if (!input.supported && schedules.length > 0) {
      fail("schedules.schedules", "must be empty when schedule introspection is unsupported");
    }
    return { supported: input.supported, schedules, handlers };
  });
}

export function npRequireScheduleListWire(value: unknown): NpScheduleListWire {
  return npRequireJobContract(npAnalyzeScheduleListWire(value));
}

export function npRequireJobsPauseState(value: unknown): NpJobsPauseState {
  const input = exactRecord(value, "jobs.pause", [
    "paused",
    "changedAt",
    "changedByUserId",
    "reason",
  ]);
  if (typeof input.paused !== "boolean") fail("jobs.pause.paused", "must be boolean");
  return {
    paused: input.paused,
    changedAt: canonicalIso(input.changedAt, "jobs.pause.changedAt"),
    changedByUserId: nullableUuid(input.changedByUserId, "jobs.pause.changedByUserId"),
    reason:
      input.reason === null
        ? null
        : boundedString(input.reason, "jobs.pause.reason", npJobContractLimits.reasonLength, true),
  };
}

export function npAnalyzeJobsPauseState(value: unknown): NpJobContractResult<NpJobsPauseState> {
  return analyze(() => npRequireJobsPauseState(value));
}

export function npRequireJobStateCounts(value: unknown, path = "jobs.counts"): NpJobStateCounts {
  const input = exactRecord(value, path, NP_JOB_STATES);
  return {
    created: nonNegativeInteger(input.created, `${path}.created`),
    active: nonNegativeInteger(input.active, `${path}.active`),
    completed: nonNegativeInteger(input.completed, `${path}.completed`),
    failed: nonNegativeInteger(input.failed, `${path}.failed`),
    retry: nonNegativeInteger(input.retry, `${path}.retry`),
    cancelled: nonNegativeInteger(input.cancelled, `${path}.cancelled`),
    expired: nonNegativeInteger(input.expired, `${path}.expired`),
  };
}

export function npRequireWorkerHeartbeat(value: unknown): NpWorkerHeartbeat {
  const input = exactRecord(value, "worker", ["id", "status", "startedAt", "lastSeenAt", "meta"]);
  if (typeof input.status !== "string" || !WORKER_STATUSES.has(input.status)) {
    fail("worker.status", "must be running or stopped");
  }
  if (!(input.startedAt instanceof Date) || Number.isNaN(input.startedAt.getTime())) {
    fail("worker.startedAt", "must be a valid Date");
  }
  if (!(input.lastSeenAt instanceof Date) || Number.isNaN(input.lastSeenAt.getTime())) {
    fail("worker.lastSeenAt", "must be a valid Date");
  }
  if (input.lastSeenAt.getTime() < input.startedAt.getTime()) {
    fail("worker.lastSeenAt", "must not precede startedAt");
  }
  return {
    id: npRequireJobId(input.id, "worker.id"),
    status: input.status as NpWorkerHeartbeat["status"],
    startedAt: input.startedAt,
    lastSeenAt: input.lastSeenAt,
    meta: npNormalizeJobData(input.meta, "worker.meta"),
  };
}

export function npAnalyzeWorkerHeartbeat(value: unknown): NpJobContractResult<NpWorkerHeartbeat> {
  return analyze(() => npRequireWorkerHeartbeat(value));
}

export function npSerializeWorkerHealthEntry(
  value: NpWorkerHeartbeat,
  now: Date,
  staleThresholdMs: number,
): NpWorkerHealthWireEntry {
  const worker = npRequireWorkerHeartbeat(value);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail("worker.now", "must be a valid Date");
  }
  const threshold = positiveInteger(staleThresholdMs, "worker.staleThresholdMs");
  const lastSeenAgoMs = nonNegativeInteger(
    Math.max(0, now.getTime() - worker.lastSeenAt.getTime()),
    "worker.lastSeenAgoMs",
  );
  return {
    id: worker.id,
    status: worker.status,
    startedAt: worker.startedAt.toISOString(),
    lastSeenAt: worker.lastSeenAt.toISOString(),
    meta: worker.meta,
    alive: worker.status === "running" && lastSeenAgoMs < threshold,
    lastSeenAgoMs,
  };
}

export function npRequireJobLogEntry(value: unknown): NpJobLogEntry {
  const input = exactRecord(value, "job.log", [
    "id",
    "jobId",
    "level",
    "message",
    "context",
    "createdAt",
  ]);
  if (typeof input.level !== "string" || !LOG_LEVELS.has(input.level)) {
    fail("job.log.level", "must be debug, info, warn, or error");
  }
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    fail("job.log.createdAt", "must be a valid Date");
  }
  return {
    id: uuid(input.id, "job.log.id"),
    jobId: npRequireJobId(input.jobId, "job.log.jobId"),
    level: input.level as NpJobLogEntry["level"],
    message: boundedString(
      input.message,
      "job.log.message",
      npJobContractLimits.messageLength,
      true,
    ),
    context: input.context === null ? null : npNormalizeJobData(input.context, "job.log.context"),
    createdAt: input.createdAt,
  };
}

export function npRequireJobLogInput(value: unknown): NpJobLogInput {
  const input = exactRecord(value, "job.log.input", ["level", "message", "context"]);
  if (typeof input.level !== "string" || !LOG_LEVELS.has(input.level)) {
    fail("job.log.input.level", "must be debug, info, warn, or error");
  }
  return {
    level: input.level as NpJobLogInput["level"],
    message: boundedString(
      input.message,
      "job.log.input.message",
      npJobContractLimits.messageLength,
      true,
    ),
    context:
      input.context === null ? null : npNormalizeJobData(input.context, "job.log.input.context"),
  };
}

export function npAnalyzeJobLogEntry(value: unknown): NpJobContractResult<NpJobLogEntry> {
  return analyze(() => npRequireJobLogEntry(value));
}

export function npSerializeJobLogEntry(value: NpJobLogEntry): NpJobLogWireEntry {
  const entry = npRequireJobLogEntry(value);
  return {
    id: entry.id,
    level: entry.level,
    message: entry.message,
    context: entry.context,
    createdAt: entry.createdAt.toISOString(),
  };
}

function parseJobLogWire(value: unknown, path: string): NpJobLogWireEntry {
  const input = exactRecord(value, path, ["id", "level", "message", "context", "createdAt"]);
  if (typeof input.level !== "string" || !LOG_LEVELS.has(input.level)) {
    fail(`${path}.level`, "must be debug, info, warn, or error");
  }
  return {
    id: uuid(input.id, `${path}.id`),
    level: input.level as NpJobLogWireEntry["level"],
    message: boundedString(
      input.message,
      `${path}.message`,
      npJobContractLimits.messageLength,
      true,
    ),
    context: input.context === null ? null : npNormalizeJobData(input.context, `${path}.context`),
    createdAt: canonicalIso(input.createdAt, `${path}.createdAt`),
  };
}

export function npAnalyzeJobLogsWire(value: unknown): NpJobContractResult<NpJobLogsWire> {
  return analyze(() => {
    const input = exactRecord(value, "job.logs", ["jobId", "total", "entries"]);
    if (!Array.isArray(input.entries)) fail("job.logs.entries", "must be an array");
    const total = nonNegativeInteger(input.total, "job.logs.total");
    if (total < input.entries.length) fail("job.logs.total", "must cover every returned entry");
    const entries = input.entries.map((entry, index) =>
      parseJobLogWire(entry, `job.logs.entries[${index.toString()}]`),
    );
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      fail("job.logs.entries", "must not contain duplicate log ids");
    }
    if (
      entries.some(
        (entry, index) =>
          index > 0 && Date.parse(entry.createdAt) < Date.parse(entries[index - 1].createdAt),
      )
    ) {
      fail("job.logs.entries", "must use chronological order");
    }
    return {
      jobId: npRequireJobId(input.jobId, "job.logs.jobId"),
      total,
      entries,
    };
  });
}

export function npRequireJobLogsWire(value: unknown): NpJobLogsWire {
  return npRequireJobContract(npAnalyzeJobLogsWire(value));
}

function parseWorkerWire(value: unknown, path: string): NpWorkerHealthWireEntry {
  const input = exactRecord(value, path, [
    "id",
    "status",
    "startedAt",
    "lastSeenAt",
    "meta",
    "alive",
    "lastSeenAgoMs",
  ]);
  if (typeof input.status !== "string" || !WORKER_STATUSES.has(input.status)) {
    fail(`${path}.status`, "must be running or stopped");
  }
  if (typeof input.alive !== "boolean") fail(`${path}.alive`, "must be boolean");
  const startedAt = canonicalIso(input.startedAt, `${path}.startedAt`);
  const lastSeenAt = canonicalIso(input.lastSeenAt, `${path}.lastSeenAt`);
  if (Date.parse(lastSeenAt) < Date.parse(startedAt)) {
    fail(`${path}.lastSeenAt`, "must not precede startedAt");
  }
  if (input.status === "stopped" && input.alive) {
    fail(`${path}.alive`, "must be false for a stopped worker");
  }
  return {
    id: npRequireJobId(input.id, `${path}.id`),
    status: input.status as NpWorkerHealthWireEntry["status"],
    startedAt,
    lastSeenAt,
    meta: npNormalizeJobData(input.meta, `${path}.meta`),
    alive: input.alive,
    lastSeenAgoMs: nonNegativeInteger(input.lastSeenAgoMs, `${path}.lastSeenAgoMs`),
  };
}

export function npRequireWorkerHealthWireEntry(value: unknown): NpWorkerHealthWireEntry {
  return parseWorkerWire(value, "worker.health");
}

function parseRecentFailure(value: unknown, path: string): NpRecentJobFailure {
  const input = optionalRecord(
    value,
    path,
    [
      "id",
      "name",
      "state",
      "source",
      "retryCount",
      "output",
      "createdOn",
      "startedOn",
      "completedOn",
      "logCount",
      "lastLog",
    ],
    ["logError"],
  );
  if (typeof input.state !== "string" || !JOB_FAILURE_STATES.has(input.state)) {
    fail(`${path}.state`, "must be a failure state");
  }
  if (typeof input.source !== "string" || !JOB_SOURCES.has(input.source)) {
    fail(`${path}.source`, "must be live or archive");
  }
  const logCount = nonNegativeInteger(input.logCount, `${path}.logCount`);
  const lastLog = input.lastLog === null ? null : parseJobLogWire(input.lastLog, `${path}.lastLog`);
  if ((logCount === 0) !== (lastLog === null)) {
    fail(`${path}.lastLog`, "must be present exactly when logCount is positive");
  }
  const createdOn = canonicalIso(input.createdOn, `${path}.createdOn`);
  const startedOn = nullableIso(input.startedOn, `${path}.startedOn`);
  const completedOn = nullableIso(input.completedOn, `${path}.completedOn`);
  if (startedOn && Date.parse(startedOn) < Date.parse(createdOn)) {
    fail(`${path}.startedOn`, "must not precede createdOn");
  }
  if (completedOn && Date.parse(completedOn) < Date.parse(startedOn ?? createdOn)) {
    fail(`${path}.completedOn`, "must not precede the job start");
  }
  if (lastLog && Date.parse(lastLog.createdAt) < Date.parse(createdOn)) {
    fail(`${path}.lastLog.createdAt`, "must not precede the job creation");
  }
  return {
    id: npRequireJobId(input.id, `${path}.id`),
    name: npRequireJobQueueName(input.name, `${path}.name`),
    state: input.state as NpRecentJobFailure["state"],
    source: input.source as NpRecentJobFailure["source"],
    retryCount: nonNegativeInteger(input.retryCount, `${path}.retryCount`),
    output:
      input.output === null
        ? null
        : boundedString(input.output, `${path}.output`, npJobContractLimits.outputLength, true),
    createdOn,
    startedOn,
    completedOn,
    logCount,
    lastLog,
    ...(input.logError === undefined
      ? {}
      : {
          logError: boundedString(
            input.logError,
            `${path}.logError`,
            npJobContractLimits.messageLength,
            true,
          ),
        }),
  };
}

export function npRequireRecentJobFailure(value: unknown): NpRecentJobFailure {
  return parseRecentFailure(value, "job.failure");
}

export function npAnalyzeJobsHealthWire(value: unknown): NpJobContractResult<NpJobsHealthWire> {
  return analyze(() => {
    const input = exactRecord(value, "jobs.health", [
      "workers",
      "aliveCount",
      "totalCount",
      "newestHeartbeat",
      "pause",
      "stuck",
      "recentFailures",
    ]);
    if (!Array.isArray(input.workers)) fail("jobs.health.workers", "must be an array");
    if (!Array.isArray(input.recentFailures)) {
      fail("jobs.health.recentFailures", "must be an array");
    }
    const workers = input.workers.map((worker, index) =>
      parseWorkerWire(worker, `jobs.health.workers[${index.toString()}]`),
    );
    if (new Set(workers.map((worker) => worker.id)).size !== workers.length) {
      fail("jobs.health.workers", "must not contain duplicate worker ids");
    }
    if (
      workers.some(
        (worker, index) =>
          index > 0 && Date.parse(worker.lastSeenAt) > Date.parse(workers[index - 1].lastSeenAt),
      )
    ) {
      fail("jobs.health.workers", "must use newest-heartbeat-first order");
    }
    const aliveCount = nonNegativeInteger(input.aliveCount, "jobs.health.aliveCount");
    const totalCount = nonNegativeInteger(input.totalCount, "jobs.health.totalCount");
    if (
      totalCount !== workers.length ||
      aliveCount !== workers.filter((worker) => worker.alive).length
    ) {
      fail("jobs.health", "worker aggregate counts must match workers");
    }
    const newestHeartbeat = nullableIso(input.newestHeartbeat, "jobs.health.newestHeartbeat");
    const expectedNewest =
      workers
        .map((worker) => worker.lastSeenAt)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
    if (newestHeartbeat !== expectedNewest) {
      fail("jobs.health.newestHeartbeat", "must match the newest worker heartbeat");
    }
    let stuck: NpJobsHealthWire["stuck"] = null;
    if (input.stuck !== null) {
      const block = exactRecord(input.stuck, "jobs.health.stuck", ["counts", "thresholds"]);
      const thresholds = exactRecord(block.thresholds, "jobs.health.stuck.thresholds", [
        "failed",
        "expired",
      ]);
      stuck = {
        counts: npRequireJobStateCounts(block.counts, "jobs.health.stuck.counts"),
        thresholds: {
          failed: nonNegativeInteger(thresholds.failed, "jobs.health.stuck.thresholds.failed"),
          expired: nonNegativeInteger(thresholds.expired, "jobs.health.stuck.thresholds.expired"),
        },
      };
    }
    const recentFailures = input.recentFailures.map((failure, index) =>
      parseRecentFailure(failure, `jobs.health.recentFailures[${index.toString()}]`),
    );
    if (new Set(recentFailures.map((failure) => failure.id)).size !== recentFailures.length) {
      fail("jobs.health.recentFailures", "must not contain duplicate job ids");
    }
    if (
      recentFailures.some(
        (failure, index) =>
          index > 0 &&
          Date.parse(failure.completedOn ?? failure.startedOn ?? failure.createdOn) >
            Date.parse(
              recentFailures[index - 1].completedOn ??
                recentFailures[index - 1].startedOn ??
                recentFailures[index - 1].createdOn,
            ),
      )
    ) {
      fail("jobs.health.recentFailures", "must use newest-failure-first order");
    }
    return {
      workers,
      aliveCount,
      totalCount,
      newestHeartbeat,
      pause: npRequireJobsPauseState(input.pause),
      stuck,
      recentFailures,
    };
  });
}

export function npRequireJobsHealthWire(value: unknown): NpJobsHealthWire {
  return npRequireJobContract(npAnalyzeJobsHealthWire(value));
}

export function npAnalyzeEnqueueJobWire(value: unknown): NpJobContractResult<NpEnqueueJobWire> {
  return analyze(() => {
    const input = exactRecord(value, "job.enqueue", ["id", "type", "data"]);
    const type = npRequireJobType(input.type, "job.enqueue.type");
    return {
      id: npRequireJobId(input.id, "job.enqueue.id"),
      type,
      data: npNormalizeJobData(npNormalizeJobPayload(type, input.data)),
    };
  });
}

export function npRequireEnqueueJobWire(value: unknown): NpEnqueueJobWire {
  return npRequireJobContract(npAnalyzeEnqueueJobWire(value));
}

export function npAnalyzeRetryJobWire(value: unknown): NpJobContractResult<NpRetryJobWire> {
  return analyze(() => {
    const input = exactRecord(value, "job.retry", ["id"]);
    return { id: npRequireJobId(input.id, "job.retry.id") };
  });
}

export function npRequireRetryJobWire(value: unknown): NpRetryJobWire {
  return npRequireJobContract(npAnalyzeRetryJobWire(value));
}

export function npAnalyzeCancelJobWire(value: unknown): NpJobContractResult<NpCancelJobWire> {
  return analyze(() => {
    const input = exactRecord(value, "job.cancel", ["ok"]);
    if (input.ok !== true) fail("job.cancel.ok", "must be true");
    return { ok: true };
  });
}

export function npRequireCancelJobWire(value: unknown): NpCancelJobWire {
  return npRequireJobContract(npAnalyzeCancelJobWire(value));
}

export function npAnalyzeRetryAllJobsWire(value: unknown): NpJobContractResult<NpRetryAllJobsWire> {
  return analyze(() => {
    const input = exactRecord(value, "jobs.retryAll", [
      "retried",
      "failed",
      "total",
      "remaining",
      "results",
    ]);
    if (!Array.isArray(input.results) || input.results.length > npJobContractLimits.resultRows) {
      fail("jobs.retryAll.results", "must be a bounded array");
    }
    const results = input.results.map((value, index) => {
      const row = optionalRecord(
        value,
        `jobs.retryAll.results[${index.toString()}]`,
        ["id", "ok"],
        ["error"],
      );
      if (typeof row.ok !== "boolean") {
        fail(`jobs.retryAll.results[${index.toString()}].ok`, "must be boolean");
      }
      if ((row.ok && row.error !== undefined) || (!row.ok && row.error === undefined)) {
        fail(
          `jobs.retryAll.results[${index.toString()}].error`,
          "must be present exactly for failed retries",
        );
      }
      return {
        id: npRequireJobId(row.id, `jobs.retryAll.results[${index.toString()}].id`),
        ok: row.ok,
        ...(row.error === undefined
          ? {}
          : {
              error: boundedString(
                row.error,
                `jobs.retryAll.results[${index.toString()}].error`,
                npJobContractLimits.messageLength,
              ),
            }),
      };
    });
    const retried = nonNegativeInteger(input.retried, "jobs.retryAll.retried");
    const failed = nonNegativeInteger(input.failed, "jobs.retryAll.failed");
    if (retried + failed !== results.length) {
      fail("jobs.retryAll", "result totals must match result rows");
    }
    if (new Set(results.map((result) => result.id)).size !== results.length) {
      fail("jobs.retryAll.results", "must not contain duplicate job ids");
    }
    const total = nonNegativeInteger(input.total, "jobs.retryAll.total");
    const remaining = nonNegativeInteger(input.remaining, "jobs.retryAll.remaining");
    if (total < results.length || remaining !== Math.max(0, total - retried)) {
      fail("jobs.retryAll", "total and remaining must match the retry results");
    }
    return {
      retried,
      failed,
      total,
      remaining,
      results,
    };
  });
}

export function npBuiltinJobTypeForQueueName(queueName: string): NpBuiltinJobType | null {
  if (queueName.startsWith("plugin.scheduledTask.")) return "plugin:scheduledTaskTick";
  return NP_BUILTIN_JOB_TYPES.find((type) => type.replaceAll(":", ".") === queueName) ?? null;
}

/**
 * pg-boss queue names exclude `@`, while canonical plugin ids may be scoped.
 * Hex encoding both validated identifiers is deterministic and collision-free
 * without depending on Node-only Buffer APIs in this client-safe contract.
 */
export function npPluginScheduledTaskQueueName(pluginId: unknown, taskId: unknown): string {
  const payload = npNormalizeJobPayload(
    "plugin:scheduledTaskTick",
    { pluginId, taskId },
    "plugin.schedule",
  );
  return `plugin.scheduledTask.${asciiHex(payload.pluginId)}.${asciiHex(payload.taskId)}`;
}

function asciiHex(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return encoded;
}

export function npRequireRetryAllJobsWire(value: unknown): NpRetryAllJobsWire {
  return npRequireJobContract(npAnalyzeRetryAllJobsWire(value));
}

export function npAnalyzePauseJobsWire(value: unknown): NpJobContractResult<NpPauseJobsWire> {
  return analyze(() => {
    const input = exactRecord(value, "jobs.pause.result", [
      "paused",
      "changedAt",
      "reason",
      "localApplied",
    ]);
    if (input.paused !== true) fail("jobs.pause.result.paused", "must be true");
    if (typeof input.localApplied !== "boolean") {
      fail("jobs.pause.result.localApplied", "must be boolean");
    }
    return {
      paused: true,
      changedAt: canonicalIso(input.changedAt, "jobs.pause.result.changedAt"),
      reason:
        input.reason === null
          ? null
          : boundedString(
              input.reason,
              "jobs.pause.result.reason",
              npJobContractLimits.reasonLength,
              true,
            ),
      localApplied: input.localApplied,
    };
  });
}

export function npRequirePauseJobsWire(value: unknown): NpPauseJobsWire {
  return npRequireJobContract(npAnalyzePauseJobsWire(value));
}

export function npAnalyzeResumeJobsWire(value: unknown): NpJobContractResult<NpResumeJobsWire> {
  return analyze(() => {
    const input = exactRecord(value, "jobs.resume.result", ["paused", "changedAt", "localApplied"]);
    if (input.paused !== false) fail("jobs.resume.result.paused", "must be false");
    if (typeof input.localApplied !== "boolean") {
      fail("jobs.resume.result.localApplied", "must be boolean");
    }
    return {
      paused: false,
      changedAt: canonicalIso(input.changedAt, "jobs.resume.result.changedAt"),
      localApplied: input.localApplied,
    };
  });
}

export function npRequireResumeJobsWire(value: unknown): NpResumeJobsWire {
  return npRequireJobContract(npAnalyzeResumeJobsWire(value));
}
