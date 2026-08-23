import { npApiErrorContractLimits } from "../api-contract/contract.js";
import { npAgentContractLimits, npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
  type AgentCanonicalJsonInspectionLimits,
} from "./canonical-foundation.js";
import type {
  NpAgentCanonicalBodyBytesV1,
  NpAgentContractResult,
  NpAgentJsonObject,
  NpAgentJsonValue,
  NpAgentMcpStoredTerminalResultV1,
} from "./types.js";

const RESULT_KINDS = new Set<string>(["tool_result", "jsonrpc_error"]);
const CONTENT_TYPES = new Set<string>(["text", "image", "audio", "resource_link", "resource"]);
const ANNOTATION_ROLES = new Set<string>(["user", "assistant"]);
const ICON_THEMES = new Set<string>(["light", "dark"]);
const RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";
const JSON_RPC_ENVELOPE_KEYS = new Set(["jsonrpc", "id", "relatedTask", "taskId"]);
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/u;

type NpAgentMcpStoredTerminalResultKey =
  | keyof Extract<NpAgentMcpStoredTerminalResultV1, { kind: "tool_result" }>
  | keyof Extract<NpAgentMcpStoredTerminalResultV1, { kind: "jsonrpc_error" }>;

const RAW_RESULT_LIMITS: AgentCanonicalJsonInspectionLimits = {
  maximumDepth: npAgentContractLimits.invocationDepth,
  maximumNodes: npAgentContractLimits.invocationNodes,
  maximumArrayItems: npAgentContractLimits.invocationArrayItems,
  maximumObjectProperties: npAgentContractLimits.invocationObjectProperties,
  maximumStringCharacters: npAgentContractLimits.invocationStringCharacters,
  maximumCanonicalBytes: npAgentContractLimits.mcpFrameBytes,
};

const STORED_RESULT_LIMITS: AgentCanonicalJsonInspectionLimits = {
  ...RAW_RESULT_LIMITS,
  maximumCanonicalBytes: npAgentContractLimits.invocationBytes,
};

const STRUCTURED_RESULT_LIMITS: AgentCanonicalJsonInspectionLimits = {
  ...STORED_RESULT_LIMITS,
  maximumCanonicalBytes: npAgentContractLimits.inlineMcpStructuredResultBytes,
};

const ERROR_DATA_LIMITS: AgentCanonicalJsonInspectionLimits = {
  maximumDepth: npApiErrorContractLimits.detailDepth,
  maximumNodes: npApiErrorContractLimits.detailNodes,
  maximumArrayItems: npApiErrorContractLimits.detailArrayItems,
  maximumObjectProperties: npApiErrorContractLimits.detailObjectKeys,
  maximumStringCharacters: npApiErrorContractLimits.detailStringLength,
  maximumCanonicalBytes: npAgentContractLimits.invocationBytes,
};

export const npAgentMcpTaskResultCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "kind",
  "result",
  "error",
] as const satisfies readonly NpAgentMcpStoredTerminalResultKey[];

export const npAgentMcpTaskResultCanonicalExcludedKeysV1 = [
  "terminalResultDigest",
  "taskId",
  "status",
  "statusMessage",
  "jsonrpc",
  "id",
  "relatedTask",
  "createdAt",
  "lastUpdatedAt",
  "expiresAt",
] as const;

export const npAgentMcpTaskResultCanonicalToolResultIncludedKeysV1 = [
  "schemaVersion",
  "kind",
  "result",
] as const;

export const npAgentMcpTaskResultCanonicalJsonRpcErrorIncludedKeysV1 = [
  "schemaVersion",
  "kind",
  "error",
] as const;

export const npAgentMcpTaskResultCanonicalErrorIncludedKeysV1 = [
  "code",
  "message",
  "data",
] as const;

function requireJsonValueWithLimits(
  value: unknown,
  path: string,
  limits: AgentCanonicalJsonInspectionLimits,
): NpAgentJsonValue {
  return npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, limits),
    "Invalid Agent MCP task terminal result",
  );
}

function requireJsonObjectWithLimits(
  value: unknown,
  path: string,
  limits: AgentCanonicalJsonInspectionLimits,
): NpAgentJsonObject {
  const result = requireJsonValueWithLimits(value, path, limits);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    failCanonicalBody("shape", path, "must be an object-root I-JSON value");
  }
  return result;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    failCanonicalBody("invalid-field", path, "must be a string");
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    failCanonicalBody("invalid-field", path, "must be a boolean");
  }
  return value;
}

