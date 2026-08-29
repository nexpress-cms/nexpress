import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import {
  npBuildAgentVaultAadCanonicalBytes,
  npDigestAgentVaultAadCanonical,
  npRequireAgentVaultAadCanonical,
  type NpAgentVaultAadCanonicalV1,
} from "../agent-contract/index.js";
import { getDb } from "../db/runtime.js";
import { npAgentVaultEntries, npAgentVaultOperations } from "../db/schema/agent.js";
import {
  NpAgentVaultError,
  npAgentVaultLimitsV1,
  type NpAgentVaultAdapterV1,
  type NpVaultDestroyRequestV1,
  type NpVaultDestroyResultV1,
  type NpVaultOpenRequestV1,
  type NpVaultOperationInspectRequestV1,
  type NpVaultOperationInspectResultV1,
  type NpVaultRewrapRequestV1,
  type NpVaultRewrapResultV1,
  type NpVaultSealRequestV1,
  type NpVaultSealResultV1,
  type NpVaultStoredValueV1,
} from "./vault-contract.js";
import { NpVaultPlaintextLease } from "./vault-runtime.js";

type NpAgentDb = ReturnType<typeof getDb>;
type VaultEntry = typeof npAgentVaultEntries.$inferSelect;
type VaultOperation = typeof npAgentVaultOperations.$inferSelect;

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const REQUEST_DIGEST_PATTERN = /^cj1:hmac-sha256:[a-z0-9][a-z0-9._-]{0,127}:[A-Za-z0-9_-]{43}$/u;
const LOCAL_REF_PATTERN =
  /^local-envelope:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const WRAPPED_KEY_VERSION = 1;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const WRAPPED_DATA_KEY_BYTES = 1 + GCM_NONCE_BYTES + DATA_KEY_BYTES + GCM_TAG_BYTES;
const ZEROIZED_BYTES = Uint8Array.of(0);

export const npLocalEnvelopeVaultAdapterFingerprintV1 = `sha256:${createHash("sha256")
  .update("np-agent-local-envelope/v1\0aes-256-gcm\0per-secret-dek\0journal-inspection", "utf8")
  .digest("base64url")}`;

export interface NpLocalEnvelopeVaultKeyV1 {
  id: string;
  version: string;
  key: Uint8Array;
}

export interface NpLocalEnvelopeVaultAdapterOptionsV1 {
  environment: "development" | "production" | "hosted";
  explicitlyEnabled: boolean;
  activeKey: NpLocalEnvelopeVaultKeyV1;
  retainedKeys?: NpLocalEnvelopeVaultKeyV1[];
  resolveDb?: () => NpAgentDb;
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
  leaseSeconds?: number;
}

function fail(code: string, message: string, retryable = false): never {
  throw new NpAgentVaultError(code, message, retryable);
}

function keyIdentity(value: Pick<NpLocalEnvelopeVaultKeyV1, "id" | "version">): string {
  return `${value.id}\0${value.version}`;
}

function requireKey(value: NpLocalEnvelopeVaultKeyV1): NpLocalEnvelopeVaultKeyV1 {
  if (
    !value ||
    !KEY_PATTERN.test(value.id) ||
    !KEY_PATTERN.test(value.version) ||
    !(value.key instanceof Uint8Array) ||
    value.key.byteLength !== 32
  ) {
    return fail("VAULT_MASTER_KEY_INVALID", "The local-envelope key definition is invalid.");
  }
  return { id: value.id, version: value.version, key: new Uint8Array(value.key) };
}

function requireSignal(signal: AbortSignal): void {
  if (!(signal instanceof AbortSignal)) {
    fail("VAULT_CONTRACT_INVALID", "The local-envelope adapter requires a host AbortSignal.");
  }
  if (signal.aborted)
    fail("VAULT_ADAPTER_ABORTED", "The local-envelope operation was aborted.", true);
}

function requireRequestDigest(value: string): void {
  if (!REQUEST_DIGEST_PATTERN.test(value)) {
    fail("VAULT_CONTRACT_INVALID", "The vault request digest is malformed.");
  }
}

