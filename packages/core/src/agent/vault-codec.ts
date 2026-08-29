import {
  NpAgentVaultError,
  npAgentVaultLimitsV1,
  type NpAgentVaultPlaintextEnvelopeV1,
} from "./vault-contract.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

type CborValue = number | string | Uint8Array | null | CborValue[] | Map<number, CborValue>;

function fail(path: string, message: string): never {
  throw new NpAgentVaultError("VAULT_ENVELOPE_INVALID", `Invalid ${path}: ${message}.`);
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "must be a plain object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return fail(path, "must use the ordinary object prototype");
  }
  const actual = Reflect.ownKeys(value);
  const allowed = new Set(keys);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    return fail(path, "must contain the exact branch fields");
  }
  for (const key of actual) {
    if (typeof key !== "string") return fail(path, "must not contain symbol fields");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail(`${path}.${key}`, "must be one enumerable data property");
    }
  }
  return value as Record<string, unknown>;
}

function requireByteSource(value: unknown, path: string): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > npAgentVaultLimitsV1.plaintextEnvelopeBytes
  ) {
    return fail(path, "must be non-empty bytes within the encoded envelope ceiling");
  }
  return value;
}

function requireBytes(value: unknown, path: string): Uint8Array {
  return new Uint8Array(requireByteSource(value, path));
}

function requireIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail(path, "must use the canonical adapter identifier grammar");
  }
  return value;
}

function requireFingerprint(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npAgentVaultLimitsV1.adapterFingerprintCharacters ||
    !VISIBLE_ASCII_PATTERN.test(value)
  ) {
    return fail(path, "must be bounded visible ASCII");
  }
  return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value <= 0) {
    return fail(path, "must be a positive safe integer");
  }
  return value;
}

function requireTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "must be a canonical UTC timestamp");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return fail(path, "must be a canonical UTC timestamp");
  }
  return value;
}

function requirePermissions(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 1_024) {
    return fail(path, "must be a bounded array");
  }
  const result = value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      TEXT_ENCODER.encode(entry).length > 1_024 ||
      TEXT_DECODER.decode(TEXT_ENCODER.encode(entry)) !== entry
    ) {
      return fail(`${path}[${index.toString()}]`, "must be bounded non-empty UTF-8 text");
    }
    return entry;
  });
  if (
    new Set(result).size !== result.length ||
    result.some((entry, index) => index > 0 && result[index - 1] >= entry)
  ) {
    return fail(path, "must be lexicographically sorted and unique");
  }
  return result;
}