function requireObject(value: unknown, path: string): NpAgentJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be an object");
  }
  return value as NpAgentJsonObject;
}

function requireUri(value: unknown, path: string): string {
  const uri = requireString(value, path);
  if (uri.length === 0 || uri.length > npAgentContractLimits.invocationStringCharacters) {
    failCanonicalBody("limit", path, "must be one bounded absolute URI");
  }
  try {
    new URL(uri);
  } catch {
    failCanonicalBody("invalid-field", path, "must be an absolute URI");
  }
  return uri;
}

function requireCanonicalBase64(value: unknown, path: string): string {
  const data = requireString(value, path);
  if (!CANONICAL_BASE64_PATTERN.test(data)) {
    failCanonicalBody("invalid-field", path, "must use canonical padded RFC 4648 base64");
  }
  return data;
}

function validateAnnotations(value: unknown, path: string): void {
  const annotations = requireObject(value, path);
  if (Object.hasOwn(annotations, "audience")) {
    const audience = annotations.audience;
    if (!Array.isArray(audience)) {
      failCanonicalBody("shape", `${path}.audience`, "must be an array");
    }
    audience.forEach((role, index) => {
      canonicalBodyEnum(role, `${path}.audience[${index.toString()}]`, ANNOTATION_ROLES);
    });
  }
  if (Object.hasOwn(annotations, "priority")) {
    const priority = annotations.priority;
    if (
      typeof priority !== "number" ||
      !Number.isFinite(priority) ||
      priority < 0 ||
      priority > 1
    ) {
      failCanonicalBody("limit", `${path}.priority`, "must be a finite number from 0 through 1");
    }
  }
  if (Object.hasOwn(annotations, "lastModified")) {
    canonicalBodyUtc(annotations.lastModified, `${path}.lastModified`);
  }
}

function validateMeta(value: unknown, path: string): void {
  requireObject(value, path);
}

function validateCommonContentFields(content: NpAgentJsonObject, path: string): void {
  if (Object.hasOwn(content, "annotations")) {
    validateAnnotations(content.annotations, `${path}.annotations`);
  }
  if (Object.hasOwn(content, "_meta")) {
    validateMeta(content._meta, `${path}._meta`);
  }
}

function validateIcon(value: unknown, path: string): void {
  const icon = requireObject(value, path);
  if (!Object.hasOwn(icon, "src")) {
    failCanonicalBody("missing-field", `${path}.src`, "is required");
  }
  requireUri(icon.src, `${path}.src`);
  if (Object.hasOwn(icon, "mimeType")) requireString(icon.mimeType, `${path}.mimeType`);
  if (Object.hasOwn(icon, "theme")) {
    canonicalBodyEnum(icon.theme, `${path}.theme`, ICON_THEMES);
  }
  if (Object.hasOwn(icon, "sizes")) {
    if (!Array.isArray(icon.sizes)) {
      failCanonicalBody("shape", `${path}.sizes`, "must be an array");
    }
    icon.sizes.forEach((size, index) => {
      requireString(size, `${path}.sizes[${index.toString()}]`);
    });
  }
}

function validateResourceContents(value: unknown, path: string): void {
  const resource = requireObject(value, path);
  if (!Object.hasOwn(resource, "uri")) {
    failCanonicalBody("missing-field", `${path}.uri`, "is required");
  }
  requireUri(resource.uri, `${path}.uri`);
  const hasText = Object.hasOwn(resource, "text");
  const hasBlob = Object.hasOwn(resource, "blob");
  if (!hasText && !hasBlob) {
    failCanonicalBody("missing-field", path, "must contain text or blob resource contents");
  }
  if (hasText) requireString(resource.text, `${path}.text`);
  if (hasBlob) requireCanonicalBase64(resource.blob, `${path}.blob`);
  if (Object.hasOwn(resource, "mimeType")) {
    requireString(resource.mimeType, `${path}.mimeType`);
  }
  if (Object.hasOwn(resource, "_meta")) validateMeta(resource._meta, `${path}._meta`);
}

