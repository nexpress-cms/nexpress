import { isIP } from "node:net";
import { ReadableStream } from "node:stream/web";

import { npIsStorageKey } from "./key-contract.js";
import type {
  LocalStorageAdapterConfig,
  NpFileMetadata,
  NpStorageAdapter,
  NpStorageRuntimeConfig,
  S3StorageAdapterConfig,
} from "./types.js";

export const npStorageContractLimits = {
  adapterKindLength: 64,
  baseUrlLength: 8_192,
  bucketLength: 63,
  contentTypeLength: 127,
  credentialIdLength: 1_024,
  credentialSecretLength: 4_096,
  directoryLength: 4_096,
  endpointLength: 2_048,
  filenameLength: 255,
  regionLength: 128,
  urlLength: 8_192,
} as const;

export type NpStorageContractIssueCode = "shape" | "unknown-field" | "invalid-field" | "invariant";

export interface NpStorageContractIssue {
  readonly code: NpStorageContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export class NpStorageContractError extends Error {
  readonly issues: NpStorageContractIssue[];

  constructor(message: string, issues: NpStorageContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpStorageContractError";
    this.issues = issues;
  }
}

const adapterKindPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const bucketLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const contentTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;\s*[^\r\n\0]+)?$/u;
const regionPattern = /^[a-z0-9][a-z0-9-]*$/u;
const runtimeKeys = new Set(["adapter", "local", "s3"]);
const localKeys = new Set(["directory", "baseUrl"]);
const s3Keys = new Set(["bucket", "region", "endpoint"]);
const s3AdapterKeys = new Set(["bucket", "region", "endpoint", "credentials"]);
const credentialKeys = new Set(["accessKeyId", "secretAccessKey"]);
const metadataKeys = new Set(["contentType", "contentLength", "originalFilename"]);

function issue(
  code: NpStorageContractIssueCode,
  path: string,
  message: string,
): NpStorageContractIssue {
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
  issues: NpStorageContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported storage field "${key}".`));
    }
  }
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isBoundedTrimmed(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !hasControl(value)
  );
}

function isHttpUrl(
  value: unknown,
  maximum: number,
  options: { allowQuery: boolean },
): value is string {
  if (!isBoundedTrimmed(value, maximum) || /\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (options.allowQuery || url.search === "")
    );
  } catch {
    return false;
  }
}

function isRootRelativeUrl(
  value: unknown,
  maximum: number,
  options: { allowQuery: boolean },
): value is string {
  if (
    !isBoundedTrimmed(value, maximum) ||
    /\s/u.test(value) ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    (!options.allowQuery && value.includes("?"))
  ) {
    return false;
  }
  try {
    const url = new URL(value, "https://nexpress.invalid");
    return url.origin === "https://nexpress.invalid";
  } catch {
    return false;
  }
}

function analyzeLocalConfig(value: unknown, path: string): NpStorageContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpStorageContractIssue[] = [];
  pushUnknownFields(value, localKeys, path, issues);
  if (!isBoundedTrimmed(value.directory, npStorageContractLimits.directoryLength)) {
    issues.push(
      issue("invalid-field", `${path}.directory`, "must be a bounded non-empty trimmed path."),
    );
  }
  if (
    !isRootRelativeUrl(value.baseUrl, npStorageContractLimits.baseUrlLength, {
      allowQuery: false,
    }) &&
    !isHttpUrl(value.baseUrl, npStorageContractLimits.baseUrlLength, { allowQuery: false })
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.baseUrl`,
        "must be an absolute path or HTTP(S) base URL without credentials, query, or fragment.",
      ),
    );
  }
  return issues;
}

function isS3Bucket(value: unknown): value is string {
  if (
    !isBoundedTrimmed(value, npStorageContractLimits.bucketLength) ||
    value.length < 3 ||
    !value.split(".").every((label) => bucketLabelPattern.test(label)) ||
    isIP(value) !== 0
  ) {
    return false;
  }
  return true;
}