export function npRequireAgentVaultPlaintextEnvelopeV1(
  value: unknown,
): NpAgentVaultPlaintextEnvelopeV1 {
  const path = "agent.vault.plaintextEnvelope";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "must be a plain object");
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "api_key") {
    const record = exactRecord(value, path, [
      "schemaVersion",
      "kind",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
      "secret",
    ]);
    if (record.schemaVersion !== "np.agent-credential-envelope.v1") {
      return fail(`${path}.schemaVersion`, "must be np.agent-credential-envelope.v1");
    }
    return {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "api_key",
      adapterId: requireIdentifier(record.adapterId, `${path}.adapterId`),
      adapterContractVersion: requirePositiveInteger(
        record.adapterContractVersion,
        `${path}.adapterContractVersion`,
      ),
      adapterFingerprint: requireFingerprint(
        record.adapterFingerprint,
        `${path}.adapterFingerprint`,
      ),
      secret: requireBytes(record.secret, `${path}.secret`),
    };
  }
  if (kind === "oauth") {
    const record = exactRecord(value, path, [
      "schemaVersion",
      "kind",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
      "tokenType",
      "accessToken",
      "accessExpiresAt",
      "refresh",
      "grantedPermissions",
    ]);
    if (
      record.schemaVersion !== "np.agent-credential-envelope.v1" ||
      record.tokenType !== "Bearer"
    ) {
      return fail(path, "must use the v1 schema and Bearer token type");
    }
    const refreshValue = record.refresh;
    if (typeof refreshValue !== "object" || refreshValue === null || Array.isArray(refreshValue)) {
      return fail(`${path}.refresh`, "must be one exact refresh branch");
    }
    const refreshMode = (refreshValue as { mode?: unknown }).mode;
    const refreshMetadata =
      refreshMode === "present"
        ? (() => {
            const branch = exactRecord(refreshValue, `${path}.refresh`, [
              "mode",
              "token",
              "expiresAt",
            ]);
            return {
              mode: "present" as const,
              token: branch.token,
              expiresAt:
                branch.expiresAt === null
                  ? null
                  : requireTimestamp(branch.expiresAt, `${path}.refresh.expiresAt`),
            };
          })()
        : refreshMode === "absent"
          ? (() => {
              exactRecord(refreshValue, `${path}.refresh`, ["mode"]);
              return { mode: "absent" as const };
            })()
          : fail(`${path}.refresh.mode`, "must be present or absent");
    const adapterId = requireIdentifier(record.adapterId, `${path}.adapterId`);
    const adapterContractVersion = requirePositiveInteger(
      record.adapterContractVersion,
      `${path}.adapterContractVersion`,
    );
    const adapterFingerprint = requireFingerprint(
      record.adapterFingerprint,
      `${path}.adapterFingerprint`,
    );
    const accessExpiresAt = requireTimestamp(record.accessExpiresAt, `${path}.accessExpiresAt`);
    const grantedPermissions = requirePermissions(
      record.grantedPermissions,
      `${path}.grantedPermissions`,
    );
    const accessToken = requireByteSource(record.accessToken, `${path}.accessToken`);
    const refreshToken =
      refreshMetadata.mode === "present"
        ? requireByteSource(refreshMetadata.token, `${path}.refresh.token`)
        : null;
    const refresh =
      refreshMetadata.mode === "present"
        ? {
            mode: "present" as const,
            token: new Uint8Array(refreshToken!),
            expiresAt: refreshMetadata.expiresAt,
          }
        : refreshMetadata;
    return {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "oauth",
      adapterId,
      adapterContractVersion,
      adapterFingerprint,
      tokenType: "Bearer",
      accessToken: new Uint8Array(accessToken),
      accessExpiresAt,
      refresh,
      grantedPermissions,
    };
  }
  if (kind === "provider_oauth_pkce") {
    const record = exactRecord(value, path, ["schemaVersion", "kind", "verifier"]);
    if (record.schemaVersion !== "np.agent-credential-envelope.v1") {
      return fail(`${path}.schemaVersion`, "must be np.agent-credential-envelope.v1");
    }
    const verifier = requireBytes(record.verifier, `${path}.verifier`);
    let text: string;
    try {
      text = TEXT_DECODER.decode(verifier);
    } catch {
      verifier.fill(0);
      return fail(`${path}.verifier`, "must be ASCII PKCE bytes");
    }
    if (!PKCE_PATTERN.test(text) || TEXT_ENCODER.encode(text).length !== verifier.length) {
      verifier.fill(0);
      return fail(`${path}.verifier`, "must satisfy the exact 43..128 byte PKCE grammar");
    }
    return {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "provider_oauth_pkce",
      verifier,
    };
  }
  if (kind === "provider_oauth_code") {
    const record = exactRecord(value, path, ["schemaVersion", "kind", "code"]);
    if (record.schemaVersion !== "np.agent-credential-envelope.v1") {
      return fail(`${path}.schemaVersion`, "must be np.agent-credential-envelope.v1");
    }
    return {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "provider_oauth_code",
      code: requireBytes(record.code, `${path}.code`),
    };
  }
  return fail(`${path}.kind`, "must use one frozen v1 branch");
}