function validateContentBlock(value: unknown, path: string): void {
  const content = requireObject(value, path);
  if (!Object.hasOwn(content, "type")) {
    failCanonicalBody("missing-field", `${path}.type`, "is required");
  }
  const type = canonicalBodyEnum<"text" | "image" | "audio" | "resource_link" | "resource">(
    content.type,
    `${path}.type`,
    CONTENT_TYPES,
  );
  validateCommonContentFields(content, path);

  if (type === "text") {
    if (!Object.hasOwn(content, "text")) {
      failCanonicalBody("missing-field", `${path}.text`, "is required");
    }
    requireString(content.text, `${path}.text`);
    return;
  }
  if (type === "image" || type === "audio") {
    if (!Object.hasOwn(content, "data")) {
      failCanonicalBody("missing-field", `${path}.data`, "is required");
    }
    if (!Object.hasOwn(content, "mimeType")) {
      failCanonicalBody("missing-field", `${path}.mimeType`, "is required");
    }
    requireCanonicalBase64(content.data, `${path}.data`);
    requireString(content.mimeType, `${path}.mimeType`);
    return;
  }
  if (type === "resource_link") {
    for (const key of ["name", "uri"] as const) {
      if (!Object.hasOwn(content, key)) {
        failCanonicalBody("missing-field", `${path}.${key}`, "is required");
      }
    }
    requireString(content.name, `${path}.name`);
    requireUri(content.uri, `${path}.uri`);
    for (const key of ["title", "description", "mimeType"] as const) {
      if (Object.hasOwn(content, key)) requireString(content[key], `${path}.${key}`);
    }
    if (Object.hasOwn(content, "size")) {
      if (
        !Number.isSafeInteger(content.size) ||
        typeof content.size !== "number" ||
        content.size < 0
      ) {
        failCanonicalBody("invalid-field", `${path}.size`, "must be a non-negative safe integer");
      }
    }
    if (Object.hasOwn(content, "icons")) {
      if (!Array.isArray(content.icons)) {
        failCanonicalBody("shape", `${path}.icons`, "must be an array");
      }
      content.icons.forEach((icon, index) => {
        validateIcon(icon, `${path}.icons[${index.toString()}]`);
      });
    }
    return;
  }

  if (!Object.hasOwn(content, "resource")) {
    failCanonicalBody("missing-field", `${path}.resource`, "is required");
  }
  validateResourceContents(content.resource, `${path}.resource`);
}

function normalizeCallToolResult(value: unknown, path: string): NpAgentJsonObject {
  const result = requireJsonObjectWithLimits(value, path, RAW_RESULT_LIMITS);
  for (const key of JSON_RPC_ENVELOPE_KEYS) {
    if (Object.hasOwn(result, key)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "is not part of a CallToolResult");
    }
  }
  if (!Object.hasOwn(result, "content")) {
    failCanonicalBody("missing-field", `${path}.content`, "is required");
  }
  if (!Array.isArray(result.content)) {
    failCanonicalBody("shape", `${path}.content`, "must be an array");
  }
  result.content.forEach((content, index) => {
    validateContentBlock(content, `${path}.content[${index.toString()}]`);
  });
  if (Object.hasOwn(result, "structuredContent")) {
    requireJsonObjectWithLimits(
      result.structuredContent,
      `${path}.structuredContent`,
      STRUCTURED_RESULT_LIMITS,
    );
  }
  if (Object.hasOwn(result, "isError")) {
    requireBoolean(result.isError, `${path}.isError`);
  }
  if (Object.hasOwn(result, "_meta")) {
    const meta = requireObject(result._meta, `${path}._meta`);
    delete meta[RELATED_TASK_META_KEY];
    if (Object.keys(meta).length === 0) delete result._meta;
  }
  return requireJsonObjectWithLimits(result, path, STORED_RESULT_LIMITS);
}

function hasUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function validateErrorDataSafety(value: NpAgentJsonValue, path: string): void {
  if (typeof value === "string") {
    if (hasUnsafeText(value)) {
      failCanonicalBody("unsafe-value", path, "must be bounded safe text");
    }
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateErrorDataSafety(entry, `${path}[${index.toString()}]`);
    });
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.length === 0 ||
      key.length > npApiErrorContractLimits.detailKeyLength ||
      hasUnsafeText(key)
    ) {
      failCanonicalBody("unsafe-value", `${path}.${key}`, "uses an invalid error-data key");
    }
    validateErrorDataSafety(entry, `${path}.${key}`);
  }
}