function requireIdempotencyKey(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npAgentVaultLimitsV1.idempotencyKeyCharacters ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    fail("VAULT_CONTRACT_INVALID", "The vault idempotency key is malformed.");
  }
}

function requireLocalAad(
  value: unknown,
  adapter: Pick<NpAgentVaultAdapterV1, "id" | "contractVersion" | "fingerprint" | "algorithm">,
): NpAgentVaultAadCanonicalV1 {
  const aad = npRequireAgentVaultAadCanonical(value);
  const bytes = npBuildAgentVaultAadCanonicalBytes(aad).domainSeparatedUtf8;
  if (
    bytes.byteLength > npAgentVaultLimitsV1.aadBytes ||
    aad.vaultAdapterId !== adapter.id ||
    aad.vaultAdapterContractVersion !== adapter.contractVersion ||
    aad.vaultAdapterFingerprint !== adapter.fingerprint ||
    aad.algorithm !== adapter.algorithm
  ) {
    fail("VAULT_AAD_MISMATCH", "The vault AAD does not match the frozen adapter.");
  }
  return aad;
}

function secretRef(id: string): string {
  return `local-envelope:${id}`;
}

function parseSecretRef(value: string): string {
  const match = LOCAL_REF_PATTERN.exec(value);
  if (!match) fail("VAULT_SECRET_REF_INVALID", "The local-envelope secret reference is invalid.");
  return match[1];
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function frame(value: Uint8Array): Uint8Array {
  const size = value.byteLength;
  return concat([
    Uint8Array.of((size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
    value,
  ]);
}

function wrapAad(
  entryId: string,
  aadDigest: string,
  key: Pick<NpLocalEnvelopeVaultKeyV1, "id" | "version">,
): Uint8Array {
  const encode = (value: string) => new TextEncoder().encode(value);
  return concat([
    frame(encode("np-agent-local-envelope-dek/v1")),
    frame(encode(entryId)),
    frame(encode(aadDigest)),
    frame(encode(key.id)),
    frame(encode(key.version)),
  ]);
}

function encryptAesGcm(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): { ciphertext: Uint8Array; tag: Uint8Array } {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const chunks: Uint8Array[] = [];
  let ciphertext: Buffer | null = null;
  let tag: Buffer | null = null;
  try {
    chunks.push(cipher.update(plaintext), cipher.final());
    ciphertext = Buffer.concat(chunks);
    tag = cipher.getAuthTag();
    return { ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(tag) };
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    ciphertext?.fill(0);
    tag?.fill(0);
  }
}

function decryptAesGcm(
  ciphertext: Uint8Array,
  tag: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let plaintext: Buffer | null = null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    chunks.push(decipher.update(ciphertext), decipher.final());
    plaintext = Buffer.concat(chunks);
    return new Uint8Array(plaintext);
  } catch {
    return fail("VAULT_AUTHENTICATION_FAILED", "The local-envelope authentication check failed.");
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    plaintext?.fill(0);
  }
}

function wrapDataKey(
  dataKey: Uint8Array,
  entryId: string,
  aadDigest: string,
  key: NpLocalEnvelopeVaultKeyV1,
  random: (size: number) => Uint8Array,
): Uint8Array {
  const nonce = random(GCM_NONCE_BYTES);
  const aad = wrapAad(entryId, aadDigest, key);
  let wrapped: ReturnType<typeof encryptAesGcm> | null = null;
  try {
    wrapped = encryptAesGcm(dataKey, key.key, nonce, aad);
    return concat([Uint8Array.of(WRAPPED_KEY_VERSION), nonce, wrapped.ciphertext, wrapped.tag]);
  } finally {
    nonce.fill(0);
    aad.fill(0);
    wrapped?.ciphertext.fill(0);
    wrapped?.tag.fill(0);
  }
}

function unwrapDataKey(
  wrapped: Uint8Array,
  entryId: string,
  aadDigest: string,
  key: NpLocalEnvelopeVaultKeyV1,
): Uint8Array {
  if (wrapped.byteLength !== WRAPPED_DATA_KEY_BYTES || wrapped[0] !== WRAPPED_KEY_VERSION) {
    return fail("VAULT_WRAPPED_KEY_INVALID", "The local-envelope wrapped key is malformed.");
  }
  const nonce = wrapped.slice(1, 1 + GCM_NONCE_BYTES);
  const ciphertext = wrapped.slice(1 + GCM_NONCE_BYTES, 1 + GCM_NONCE_BYTES + DATA_KEY_BYTES);
  const tag = wrapped.slice(-GCM_TAG_BYTES);
  const aad = wrapAad(entryId, aadDigest, key);
  try {
    return decryptAesGcm(ciphertext, tag, key.key, nonce, aad);
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
    tag.fill(0);
    aad.fill(0);
  }
}

function resultDigest(kind: string, value: Record<string, unknown>): string {
  const hash = createHash("sha256");
  hash.update(`np-agent-vault-adapter-result/v1\0${kind}\0`, "utf8");
  const keys = Object.keys(value).sort();
  for (const key of keys) hash.update(`${key}\0${String(value[key])}\0`, "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function storedValue(entry: VaultEntry): NpVaultStoredValueV1 {
  return {
    secretRef: secretRef(entry.id),
    secretVersionId: entry.secretVersionId,
    aadDigest: entry.aadDigest,
    algorithm: "AES-256-GCM",
    keyId: entry.kekId,
    keyVersion: entry.kekVersion,
  };
}

function sealResult(entry: VaultEntry, status: NpVaultSealResultV1["status"]): NpVaultSealResultV1 {
  return {
    schemaVersion: "np.agent-vault-seal-result.v1",
    status,
    ...storedValue(entry),
  };
}

function rewrapResult(
  entry: VaultEntry,
  status: NpVaultRewrapResultV1["status"],
): NpVaultRewrapResultV1 {
  return {
    schemaVersion: "np.agent-vault-rewrap-result.v1",
    status,
    ...storedValue(entry),
  };
}

function destroyResult(
  status: NpVaultDestroyResultV1["status"],
  target: string,
): NpVaultDestroyResultV1 {
  return {
    schemaVersion: "np.agent-vault-destroy-result.v1",
    status,
    resultDigest: resultDigest("destroy", { status, target }),
  };
}

function inspection(
  kind: NpVaultOperationInspectRequestV1["kind"],
  state: "pending" | "absent" | "failed",
  safeCode: string | null,
  operationId: string,
): NpVaultOperationInspectResultV1 {
  return {
    schemaVersion: "np.agent-vault-operation-inspect-result.v1",
    kind,
    state,
    sealed: null,
    destroyed: null,
    safeCode: state === "failed" ? (safeCode ?? "VAULT_OPERATION_FAILED") : null,
    resultDigest: resultDigest("inspect", { kind, state, operationId, safeCode }),
  } as NpVaultOperationInspectResultV1;
}

export function createLocalEnvelopeVaultAdapterV1(
  options: NpLocalEnvelopeVaultAdapterOptionsV1,
): NpAgentVaultAdapterV1 {
  if (options.environment !== "development" || options.explicitlyEnabled !== true) {
    fail(
      "VAULT_LOCAL_ENVELOPE_FORBIDDEN",
      "The local-envelope Agent vault requires explicit development-only enablement.",
    );
  }
  const activeKey = requireKey(options.activeKey);
  const keys = new Map<string, NpLocalEnvelopeVaultKeyV1>();
  keys.set(keyIdentity(activeKey), activeKey);
  try {
    for (const raw of options.retainedKeys ?? []) {
      const value = requireKey(raw);
      const identity = keyIdentity(value);
      if (keys.has(identity)) {
        value.key.fill(0);
        fail(
          "VAULT_MASTER_KEY_INVALID",
          "The local-envelope keyring contains duplicate identities.",
        );
      }
      keys.set(identity, value);
    }
  } catch (error) {
    for (const retained of keys.values()) retained.key.fill(0);
    throw error;
  }
  const resolveDb = options.resolveDb ?? getDb;
  const now = options.now ?? (() => new Date());
  const random = options.randomBytes ?? ((size: number) => new Uint8Array(randomBytes(size)));
  const leaseSeconds = options.leaseSeconds ?? 60;
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 1 ||
    leaseSeconds > npAgentVaultLimitsV1.plaintextLeaseSeconds
  ) {
    for (const retained of keys.values()) retained.key.fill(0);
    fail("VAULT_CONFIG_INVALID", "The local-envelope lease lifetime is invalid.");
  }
  let closed = false;

  const adapterIdentity = {
    id: "local-envelope",
    contractVersion: 1,
    fingerprint: npLocalEnvelopeVaultAdapterFingerprintV1,
    algorithm: "AES-256-GCM" as const,
  };

  const requireOpen = () => {
    if (closed) fail("VAULT_ADAPTER_UNAVAILABLE", "The local-envelope adapter is closed.");
  };

  const resolveKey = (id: string, version: string): NpLocalEnvelopeVaultKeyV1 => {
    const key = keys.get(keyIdentity({ id, version }));
    if (!key) fail("VAULT_KEY_UNAVAILABLE", "The required local-envelope key is unavailable.");
    return key;
  };

  const findEntry = async (db: NpAgentDb, id: string): Promise<VaultEntry | null> => {
    const [entry] = await db
      .select()
      .from(npAgentVaultEntries)
      .where(eq(npAgentVaultEntries.id, id))
      .limit(1);
    return entry ?? null;
  };

  const requireEntryAad = async (
    entry: VaultEntry,
    aad: NpAgentVaultAadCanonicalV1,
  ): Promise<string> => {
    const digest = await npDigestAgentVaultAadCanonical(aad);
    if (
      entry.siteId !== aad.siteId ||
      entry.secretVersionId !== aad.secretVersionId ||
      entry.algorithm !== "AES-256-GCM" ||
      entry.aadDigest !== digest
    ) {
      fail("VAULT_AAD_MISMATCH", "The local-envelope row does not match authoritative AAD.");
    }
    return digest;
  };

  return {
    ...adapterIdentity,
    kind: "local-envelope",

    async seal(input: NpVaultSealRequestV1, callOptions): Promise<NpVaultSealResultV1> {
      requireOpen();
      requireSignal(callOptions.signal);
      if (input.schemaVersion !== "np.agent-vault-seal.v1") {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope seal request version is invalid.");
      }
      requireIdempotencyKey(input.idempotencyKey);
      requireRequestDigest(input.requestDigest);
      const aad = requireLocalAad(input.aad, adapterIdentity);
      if (
        !(input.plaintext instanceof Uint8Array) ||
        input.plaintext.byteLength === 0 ||
        input.plaintext.byteLength > npAgentVaultLimitsV1.plaintextEnvelopeBytes
      ) {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope plaintext is invalid.");
      }
      const aadDigest = await npDigestAgentVaultAadCanonical(aad);
      const db = resolveDb();
      const [existing] = await db
        .select()
        .from(npAgentVaultEntries)
        .where(eq(npAgentVaultEntries.secretVersionId, aad.secretVersionId))
        .limit(1);
      if (existing) {
        await requireEntryAad(existing, aad);
        if (existing.destroyedAt)
          fail("VAULT_SECRET_DESTROYED", "The local-envelope secret was destroyed.");
        return sealResult(existing, "already_sealed");
      }

      const entryId = randomUUID();
      const dataKey = random(DATA_KEY_BYTES);
      const nonce = random(GCM_NONCE_BYTES);
      if (dataKey.byteLength !== DATA_KEY_BYTES || nonce.byteLength !== GCM_NONCE_BYTES) {
        dataKey.fill(0);
        nonce.fill(0);
        fail(
          "VAULT_RANDOM_SOURCE_INVALID",
          "The local-envelope random source returned invalid bytes.",
        );
      }
      const aadBytes = npBuildAgentVaultAadCanonicalBytes(aad).domainSeparatedUtf8;
      const plaintext = new Uint8Array(input.plaintext);
      let encrypted: ReturnType<typeof encryptAesGcm> | null = null;
      let wrappedDataKey: Uint8Array | null = null;
      try {
        encrypted = encryptAesGcm(plaintext, dataKey, nonce, aadBytes);
        wrappedDataKey = wrapDataKey(dataKey, entryId, aadDigest, activeKey, random);
        requireSignal(callOptions.signal);
        const [inserted] = await db
          .insert(npAgentVaultEntries)
          .values({
            id: entryId,
            siteId: aad.siteId,
            secretVersionId: aad.secretVersionId,
            ciphertext: encrypted.ciphertext,
            wrappedDataKey,
            nonce,
            authTag: encrypted.tag,
            algorithm: "AES-256-GCM",
            kekId: activeKey.id,
            kekVersion: activeKey.version,
            aadDigest,
            createdAt: now(),
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) return sealResult(inserted, "sealed");
        const [winner] = await db
          .select()
          .from(npAgentVaultEntries)
          .where(eq(npAgentVaultEntries.secretVersionId, aad.secretVersionId))
          .limit(1);
        if (!winner)
          fail("VAULT_PERSISTENCE_CONFLICT", "The local-envelope seal CAS was lost.", true);
        await requireEntryAad(winner, aad);
        if (winner.destroyedAt)
          fail("VAULT_SECRET_DESTROYED", "The local-envelope secret was destroyed.");
        return sealResult(winner, "already_sealed");
      } finally {
        dataKey.fill(0);
        nonce.fill(0);
        aadBytes.fill(0);
        plaintext.fill(0);
        encrypted?.ciphertext.fill(0);
        encrypted?.tag.fill(0);
        wrappedDataKey?.fill(0);
      }
    },

    async open(input: NpVaultOpenRequestV1, callOptions) {
      requireOpen();
      requireSignal(callOptions.signal);
      if (input.schemaVersion !== "np.agent-vault-open.v1") {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope open request version is invalid.");
      }
      const aad = requireLocalAad(input.expectedAad, adapterIdentity);
      const id = parseSecretRef(input.secretRef);
      const entry = await findEntry(resolveDb(), id);
      if (!entry || entry.destroyedAt)
        fail("VAULT_SECRET_UNAVAILABLE", "The local-envelope secret is unavailable.");
      const aadDigest = await requireEntryAad(entry, aad);
      if (
        entry.nonce.byteLength !== GCM_NONCE_BYTES ||
        entry.authTag.byteLength !== GCM_TAG_BYTES ||
        entry.wrappedDataKey.byteLength !== WRAPPED_DATA_KEY_BYTES
      ) {
        fail("VAULT_ENTRY_INVALID", "The local-envelope row has invalid cryptographic dimensions.");
      }
      const key = resolveKey(entry.kekId, entry.kekVersion);
      const aadBytes = npBuildAgentVaultAadCanonicalBytes(aad).domainSeparatedUtf8;
      let dataKey: Uint8Array | null = null;
      let plaintext: Uint8Array | null = null;
      try {
        dataKey = unwrapDataKey(entry.wrappedDataKey, entry.id, aadDigest, key);
        plaintext = decryptAesGcm(entry.ciphertext, entry.authTag, dataKey, entry.nonce, aadBytes);
        requireSignal(callOptions.signal);
        return new NpVaultPlaintextLease(
          entry.secretVersionId,
          aadDigest,
          plaintext,
          new Date(now().getTime() + leaseSeconds * 1_000),
          now,
        );
      } finally {
        dataKey?.fill(0);
        aadBytes.fill(0);
        plaintext?.fill(0);
      }
    },

    async rewrap(input: NpVaultRewrapRequestV1, callOptions): Promise<NpVaultRewrapResultV1> {
      requireOpen();
      requireSignal(callOptions.signal);
      if (input.schemaVersion !== "np.agent-vault-rewrap.v1") {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope rewrap request version is invalid.");
      }
      requireIdempotencyKey(input.idempotencyKey);
      requireRequestDigest(input.requestDigest);
      if (!KEY_PATTERN.test(input.targetKeyId) || !KEY_PATTERN.test(input.targetKeyVersion)) {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope target key is invalid.");
      }
      const aad = requireLocalAad(input.expectedAad, adapterIdentity);
      const id = parseSecretRef(input.secretRef);
      const db = resolveDb();
      const entry = await findEntry(db, id);
      if (!entry || entry.destroyedAt)
        fail("VAULT_SECRET_UNAVAILABLE", "The local-envelope secret is unavailable.");
      const aadDigest = await requireEntryAad(entry, aad);
      if (entry.kekId === input.targetKeyId && entry.kekVersion === input.targetKeyVersion) {
        return rewrapResult(entry, "already_rewrapped");
      }
      const currentKey = resolveKey(entry.kekId, entry.kekVersion);
      const targetKey = resolveKey(input.targetKeyId, input.targetKeyVersion);
      let dataKey: Uint8Array | null = null;
      let wrappedDataKey: Uint8Array | null = null;
      try {
        dataKey = unwrapDataKey(entry.wrappedDataKey, entry.id, aadDigest, currentKey);
        wrappedDataKey = wrapDataKey(dataKey, entry.id, aadDigest, targetKey, random);
        requireSignal(callOptions.signal);
        const [updated] = await db
          .update(npAgentVaultEntries)
          .set({
            wrappedDataKey,
            kekId: targetKey.id,
            kekVersion: targetKey.version,
          })
          .where(
            and(
              eq(npAgentVaultEntries.id, entry.id),
              eq(npAgentVaultEntries.kekId, entry.kekId),
              eq(npAgentVaultEntries.kekVersion, entry.kekVersion),
              isNull(npAgentVaultEntries.destroyedAt),
            ),
          )
          .returning();
        if (updated) return rewrapResult(updated, "rewrapped");
        const winner = await findEntry(db, id);
        if (
          winner &&
          !winner.destroyedAt &&
          winner.kekId === targetKey.id &&
          winner.kekVersion === targetKey.version
        ) {
          return rewrapResult(winner, "already_rewrapped");
        }
        fail("VAULT_PERSISTENCE_CONFLICT", "The local-envelope rewrap CAS was lost.", true);
      } finally {
        dataKey?.fill(0);
        wrappedDataKey?.fill(0);
      }
    },

    async destroy(input: NpVaultDestroyRequestV1, callOptions): Promise<NpVaultDestroyResultV1> {
      requireOpen();
      requireSignal(callOptions.signal);
      if (input.schemaVersion !== "np.agent-vault-destroy.v1") {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope destroy request version is invalid.");
      }
      requireIdempotencyKey(input.idempotencyKey);
      requireRequestDigest(input.requestDigest);
      const aad = requireLocalAad(input.expectedAad, adapterIdentity);
      const id = parseSecretRef(input.secretRef);
      const db = resolveDb();
      const entry = await findEntry(db, id);
      if (!entry) return destroyResult("already_absent", input.secretRef);
      await requireEntryAad(entry, aad);
      if (entry.destroyedAt) return destroyResult("already_absent", input.secretRef);
      requireSignal(callOptions.signal);
      const [destroyed] = await db
        .update(npAgentVaultEntries)
        .set({
          ciphertext: ZEROIZED_BYTES,
          wrappedDataKey: ZEROIZED_BYTES,
          nonce: ZEROIZED_BYTES,
          authTag: ZEROIZED_BYTES,
          destroyedAt: now(),
        })
        .where(
          and(
            eq(npAgentVaultEntries.id, id),
            eq(npAgentVaultEntries.aadDigest, entry.aadDigest),
            isNull(npAgentVaultEntries.destroyedAt),
          ),
        )
        .returning();
      if (!destroyed) {
        const winner = await findEntry(db, id);
        if (winner?.destroyedAt) return destroyResult("already_absent", input.secretRef);
        fail("VAULT_PERSISTENCE_CONFLICT", "The local-envelope destroy CAS was lost.", true);
      }
      return destroyResult("destroyed", input.secretRef);
    },

    async inspectOperation(
      input: NpVaultOperationInspectRequestV1,
      callOptions,
    ): Promise<NpVaultOperationInspectResultV1> {
      requireOpen();
      requireSignal(callOptions.signal);
      if (input.schemaVersion !== "np.agent-vault-operation-inspect.v1") {
        fail("VAULT_CONTRACT_INVALID", "The local-envelope inspect request version is invalid.");
      }
      requireIdempotencyKey(input.idempotencyKey);
      requireRequestDigest(input.requestDigest);
      const db = resolveDb();
      const [operation] = await db
        .select()
        .from(npAgentVaultOperations)
        .where(
          and(
            eq(npAgentVaultOperations.vaultAdapter, "local-envelope"),
            eq(npAgentVaultOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!operation) return inspection(input.kind, "absent", null, input.idempotencyKey);
      if (
        operation.kind !== input.kind ||
        operation.requestDigest !== input.requestDigest ||
        operation.vaultAdapterContractVersion !== 1 ||
        operation.vaultAdapterFingerprint !== npLocalEnvelopeVaultAdapterFingerprintV1
      ) {
        return inspection(input.kind, "failed", "VAULT_REQUEST_MISMATCH", operation.id);
      }
      const [entry] = await db
        .select()
        .from(npAgentVaultEntries)
        .where(eq(npAgentVaultEntries.secretVersionId, operation.secretVersionId))
        .limit(1);
      return inspectLocalOperation(operation, entry ?? null);
    },

    healthCheck(callOptions) {
      requireOpen();
      requireSignal(callOptions.signal);
      const nonce = random(GCM_NONCE_BYTES);
      const plaintext = random(32);
      const aad = new TextEncoder().encode("np-agent-local-envelope-health/v1");
      let sealed: ReturnType<typeof encryptAesGcm> | null = null;
      let opened: Uint8Array | null = null;
      try {
        sealed = encryptAesGcm(plaintext, activeKey.key, nonce, aad);
        opened = decryptAesGcm(sealed.ciphertext, sealed.tag, activeKey.key, nonce, aad);
        const ready =
          opened.length === plaintext.length &&
          opened.every((byte, index) => byte === plaintext[index]);
        return Promise.resolve({
          schemaVersion: "np.agent-vault-health.v1" as const,
          status: ready ? ("ready" as const) : ("unavailable" as const),
          checkedAt: now().toISOString(),
          keyId: activeKey.id,
          safeCodes: ready ? [] : ["VAULT_CANARY_FAILED"],
        });
      } finally {
        nonce.fill(0);
        plaintext.fill(0);
        aad.fill(0);
        sealed?.ciphertext.fill(0);
        sealed?.tag.fill(0);
        opened?.fill(0);
      }
    },

    shutdown() {
      if (closed) return;
      closed = true;
      for (const key of keys.values()) key.key.fill(0);
      keys.clear();
    },
  };
}

function inspectLocalOperation(
  operation: VaultOperation,
  entry: VaultEntry | null,
): NpVaultOperationInspectResultV1 {
  if (operation.kind === "seal") {
    if (!entry) return inspection("seal", "absent", null, operation.id);
    if (entry.destroyedAt)
      return inspection("seal", "failed", "VAULT_SECRET_DESTROYED", operation.id);
    const sealed = sealResult(entry, "already_sealed");
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: "seal",
      state: "succeeded",
      sealed,
      destroyed: null,
      safeCode: null,
      resultDigest: resultDigest("inspect", {
        kind: "seal",
        state: "succeeded",
        operationId: operation.id,
        secretRef: sealed.secretRef,
      }),
    };
  }
  if (operation.kind === "rewrap") {
    if (!entry || entry.destroyedAt) {
      return inspection("rewrap", "failed", "VAULT_SECRET_UNAVAILABLE", operation.id);
    }
    if (entry.kekId !== operation.targetKeyId || entry.kekVersion !== operation.targetKeyVersion) {
      return inspection("rewrap", "absent", null, operation.id);
    }
    const sealed = rewrapResult(entry, "already_rewrapped");
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: "rewrap",
      state: "succeeded",
      sealed,
      destroyed: null,
      safeCode: null,
      resultDigest: resultDigest("inspect", {
        kind: "rewrap",
        state: "succeeded",
        operationId: operation.id,
        secretRef: sealed.secretRef,
      }),
    };
  }
  if (!entry || entry.destroyedAt) {
    const destroyed = destroyResult(
      entry ? "destroyed" : "already_absent",
      operation.secretRef ?? operation.id,
    );
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: "destroy",
      state: "succeeded",
      sealed: null,
      destroyed,
      safeCode: null,
      resultDigest: resultDigest("inspect", {
        kind: "destroy",
        state: "succeeded",
        operationId: operation.id,
        status: destroyed.status,
      }),
    };
  }
  return inspection("destroy", "absent", null, operation.id);
}