function encodeHead(major: number, value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) return fail("agent.vault.cbor", "invalid length");
  if (value < 24) return Uint8Array.of((major << 5) | value);
  if (value <= 0xff) return Uint8Array.of((major << 5) | 24, value);
  if (value <= 0xffff) return Uint8Array.of((major << 5) | 25, value >>> 8, value & 0xff);
  if (value <= 0xffff_ffff) {
    return Uint8Array.of(
      (major << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }
  const high = Math.floor(value / 0x1_0000_0000);
  const low = value >>> 0;
  return Uint8Array.of(
    (major << 5) | 27,
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function encodeUInt(value: number): Uint8Array {
  return encodeHead(0, value);
}

function encodeBytes(value: Uint8Array): Uint8Array {
  return concat([encodeHead(2, value.byteLength), value]);
}

function encodeText(value: string): Uint8Array {
  const bytes = TEXT_ENCODER.encode(value);
  return concat([encodeHead(3, bytes.byteLength), bytes]);
}

function encodeTextArray(value: readonly string[]): Uint8Array {
  return concat([encodeHead(4, value.length), ...value.map(encodeText)]);
}

function encodeMap(entries: readonly (readonly [number, Uint8Array])[]): Uint8Array {
  return concat([
    encodeHead(5, entries.length),
    ...entries.flatMap(([key, value]) => [encodeUInt(key), value]),
  ]);
}

export function npEncodeAgentVaultPlaintextEnvelopeV1(value: unknown): Uint8Array {
  const envelope = npRequireAgentVaultPlaintextEnvelopeV1(value);
  let bytes: Uint8Array | null = null;
  try {
    switch (envelope.kind) {
      case "api_key":
        bytes = encodeMap([
          [0, encodeUInt(1)],
          [1, encodeUInt(0)],
          [2, encodeText(envelope.adapterId)],
          [3, encodeUInt(envelope.adapterContractVersion)],
          [4, encodeText(envelope.adapterFingerprint)],
          [5, encodeBytes(envelope.secret)],
        ]);
        break;
      case "oauth": {
        const entries: Array<readonly [number, Uint8Array]> = [
          [0, encodeUInt(1)],
          [1, encodeUInt(1)],
          [2, encodeText(envelope.adapterId)],
          [3, encodeUInt(envelope.adapterContractVersion)],
          [4, encodeText(envelope.adapterFingerprint)],
          [6, encodeUInt(0)],
          [7, encodeBytes(envelope.accessToken)],
          [8, encodeText(envelope.accessExpiresAt)],
          [9, encodeUInt(envelope.refresh.mode === "present" ? 0 : 1)],
        ];
        if (envelope.refresh.mode === "present") {
          entries.push([10, encodeBytes(envelope.refresh.token)]);
          entries.push([
            11,
            envelope.refresh.expiresAt === null
              ? Uint8Array.of(0xf6)
              : encodeText(envelope.refresh.expiresAt),
          ]);
        }
        entries.push([12, encodeTextArray(envelope.grantedPermissions)]);
        entries.sort(([left], [right]) => left - right);
        bytes = encodeMap(entries);
        break;
      }
      case "provider_oauth_pkce":
        bytes = encodeMap([
          [0, encodeUInt(1)],
          [1, encodeUInt(2)],
          [13, encodeBytes(envelope.verifier)],
        ]);
        break;
      case "provider_oauth_code":
        bytes = encodeMap([
          [0, encodeUInt(1)],
          [1, encodeUInt(3)],
          [14, encodeBytes(envelope.code)],
        ]);
        break;
    }
    if (bytes.byteLength > npAgentVaultLimitsV1.plaintextEnvelopeBytes) {
      bytes.fill(0);
      return fail("agent.vault.plaintextEnvelope", "exceeds the 160 KiB encoded ceiling");
    }
    return bytes;
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    npZeroAgentVaultEnvelopeV1(envelope);
  }
}

class Decoder {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.byteLength === 0 || bytes.byteLength > npAgentVaultLimitsV1.plaintextEnvelopeBytes) {
      fail("agent.vault.cbor", "must be within the frozen encoded size ceiling");
    }
  }

  complete(): void {
    if (this.offset !== this.bytes.byteLength)
      fail("agent.vault.cbor", "must not contain trailing bytes");
  }

  read(depth = 0): CborValue {
    if (depth > 3 || this.offset >= this.bytes.byteLength) {
      return fail("agent.vault.cbor", "is truncated or too deeply nested");
    }
    const initial = this.bytes[this.offset++];
    const major = initial >>> 5;
    const additional = initial & 0x1f;
    if (major === 7) {
      if (additional === 22) return null;
      return fail("agent.vault.cbor", "must not use tags, floats, booleans, or indefinite values");
    }
    const length = this.readArgument(additional);
    if (major === 0) return length;
    if (major === 2) return this.readBytes(length);
    if (major === 3) {
      const encoded = this.readBytes(length);
      let text: string;
      try {
        text = TEXT_DECODER.decode(encoded);
      } catch {
        return fail("agent.vault.cbor", "contains malformed UTF-8");
      }
      const roundTrip = TEXT_ENCODER.encode(text);
      if (
        roundTrip.length !== encoded.length ||
        roundTrip.some((byte, index) => byte !== encoded[index])
      ) {
        return fail("agent.vault.cbor", "contains non-canonical UTF-8");
      }
      return text;
    }
    if (major === 4) {
      if (length > 1_024) return fail("agent.vault.cbor", "contains an oversized array");
      return Array.from({ length }, () => this.read(depth + 1));
    }
    if (major === 5) {
      if (length > 15) return fail("agent.vault.cbor", "contains an oversized map");
      const result = new Map<number, CborValue>();
      let previous = -1;
      for (let index = 0; index < length; index += 1) {
        const key = this.read(depth + 1);
        if (typeof key !== "number" || !Number.isInteger(key) || key <= previous || key > 14) {
          return fail("agent.vault.cbor", "map keys must be ascending unique v1 integers");
        }
        previous = key;
        result.set(key, this.read(depth + 1));
      }
      return result;
    }
    return fail("agent.vault.cbor", "uses an unsupported major type");
  }

  private readArgument(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 31 || additional < 24 || additional > 27) {
      return fail("agent.vault.cbor", "uses an unsupported additional value");
    }
    const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 8;
    if (this.offset + width > this.bytes.byteLength)
      return fail("agent.vault.cbor", "is truncated");
    let value = 0;
    for (let index = 0; index < width; index += 1) {
      value = value * 256 + this.bytes[this.offset++];
      if (value > MAX_SAFE_INTEGER) return fail("agent.vault.cbor", "contains an unsafe integer");
    }
    const minimum = width === 1 ? 24 : width === 2 ? 0x100 : width === 4 ? 0x1_0000 : 0x1_0000_0000;
    if (value < minimum) return fail("agent.vault.cbor", "does not use the shortest integer form");
    return value;
  }

  private readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.byteLength)
      return fail("agent.vault.cbor", "is truncated");
    const result = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}