function parseJsonRpcError(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): Extract<NpAgentMcpStoredTerminalResultV1, { kind: "jsonrpc_error" }>["error"] {
  const error = canonicalBodyRecord(
    value,
    path,
    npAgentMcpTaskResultCanonicalErrorIncludedKeysV1,
    ["code", "message"],
    state,
  );
  if (!Number.isSafeInteger(error.code) || typeof error.code !== "number") {
    failCanonicalBody("invalid-field", `${path}.code`, "must be a safe integer JSON-RPC code");
  }
  const code = Object.is(error.code, -0) ? 0 : error.code;
  const message = requireString(error.message, `${path}.message`);
  if (
    message.length === 0 ||
    message.length > npApiErrorContractLimits.messageLength ||
    message.trim() !== message ||
    hasUnsafeText(message)
  ) {
    failCanonicalBody("unsafe-value", `${path}.message`, "must be bounded, trimmed safe text");
  }
  if (!Object.hasOwn(error, "data")) return { code, message };
  const data = requireJsonValueWithLimits(error.data, `${path}.data`, ERROR_DATA_LIMITS);
  validateErrorDataSafety(data, `${path}.data`);
  return { code, message, data };
}

function parseMcpTaskResultCanonical(value: unknown): NpAgentMcpStoredTerminalResultV1 {
  const path = "agent.canonical.mcpTaskResult";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const outer = canonicalBodyRecord(
    value,
    path,
    npAgentMcpTaskResultCanonicalIncludedKeysV1,
    ["schemaVersion", "kind"],
    state,
  );
  if (outer.schemaVersion !== "np.agent-mcp-stored-task-result.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-mcp-stored-task-result.v1",
    );
  }
  const kind = canonicalBodyEnum<"tool_result" | "jsonrpc_error">(
    outer.kind,
    `${path}.kind`,
    RESULT_KINDS,
  );

  const result: NpAgentMcpStoredTerminalResultV1 =
    kind === "tool_result"
      ? (() => {
          if (!Object.hasOwn(outer, "result")) {
            failCanonicalBody("missing-field", `${path}.result`, "is required");
          }
          if (Object.hasOwn(outer, "error")) {
            failCanonicalBody("unknown-field", `${path}.error`, "is forbidden for tool_result");
          }
          return {
            schemaVersion: "np.agent-mcp-stored-task-result.v1" as const,
            kind,
            result: normalizeCallToolResult(outer.result, `${path}.result`),
          };
        })()
      : (() => {
          if (!Object.hasOwn(outer, "error")) {
            failCanonicalBody("missing-field", `${path}.error`, "is required");
          }
          if (Object.hasOwn(outer, "result")) {
            failCanonicalBody("unknown-field", `${path}.result`, "is forbidden for jsonrpc_error");
          }
          return {
            schemaVersion: "np.agent-mcp-stored-task-result.v1" as const,
            kind,
            error: parseJsonRpcError(outer.error, `${path}.error`, state),
          };
        })();

  buildAgentCanonicalFoundationBytes("np.agent-mcp-task-result.v1", result);
  return result;
}

export function npAnalyzeAgentMcpStoredTerminalResult(
  value: unknown,
): NpAgentContractResult<NpAgentMcpStoredTerminalResultV1> {
  return analyzeCanonicalBody("agent.canonical.mcpTaskResult", () =>
    parseMcpTaskResultCanonical(value),
  );
}

export function npRequireAgentMcpStoredTerminalResult(
  value: unknown,
): NpAgentMcpStoredTerminalResultV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentMcpStoredTerminalResult(value),
    "Invalid Agent MCP stored terminal result",
  );
}

export function npBuildAgentMcpTaskResultCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-mcp-task-result.v1", NpAgentMcpStoredTerminalResultV1> {
  return buildAgentCanonicalFoundationBytes(
    "np.agent-mcp-task-result.v1",
    npRequireAgentMcpStoredTerminalResult(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-mcp-task-result.v1",
    NpAgentMcpStoredTerminalResultV1
  >;
}

export async function npDigestAgentMcpTaskResultCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentMcpTaskResultCanonicalBytes(value).domainSeparatedUtf8,
  );
}
