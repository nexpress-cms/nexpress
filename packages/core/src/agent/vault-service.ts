import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";

import {
  npDigestAgentVaultAadCanonical,
  npRequireAgentVaultAadCanonical,
  type NpAgentConnectionKind,
  type NpAgentConnectionSecretPurpose,
  type NpAgentVaultAadCanonicalV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentConnectionConfigVersions,
  npAgentConnectionAuthRequests,
  npAgentConnectionOperations,
  npAgentConnections,
  npAgentConnectionSecretVersions,
  npAgentVaultOperations,
} from "../db/schema/agent.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  npDecodeAgentVaultPlaintextEnvelopeV1,
  npEncodeAgentVaultPlaintextEnvelopeV1,
  npRequireAgentVaultPlaintextEnvelopeV1,
  npZeroAgentVaultEnvelopeV1,
} from "./vault-codec.js";
import {
  NpAgentVaultError,
  npAgentVaultLimitsV1,
  npAgentVaultRetryDelaySeconds,
  npRequireVaultDestroyResultV1,
  npRequireVaultInspectResultV1,
  npRequireVaultRewrapResultV1,
  npRequireVaultSealResultV1,
  type NpAgentConnectionCredentialEnvelopeV1,
  type NpAgentVaultPlaintextEnvelopeV1,
  type NpProviderCredentialLeaseV1,
  type NpProviderOAuthCodeLeaseV1,
  type NpProviderOAuthPkceLeaseV1,
  type NpVaultDestroyResultV1,
  type NpVaultOperationInspectResultV1,
  type NpVaultPlaintextLeaseV1,
  type NpVaultRewrapResultV1,
  type NpVaultSealResultV1,
} from "./vault-contract.js";
import {
  npCloneAgentVaultRequestDigestKeyringV1,
  npDigestAgentVaultOperationRequestV1,
  npResolveAgentVaultRequestDigestKeyV1,
  npVerifyAgentVaultOperationRequestDigestV1,
  type NpAgentVaultOperationDigestInputV1,
  type NpAgentVaultRequestDigestKeyringV1,
} from "./vault-operation-digest.js";
import {
  type NpAgentVaultAdapterRegistryV1,
  npCallAgentVaultAdapterV1,
  npRequireVaultPlaintextLeaseV1,
} from "./vault-runtime.js";

type NpAgentDb = ReturnType<typeof getDb>;
type SecretRow = typeof npAgentConnectionSecretVersions.$inferSelect;
type OperationRow = typeof npAgentVaultOperations.$inferSelect;

const UUID_PATTERN = new RegExp(npAuthUuidPattern, "u");
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const TERMINAL_STATES = new Set(["succeeded", "failed"]);

export interface NpAgentVaultServiceOptionsV1 {
  registry: NpAgentVaultAdapterRegistryV1;
  requestDigestKeyring: NpAgentVaultRequestDigestKeyringV1;
  resolveDb?: () => NpAgentDb;
  now?: () => Date;
  adapterCallMilliseconds?: number;
  workerLeaseSeconds?: number;
}