function analyzeS3Config(
  value: unknown,
  path: string,
  options: { allowCredentials: boolean },
): NpStorageContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpStorageContractIssue[] = [];
  pushUnknownFields(value, options.allowCredentials ? s3AdapterKeys : s3Keys, path, issues);
  if (!isS3Bucket(value.bucket)) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.bucket`,
        "must be a 3-63 character lowercase DNS-compatible bucket name.",
      ),
    );
  }
  if (
    !isBoundedTrimmed(value.region, npStorageContractLimits.regionLength) ||
    !regionPattern.test(value.region)
  ) {
    issues.push(
      issue("invalid-field", `${path}.region`, "must be a bounded lowercase region identifier."),
    );
  }
  if (
    value.endpoint !== undefined &&
    !isHttpUrl(value.endpoint, npStorageContractLimits.endpointLength, { allowQuery: false })
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.endpoint`,
        "must be an HTTP(S) base URL without credentials, query, or fragment.",
      ),
    );
  }
  if (options.allowCredentials && value.credentials !== undefined) {
    if (!isPlainRecord(value.credentials)) {
      issues.push(issue("shape", `${path}.credentials`, "must be a plain object."));
    } else {
      pushUnknownFields(value.credentials, credentialKeys, `${path}.credentials`, issues);
      if (
        !isBoundedTrimmed(value.credentials.accessKeyId, npStorageContractLimits.credentialIdLength)
      ) {
        issues.push(
          issue(
            "invalid-field",
            `${path}.credentials.accessKeyId`,
            "must be a bounded non-empty identifier.",
          ),
        );
      }
      if (
        typeof value.credentials.secretAccessKey !== "string" ||
        value.credentials.secretAccessKey.length === 0 ||
        value.credentials.secretAccessKey.length > npStorageContractLimits.credentialSecretLength ||
        hasControl(value.credentials.secretAccessKey)
      ) {
        issues.push(
          issue(
            "invalid-field",
            `${path}.credentials.secretAccessKey`,
            "must be a bounded non-empty secret without control characters.",
          ),
        );
      }
    }
  }
  return issues;
}

export function npAnalyzeStorageRuntimeConfig(
  value: unknown,
  path = "storage.runtime",
): NpStorageContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpStorageContractIssue[] = [];
  pushUnknownFields(value, runtimeKeys, path, issues);
  if (value.adapter !== "local" && value.adapter !== "s3" && value.adapter !== "custom") {
    issues.push(
      issue("invalid-field", `${path}.adapter`, 'must be exactly "local", "s3", or "custom".'),
    );
    return issues;
  }
  if (value.adapter === "local") {
    issues.push(...analyzeLocalConfig(value.local, `${path}.local`));
    if (value.s3 !== undefined) {
      issues.push(issue("unknown-field", `${path}.s3`, "is not allowed for local storage."));
    }
  } else if (value.adapter === "s3") {
    issues.push(...analyzeS3Config(value.s3, `${path}.s3`, { allowCredentials: false }));
    if (value.local !== undefined) {
      issues.push(issue("unknown-field", `${path}.local`, "is not allowed for S3 storage."));
    }
  } else {
    if (value.local !== undefined) {
      issues.push(issue("unknown-field", `${path}.local`, "is not allowed for custom storage."));
    }
    if (value.s3 !== undefined) {
      issues.push(issue("unknown-field", `${path}.s3`, "is not allowed for custom storage."));
    }
  }
  return issues;
}

export function npRequireStorageRuntimeConfig(value: unknown): NpStorageRuntimeConfig {
  const issues = npAnalyzeStorageRuntimeConfig(value);
  if (issues.length > 0) {
    throw new NpStorageContractError("Invalid storage runtime configuration", issues);
  }
  return value as NpStorageRuntimeConfig;
}

export function npReadStorageRuntimeConfig(
  env: Record<string, string | undefined>,
): NpStorageRuntimeConfig {
  const raw = env.NP_STORAGE_ADAPTER;
  const adapter = raw === undefined || raw === "" ? "local" : raw;
  if (adapter === "custom") return { adapter };
  if (adapter === "local") {
    return npRequireStorageRuntimeConfig({
      adapter,
      local: {
        directory: env.NP_STORAGE_DIR ?? "./public/media",
        baseUrl: env.NP_STORAGE_URL ?? "/media",
      },
    });
  }
  if (adapter === "s3") {
    return npRequireStorageRuntimeConfig({
      adapter,
      s3: {
        bucket: env.NP_S3_BUCKET ?? "",
        region: env.NP_S3_REGION ?? "",
        ...(env.NP_S3_ENDPOINT === undefined ? {} : { endpoint: env.NP_S3_ENDPOINT }),
      },
    });
  }
  throw new NpStorageContractError("Invalid storage runtime configuration", [
    issue("invalid-field", "env.NP_STORAGE_ADAPTER", 'must be exactly "local", "s3", or "custom".'),
  ]);
}

export function npRequireLocalStorageAdapterConfig(value: unknown): LocalStorageAdapterConfig {
  const issues = analyzeLocalConfig(value, "storage.local");
  if (issues.length > 0) throw new NpStorageContractError("Invalid local storage config", issues);
  return value as LocalStorageAdapterConfig;
}

export function npRequireS3StorageAdapterConfig(value: unknown): S3StorageAdapterConfig {
  const issues = analyzeS3Config(value, "storage.s3", { allowCredentials: true });
  if (issues.length > 0) throw new NpStorageContractError("Invalid S3 storage config", issues);
  return value as S3StorageAdapterConfig;
}

