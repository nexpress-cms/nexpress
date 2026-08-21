import { NpAgentContractError } from "./contract.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCanonicalPurposes,
  type NpAgentCanonicalPurposeV1,
  type NpAgentContractIssue,
  type NpAgentContractResult,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
} from "./types.js";

const CANONICAL_DOMAIN = "np.agent-canonical-json.v1";
const CANONICAL_PURPOSES = new Set<string>(npAgentCanonicalPurposes);
const FOUNDATION_MAXIMUM_BODY_BYTES = Math.max(...Object.values(npAgentCanonicalBodyMaxBytesV1));
const FOUNDATION_MAXIMUM_DEPTH = 64;
const FOUNDATION_MAXIMUM_NODES = FOUNDATION_MAXIMUM_BODY_BYTES;
const FOUNDATION_MAXIMUM_CONTAINER_ENTRIES = FOUNDATION_MAXIMUM_BODY_BYTES;
const FOUNDATION_MAXIMUM_STRING_CODE_UNITS = FOUNDATION_MAXIMUM_BODY_BYTES;

interface CanonicalInspectionState {
  seen: WeakSet<object>;
  nodes: number;
}

export interface AgentCanonicalFoundationBytesV1<P extends NpAgentCanonicalPurposeV1> {
  purpose: P;
  body: NpAgentJsonObject;
  canonicalJsonUtf8: Uint8Array;
  domainSeparatedUtf8: Uint8Array;
}

function fail(code: NpAgentContractIssue["code"], path: string, message: string): never {
  throw new NpAgentContractError("Invalid Agent canonical JSON", [{ code, path, message }]);
}

function analyze<T>(path: string, parser: () => T): NpAgentContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    if (error instanceof NpAgentContractError) {
      return { ok: false, issues: error.contractIssues };
    }
    return {
      ok: false,
      issues: [
        {
          code: "unsafe-value",
          path,
          message: "could not be inspected safely",
        },
      ],
    };
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function cloneString(value: string, path: string): string {
  if (value.length > FOUNDATION_MAXIMUM_STRING_CODE_UNITS) {
    fail("limit", path, "exceeds the canonical string safety limit");
  }
  if (hasLoneSurrogate(value)) {
    fail("unsafe-value", path, "must not contain lone UTF-16 surrogates");
  }
  return value;
}

function claimContainer(value: object, path: string, state: CanonicalInspectionState): void {
  if (state.seen.has(value)) {
    fail("shape", path, "must not contain cycles or shared references");
  }
  state.seen.add(value);
}

function defineDataProperty(target: NpAgentJsonObject, key: string, value: NpAgentJsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneArray(
  value: unknown[],
  path: string,
  depth: number,
  state: CanonicalInspectionState,
): NpAgentJsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail("shape", path, "must use the ordinary array prototype");
  }
  claimContainer(value, path, state);

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    fail("shape", path, "must have one ordinary array length");
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    fail("shape", path, "must have one valid array length");
  }
  if (length > FOUNDATION_MAXIMUM_CONTAINER_ENTRIES) {
    fail("limit", path, "contains too many array entries");
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      fail("shape", path, "must not contain symbol properties");
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || index.toString() !== key) {
      fail("shape", path, "must not contain non-index array properties");
    }
  }

  const result: NpAgentJsonValue[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("shape", `${path}[${index.toString()}]`, "must be one dense plain data element");
    }
    result.push(cloneJson(descriptor.value, `${path}[${index.toString()}]`, depth + 1, state));
  }
  return result;
}

function cloneObject(
  value: object,
  path: string,
  depth: number,
  state: CanonicalInspectionState,
): NpAgentJsonObject {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail("shape", path, "must use the ordinary object prototype");
  }
  claimContainer(value, path, state);

  const keys = Reflect.ownKeys(value);
  if (keys.length > FOUNDATION_MAXIMUM_CONTAINER_ENTRIES) {
    fail("limit", path, "contains too many object properties");
  }
  const result: NpAgentJsonObject = {};
  for (const key of keys) {
    if (typeof key !== "string") {
      fail("shape", path, "must not contain symbol properties");
    }
    cloneString(key, `${path}.${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("shape", `${path}.${key}`, "must be one enumerable plain data property");
    }
    defineDataProperty(
      result,
      key,
      cloneJson(descriptor.value, `${path}.${key}`, depth + 1, state),
    );
  }
  return result;
}

function cloneJson(
  value: unknown,
  path: string,
  depth: number,
  state: CanonicalInspectionState,
): NpAgentJsonValue {
  state.nodes += 1;
  if (state.nodes > FOUNDATION_MAXIMUM_NODES) {
    fail("limit", path, "exceeds the canonical JSON node safety limit");
  }
  if (depth > FOUNDATION_MAXIMUM_DEPTH) {
    fail("limit", path, "exceeds the canonical JSON depth safety limit");
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return cloneString(value, path);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("unsafe-value", path, "must be one finite I-JSON number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return cloneArray(value, path, depth, state);
  if (typeof value === "object") return cloneObject(value, path, depth, state);
  fail("shape", path, "must contain only I-JSON values");
}

function requireCanonicalJsonValue(value: unknown, path: string): NpAgentJsonValue {
  const result = analyze(path, () =>
    cloneJson(value, path, 0, { seen: new WeakSet<object>(), nodes: 0 }),
  );
  if (result.ok) return result.value;
  throw new NpAgentContractError("Invalid Agent canonical JSON", result.issues);
}

function serializeAnalyzedJson(value: NpAgentJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeAnalyzedJson(entry)).join(",")}]`;
  }

  const fields = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeAnalyzedJson(value[key])}`);
  return `{${fields.join(",")}}`;
}

function concatenateBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const output = new Uint8Array(first.byteLength + second.byteLength);
  output.set(first, 0);
  output.set(second, first.byteLength);
  return output;
}

export function analyzeAgentCanonicalJsonValue(
  value: unknown,
): NpAgentContractResult<NpAgentJsonValue> {
  return analyze("agent.canonical", () =>
    cloneJson(value, "agent.canonical", 0, { seen: new WeakSet<object>(), nodes: 0 }),
  );
}

export function serializeAgentCanonicalJson(value: unknown): string {
  return serializeAnalyzedJson(requireCanonicalJsonValue(value, "agent.canonical"));
}

export function buildAgentCanonicalFoundationBytes<P extends NpAgentCanonicalPurposeV1>(
  purpose: P,
  value: unknown,
): AgentCanonicalFoundationBytesV1<P> {
  if (typeof purpose !== "string" || !CANONICAL_PURPOSES.has(purpose)) {
    fail("invalid-field", "agent.canonical.purpose", "must select one canonical v1 purpose");
  }
  const body = requireCanonicalJsonValue(value, "agent.canonical.body");
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    fail("shape", "agent.canonical.body", "must be an object-root canonical body");
  }

  const encoder = new TextEncoder();
  const canonicalJsonUtf8 = encoder.encode(serializeAnalyzedJson(body));
  const maximumBytes = npAgentCanonicalBodyMaxBytesV1[purpose];
  if (canonicalJsonUtf8.byteLength > maximumBytes) {
    fail(
      "limit",
      "agent.canonical.body",
      `exceeds the ${maximumBytes.toString()} byte limit for ${purpose}`,
    );
  }
  const prefix = encoder.encode(`${CANONICAL_DOMAIN}\0${purpose}\0`);
  return {
    purpose,
    body,
    canonicalJsonUtf8,
    domainSeparatedUtf8: concatenateBytes(prefix, canonicalJsonUtf8),
  };
}