export interface NpAgentVaultOperationProjectionV1 {
  schemaVersion: "np.agent-vault-operation.v1";
  id: string;
  siteId: string;
  connectionId: string;
  secretVersionId: string;
  kind: "seal" | "rewrap" | "destroy";
  state: "queued" | "running" | "waiting_inspection" | "succeeded" | "failed";
  attempt: number;
  rowVersion: number;
  lastErrorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface NpAgentVaultSealSecretInputV1 {
  operationId: string;
  secretVersionId: string;
  siteId: string;
  connectionId: string;
  connectionKind: NpAgentConnectionKind;
  purpose: NpAgentConnectionSecretPurpose;
  version: number;
  envelope: NpAgentVaultPlaintextEnvelopeV1;
  temporaryExpiresAt?: Date | null;
  oauthRefreshGeneration?: number;
  /**
   * Runs inside the same transaction after the exact secret and seal journals exist.
   * Connection/OAuth services use this narrow seam to attach their own authority row
   * before any plaintext is dispatched to the vault adapter.
   */
  onJournaled?: (context: {
    db: NpAgentDb;
    now: Date;
    secret: SecretRow;
    operation: OperationRow;
  }) => Promise<void>;
}

export interface NpAgentVaultMutateSecretInputV1 {
  operationId: string;
  siteId: string;
  secretVersionId: string;
}

export interface NpAgentVaultDestroySecretInputV1 extends NpAgentVaultMutateSecretInputV1 {
  /** Runs in the exact destroy journal transaction before adapter dispatch. */
  onJournaled?: (context: {
    db: NpAgentDb;
    now: Date;
    secret: SecretRow;
    operation: OperationRow;
  }) => Promise<void>;
}

function fail(code: string, message: string, retryable = false): never {
  throw new NpAgentVaultError(code, message, retryable);
}

function projection(row: OperationRow): NpAgentVaultOperationProjectionV1 {
  return {
    schemaVersion: "np.agent-vault-operation.v1",
    id: row.id,
    siteId: row.siteId,
    connectionId: row.connectionId,
    secretVersionId: row.secretVersionId,
    kind: row.kind as NpAgentVaultOperationProjectionV1["kind"],
    state: row.state as NpAgentVaultOperationProjectionV1["state"],
    attempt: row.attempt,
    rowVersion: row.rowVersion,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function requireIdentity(input: {
  siteId: string;
  operationId?: string;
  secretVersionId: string;
}): void {
  if (
    !npIsCanonicalSiteId(input.siteId) ||
    !UUID_PATTERN.test(input.secretVersionId) ||
    (input.operationId !== undefined && !UUID_PATTERN.test(input.operationId))
  ) {
    fail("VAULT_IDENTITY_INVALID", "Agent vault site and operation identities are invalid.");
  }
}

function safeCode(error: unknown): string {
  return error instanceof NpAgentVaultError && SAFE_CODE_PATTERN.test(error.code)
    ? error.code
    : "VAULT_ADAPTER_ERROR";
}

function resultDigest(kind: string, value: unknown): string {
  const hash = createHash("sha256");
  hash.update(`np-agent-vault-operation-result/v1\0${kind}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function permissionDigest(value: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update("np-agent-provider-permissions/v1\0", "utf8");
  hash.update(serializeAgentCanonicalJson([...value]), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function materialForPurpose(
  purpose: NpAgentConnectionSecretPurpose,
  envelope: NpAgentVaultPlaintextEnvelopeV1,
): void {
  const matches =
    (purpose === "connection-credential" &&
      (envelope.kind === "api_key" || envelope.kind === "oauth")) ||
    (purpose === "provider-oauth-pkce" && envelope.kind === "provider_oauth_pkce") ||
    (purpose === "provider-oauth-code" && envelope.kind === "provider_oauth_code");
  if (!matches) fail("VAULT_PURPOSE_MISMATCH", "The vault purpose and plaintext branch disagree.");
}

async function requireSecretAad(
  row: SecretRow,
  db: NpAgentDb,
): Promise<NpAgentVaultAadCanonicalV1> {
  const aad = npRequireAgentVaultAadCanonical(row.aadBody);
  const digest = await npDigestAgentVaultAadCanonical(aad);
  const [connection] = await db
    .select({ kind: npAgentConnections.kind, authKind: npAgentConnections.authKind })
    .from(npAgentConnections)
    .where(
      and(eq(npAgentConnections.siteId, row.siteId), eq(npAgentConnections.id, row.connectionId)),
    )
    .limit(1);
  if (
    !connection ||
    aad.siteId !== row.siteId ||
    aad.connectionId !== row.connectionId ||
    aad.connectionKind !== connection.kind ||
    aad.purpose !== row.purpose ||
    aad.secretVersionId !== row.id ||
    aad.secretVersion !== row.version ||
    aad.vaultAdapterId !== row.vaultAdapter ||
    aad.vaultAdapterContractVersion !== row.vaultAdapterContractVersion ||
    aad.vaultAdapterFingerprint !== row.vaultAdapterFingerprint ||
    aad.credentialEnvelopeVersion !== row.credentialEnvelopeVersion ||
    aad.algorithm !== row.vaultAlgorithm ||
    digest !== row.aadDigest
  ) {
    fail("VAULT_AAD_MISMATCH", "Persisted Agent vault metadata does not reproduce its AAD.");
  }
  if (row.purpose === "connection-credential" && connection.authKind !== row.materialKind) {
    fail(
      "VAULT_PURPOSE_MISMATCH",
      "Persisted credential material does not match the connection auth kind.",
    );
  }
  return aad;
}

function requireOperationMatchesSecret(operation: OperationRow, secret: SecretRow): void {
  if (
    operation.siteId !== secret.siteId ||
    operation.connectionId !== secret.connectionId ||
    operation.secretVersionId !== secret.id ||
    operation.vaultAdapter !== secret.vaultAdapter ||
    operation.vaultAdapterContractVersion !== secret.vaultAdapterContractVersion ||
    operation.vaultAdapterFingerprint !== secret.vaultAdapterFingerprint
  ) {
    fail("VAULT_OPERATION_MISMATCH", "The vault operation and secret metadata disagree.");
  }
}

function validateStoredResult(
  result: NpVaultSealResultV1 | NpVaultRewrapResultV1,
  secret: SecretRow,
): void {
  if (
    result.secretVersionId !== secret.id ||
    result.aadDigest !== secret.aadDigest ||
    result.algorithm !== secret.vaultAlgorithm
  ) {
    fail("VAULT_ADAPTER_RESULT_INVALID", "The vault adapter receipt does not match its secret.");
  }
}

class ProviderCredentialLease implements NpProviderCredentialLeaseV1 {
  readonly envelopeVersion = 1 as const;

  constructor(
    private readonly raw: NpVaultPlaintextLeaseV1,
    readonly secretVersionId: string,
    readonly expiresAt: string,
    private readonly expectedAdapter: {
      id: string;
      contractVersion: number;
      fingerprint: string;
    },
  ) {
    Object.defineProperty(this, "raw", { enumerable: false });
  }

  toJSON(): never {
    fail("VAULT_LEASE_SERIALIZATION_FORBIDDEN", "Provider credential leases cannot be serialized.");
  }

  async use<T>(
    consumer: (credential: NpAgentConnectionCredentialEnvelopeV1) => Promise<T>,
  ): Promise<T> {
    return this.raw.use(async (bytes) => {
      const envelope = npDecodeAgentVaultPlaintextEnvelopeV1(bytes);
      try {
        if (
          (envelope.kind !== "api_key" && envelope.kind !== "oauth") ||
          envelope.adapterId !== this.expectedAdapter.id ||
          envelope.adapterContractVersion !== this.expectedAdapter.contractVersion ||
          envelope.adapterFingerprint !== this.expectedAdapter.fingerprint
        ) {
          fail(
            "VAULT_CREDENTIAL_ADAPTER_MISMATCH",
            "The provider credential does not match its frozen adapter.",
          );
        }
        return await consumer(envelope);
      } finally {
        npZeroAgentVaultEnvelopeV1(envelope);
      }
    });
  }

  dispose(): void {
    this.raw.dispose();
  }
}

class OAuthTemporaryLease<P extends "provider-oauth-code" | "provider-oauth-pkce"> {
  constructor(
    private readonly raw: NpVaultPlaintextLeaseV1,
    readonly secretVersionId: string,
    readonly purpose: P,
    readonly expiresAt: string,
  ) {
    Object.defineProperty(this, "raw", { enumerable: false });
  }

  toJSON(): never {
    fail("VAULT_LEASE_SERIALIZATION_FORBIDDEN", "Temporary OAuth leases cannot be serialized.");
  }

  async use<T>(consumer: (bytes: Uint8Array) => Promise<T>): Promise<T> {
    return this.raw.use(async (bytes) => {
      const envelope = npDecodeAgentVaultPlaintextEnvelopeV1(bytes);
      try {
        const value =
          this.purpose === "provider-oauth-code" && envelope.kind === "provider_oauth_code"
            ? envelope.code
            : this.purpose === "provider-oauth-pkce" && envelope.kind === "provider_oauth_pkce"
              ? envelope.verifier
              : null;
        if (!value) fail("VAULT_PURPOSE_MISMATCH", "The temporary OAuth vault branch disagrees.");
        return await consumer(value);
      } finally {
        npZeroAgentVaultEnvelopeV1(envelope);
      }
    });
  }

  dispose(): void {
    this.raw.dispose();
  }
}

export function createAgentVaultServiceV1(options: NpAgentVaultServiceOptionsV1) {
  const resolveDb = options.resolveDb ?? getDb;
  const now = options.now ?? (() => new Date());
  const keyring = npCloneAgentVaultRequestDigestKeyringV1(options.requestDigestKeyring);
  const callMilliseconds =
    options.adapterCallMilliseconds ?? npAgentVaultLimitsV1.adapterCallMilliseconds;
  const leaseSeconds = options.workerLeaseSeconds ?? npAgentVaultLimitsV1.workerLeaseSeconds;
  if (
    !Number.isInteger(callMilliseconds) ||
    callMilliseconds < 1 ||
    callMilliseconds > npAgentVaultLimitsV1.adapterCallMilliseconds ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 1 ||
    leaseSeconds > npAgentVaultLimitsV1.workerLeaseSeconds
  ) {
    fail("VAULT_CONFIG_INVALID", "Agent vault service deadlines exceed the frozen bounds.");
  }

  const operationInput = (
    operation: OperationRow,
    secret: SecretRow,
  ): NpAgentVaultOperationDigestInputV1 => {
    if (!secret.secretRef) fail("VAULT_SECRET_REF_MISSING", "The vault secret locator is absent.");
    if (operation.kind === "rewrap") {
      if (!operation.targetKeyId || !operation.targetKeyVersion) {
        fail("VAULT_OPERATION_MISMATCH", "The rewrap target is absent.");
      }
      return {
        kind: "rewrap",
        secretRef: secret.secretRef,
        targetKeyId: operation.targetKeyId,
        targetKeyVersion: operation.targetKeyVersion,
      };
    }
    return { kind: "destroy", secretRef: secret.secretRef };
  };

  const digestInput = (
    operation: OperationRow,
    secret: SecretRow,
    aad: NpAgentVaultAadCanonicalV1,
    value: NpAgentVaultOperationDigestInputV1,
  ) => ({
    siteId: operation.siteId,
    kind: operation.kind as "seal" | "rewrap" | "destroy",
    adapterId: operation.vaultAdapter,
    adapterContractVersion: operation.vaultAdapterContractVersion,
    adapterFingerprint: operation.vaultAdapterFingerprint,
    secretVersionId: operation.secretVersionId,
    idempotencyKey: operation.idempotencyKey,
    aad,
    operationInput: value,
  });

  async function loadOperation(
    siteId: string,
    operationId: string,
  ): Promise<{ operation: OperationRow; secret: SecretRow; aad: NpAgentVaultAadCanonicalV1 }> {
    const db = resolveDb();
    const [operation] = await db
      .select()
      .from(npAgentVaultOperations)
      .where(
        and(eq(npAgentVaultOperations.siteId, siteId), eq(npAgentVaultOperations.id, operationId)),
      )
      .limit(1);
    if (!operation) fail("VAULT_OPERATION_NOT_FOUND", "The Agent vault operation was not found.");
    const [secret] = await db
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(
        and(
          eq(npAgentConnectionSecretVersions.siteId, siteId),
          eq(npAgentConnectionSecretVersions.id, operation.secretVersionId),
        ),
      )
      .limit(1);
    if (!secret) fail("VAULT_SECRET_NOT_FOUND", "The Agent vault secret was not found.");
    requireOperationMatchesSecret(operation, secret);
    return { operation, secret, aad: await requireSecretAad(secret, db) };
  }

  async function moveWaiting(
    operation: OperationRow,
    error: unknown,
  ): Promise<NpAgentVaultOperationProjectionV1> {
    const retryAt = new Date(
      now().getTime() + npAgentVaultRetryDelaySeconds(operation.attempt) * 1_000,
    );
    const [updated] = await resolveDb()
      .update(npAgentVaultOperations)
      .set({
        state: "waiting_inspection",
        leaseUntil: retryAt,
        lastErrorCode: safeCode(error),
        rowVersion: operation.rowVersion + 1,
      })
      .where(
        and(
          eq(npAgentVaultOperations.siteId, operation.siteId),
          eq(npAgentVaultOperations.id, operation.id),
          eq(npAgentVaultOperations.state, "running"),
          eq(npAgentVaultOperations.rowVersion, operation.rowVersion),
          eq(npAgentVaultOperations.attempt, operation.attempt),
        ),
      )
      .returning();
    if (!updated) fail("VAULT_OPERATION_STALE", "A late vault result lost its operation CAS.");
    return projection(updated);
  }

  async function terminalFailure(
    operation: OperationRow,
    code: string,
    digest = resultDigest("failed", { code, operationId: operation.id }),
  ): Promise<NpAgentVaultOperationProjectionV1> {
    return resolveDb().transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const failedAt = now();
      const [updated] = await tx
        .update(npAgentVaultOperations)
        .set({
          state: "failed",
          resultDigest: digest,
          lastErrorCode: SAFE_CODE_PATTERN.test(code) ? code : "VAULT_OPERATION_FAILED",
          leaseUntil: null,
          finishedAt: failedAt,
          rowVersion: operation.rowVersion + 1,
        })
        .where(
          and(
            eq(npAgentVaultOperations.siteId, operation.siteId),
            eq(npAgentVaultOperations.id, operation.id),
            eq(npAgentVaultOperations.state, operation.state),
            eq(npAgentVaultOperations.rowVersion, operation.rowVersion),
            eq(npAgentVaultOperations.attempt, operation.attempt),
          ),
        )
        .returning();
      if (!updated) fail("VAULT_OPERATION_STALE", "A vault failure lost its operation CAS.");
      if (code === "VAULT_SEAL_INPUT_LOST" && operation.kind === "seal") {
        const [secret] = await tx
          .select({
            purpose: npAgentConnectionSecretVersions.purpose,
            status: npAgentConnectionSecretVersions.status,
            secretRef: npAgentConnectionSecretVersions.secretRef,
          })
          .from(npAgentConnectionSecretVersions)
          .where(
            and(
              eq(npAgentConnectionSecretVersions.siteId, operation.siteId),
              eq(npAgentConnectionSecretVersions.id, operation.secretVersionId),
            ),
          )
          .for("update")
          .limit(1);
        if (!secret || secret.status !== "pending" || secret.secretRef !== null) {
          fail(
            "VAULT_OPERATION_MISMATCH",
            "Lost seal input does not point to one unsealed pending secret.",
          );
        }
        const temporary = secret.purpose !== "connection-credential";
        const [closed] = await tx
          .update(npAgentConnectionSecretVersions)
          .set({
            status: temporary ? "destroyed" : "revoked",
            destroyedAt: temporary ? failedAt : null,
          })
          .where(
            and(
              eq(npAgentConnectionSecretVersions.siteId, operation.siteId),
              eq(npAgentConnectionSecretVersions.id, operation.secretVersionId),
              eq(npAgentConnectionSecretVersions.status, "pending"),
              isNull(npAgentConnectionSecretVersions.secretRef),
            ),
          )
          .returning({ id: npAgentConnectionSecretVersions.id });
        if (!closed) fail("VAULT_OPERATION_STALE", "The unsealed secret close CAS was lost.");
        if (secret.purpose === "provider-oauth-code") {
          const [authRequest] = await tx
            .select({ connectionOperationId: npAgentConnectionAuthRequests.connectionOperationId })
            .from(npAgentConnectionAuthRequests)
            .where(eq(npAgentConnectionAuthRequests.codeVaultOperationId, operation.id))
            .limit(1);
          if (authRequest?.connectionOperationId) {
            const failedOperations = await tx
              .update(npAgentConnectionOperations)
              .set({
                state: "failed",
                lastErrorCode: "VAULT_SEAL_INPUT_LOST",
                leaseUntil: null,
                finishedAt: failedAt,
              })
              .where(
                and(
                  eq(npAgentConnectionOperations.siteId, operation.siteId),
                  eq(npAgentConnectionOperations.id, authRequest.connectionOperationId),
                  eq(npAgentConnectionOperations.state, "awaiting_secret"),
                ),
              )
              .returning({ id: npAgentConnectionOperations.id });
            if (failedOperations.length !== 1) {
              fail("VAULT_OPERATION_STALE", "The linked OAuth exchange failure CAS was lost.");
            }
          }
        }
      }
      return projection(updated);
    });
  }

  async function acceptStoredResult(
    operation: OperationRow,
    secret: SecretRow,
    result: NpVaultSealResultV1 | NpVaultRewrapResultV1,
    digest?: string,
  ): Promise<NpAgentVaultOperationProjectionV1> {
    validateStoredResult(result, secret);
    if (
      operation.kind === "rewrap" &&
      (result.keyId !== operation.targetKeyId || result.keyVersion !== operation.targetKeyVersion)
    ) {
      fail("VAULT_ADAPTER_RESULT_INVALID", "The rewrap receipt does not match its target key.");
    }
    const db = resolveDb();
    return db.transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const [updatedOperation] = await tx
        .update(npAgentVaultOperations)
        .set({
          state: "succeeded",
          secretRef: result.secretRef,
          resultDigest: digest ?? resultDigest(operation.kind, result),
          lastErrorCode: null,
          leaseUntil: null,
          finishedAt: now(),
          rowVersion: operation.rowVersion + 1,
        })
        .where(
          and(
            eq(npAgentVaultOperations.siteId, operation.siteId),
            eq(npAgentVaultOperations.id, operation.id),
            eq(npAgentVaultOperations.state, "running"),
            eq(npAgentVaultOperations.rowVersion, operation.rowVersion),
            eq(npAgentVaultOperations.attempt, operation.attempt),
          ),
        )
        .returning();
      if (!updatedOperation)
        fail("VAULT_OPERATION_STALE", "A late vault result lost its operation CAS.");
      const [updatedSecret] = await tx
        .update(npAgentConnectionSecretVersions)
        .set({ secretRef: result.secretRef })
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, secret.siteId),
            eq(npAgentConnectionSecretVersions.id, secret.id),
            eq(npAgentConnectionSecretVersions.status, secret.status),
            secret.secretRef === null
              ? isNull(npAgentConnectionSecretVersions.secretRef)
              : eq(npAgentConnectionSecretVersions.secretRef, secret.secretRef),
          ),
        )
        .returning();
      if (!updatedSecret) fail("VAULT_OPERATION_STALE", "The vault secret locator CAS was lost.");
      if (operation.kind === "seal" && secret.purpose === "provider-oauth-code") {
        const [authRequest] = await tx
          .select({
            id: npAgentConnectionAuthRequests.id,
            status: npAgentConnectionAuthRequests.status,
            expiresAt: npAgentConnectionAuthRequests.expiresAt,
            connectionOperationId: npAgentConnectionAuthRequests.connectionOperationId,
          })
          .from(npAgentConnectionAuthRequests)
          .where(eq(npAgentConnectionAuthRequests.codeVaultOperationId, operation.id))
          .limit(1);
        if (!authRequest) {
          fail("VAULT_OPERATION_MISMATCH", "The provider OAuth code has no callback journal.");
        }
        if (
          authRequest.status !== "consumed" ||
          !authRequest.connectionOperationId ||
          !secret.expiresAt
        ) {
          fail("VAULT_OPERATION_MISMATCH", "The linked OAuth callback journal is invalid.");
        }
        {
          const queuedAt = now();
          const deadlineAt = new Date(
            Math.min(
              queuedAt.getTime() + 60 * 1_000,
              authRequest.expiresAt.getTime(),
              secret.expiresAt.getTime(),
            ),
          );
          if (deadlineAt <= queuedAt) {
            fail("VAULT_OPERATION_MISMATCH", "The linked OAuth exchange deadline elapsed.");
          }
          const queuedOperations = await tx
            .update(npAgentConnectionOperations)
            .set({ state: "queued", deadlineAt })
            .where(
              and(
                eq(npAgentConnectionOperations.siteId, operation.siteId),
                eq(npAgentConnectionOperations.id, authRequest.connectionOperationId),
                eq(npAgentConnectionOperations.state, "awaiting_secret"),
              ),
            )
            .returning({ id: npAgentConnectionOperations.id });
          if (queuedOperations.length !== 1) {
            fail("VAULT_OPERATION_STALE", "The linked OAuth exchange queue CAS was lost.");
          }
        }
      }
      return projection(updatedOperation);
    });
  }

  async function acceptDestroyResult(
    operation: OperationRow,
    secret: SecretRow,
    result: NpVaultDestroyResultV1,
    digest?: string,
  ): Promise<NpAgentVaultOperationProjectionV1> {
    if (
      secret.purpose === "connection-credential" &&
      !["pending", "retiring", "revoked"].includes(secret.status)
    ) {
      fail("VAULT_SECRET_STATE_CONFLICT", "An active credential must be revoked before destroy.");
    }
    if (secret.purpose !== "connection-credential" && secret.status !== "pending") {
      fail("VAULT_SECRET_STATE_CONFLICT", "A temporary credential has an invalid destroy state.");
    }
    const db = resolveDb();
    return db.transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const [updatedOperation] = await tx
        .update(npAgentVaultOperations)
        .set({
          state: "succeeded",
          resultDigest: digest ?? result.resultDigest,
          lastErrorCode: null,
          leaseUntil: null,
          finishedAt: now(),
          rowVersion: operation.rowVersion + 1,
        })
        .where(
          and(
            eq(npAgentVaultOperations.siteId, operation.siteId),
            eq(npAgentVaultOperations.id, operation.id),
            eq(npAgentVaultOperations.state, "running"),
            eq(npAgentVaultOperations.rowVersion, operation.rowVersion),
            eq(npAgentVaultOperations.attempt, operation.attempt),
          ),
        )
        .returning();
      if (!updatedOperation) fail("VAULT_OPERATION_STALE", "A late destroy result lost its CAS.");
      const [updatedSecret] = await tx
        .update(npAgentConnectionSecretVersions)
        .set({ status: "destroyed", secretRef: null, destroyedAt: now() })
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, secret.siteId),
            eq(npAgentConnectionSecretVersions.id, secret.id),
            eq(npAgentConnectionSecretVersions.status, secret.status),
            eq(npAgentConnectionSecretVersions.secretRef, secret.secretRef!),
          ),
        )
        .returning();
      if (!updatedSecret) fail("VAULT_OPERATION_STALE", "The destroyed secret CAS was lost.");
      return projection(updatedOperation);
    });
  }

  async function claimQueued(operation: OperationRow): Promise<OperationRow> {
    const [claimed] = await resolveDb()
      .update(npAgentVaultOperations)
      .set({
        state: "running",
        leaseUntil: new Date(now().getTime() + leaseSeconds * 1_000),
        lastErrorCode: null,
        rowVersion: operation.rowVersion + 1,
      })
      .where(
        and(
          eq(npAgentVaultOperations.siteId, operation.siteId),
          eq(npAgentVaultOperations.id, operation.id),
          eq(npAgentVaultOperations.state, "queued"),
          eq(npAgentVaultOperations.rowVersion, operation.rowVersion),
        ),
      )
      .returning();
    if (!claimed) fail("VAULT_OPERATION_STALE", "The vault operation claim was lost.");
    return claimed;
  }

  async function dispatch(
    operation: OperationRow,
    secret: SecretRow,
    aad: NpAgentVaultAadCanonicalV1,
    plaintext?: Uint8Array,
  ): Promise<NpAgentVaultOperationProjectionV1> {
    const adapter = options.registry.resolve({
      id: operation.vaultAdapter,
      contractVersion: operation.vaultAdapterContractVersion,
      fingerprint: operation.vaultAdapterFingerprint,
    });
    try {
      if (!operation.requestDigest.startsWith(`cj1:hmac-sha256:${operation.requestDigestKeyId}:`)) {
        return terminalFailure(operation, "VAULT_REQUEST_DIGEST_MISMATCH");
      }
      if (operation.kind === "seal") {
        if (!plaintext) {
          return terminalFailure(operation, "VAULT_SEAL_INPUT_LOST");
        }
        if (
          !npVerifyAgentVaultOperationRequestDigestV1(
            operation.requestDigest,
            digestInput(operation, secret, aad, {
              kind: "seal",
              plaintextEnvelope: plaintext,
            }),
            keyring,
          )
        ) {
          return terminalFailure(operation, "VAULT_REQUEST_DIGEST_MISMATCH");
        }
        const result = npRequireVaultSealResultV1(
          await npCallAgentVaultAdapterV1(
            (signal) =>
              adapter.seal(
                {
                  schemaVersion: "np.agent-vault-seal.v1",
                  aad,
                  plaintext,
                  idempotencyKey: operation.idempotencyKey,
                  requestDigest: operation.requestDigest,
                },
                { signal },
              ),
            callMilliseconds,
          ),
        );
        return acceptStoredResult(operation, secret, result);
      }
      const value = operationInput(operation, secret);
      if (
        !npVerifyAgentVaultOperationRequestDigestV1(
          operation.requestDigest,
          digestInput(operation, secret, aad, value),
          keyring,
        )
      ) {
        return terminalFailure(operation, "VAULT_REQUEST_DIGEST_MISMATCH");
      }
      if (operation.kind === "rewrap") {
        if (!adapter.rewrap || value.kind !== "rewrap") {
          return terminalFailure(operation, "VAULT_REWRAP_UNSUPPORTED");
        }
        const result = npRequireVaultRewrapResultV1(
          await npCallAgentVaultAdapterV1(
            (signal) =>
              adapter.rewrap!(
                {
                  schemaVersion: "np.agent-vault-rewrap.v1",
                  secretRef: value.secretRef,
                  expectedAad: aad,
                  targetKeyId: value.targetKeyId,
                  targetKeyVersion: value.targetKeyVersion,
                  idempotencyKey: operation.idempotencyKey,
                  requestDigest: operation.requestDigest,
                },
                { signal },
              ),
            callMilliseconds,
          ),
        );
        return acceptStoredResult(operation, secret, result);
      }
      if (value.kind !== "destroy") fail("VAULT_OPERATION_MISMATCH", "Destroy input is invalid.");
      const result = npRequireVaultDestroyResultV1(
        await npCallAgentVaultAdapterV1(
          (signal) =>
            adapter.destroy(
              {
                schemaVersion: "np.agent-vault-destroy.v1",
                secretRef: value.secretRef,
                expectedAad: aad,
                idempotencyKey: operation.idempotencyKey,
                requestDigest: operation.requestDigest,
              },
              { signal },
            ),
          callMilliseconds,
        ),
      );
      return acceptDestroyResult(operation, secret, result);
    } catch (error) {
      if (error instanceof NpAgentVaultError && error.code === "VAULT_OPERATION_STALE") throw error;
      return moveWaiting(operation, error);
    } finally {
      plaintext?.fill(0);
    }
  }

  async function admitOperation(input: {
    operationId: string;
    siteId: string;
    secretVersionId: string;
    kind: "rewrap" | "destroy";
    targetKeyId?: string;
    targetKeyVersion?: string;
    onJournaled?: NpAgentVaultDestroySecretInputV1["onJournaled"];
  }): Promise<{
    operation: OperationRow;
    secret: SecretRow;
    aad: NpAgentVaultAadCanonicalV1;
  }> {
    const db = resolveDb();
    return db.transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const [secret] = await tx
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, input.siteId),
            eq(npAgentConnectionSecretVersions.id, input.secretVersionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!secret) fail("VAULT_SECRET_NOT_FOUND", "The Agent vault secret was not found.");
      if (!secret.secretRef || secret.status === "destroyed") {
        fail("VAULT_SECRET_UNAVAILABLE", "The Agent vault secret has no usable locator.");
      }
      if (
        input.kind === "destroy" &&
        ((secret.purpose === "connection-credential" &&
          !["pending", "retiring", "revoked"].includes(secret.status)) ||
          (secret.purpose !== "connection-credential" && secret.status !== "pending"))
      ) {
        fail("VAULT_SECRET_STATE_CONFLICT", "The Agent vault secret cannot be destroyed yet.");
      }
      const aad = await requireSecretAad(secret, tx);
      const adapter = options.registry.resolve({
        id: secret.vaultAdapter,
        contractVersion: secret.vaultAdapterContractVersion,
        fingerprint: secret.vaultAdapterFingerprint,
      });
      const idempotencyKey =
        input.kind === "rewrap"
          ? `rewrap:${secret.id}:${input.targetKeyId}:${input.targetKeyVersion}`
          : `destroy:${secret.id}:${secret.version.toString()}`;
      const value: NpAgentVaultOperationDigestInputV1 =
        input.kind === "rewrap"
          ? {
              kind: "rewrap",
              secretRef: secret.secretRef,
              targetKeyId: input.targetKeyId!,
              targetKeyVersion: input.targetKeyVersion!,
            }
          : { kind: "destroy", secretRef: secret.secretRef };
      const requestDigest = npDigestAgentVaultOperationRequestV1(
        {
          siteId: secret.siteId,
          kind: input.kind,
          adapterId: adapter.id,
          adapterContractVersion: adapter.contractVersion,
          adapterFingerprint: adapter.fingerprint,
          secretVersionId: secret.id,
          idempotencyKey,
          aad,
          operationInput: value,
        },
        keyring.active,
      );
      const [existing] = await tx
        .select()
        .from(npAgentVaultOperations)
        .where(
          or(
            and(
              eq(npAgentVaultOperations.siteId, secret.siteId),
              eq(npAgentVaultOperations.id, input.operationId),
            ),
            and(
              eq(npAgentVaultOperations.vaultAdapter, adapter.id),
              eq(npAgentVaultOperations.idempotencyKey, idempotencyKey),
            ),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.id !== input.operationId ||
          existing.secretVersionId !== secret.id ||
          existing.kind !== input.kind ||
          existing.requestDigest !== requestDigest
        ) {
          fail("VAULT_IDEMPOTENCY_CONFLICT", "The vault operation identity is already bound.");
        }
        await input.onJournaled?.({ db: tx, now: now(), secret, operation: existing });
        return { operation: existing, secret, aad };
      }
      const [created] = await tx
        .insert(npAgentVaultOperations)
        .values({
          id: input.operationId,
          siteId: secret.siteId,
          connectionId: secret.connectionId,
          secretVersionId: secret.id,
          vaultAdapter: adapter.id,
          vaultAdapterContractVersion: adapter.contractVersion,
          vaultAdapterFingerprint: adapter.fingerprint,
          kind: input.kind,
          idempotencyKey,
          requestDigestKeyId: keyring.active.id,
          requestDigest,
          state: "queued",
          targetKeyId: input.targetKeyId ?? null,
          targetKeyVersion: input.targetKeyVersion ?? null,
          attempt: 1,
          rowVersion: 1,
          createdAt: now(),
        })
        .returning();
      if (!created) fail("VAULT_PERSISTENCE_FAILED", "The vault operation was not persisted.");
      await input.onJournaled?.({ db: tx, now: created.createdAt, secret, operation: created });
      return { operation: created, secret, aad };
    });
  }

  async function findSecret(siteId: string, secretVersionId: string): Promise<SecretRow> {
    requireIdentity({ siteId, secretVersionId });
    const [secret] = await resolveDb()
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(
        and(
          eq(npAgentConnectionSecretVersions.siteId, siteId),
          eq(npAgentConnectionSecretVersions.id, secretVersionId),
        ),
      )
      .limit(1);
    if (!secret) fail("VAULT_SECRET_NOT_FOUND", "The Agent vault secret was not found.");
    return secret;
  }

  return {
    async sealSecret(
      input: NpAgentVaultSealSecretInputV1,
    ): Promise<NpAgentVaultOperationProjectionV1> {
      requireIdentity(input);
      if (
        !Number.isSafeInteger(input.version) ||
        input.version < 1 ||
        !["model", "notification"].includes(input.connectionKind) ||
        !["connection-credential", "provider-oauth-pkce", "provider-oauth-code"].includes(
          input.purpose,
        )
      ) {
        fail("VAULT_CONTRACT_INVALID", "The secret version metadata is invalid.");
      }
      const envelope = npRequireAgentVaultPlaintextEnvelopeV1(input.envelope);
      let encoded: Uint8Array | null = null;
      try {
        materialForPurpose(input.purpose, envelope);
        encoded = npEncodeAgentVaultPlaintextEnvelopeV1(envelope);
        const adapter = options.registry.getActive();
        const aad = npRequireAgentVaultAadCanonical({
          schemaVersion: "np.agent-vault-aad.v1",
          siteId: input.siteId,
          connectionId: input.connectionId,
          connectionKind: input.connectionKind,
          purpose: input.purpose,
          secretVersionId: input.secretVersionId,
          secretVersion: input.version,
          vaultAdapterId: adapter.id,
          vaultAdapterContractVersion: adapter.contractVersion,
          vaultAdapterFingerprint: adapter.fingerprint,
          credentialEnvelopeVersion: 1,
          algorithm: adapter.algorithm,
        });
        const aadDigest = await npDigestAgentVaultAadCanonical(aad);
        const idempotencyKey = `seal:${input.secretVersionId}:${input.version.toString()}`;
        const requestDigest = npDigestAgentVaultOperationRequestV1(
          {
            siteId: input.siteId,
            kind: "seal",
            adapterId: adapter.id,
            adapterContractVersion: adapter.contractVersion,
            adapterFingerprint: adapter.fingerprint,
            secretVersionId: input.secretVersionId,
            idempotencyKey,
            aad,
            operationInput: { kind: "seal", plaintextEnvelope: encoded },
          },
          keyring.active,
        );
        const db = resolveDb();
        const admitted = await db.transaction(async (rawTx) => {
          const tx = rawTx as NpAgentDb;
          const [connection] = await tx
            .select()
            .from(npAgentConnections)
            .where(
              and(
                eq(npAgentConnections.siteId, input.siteId),
                eq(npAgentConnections.id, input.connectionId),
              ),
            )
            .for("update")
            .limit(1);
          if (
            !connection ||
            connection.kind !== input.connectionKind ||
            connection.status === "revoked"
          ) {
            fail("VAULT_CONNECTION_INVALID", "The target Agent connection is unavailable.");
          }
          if (input.purpose === "connection-credential" && connection.authKind !== envelope.kind) {
            fail("VAULT_PURPOSE_MISMATCH", "The connection auth kind and credential disagree.");
          }
          if (envelope.kind === "api_key" || envelope.kind === "oauth") {
            const [config] = await tx
              .select()
              .from(npAgentConnectionConfigVersions)
              .where(
                and(
                  eq(npAgentConnectionConfigVersions.siteId, input.siteId),
                  eq(npAgentConnectionConfigVersions.id, connection.activeConfigSnapshotId),
                  eq(npAgentConnectionConfigVersions.connectionId, connection.id),
                ),
              )
              .limit(1);
            if (
              !config ||
              config.adapterId !== envelope.adapterId ||
              config.adapterContractVersion !== envelope.adapterContractVersion ||
              config.adapterFingerprint !== envelope.adapterFingerprint
            ) {
              fail(
                "VAULT_CREDENTIAL_ADAPTER_MISMATCH",
                "The credential does not match the active connection adapter.",
              );
            }
          }
          const [existingOperation] = await tx
            .select()
            .from(npAgentVaultOperations)
            .where(
              or(
                and(
                  eq(npAgentVaultOperations.siteId, input.siteId),
                  eq(npAgentVaultOperations.id, input.operationId),
                ),
                and(
                  eq(npAgentVaultOperations.vaultAdapter, adapter.id),
                  eq(npAgentVaultOperations.idempotencyKey, idempotencyKey),
                ),
              ),
            )
            .limit(1);
          if (existingOperation) {
            if (
              existingOperation.id !== input.operationId ||
              existingOperation.secretVersionId !== input.secretVersionId ||
              existingOperation.requestDigest !== requestDigest ||
              existingOperation.kind !== "seal"
            ) {
              fail("VAULT_IDEMPOTENCY_CONFLICT", "The vault seal identity is already bound.");
            }
            const [secret] = await tx
              .select()
              .from(npAgentConnectionSecretVersions)
              .where(eq(npAgentConnectionSecretVersions.id, input.secretVersionId))
              .limit(1);
            if (!secret) fail("VAULT_SECRET_NOT_FOUND", "The linked Agent vault secret is absent.");
            requireOperationMatchesSecret(existingOperation, secret);
            await input.onJournaled?.({
              db: tx,
              now: now(),
              secret,
              operation: existingOperation,
            });
            return { operation: existingOperation, secret, existing: true };
          }
          const createdAt = now();
          const temporary = input.purpose !== "connection-credential";
          const expiresAt =
            input.temporaryExpiresAt == null
              ? null
              : input.temporaryExpiresAt instanceof Date &&
                  Number.isFinite(input.temporaryExpiresAt.getTime())
                ? new Date(input.temporaryExpiresAt.getTime())
                : fail(
                    "VAULT_TEMPORARY_EXPIRY_INVALID",
                    "Temporary vault expiry must be one valid timestamp.",
                  );
          if (
            temporary &&
            (!expiresAt ||
              expiresAt <= createdAt ||
              expiresAt.getTime() > createdAt.getTime() + 10 * 60 * 1_000)
          ) {
            fail(
              "VAULT_TEMPORARY_EXPIRY_INVALID",
              "Temporary vault material must expire within ten minutes.",
            );
          }
          if (!temporary && expiresAt !== null) {
            fail(
              "VAULT_TEMPORARY_EXPIRY_INVALID",
              "Connection credentials do not use temporary expiry.",
            );
          }
          const oauth = envelope.kind === "oauth" ? envelope : null;
          const refreshGeneration = oauth ? (input.oauthRefreshGeneration ?? 1) : null;
          if (oauth && (!Number.isSafeInteger(refreshGeneration) || refreshGeneration! < 1)) {
            fail("VAULT_CONTRACT_INVALID", "The OAuth refresh generation is invalid.");
          }
          if (oauth && new Date(oauth.accessExpiresAt) <= createdAt) {
            fail("VAULT_CONTRACT_INVALID", "The OAuth access credential is already expired.");
          }
          const [secret] = await tx
            .insert(npAgentConnectionSecretVersions)
            .values({
              id: input.secretVersionId,
              siteId: input.siteId,
              connectionId: input.connectionId,
              version: input.version,
              status: "pending",
              purpose: input.purpose,
              vaultAdapter: adapter.id,
              vaultAdapterContractVersion: adapter.contractVersion,
              vaultAdapterFingerprint: adapter.fingerprint,
              sealOperationId: input.operationId,
              secretRef: null,
              materialKind: envelope.kind,
              credentialEnvelopeVersion: 1,
              vaultAlgorithm: adapter.algorithm,
              aadBody: aad,
              aadDigest,
              expiresAt,
              accessExpiresAt: oauth ? new Date(oauth.accessExpiresAt) : null,
              refreshTokenPresent: oauth ? oauth.refresh.mode === "present" : null,
              refreshExpiresAt:
                oauth?.refresh.mode === "present" && oauth.refresh.expiresAt
                  ? new Date(oauth.refresh.expiresAt)
                  : null,
              refreshGeneration,
              permissionDigest: oauth ? permissionDigest(oauth.grantedPermissions) : null,
              createdAt,
            })
            .returning();
          if (!secret)
            fail("VAULT_PERSISTENCE_FAILED", "The pending vault secret was not persisted.");
          const [operation] = await tx
            .insert(npAgentVaultOperations)
            .values({
              id: input.operationId,
              siteId: input.siteId,
              connectionId: input.connectionId,
              secretVersionId: input.secretVersionId,
              vaultAdapter: adapter.id,
              vaultAdapterContractVersion: adapter.contractVersion,
              vaultAdapterFingerprint: adapter.fingerprint,
              kind: "seal",
              idempotencyKey,
              requestDigestKeyId: keyring.active.id,
              requestDigest,
              state: "queued",
              attempt: 1,
              rowVersion: 1,
              createdAt,
            })
            .returning();
          if (!operation)
            fail("VAULT_PERSISTENCE_FAILED", "The vault seal journal was not persisted.");
          await input.onJournaled?.({ db: tx, now: createdAt, secret, operation });
          return { operation, secret, existing: false };
        });
        if (
          TERMINAL_STATES.has(admitted.operation.state) ||
          admitted.operation.state !== "queued"
        ) {
          return projection(admitted.operation);
        }
        const claimed = await claimQueued(admitted.operation);
        return await dispatch(claimed, admitted.secret, aad, encoded);
      } finally {
        encoded?.fill(0);
        npZeroAgentVaultEnvelopeV1(envelope);
      }
    },

    async rewrapSecret(
      input: NpAgentVaultMutateSecretInputV1 & { targetKeyId: string; targetKeyVersion: string },
    ): Promise<NpAgentVaultOperationProjectionV1> {
      requireIdentity(input);
      if (
        typeof input.targetKeyId !== "string" ||
        typeof input.targetKeyVersion !== "string" ||
        !IDENTIFIER_PATTERN.test(input.targetKeyId) ||
        !IDENTIFIER_PATTERN.test(input.targetKeyVersion)
      ) {
        fail("VAULT_CONTRACT_INVALID", "The target Agent vault key is invalid.");
      }
      const admitted = await admitOperation({
        operationId: input.operationId,
        siteId: input.siteId,
        secretVersionId: input.secretVersionId,
        kind: "rewrap",
        targetKeyId: input.targetKeyId,
        targetKeyVersion: input.targetKeyVersion,
      });
      if (admitted.operation.state !== "queued") return projection(admitted.operation);
      const claimed = await claimQueued(admitted.operation);
      return dispatch(claimed, admitted.secret, admitted.aad);
    },

    async revokeSecret(input: {
      siteId: string;
      secretVersionId: string;
    }): Promise<{ secretVersionId: string; status: "revoked" }> {
      const secret = await findSecret(input.siteId, input.secretVersionId);
      if (secret.purpose !== "connection-credential") {
        fail(
          "VAULT_SECRET_STATE_CONFLICT",
          "Temporary OAuth material must be destroyed, not revoked.",
        );
      }
      if (secret.status === "destroyed") {
        fail("VAULT_SECRET_STATE_CONFLICT", "A destroyed credential cannot be revoked.");
      }
      if (secret.status === "revoked") {
        return { secretVersionId: secret.id, status: "revoked" };
      }
      const revokedAt = now();
      const [updated] = await resolveDb()
        .update(npAgentConnectionSecretVersions)
        .set({
          status: "revoked",
          retiredAt: secret.status === "active" ? revokedAt : secret.retiredAt,
        })
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, secret.siteId),
            eq(npAgentConnectionSecretVersions.id, secret.id),
            eq(npAgentConnectionSecretVersions.status, secret.status),
          ),
        )
        .returning();
      if (!updated) fail("VAULT_OPERATION_STALE", "The credential revocation CAS was lost.");
      return { secretVersionId: updated.id, status: "revoked" };
    },

    async destroySecret(
      input: NpAgentVaultDestroySecretInputV1,
    ): Promise<NpAgentVaultOperationProjectionV1> {
      requireIdentity(input);
      const admitted = await admitOperation({
        operationId: input.operationId,
        siteId: input.siteId,
        secretVersionId: input.secretVersionId,
        kind: "destroy",
        onJournaled: input.onJournaled,
      });
      if (admitted.operation.state !== "queued") return projection(admitted.operation);
      const claimed = await claimQueued(admitted.operation);
      return dispatch(claimed, admitted.secret, admitted.aad);
    },

    async reconcileOperation(input: {
      siteId: string;
      operationId: string;
    }): Promise<NpAgentVaultOperationProjectionV1> {
      requireIdentity({
        siteId: input.siteId,
        secretVersionId: input.operationId,
        operationId: input.operationId,
      });
      const loaded = await loadOperation(input.siteId, input.operationId);
      let operation = loaded.operation;
      const { secret, aad } = loaded;
      if (TERMINAL_STATES.has(operation.state)) return projection(operation);
      // Merely resolving the frozen digest key is a readiness/recovery gate for every operation.
      npResolveAgentVaultRequestDigestKeyV1(keyring, operation.requestDigestKeyId);
      if (operation.state === "queued") {
        if (operation.kind === "seal") return terminalFailure(operation, "VAULT_SEAL_INPUT_LOST");
        const claimed = await claimQueued(operation);
        return dispatch(claimed, secret, aad);
      }
      if (operation.leaseUntil && operation.leaseUntil > now()) return projection(operation);
      if (!operation.leaseUntil) {
        fail("VAULT_OPERATION_MISMATCH", "A recoverable vault operation has no inspection time.");
      }
      if (operation.attempt >= npAgentVaultLimitsV1.maximumAttempt) return projection(operation);
      const [claimed] = await resolveDb()
        .update(npAgentVaultOperations)
        .set({
          state: "running",
          attempt: operation.attempt + 1,
          rowVersion: operation.rowVersion + 1,
          leaseUntil: new Date(now().getTime() + leaseSeconds * 1_000),
        })
        .where(
          and(
            eq(npAgentVaultOperations.siteId, operation.siteId),
            eq(npAgentVaultOperations.id, operation.id),
            inArray(npAgentVaultOperations.state, ["running", "waiting_inspection"]),
            eq(npAgentVaultOperations.rowVersion, operation.rowVersion),
            or(
              eq(npAgentVaultOperations.leaseUntil, operation.leaseUntil),
              lte(npAgentVaultOperations.leaseUntil, now()),
            ),
          ),
        )
        .returning();
      if (!claimed) fail("VAULT_OPERATION_STALE", "The vault inspection claim was lost.");
      operation = claimed;
      const adapter = options.registry.resolve({
        id: operation.vaultAdapter,
        contractVersion: operation.vaultAdapterContractVersion,
        fingerprint: operation.vaultAdapterFingerprint,
      });
      let inspected: NpVaultOperationInspectResultV1;
      try {
        inspected = npRequireVaultInspectResultV1(
          await npCallAgentVaultAdapterV1(
            (signal) =>
              adapter.inspectOperation(
                {
                  schemaVersion: "np.agent-vault-operation-inspect.v1",
                  kind: operation.kind as "seal" | "rewrap" | "destroy",
                  idempotencyKey: operation.idempotencyKey,
                  requestDigest: operation.requestDigest,
                },
                { signal },
              ),
            callMilliseconds,
          ),
          operation.kind as "seal" | "rewrap" | "destroy",
        );
      } catch (error) {
        return moveWaiting(operation, error);
      }
      if (inspected.state === "pending") {
        return moveWaiting(
          operation,
          new NpAgentVaultError(
            "VAULT_OPERATION_PENDING",
            "The vault effect is still pending.",
            true,
          ),
        );
      }
      if (inspected.state === "failed") {
        return terminalFailure(operation, inspected.safeCode, inspected.resultDigest);
      }
      if (inspected.state === "absent") {
        if (operation.kind === "seal") return terminalFailure(operation, "VAULT_SEAL_INPUT_LOST");
        return dispatch(operation, secret, aad);
      }
      if (operation.kind === "destroy") {
        if (!inspected.destroyed)
          fail("VAULT_ADAPTER_RESULT_INVALID", "Destroy inspection omitted its receipt.");
        return acceptDestroyResult(operation, secret, inspected.destroyed, inspected.resultDigest);
      }
      if (!inspected.sealed)
        fail("VAULT_ADAPTER_RESULT_INVALID", "Vault inspection omitted its stored value.");
      return acceptStoredResult(operation, secret, inspected.sealed, inspected.resultDigest);
    },

    async leaseProviderCredential(input: {
      siteId: string;
      secretVersionId: string;
      use: "runtime" | "probe";
    }): Promise<NpProviderCredentialLeaseV1> {
      const secret = await findSecret(input.siteId, input.secretVersionId);
      if (
        secret.purpose !== "connection-credential" ||
        !(
          (input.use === "runtime" && ["active", "retiring"].includes(secret.status)) ||
          (input.use === "probe" && secret.status === "pending")
        ) ||
        !secret.secretRef
      ) {
        fail("VAULT_SECRET_UNAVAILABLE", "The provider credential is not leaseable.");
      }
      const aad = await requireSecretAad(secret, resolveDb());
      const [config] = await resolveDb()
        .select()
        .from(npAgentConnectionConfigVersions)
        .where(
          and(
            eq(npAgentConnectionConfigVersions.siteId, secret.siteId),
            eq(npAgentConnectionConfigVersions.connectionId, secret.connectionId),
            eq(npAgentConnectionConfigVersions.state, "active"),
          ),
        )
        .limit(1);
      if (!config)
        fail("VAULT_CREDENTIAL_ADAPTER_MISMATCH", "The active connection adapter is absent.");
      const adapter = options.registry.resolve({
        id: secret.vaultAdapter,
        contractVersion: secret.vaultAdapterContractVersion,
        fingerprint: secret.vaultAdapterFingerprint,
      });
      const raw = npRequireVaultPlaintextLeaseV1(
        await npCallAgentVaultAdapterV1(
          (signal) =>
            adapter.open(
              {
                schemaVersion: "np.agent-vault-open.v1",
                secretRef: secret.secretRef!,
                expectedAad: aad,
              },
              { signal },
            ),
          callMilliseconds,
          (late) => late.dispose(),
        ),
        { secretVersionId: secret.id, aadDigest: secret.aadDigest, now: now() },
      );
      return new ProviderCredentialLease(raw, secret.id, raw.expiresAt, {
        id: config.adapterId,
        contractVersion: config.adapterContractVersion,
        fingerprint: config.adapterFingerprint,
      });
    },

    async leaseProviderOAuthCode(input: {
      siteId: string;
      secretVersionId: string;
    }): Promise<NpProviderOAuthCodeLeaseV1> {
      return leaseTemporary(input, "provider-oauth-code") as Promise<NpProviderOAuthCodeLeaseV1>;
    },

    async leaseProviderOAuthPkce(input: {
      siteId: string;
      secretVersionId: string;
    }): Promise<NpProviderOAuthPkceLeaseV1> {
      return leaseTemporary(input, "provider-oauth-pkce") as Promise<NpProviderOAuthPkceLeaseV1>;
    },

    async inspectOperation(input: {
      siteId: string;
      operationId: string;
    }): Promise<NpAgentVaultOperationProjectionV1> {
      requireIdentity({
        siteId: input.siteId,
        secretVersionId: input.operationId,
        operationId: input.operationId,
      });
      return projection((await loadOperation(input.siteId, input.operationId)).operation);
    },

    dispose(): void {
      keyring.active.key.fill(0);
      for (const key of Object.values(keyring.previous ?? {})) key.fill(0);
    },
  };

  async function leaseTemporary(
    input: { siteId: string; secretVersionId: string },
    purpose: "provider-oauth-code" | "provider-oauth-pkce",
  ): Promise<OAuthTemporaryLease<typeof purpose>> {
    const secret = await findSecret(input.siteId, input.secretVersionId);
    if (
      secret.purpose !== purpose ||
      secret.status !== "pending" ||
      !secret.secretRef ||
      !secret.expiresAt ||
      secret.expiresAt <= now()
    ) {
      fail("VAULT_SECRET_UNAVAILABLE", "The temporary OAuth secret is not leaseable.");
    }
    const aad = await requireSecretAad(secret, resolveDb());
    const adapter = options.registry.resolve({
      id: secret.vaultAdapter,
      contractVersion: secret.vaultAdapterContractVersion,
      fingerprint: secret.vaultAdapterFingerprint,
    });
    const raw = npRequireVaultPlaintextLeaseV1(
      await npCallAgentVaultAdapterV1(
        (signal) =>
          adapter.open(
            {
              schemaVersion: "np.agent-vault-open.v1",
              secretRef: secret.secretRef!,
              expectedAad: aad,
            },
            { signal },
          ),
        callMilliseconds,
        (late) => late.dispose(),
      ),
      { secretVersionId: secret.id, aadDigest: secret.aadDigest, now: now() },
    );
    return new OAuthTemporaryLease(raw, secret.id, purpose, raw.expiresAt);
  }
}

export type NpAgentVaultServiceV1 = ReturnType<typeof createAgentVaultServiceV1>;