function requireMap(value: CborValue): Map<number, CborValue> {
  if (!(value instanceof Map)) return fail("agent.vault.cbor", "top level must be a map");
  return value;
}

function requireKeySet(map: Map<number, CborValue>, expected: readonly number[]): void {
  const keys = [...map.keys()];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("agent.vault.cbor", "branch contains the wrong integer key set");
  }
}

function mapUInt(map: Map<number, CborValue>, key: number): number {
  const value = map.get(key);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fail(`agent.vault.cbor[${key.toString()}]`, "must be an unsigned integer");
  }
  return value;
}

function mapText(map: Map<number, CborValue>, key: number): string {
  const value = map.get(key);
  if (typeof value !== "string") return fail(`agent.vault.cbor[${key.toString()}]`, "must be text");
  return value;
}

function mapBytes(map: Map<number, CborValue>, key: number): Uint8Array {
  const value = map.get(key);
  if (!(value instanceof Uint8Array) || value.length === 0) {
    return fail(`agent.vault.cbor[${key.toString()}]`, "must be non-empty bytes");
  }
  return value;
}

export function npDecodeAgentVaultPlaintextEnvelopeV1(
  value: Uint8Array,
): NpAgentVaultPlaintextEnvelopeV1 {
  if (!(value instanceof Uint8Array)) return fail("agent.vault.cbor", "must be a Uint8Array");
  const decoder = new Decoder(value);
  const map = requireMap(decoder.read());
  decoder.complete();
  if (mapUInt(map, 0) !== 1) return fail("agent.vault.cbor[0]", "must be envelope version 1");
  const kind = mapUInt(map, 1);
  let envelope: NpAgentVaultPlaintextEnvelopeV1;
  if (kind === 0) {
    requireKeySet(map, [0, 1, 2, 3, 4, 5]);
    envelope = {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "api_key",
      adapterId: mapText(map, 2),
      adapterContractVersion: mapUInt(map, 3),
      adapterFingerprint: mapText(map, 4),
      secret: mapBytes(map, 5),
    };
  } else if (kind === 1) {
    const refreshMode = mapUInt(map, 9);
    if (mapUInt(map, 6) !== 0) return fail("agent.vault.cbor[6]", "must be Bearer token type 0");
    if (refreshMode === 0) requireKeySet(map, [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
    else if (refreshMode === 1) requireKeySet(map, [0, 1, 2, 3, 4, 6, 7, 8, 9, 12]);
    else return fail("agent.vault.cbor[9]", "must be present/absent refresh mode");
    const permissions = map.get(12);
    if (!Array.isArray(permissions) || permissions.some((entry) => typeof entry !== "string")) {
      return fail("agent.vault.cbor[12]", "must be an array of permission text");
    }
    const expiry = map.get(11);
    envelope = {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "oauth",
      adapterId: mapText(map, 2),
      adapterContractVersion: mapUInt(map, 3),
      adapterFingerprint: mapText(map, 4),
      tokenType: "Bearer",
      accessToken: mapBytes(map, 7),
      accessExpiresAt: mapText(map, 8),
      refresh:
        refreshMode === 0
          ? {
              mode: "present",
              token: mapBytes(map, 10),
              expiresAt:
                expiry === null
                  ? null
                  : typeof expiry === "string"
                    ? expiry
                    : fail("agent.vault.cbor[11]", "must be text or null"),
            }
          : { mode: "absent" },
      grantedPermissions: permissions as string[],
    };
  } else if (kind === 2) {
    requireKeySet(map, [0, 1, 13]);
    envelope = {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "provider_oauth_pkce",
      verifier: mapBytes(map, 13),
    };
  } else if (kind === 3) {
    requireKeySet(map, [0, 1, 14]);
    envelope = {
      schemaVersion: "np.agent-credential-envelope.v1",
      kind: "provider_oauth_code",
      code: mapBytes(map, 14),
    };
  } else {
    return fail("agent.vault.cbor[1]", "must be one frozen kind");
  }
  try {
    return npRequireAgentVaultPlaintextEnvelopeV1(envelope);
  } finally {
    npZeroAgentVaultEnvelopeV1(envelope);
  }
}

export function npZeroAgentVaultEnvelopeV1(value: NpAgentVaultPlaintextEnvelopeV1): void {
  if (value.kind === "api_key") value.secret.fill(0);
  else if (value.kind === "oauth") {
    value.accessToken.fill(0);
    if (value.refresh.mode === "present") value.refresh.token.fill(0);
  } else if (value.kind === "provider_oauth_pkce") value.verifier.fill(0);
  else value.code.fill(0);
}