export function npAnalyzeStorageKey(
  value: unknown,
  path = "storage.key",
): NpStorageContractIssue[] {
  return npIsStorageKey(value)
    ? []
    : [issue("invalid-field", path, "must be a safe relative object key.")];
}

export function npRequireStorageKey(value: unknown, path = "storage.key"): string {
  const issues = npAnalyzeStorageKey(value, path);
  if (issues.length > 0) throw new NpStorageContractError("Invalid storage key", issues);
  return value as string;
}

export function npAnalyzeFileMetadata(
  value: unknown,
  path = "storage.metadata",
): NpStorageContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpStorageContractIssue[] = [];
  pushUnknownFields(value, metadataKeys, path, issues);
  if (
    !isBoundedTrimmed(value.contentType, npStorageContractLimits.contentTypeLength) ||
    !contentTypePattern.test(value.contentType)
  ) {
    issues.push(issue("invalid-field", `${path}.contentType`, "must be a bounded MIME type."));
  }
  if (
    typeof value.contentLength !== "number" ||
    !Number.isSafeInteger(value.contentLength) ||
    value.contentLength < 0
  ) {
    issues.push(
      issue("invalid-field", `${path}.contentLength`, "must be a non-negative safe integer."),
    );
  }
  if (
    !isBoundedTrimmed(value.originalFilename, npStorageContractLimits.filenameLength) ||
    value.originalFilename === "." ||
    value.originalFilename === ".." ||
    /[\\/]/u.test(value.originalFilename)
  ) {
    issues.push(
      issue(
        "invalid-field",
        `${path}.originalFilename`,
        "must be a bounded basename without path separators.",
      ),
    );
  }
  return issues;
}

export function npRequireFileMetadata(value: unknown): NpFileMetadata {
  const issues = npAnalyzeFileMetadata(value);
  if (issues.length > 0) throw new NpStorageContractError("Invalid storage metadata", issues);
  return value as NpFileMetadata;
}

export function npRequireStorageUploadData(
  value: unknown,
  metadata: NpFileMetadata,
): Buffer | ReadableStream {
  if (!Buffer.isBuffer(value) && !(value instanceof ReadableStream)) {
    throw new NpStorageContractError("Invalid storage upload data", [
      issue("invalid-field", "storage.data", "must be a Buffer or ReadableStream."),
    ]);
  }
  if (Buffer.isBuffer(value) && value.byteLength !== metadata.contentLength) {
    throw new NpStorageContractError("Invalid storage upload data", [
      issue(
        "invariant",
        "storage.metadata.contentLength",
        "must equal the uploaded Buffer byte length.",
      ),
    ]);
  }
  return value;
}

export function npRequireStorageAdapter(value: unknown): NpStorageAdapter {
  const issues: NpStorageContractIssue[] = [];
  if (typeof value !== "object" || value === null) {
    issues.push(issue("shape", "storage.adapter", "must be an object."));
  } else {
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.kind !== "string" ||
      candidate.kind.length > npStorageContractLimits.adapterKindLength ||
      !adapterKindPattern.test(candidate.kind)
    ) {
      issues.push(
        issue("invalid-field", "storage.adapter.kind", "must be a canonical lowercase kind."),
      );
    }
    for (const method of ["upload", "getStream", "getUrl", "delete", "exists"] as const) {
      if (typeof candidate[method] !== "function") {
        issues.push(issue("invalid-field", `storage.adapter.${method}`, "must be a function."));
      }
    }
    if (candidate.shutdown !== undefined && typeof candidate.shutdown !== "function") {
      issues.push(
        issue("invalid-field", "storage.adapter.shutdown", "must be a function when provided."),
      );
    }
  }
  if (issues.length > 0) throw new NpStorageContractError("Invalid storage adapter", issues);
  return value as NpStorageAdapter;
}

export function npRequireStorageUrl(
  value: unknown,
  path = "storage.adapter.getUrl.result",
): string {
  if (
    !isRootRelativeUrl(value, npStorageContractLimits.urlLength, { allowQuery: true }) &&
    !isHttpUrl(value, npStorageContractLimits.urlLength, { allowQuery: true })
  ) {
    throw new NpStorageContractError("Invalid storage adapter result", [
      issue(
        "invalid-field",
        path,
        "must be a bounded root-relative or HTTP(S) URL without credentials or fragment.",
      ),
    ]);
  }
  return value;
}

export function npRequireStorageStream(value: unknown): ReadableStream {
  if (!(value instanceof ReadableStream)) {
    throw new NpStorageContractError("Invalid storage adapter result", [
      issue("invalid-field", "storage.adapter.getStream.result", "must be a ReadableStream."),
    ]);
  }
  return value;
}
