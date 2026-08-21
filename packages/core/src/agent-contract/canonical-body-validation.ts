import { npAuthUuidPattern, npUserRoles } from "../auth-contract/index.js";
import type { NpCapability } from "../auth/capabilities.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { NpAgentContractError } from "./contract.js";
import type { NpAgentCapabilityId, NpAgentContractIssue, NpAgentContractResult } from "./types.js";
import { npAgentCapabilityIds } from "./types.js";

export interface CanonicalBodyInspectionState {
  seen: WeakSet<object>;
}

const UUID_PATTERN = new RegExp(npAuthUuidPattern, "u");
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,39}(?:\.[a-z][a-z0-9_-]{0,39})*$/u;
const CAPABILITY_IDS = new Set<string>(npAgentCapabilityIds);
const USER_ROLES = new Set<string>(npUserRoles);
const CAPABILITY_INVENTORY = {
  "site.access": true,
  "content.publish": true,
  "content.author": true,
  "community.moderate": true,
  "admin.manage": true,
} as const satisfies Record<NpCapability, true>;
const CAPABILITIES = new Set<string>(Object.keys(CAPABILITY_INVENTORY));

export function failCanonicalBody(
  code: NpAgentContractIssue["code"],
  path: string,
  message: string,
): never {
  throw new NpAgentContractError("Invalid Agent canonical body", [{ code, path, message }]);
}

export function analyzeCanonicalBody<T>(path: string, parser: () => T): NpAgentContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    if (error instanceof NpAgentContractError) {
      return { ok: false, issues: error.contractIssues };
    }
    return {
      ok: false,
      issues: [{ code: "unsafe-value", path, message: "could not be inspected safely" }],
    };
  }
}

function claimContainer(value: object, path: string, state: CanonicalBodyInspectionState): void {
  if (state.seen.has(value)) {
    failCanonicalBody("shape", path, "must not contain cycles or shared references");
  }
  state.seen.add(value);
}

function defineDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function canonicalBodyRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  state: CanonicalBodyInspectionState,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be an ordinary plain object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    failCanonicalBody("shape", path, "must use the ordinary object prototype");
  }
  claimContainer(value, path, state);

  const allowedKeys = new Set(allowed);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      failCanonicalBody("shape", path, "must not contain symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      failCanonicalBody("shape", `${path}.${key}`, "must be an enumerable plain data property");
    }
    if (!allowedKeys.has(key)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "is not part of this exact body");
    }
    defineDataProperty(result, key, descriptor.value as unknown);
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) {
      failCanonicalBody("missing-field", `${path}.${key}`, "is required");
    }
  }
  return result;
}

export function canonicalBodyArray(
  value: unknown,
  path: string,
  maximum: number,
  state: CanonicalBodyInspectionState,
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    failCanonicalBody("shape", path, "must be an ordinary dense array");
  }
  claimContainer(value, path, state);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    failCanonicalBody("shape", path, "must have an ordinary array length");
  }
  const length = lengthDescriptor.value;
  if (length > maximum) {
    failCanonicalBody("limit", path, `may contain at most ${maximum.toString()} entries`);
  }
  const indices = new Set(Array.from({ length }, (_, index) => index.toString()));
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" || (typeof key === "string" && indices.has(key))) continue;
    failCanonicalBody("shape", path, "must not contain non-index array properties");
  }

  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      failCanonicalBody(
        "shape",
        `${path}[${index.toString()}]`,
        "must be an enumerable plain data element",
      );
    }
    result.push(descriptor.value as unknown);
  }
  return result;
}

export function canonicalBodyEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    failCanonicalBody("invalid-field", path, "is not a supported value");
  }
  return value as T;
}

export function canonicalBodyInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number") {
    failCanonicalBody("invalid-field", path, "must be a safe integer");
  }
  if (value < minimum || value > maximum) {
    failCanonicalBody(
      "limit",
      path,
      `must be between ${minimum.toString()} and ${maximum.toString()}`,
    );
  }
  return value;
}

export function canonicalBodyIdentifier(value: unknown, path: string, maximum = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    failCanonicalBody("invalid-field", path, `must be a 1..${maximum.toString()} character id`);
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must use the canonical Agent identifier grammar");
  }
  return value;
}

export function canonicalBodyAscii(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be 1..${maximum.toString()} visible ASCII characters`,
    );
  }
  return value;
}

export function canonicalBodyUuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical lowercase UUID");
  }
  return value;
}

export function canonicalBodySiteId(value: unknown, path: string): string {
  if (!npIsCanonicalSiteId(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical site id");
  }
  return value;
}

export function canonicalBodyCapabilityId(value: unknown, path: string): NpAgentCapabilityId {
  return canonicalBodyEnum<NpAgentCapabilityId>(value, path, CAPABILITY_IDS);
}

export function canonicalBodyCapabilities(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpCapability[] {
  const entries = canonicalBodyArray(value, path, CAPABILITIES.size, state);
  const result: NpCapability[] = [];
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const current = canonicalBodyEnum<NpCapability>(
      entry,
      `${path}[${index.toString()}]`,
      CAPABILITIES,
    );
    if (previous !== null && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical ASCII value",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

export function canonicalBodyUserRole(value: unknown, path: string): string {
  return canonicalBodyEnum(value, path, USER_ROLES);
}
