import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { and, desc, eq, gt, inArray, lte, or } from "drizzle-orm";

import {
  npDigestAgentConnectionOperationCanonical,
  npRequireAgentConnectionV1,
  type NpAgentConnectionKind,
  type NpAgentConnectionOperationKind,
  type NpAgentConnectionOperationRequestCanonicalV1,
  type NpAgentConnectionV1,
  type NpAgentJsonObject,
  type NpAgentProviderDataClass,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentConnectionAuthRequests,
  npAgentConnectionConfigVersions,
  npAgentConnectionOperations,
  npAgentConnections,
  npAgentConnectionSecretVersions,
} from "../db/schema/agent.js";
import { npSessions } from "../db/schema/system.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  NpAgentProviderError,
  npAgentProviderAdapterLimitsV1,
  npBuildAgentOAuthCredentialEnvelopeV1,
  npCreateAgentProviderResultDigestV1,
  npParseAgentProviderConnectionConfigV1,
  npProjectAgentAccountSubjectV1,
  npProjectAgentConnectionDestinationV1,
  npRequireAgentProviderAuthorizationUrlV1,
  npRequireAgentProviderAuthOperationResultV1,
  npRequireAgentProviderProbeResultV1,
  npZeroAgentProviderAuthResultV1,
  npZeroAgentProviderProbeResultV1,
  type NpAgentConnectionAuthAdapterRegistryV1,
  type NpAgentConnectionAuthAdapterV1,
  type NpAgentConnectionProjectionKeyringV1,
  type NpAgentParsedConnectionConfigV1,
  type NpAgentProviderAuthOperationResultV1,
  type NpAgentProviderProbeResultV1,
} from "./provider-auth-contract.js";
import {
  NpAgentVaultError,
  type NpAgentConnectionCredentialEnvelopeV1,
  type NpProviderCredentialLeaseV1,
  type NpProviderOAuthCodeLeaseV1,
  type NpProviderOAuthPkceLeaseV1,
} from "./vault-contract.js";
import type { NpAgentVaultOperationProjectionV1, NpAgentVaultServiceV1 } from "./vault-service.js";

type NpAgentDb = ReturnType<typeof getDb>;
type ConnectionRow = typeof npAgentConnections.$inferSelect;
type ConfigRow = typeof npAgentConnectionConfigVersions.$inferSelect;
type OperationRow = typeof npAgentConnectionOperations.$inferSelect;
type SecretRow = typeof npAgentConnectionSecretVersions.$inferSelect;

const UUID_PATTERN = new RegExp(npAuthUuidPattern, "u");
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const STATE_PATTERN = /^npps1\.[A-Za-z0-9_-]{43}$/u;
const TERMINAL_OPERATION_STATES = new Set(["succeeded", "failed", "ambiguous", "cancelled"]);
const ACTIVE_CREDENTIAL_STATES = new Set(["ready", "disabled", "error"]);

export interface NpAgentProviderStateHashKeyV1 {
  id: string;
  key: Uint8Array;
}

export interface NpAgentProviderStateHashKeyringV1 {
  active: NpAgentProviderStateHashKeyV1;
  previous?: Readonly<Record<string, Uint8Array>>;
}

export interface NpAgentConnectionServiceOptionsV1 {
  providerRegistry: NpAgentConnectionAuthAdapterRegistryV1;
  vault: NpAgentVaultServiceV1;
  projectionKeyring: NpAgentConnectionProjectionKeyringV1;
  stateHashKeyring: NpAgentProviderStateHashKeyringV1;
  resolveDb?: () => NpAgentDb;
  now?: () => Date;
  randomUuid?: () => string;
  randomBytes?: (size: number) => Uint8Array;
  resolveOAuthClientConfigDigest?: (input: {
    siteId: string;
    adapterId: string;
  }) => string | Promise<string>;
  providerCallMilliseconds?: number;
  workerLeaseSeconds?: number;
}

export interface NpAgentConnectionOperationProjectionV1 {
  schemaVersion: "np.agent-connection-operation-status.v1";
  id: string;
  siteId: string;
  connectionId: string;
  kind: NpAgentConnectionOperationKind;
  state:
    "awaiting_secret" | "queued" | "running" | "succeeded" | "failed" | "ambiguous" | "cancelled";
  attempt: number;
  result: NpAgentJsonObject | null;
  lastErrorCode: string | null;
  deadlineAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface NpAgentConnectionCreateInputV1 {
  id?: string;
  siteId: string;
  kind: NpAgentConnectionKind;
  provider: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  name: string;
  authKind: "api_key" | "oauth";
  config: NpAgentJsonObject;
  dataProcessingCeiling: NpAgentProviderDataClass;
  createdBy?: string | null;
}

export interface NpAgentConnectionApiKeyInputV1 {
  siteId: string;
  connectionId: string;
  invocationId: string;
  idempotencyKey: string;
  expectedConfigVersion: number;
  expectedConfigHash: string;
  vaultOperationId: string;
  apiKey: Uint8Array;
  createdByUserId?: string | null;
}

export interface NpAgentConnectionApiKeyAdmissionInputV1 extends NpAgentConnectionApiKeyInputV1 {
  /** The shared Admin admission transaction. */
  db: NpAgentDb;
  admittedAt: Date;
}

export interface NpAgentConnectionApiKeyAdmissionV1 {
  operation: NpAgentConnectionOperationProjectionV1;
  afterCommit: () => Promise<NpAgentConnectionOperationProjectionV1>;
}

export interface NpAgentConnectionOAuthStartInputV1 {
  siteId: string;
  connectionId: string;
  staffSessionId: string;
  redirectUri: string;
  requestedPermissions: string[];
  oauthClientConfigDigest: string;
  expectedConfigVersion: number;
  expectedConfigHash: string;
  mode?: "initial" | "replace";
}

export interface NpAgentConnectionOAuthCallbackInputV1 {
  state: string;
  staffSessionId: string;
  code?: Uint8Array;
  error?: string;
}

function fail(code: string, message: string, retryable = false): never {
  throw new NpAgentProviderError(code, message, retryable);
}

function requireUuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return fail("CONNECTION_IDENTITY_INVALID", `${path} must be a canonical UUID.`);
  }
  return value;
}

function requireIdentity(siteId: string, connectionId?: string): void {
  if (
    !npIsCanonicalSiteId(siteId) ||
    (connectionId !== undefined && !UUID_PATTERN.test(connectionId))
  ) {
    fail("CONNECTION_IDENTITY_INVALID", "The connection site or resource identity is invalid.");
  }
}

function cloneProjectionKeyring(
  value: NpAgentConnectionProjectionKeyringV1,
): NpAgentConnectionProjectionKeyringV1 {
  const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
  if (
    value.accountSubject.owner !== "connection-account-subject" ||
    value.destination.owner !== "connection-destination" ||
    !keyIdPattern.test(value.accountSubject.id) ||
    !keyIdPattern.test(value.destination.id) ||
    !(value.accountSubject.bytes instanceof Uint8Array) ||
    !(value.destination.bytes instanceof Uint8Array) ||
    value.accountSubject.bytes.byteLength < 32 ||
    value.destination.bytes.byteLength < 32 ||
    Buffer.from(value.accountSubject.bytes).equals(Buffer.from(value.destination.bytes))
  ) {
    fail("PROVIDER_PROJECTION_KEY_INVALID", "The connection projection keyring is invalid.");
  }
  const clonePrevious = (
    previousValue: Readonly<Record<string, Uint8Array>> | undefined,
    activeId: string,
    activeBytes: Uint8Array,
  ): Record<string, Uint8Array> => {
    const previous: Record<string, Uint8Array> = {};
    for (const [id, bytes] of Object.entries(previousValue ?? {})) {
      if (
        !keyIdPattern.test(id) ||
        id === activeId ||
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength < 32 ||
        Buffer.from(bytes).equals(Buffer.from(activeBytes)) ||
        Object.values(previous).some((entry) => Buffer.from(bytes).equals(Buffer.from(entry)))
      ) {
        fail("PROVIDER_PROJECTION_KEY_INVALID", "The connection projection keyring is invalid.");
      }
      previous[id] = new Uint8Array(bytes);
    }
    return previous;
  };
  const accountSubjectPrevious = clonePrevious(
    value.accountSubjectPrevious,
    value.accountSubject.id,
    value.accountSubject.bytes,
  );
  const destinationPrevious = clonePrevious(
    value.destinationPrevious,
    value.destination.id,
    value.destination.bytes,
  );
  const accountKeys = [value.accountSubject.bytes, ...Object.values(accountSubjectPrevious)];
  const destinationKeys = [value.destination.bytes, ...Object.values(destinationPrevious)];
  if (
    accountKeys.some((accountKey) =>
      destinationKeys.some((destinationKey) =>
        Buffer.from(accountKey).equals(Buffer.from(destinationKey)),
      ),
    )
  ) {
    fail("PROVIDER_PROJECTION_KEY_INVALID", "Projection key owners must remain separate.");
  }
  return {
    accountSubject: { ...value.accountSubject, bytes: new Uint8Array(value.accountSubject.bytes) },
    accountSubjectPrevious,
    destination: { ...value.destination, bytes: new Uint8Array(value.destination.bytes) },
    destinationPrevious,
  };
}

function cloneStateKeyring(
  value: NpAgentProviderStateHashKeyringV1,
): NpAgentProviderStateHashKeyringV1 {
  const keyPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
  if (!keyPattern.test(value.active.id) || value.active.key.byteLength < 32) {
    fail("PROVIDER_STATE_KEY_INVALID", "The provider OAuth state keyring is invalid.");
  }
  const previous: Record<string, Uint8Array> = {};
  for (const [id, key] of Object.entries(value.previous ?? {})) {
    if (
      !keyPattern.test(id) ||
      id === value.active.id ||
      key.byteLength < 32 ||
      previous[id] ||
      Buffer.from(key).equals(Buffer.from(value.active.key)) ||
      Object.values(previous).some((entry) => Buffer.from(key).equals(Buffer.from(entry)))
    ) {
      fail("PROVIDER_STATE_KEY_INVALID", "The provider OAuth state keyring is invalid.");
    }
    previous[id] = new Uint8Array(key);
  }
  return {
    active: { id: value.active.id, key: new Uint8Array(value.active.key) },
    previous,
  };
}

function stateDigest(state: string, key: NpAgentProviderStateHashKeyV1): string {
  const digest = createHmac("sha256", key.key)
    .update("np-agent-provider-oauth-state/v1\0", "utf8")
    .update(state, "utf8")
    .digest("base64url");
  return `cj1:hmac-sha256:${key.id}:${digest}`;
}

function operationProjection(row: OperationRow): NpAgentConnectionOperationProjectionV1 {
  return {
    schemaVersion: "np.agent-connection-operation-status.v1",
    id: row.id,
    siteId: row.siteId,
    connectionId: row.connectionId,
    kind: row.kind as NpAgentConnectionOperationKind,
    state: row.state as NpAgentConnectionOperationProjectionV1["state"],
    attempt: row.attempt,
    result: row.resultRedacted as NpAgentJsonObject | null,
    lastErrorCode: row.lastErrorCode,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function providerSafeCode(error: unknown): string {
  const code =
    error instanceof NpAgentProviderError || error instanceof NpAgentVaultError
      ? error.code
      : "PROVIDER_OPERATION_FAILED";
  return SAFE_CODE_PATTERN.test(code) ? code : "PROVIDER_OPERATION_FAILED";
}

function sha256Pkce(verifier: Uint8Array): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
}

export function createAgentConnectionServiceV1(options: NpAgentConnectionServiceOptionsV1) {
  const resolveDb = options.resolveDb ?? getDb;
  const now = options.now ?? (() => new Date());
  const randomUuid = options.randomUuid ?? randomUUID;
  const randomByteSource =
    options.randomBytes ?? ((size: number) => new Uint8Array(randomBytes(size)));
  const projectionKeyring = cloneProjectionKeyring(options.projectionKeyring);
  const stateKeyring = cloneStateKeyring(options.stateHashKeyring);
  const stateKeys = [stateKeyring.active.key, ...Object.values(stateKeyring.previous ?? {})];
  const projectionKeys = [
    projectionKeyring.accountSubject.bytes,
    ...Object.values(projectionKeyring.accountSubjectPrevious ?? {}),
    projectionKeyring.destination.bytes,
    ...Object.values(projectionKeyring.destinationPrevious ?? {}),
  ];
  if (
    stateKeys.some((key) =>
      projectionKeys.some((projectionKey) => Buffer.from(key).equals(Buffer.from(projectionKey))),
    )
  ) {
    fail(
      "PROVIDER_PROJECTION_KEY_INVALID",
      "OAuth state and connection projection owners require separate keys.",
    );
  }
  const providerCallMilliseconds =
    options.providerCallMilliseconds ?? npAgentProviderAdapterLimitsV1.adapterCallMilliseconds;
  const workerLeaseSeconds =
    options.workerLeaseSeconds ?? npAgentProviderAdapterLimitsV1.workerLeaseSeconds;
  if (
    !Number.isInteger(providerCallMilliseconds) ||
    providerCallMilliseconds < 1 ||
    providerCallMilliseconds > npAgentProviderAdapterLimitsV1.adapterCallMilliseconds ||
    !Number.isInteger(workerLeaseSeconds) ||
    workerLeaseSeconds < 1 ||
    workerLeaseSeconds > npAgentProviderAdapterLimitsV1.workerLeaseSeconds
  ) {
    fail("PROVIDER_SERVICE_CONFIG_INVALID", "The provider worker bounds are invalid.");
  }

  function accountSubjectProjectionKey(
    keyId: string | null,
  ): NpAgentConnectionProjectionKeyringV1["accountSubject"] {
    if (keyId === null || keyId === projectionKeyring.accountSubject.id) {
      return projectionKeyring.accountSubject;
    }
    const bytes = projectionKeyring.accountSubjectPrevious?.[keyId];
    if (!bytes)
      fail("PROVIDER_PROJECTION_KEY_UNAVAILABLE", "The frozen account-subject key is unavailable.");
    return { owner: "connection-account-subject", id: keyId, bytes };
  }

  function destinationProjectionKey(
    keyId: string | null,
  ): NpAgentConnectionProjectionKeyringV1["destination"] {
    if (keyId === null || keyId === projectionKeyring.destination.id) {
      return projectionKeyring.destination;
    }
    const bytes = projectionKeyring.destinationPrevious?.[keyId];
    if (!bytes)
      fail("PROVIDER_PROJECTION_KEY_UNAVAILABLE", "The frozen destination key is unavailable.");
    return { owner: "connection-destination", id: keyId, bytes };
  }

  async function parseStoredConfig(
    connection: ConnectionRow,
    config: ConfigRow,
  ): Promise<{ adapter: NpAgentConnectionAuthAdapterV1; parsed: NpAgentParsedConnectionConfigV1 }> {
    const adapter = options.providerRegistry.resolve({
      id: config.adapterId,
      contractVersion: config.adapterContractVersion,
      fingerprint: config.adapterFingerprint,
    });
    if (connection.provider !== adapter.id) {
      fail("PROVIDER_CONFIG_INTEGRITY_FAILED", "The connection provider and adapter disagree.");
    }
    const parsed = await npParseAgentProviderConnectionConfigV1({
      adapter,
      siteId: connection.siteId,
      connectionId: connection.id,
      kind: connection.kind as NpAgentConnectionKind,
      provider: connection.provider,
      authKind: connection.authKind as "api_key" | "oauth",
      configVersion: config.version,
      config: config.config,
      dataProcessingCeiling: config.dataProcessingCeiling as NpAgentProviderDataClass,
      effectiveAt: config.activatedAt ?? config.createdAt,
    });
    if (
      parsed.configHash !== config.configHash ||
      parsed.pricingCatalogFingerprint !== config.pricingCatalogFingerprint ||
      !jsonEqual(parsed.pricingCatalog, config.pricingCatalog)
    ) {
      fail(
        "PROVIDER_CONFIG_INTEGRITY_FAILED",
        "The immutable connection config cannot be reproduced.",
      );
    }
    return { adapter, parsed };
  }

  async function resolveOAuthClientConfigDigest(
    siteId: string,
    adapterId: string,
  ): Promise<string> {
    const digest = await options.resolveOAuthClientConfigDigest?.({ siteId, adapterId });
    if (typeof digest !== "string" || !/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(digest)) {
      fail(
        "OAUTH_CLIENT_CONFIG_UNAVAILABLE",
        "The provider OAuth client configuration is unavailable.",
      );
    }
    return digest;
  }

  async function loadConnectionConfig(
    db: NpAgentDb,
    siteId: string,
    connectionId: string,
    configSnapshotId?: string,
  ): Promise<{ connection: ConnectionRow; config: ConfigRow }> {
    const [connection] = await db
      .select()
      .from(npAgentConnections)
      .where(and(eq(npAgentConnections.siteId, siteId), eq(npAgentConnections.id, connectionId)))
      .limit(1);
    if (!connection) fail("CONNECTION_NOT_FOUND", "The Agent connection was not found.");
    const [config] = await db
      .select()
      .from(npAgentConnectionConfigVersions)
      .where(
        and(
          eq(npAgentConnectionConfigVersions.siteId, siteId),
          eq(npAgentConnectionConfigVersions.connectionId, connectionId),
          eq(
            npAgentConnectionConfigVersions.id,
            configSnapshotId ?? connection.activeConfigSnapshotId,
          ),
        ),
      )
      .limit(1);
    if (!config) fail("CONNECTION_CONFIG_NOT_FOUND", "The connection config snapshot is absent.");
    return { connection, config };
  }

  async function callProvider<T>(
    callback: (signal: AbortSignal) => Promise<T>,
    disposeLate: (value: T) => void,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = callback(controller.signal);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new NpAgentProviderError("PROVIDER_CALL_TIMEOUT", "The provider call timed out.", true),
        );
      }, providerCallMilliseconds);
    });
    try {
      return await Promise.race([task, timeout]);
    } catch (error) {
      if (timedOut) void task.then(disposeLate, () => undefined);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function probeSecret(input: {
    connection: ConnectionRow;
    config: ConfigRow;
    secret: SecretRow;
  }): Promise<{
    adapter: NpAgentConnectionAuthAdapterV1;
    parsed: NpAgentParsedConnectionConfigV1;
    probe: NpAgentProviderProbeResultV1;
  }> {
    const { adapter, parsed } = await parseStoredConfig(input.connection, input.config);
    const lease = await options.vault.leaseProviderCredential({
      siteId: input.connection.siteId,
      secretVersionId: input.secret.id,
      use: input.secret.status === "pending" ? "probe" : "runtime",
    });
    try {
      const raw = await callProvider(
        (signal) =>
          adapter.probeCredential(structuredClone(parsed), { credentialLease: lease, signal }),
        (late) => {
          try {
            npZeroAgentProviderProbeResultV1(late);
          } catch {
            // A hostile late result is dropped without inspecting or logging it.
          }
        },
      );
      try {
        return { adapter, parsed, probe: npRequireAgentProviderProbeResultV1(raw, adapter) };
      } finally {
        try {
          npZeroAgentProviderProbeResultV1(raw);
        } catch {
          // Hostile raw result shapes are discarded without logging.
        }
      }
    } finally {
      lease.dispose();
    }
  }

  async function finishOperationFailure(
    operation: OperationRow,
    codeValue: string,
    state: "failed" | "ambiguous" = "failed",
    result?: NpAgentJsonObject,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const code = SAFE_CODE_PATTERN.test(codeValue) ? codeValue : "PROVIDER_OPERATION_FAILED";
    const safeResult = result ?? { status: state, safeCode: code };
    const digest = npCreateAgentProviderResultDigestV1("connection-operation-failed", safeResult);
    const [updated] = await resolveDb()
      .update(npAgentConnectionOperations)
      .set({
        state,
        resultRedacted: safeResult,
        resultDigest: digest,
        lastErrorCode: code,
        leaseUntil: null,
        finishedAt: now(),
      })
      .where(
        and(
          eq(npAgentConnectionOperations.siteId, operation.siteId),
          eq(npAgentConnectionOperations.id, operation.id),
          eq(npAgentConnectionOperations.state, operation.state),
          eq(npAgentConnectionOperations.attempt, operation.attempt),
        ),
      )
      .returning();
    if (!updated)
      fail("CONNECTION_OPERATION_STALE", "The connection operation failure CAS was lost.");
    return operationProjection(updated);
  }

  async function markConnectionAuthorizationError(
    connection: ConnectionRow,
    code: string,
  ): Promise<void> {
    await resolveDb()
      .update(npAgentConnections)
      .set({ status: "error", lastErrorCode: code, updatedAt: now() })
      .where(
        and(
          eq(npAgentConnections.siteId, connection.siteId),
          eq(npAgentConnections.id, connection.id),
          connection.activeSecretVersionId
            ? eq(npAgentConnections.activeSecretVersionId, connection.activeSecretVersionId)
            : inArray(npAgentConnections.status, ["pending", "error"]),
        ),
      );
  }

  function hostProbeDigest(
    probe: NpAgentProviderProbeResultV1,
    account: { keyId: string; digest: string } | null,
  ): string {
    return npCreateAgentProviderResultDigestV1("connection-probe-result", {
      status: probe.status,
      accountSubjectKeyId: account?.keyId ?? null,
      accountSubjectDigest: account?.digest ?? null,
      grantedPermissions: probe.grantedPermissions,
      capabilityIds: probe.capabilityIds,
      safeCode: probe.safeCode,
    });
  }

  async function claimOperation(operation: OperationRow): Promise<OperationRow> {
    const claimedAt = now();
    if (!operation.deadlineAt || operation.deadlineAt <= claimedAt) {
      await finishOperationFailure(operation, "PROVIDER_OPERATION_DEADLINE_EXPIRED");
      fail("PROVIDER_OPERATION_DEADLINE_EXPIRED", "The connection operation deadline elapsed.");
    }
    const [claimed] = await resolveDb()
      .update(npAgentConnectionOperations)
      .set({
        state: "running",
        leaseUntil: new Date(claimedAt.getTime() + workerLeaseSeconds * 1_000),
        startedAt: claimedAt,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(npAgentConnectionOperations.siteId, operation.siteId),
          eq(npAgentConnectionOperations.id, operation.id),
          eq(npAgentConnectionOperations.state, "queued"),
          eq(npAgentConnectionOperations.attempt, operation.attempt),
        ),
      )
      .returning();
    if (!claimed) fail("CONNECTION_OPERATION_STALE", "The connection operation claim was lost.");
    return claimed;
  }

  async function attachProducedSecret(
    operation: OperationRow,
    secretVersionId: string,
    db: NpAgentDb = resolveDb(),
  ): Promise<void> {
    const [current] = await db
      .select()
      .from(npAgentConnectionOperations)
      .where(
        and(
          eq(npAgentConnectionOperations.siteId, operation.siteId),
          eq(npAgentConnectionOperations.id, operation.id),
        ),
      )
      .limit(1);
    if (!current || current.state !== "running" || current.attempt !== operation.attempt) {
      fail("CONNECTION_OPERATION_STALE", "The produced credential owner is no longer running.");
    }
    if (current.inputSecretVersionIds.includes(secretVersionId)) return;
    const inputSecretVersionIds = [...current.inputSecretVersionIds, secretVersionId];
    if (
      inputSecretVersionIds.length > 3 ||
      new Set(inputSecretVersionIds).size !== inputSecretVersionIds.length
    ) {
      fail("CONNECTION_OPERATION_MISMATCH", "The produced credential journal is invalid.");
    }
    const attached = await db
      .update(npAgentConnectionOperations)
      .set({ inputSecretVersionIds })
      .where(
        and(
          eq(npAgentConnectionOperations.siteId, operation.siteId),
          eq(npAgentConnectionOperations.id, operation.id),
          eq(npAgentConnectionOperations.state, "running"),
          eq(npAgentConnectionOperations.attempt, operation.attempt),
        ),
      )
      .returning({ id: npAgentConnectionOperations.id });
    if (attached.length !== 1) {
      fail("CONNECTION_OPERATION_STALE", "The produced credential journal CAS was lost.");
    }
  }

  async function activateProbedSecret(input: {
    operation: OperationRow;
    connection: ConnectionRow;
    config: ConfigRow;
    secret: SecretRow;
    adapter: NpAgentConnectionAuthAdapterV1;
    parsed: NpAgentParsedConnectionConfigV1;
    probe: Extract<NpAgentProviderProbeResultV1, { status: "ready" }>;
    expectedAccountSubjectDigest?: string | null;
  }): Promise<NpAgentConnectionOperationProjectionV1> {
    const account = npProjectAgentAccountSubjectV1(
      {
        siteId: input.connection.siteId,
        adapterId: input.adapter.id,
        providerSubject: input.probe.providerSubject,
      },
      accountSubjectProjectionKey(input.connection.activeAccountSubjectKeyId),
    );
    if (
      input.expectedAccountSubjectDigest &&
      input.expectedAccountSubjectDigest !== account.digest
    ) {
      return rejectPendingSecret(
        input.operation,
        input.secret,
        "PROVIDER_ACCOUNT_SUBJECT_MISMATCH",
      );
    }
    let destination: Awaited<ReturnType<typeof npProjectAgentConnectionDestinationV1>>;
    try {
      destination = await npProjectAgentConnectionDestinationV1({
        adapter: input.adapter,
        siteId: input.connection.siteId,
        connectionKind: input.connection.kind as NpAgentConnectionKind,
        parsedConfig: input.parsed,
        accountSubjectKeyId: account.keyId,
        accountSubjectDigest: account.digest,
        destinationKey: destinationProjectionKey(input.connection.activeDestinationKeyId),
      });
    } catch (error) {
      const code = providerSafeCode(error);
      return rejectPendingSecret(input.operation, input.secret, code);
    }
    if (
      input.connection.activeSecretVersionId &&
      ((destination.descriptor === null ? null : destination.keyId) !==
        input.connection.activeDestinationKeyId ||
        destination.fingerprint !== input.connection.activeDestinationFingerprint ||
        !jsonEqual(destination.descriptor, input.connection.activeDestinationDescriptor))
    ) {
      return rejectPendingSecret(input.operation, input.secret, "PROVIDER_DESTINATION_MISMATCH");
    }
    const finishedAt = now();
    const safeResult: NpAgentJsonObject = {
      status: "ready",
      safeCode: null,
      capabilityIds: input.probe.capabilityIds,
      grantedPermissions: input.probe.grantedPermissions,
    };
    const db = resolveDb();
    const updated = await db.transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const [current] = await tx
        .select()
        .from(npAgentConnections)
        .where(
          and(
            eq(npAgentConnections.siteId, input.operation.siteId),
            eq(npAgentConnections.id, input.operation.connectionId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !current ||
        current.configVersion !== input.operation.expectedConfigVersion ||
        current.configHash !== input.operation.expectedConfigHash ||
        current.activeConfigSnapshotId !== input.operation.configSnapshotId ||
        current.activeSecretVersionId !== input.operation.expectedSecretVersionId ||
        current.credentialVersion !== input.operation.expectedCredentialVersion
      ) {
        fail("CONNECTION_OPERATION_STALE", "The connection changed before credential activation.");
      }
      const [pending] = await tx
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, current.siteId),
            eq(npAgentConnectionSecretVersions.id, input.secret.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!pending || pending.status !== "pending" || !pending.secretRef) {
        fail("CONNECTION_SECRET_STALE", "The pending credential is unavailable.");
      }
      if (current.activeSecretVersionId) {
        const retired = await tx
          .update(npAgentConnectionSecretVersions)
          .set({ status: "retiring", retiredAt: finishedAt })
          .where(
            and(
              eq(npAgentConnectionSecretVersions.siteId, current.siteId),
              eq(npAgentConnectionSecretVersions.id, current.activeSecretVersionId),
              eq(npAgentConnectionSecretVersions.status, "active"),
            ),
          )
          .returning({ id: npAgentConnectionSecretVersions.id });
        if (retired.length !== 1)
          fail("CONNECTION_SECRET_STALE", "The prior credential retirement CAS was lost.");
      }
      const activated = await tx
        .update(npAgentConnectionSecretVersions)
        .set({
          status: "active",
          accountSubjectKeyId: account.keyId,
          accountSubjectDigest: account.digest,
          activatedAt: finishedAt,
        })
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, pending.siteId),
            eq(npAgentConnectionSecretVersions.id, pending.id),
            eq(npAgentConnectionSecretVersions.status, "pending"),
          ),
        )
        .returning({ id: npAgentConnectionSecretVersions.id });
      if (activated.length !== 1)
        fail("CONNECTION_SECRET_STALE", "The credential activation CAS was lost.");
      const nextStatus = current.status === "disabled" ? "disabled" : "ready";
      const connections = await tx
        .update(npAgentConnections)
        .set({
          activeSecretVersionId: pending.id,
          credentialVersion: pending.version,
          activeAccountSubjectKeyId: account.keyId,
          activeAccountSubjectDigest: account.digest,
          activeDestinationKeyId: destination.descriptor ? destination.keyId : null,
          activeDestinationDescriptor:
            (destination.descriptor as unknown as Record<string, unknown> | null) ?? null,
          activeDestinationFingerprint: destination.fingerprint,
          status: nextStatus,
          lastVerifiedAt: finishedAt,
          lastVerifiedConfigVersion: current.configVersion,
          lastVerifiedCredentialVersion: pending.version,
          lastProbeResultDigest: hostProbeDigest(input.probe, account),
          lastErrorCode: null,
          updatedAt: finishedAt,
        })
        .where(
          and(
            eq(npAgentConnections.siteId, current.siteId),
            eq(npAgentConnections.id, current.id),
            eq(npAgentConnections.configVersion, current.configVersion),
            current.activeSecretVersionId
              ? eq(npAgentConnections.activeSecretVersionId, current.activeSecretVersionId)
              : eq(npAgentConnections.status, current.status),
          ),
        )
        .returning({ id: npAgentConnections.id });
      if (connections.length !== 1)
        fail("CONNECTION_OPERATION_STALE", "The connection activation CAS was lost.");
      const [operation] = await tx
        .update(npAgentConnectionOperations)
        .set({
          state: "succeeded",
          resultRedacted: safeResult,
          resultDigest: npCreateAgentProviderResultDigestV1(
            "connection-operation-ready",
            safeResult,
          ),
          lastErrorCode: null,
          leaseUntil: null,
          finishedAt,
        })
        .where(
          and(
            eq(npAgentConnectionOperations.siteId, input.operation.siteId),
            eq(npAgentConnectionOperations.id, input.operation.id),
            eq(npAgentConnectionOperations.state, "running"),
            eq(npAgentConnectionOperations.attempt, input.operation.attempt),
          ),
        )
        .returning();
      if (!operation)
        fail("CONNECTION_OPERATION_STALE", "The connection operation completion CAS was lost.");
      return { operation, priorSecretId: current.activeSecretVersionId };
    });
    if (updated.priorSecretId) {
      try {
        await options.vault.destroySecret({
          operationId: randomUuid(),
          siteId: input.connection.siteId,
          secretVersionId: updated.priorSecretId,
        });
      } catch {
        // A retiring credential remains non-active and is recoverable by its vault journal.
      }
    }
    return operationProjection(updated.operation);
  }

  async function rejectPendingSecret(
    operation: OperationRow,
    secret: SecretRow,
    code: string,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const failedAt = now();
    const db = resolveDb();
    const projection = await db.transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const [connection] = await tx
        .select()
        .from(npAgentConnections)
        .where(
          and(
            eq(npAgentConnections.siteId, operation.siteId),
            eq(npAgentConnections.id, operation.connectionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!connection) fail("CONNECTION_NOT_FOUND", "The connection disappeared during probe.");
      await tx
        .update(npAgentConnectionSecretVersions)
        .set({ status: "revoked" })
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, secret.siteId),
            eq(npAgentConnectionSecretVersions.id, secret.id),
            eq(npAgentConnectionSecretVersions.status, "pending"),
          ),
        );
      if (!connection.activeSecretVersionId) {
        await tx
          .update(npAgentConnections)
          .set({ status: "error", lastErrorCode: code, updatedAt: failedAt })
          .where(
            and(
              eq(npAgentConnections.siteId, connection.siteId),
              eq(npAgentConnections.id, connection.id),
              eq(npAgentConnections.status, connection.status),
            ),
          );
      }
      const safeResult: NpAgentJsonObject = { status: "failed", safeCode: code };
      const [updated] = await tx
        .update(npAgentConnectionOperations)
        .set({
          state: "failed",
          resultRedacted: safeResult,
          resultDigest: npCreateAgentProviderResultDigestV1(
            "connection-operation-rejected",
            safeResult,
          ),
          lastErrorCode: code,
          leaseUntil: null,
          finishedAt: failedAt,
        })
        .where(
          and(
            eq(npAgentConnectionOperations.siteId, operation.siteId),
            eq(npAgentConnectionOperations.id, operation.id),
            eq(npAgentConnectionOperations.state, "running"),
          ),
        )
        .returning();
      if (!updated) fail("CONNECTION_OPERATION_STALE", "The rejected operation CAS was lost.");
      return operationProjection(updated);
    });
    try {
      await options.vault.destroySecret({
        operationId: randomUuid(),
        siteId: secret.siteId,
        secretVersionId: secret.id,
      });
    } catch {
      // The revoked secret remains server-only and cleanup can reconcile its durable locator.
    }
    return projection;
  }

  async function processActivateSecret(
    operation: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const { connection, config } = await loadConnectionConfig(
      resolveDb(),
      operation.siteId,
      operation.connectionId,
      operation.configSnapshotId,
    );
    const secretId = operation.inputSecretVersionIds[0];
    if (!secretId) {
      if (!connection.activeSecretVersionId) {
        await markConnectionAuthorizationError(connection, "CONNECTION_SECRET_MISSING");
      }
      return finishOperationFailure(operation, "CONNECTION_SECRET_MISSING");
    }
    const [secret] = await resolveDb()
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(
        and(
          eq(npAgentConnectionSecretVersions.siteId, operation.siteId),
          eq(npAgentConnectionSecretVersions.id, secretId),
        ),
      )
      .limit(1);
    if (!secret || secret.status !== "pending" || !secret.secretRef) {
      if (!connection.activeSecretVersionId) {
        await markConnectionAuthorizationError(connection, "CONNECTION_SECRET_UNAVAILABLE");
      }
      return finishOperationFailure(operation, "CONNECTION_SECRET_UNAVAILABLE");
    }
    let probe: NpAgentProviderProbeResultV1 | null = null;
    try {
      const result = await probeSecret({ connection, config, secret });
      probe = result.probe;
      if (probe.status !== "ready") return rejectPendingSecret(operation, secret, probe.safeCode);
      return await activateProbedSecret({
        operation,
        connection,
        config,
        secret,
        adapter: result.adapter,
        parsed: result.parsed,
        probe,
        expectedAccountSubjectDigest: connection.activeSecretVersionId
          ? connection.activeAccountSubjectDigest
          : null,
      });
    } catch (error) {
      return rejectPendingSecret(operation, secret, providerSafeCode(error));
    } finally {
      if (probe) npZeroAgentProviderProbeResultV1(probe);
    }
  }

  async function finishProbeFailure(input: {
    operation: OperationRow;
    connection: ConnectionRow;
    secret: SecretRow;
    codeValue: string;
    result?: NpAgentJsonObject;
  }): Promise<NpAgentConnectionOperationProjectionV1> {
    const code = SAFE_CODE_PATTERN.test(input.codeValue)
      ? input.codeValue
      : "PROVIDER_OPERATION_FAILED";
    const failedAt = now();
    const safeResult = input.result ?? { status: "failed", safeCode: code };
    const [updated] = await resolveDb().transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      if (input.connection.status !== "disabled") {
        const connections = await tx
          .update(npAgentConnections)
          .set({ status: "error", lastErrorCode: code, updatedAt: failedAt })
          .where(
            and(
              eq(npAgentConnections.siteId, input.connection.siteId),
              eq(npAgentConnections.id, input.connection.id),
              eq(npAgentConnections.configVersion, input.operation.expectedConfigVersion),
              eq(npAgentConnections.configHash, input.operation.expectedConfigHash),
              eq(npAgentConnections.activeSecretVersionId, input.secret.id),
            ),
          )
          .returning({ id: npAgentConnections.id });
        if (connections.length !== 1) {
          fail("CONNECTION_OPERATION_STALE", "The connection changed before probe failure.");
        }
      }
      return tx
        .update(npAgentConnectionOperations)
        .set({
          state: "failed",
          resultRedacted: safeResult,
          resultDigest: npCreateAgentProviderResultDigestV1(
            "connection-operation-failed",
            safeResult,
          ),
          lastErrorCode: code,
          leaseUntil: null,
          finishedAt: failedAt,
        })
        .where(
          and(
            eq(npAgentConnectionOperations.siteId, input.operation.siteId),
            eq(npAgentConnectionOperations.id, input.operation.id),
            eq(npAgentConnectionOperations.state, "running"),
            eq(npAgentConnectionOperations.attempt, input.operation.attempt),
          ),
        )
        .returning();
    });
    if (!updated) fail("CONNECTION_OPERATION_STALE", "The probe failure CAS was lost.");
    return operationProjection(updated);
  }

  async function processProbe(
    operation: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const { connection, config } = await loadConnectionConfig(
      resolveDb(),
      operation.siteId,
      operation.connectionId,
      operation.configSnapshotId,
    );
    if (!connection.activeSecretVersionId)
      return finishOperationFailure(operation, "CONNECTION_SECRET_UNAVAILABLE");
    const [secret] = await resolveDb()
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, connection.activeSecretVersionId))
      .limit(1);
    if (!secret) return finishOperationFailure(operation, "CONNECTION_SECRET_UNAVAILABLE");
    let probe: NpAgentProviderProbeResultV1 | null = null;
    try {
      const result = await probeSecret({ connection, config, secret });
      probe = result.probe;
      if (probe.status !== "ready") {
        return finishProbeFailure({
          operation,
          connection,
          secret,
          codeValue: probe.safeCode,
          result: { status: probe.status, safeCode: probe.safeCode },
        });
      }
      const account = npProjectAgentAccountSubjectV1(
        {
          siteId: connection.siteId,
          adapterId: result.adapter.id,
          providerSubject: probe.providerSubject,
        },
        accountSubjectProjectionKey(connection.activeAccountSubjectKeyId),
      );
      if (account.digest !== connection.activeAccountSubjectDigest) {
        return finishProbeFailure({
          operation,
          connection,
          secret,
          codeValue: "PROVIDER_ACCOUNT_SUBJECT_MISMATCH",
        });
      }
      const destination = await npProjectAgentConnectionDestinationV1({
        adapter: result.adapter,
        siteId: connection.siteId,
        connectionKind: connection.kind as NpAgentConnectionKind,
        parsedConfig: result.parsed,
        accountSubjectKeyId: account.keyId,
        accountSubjectDigest: account.digest,
        destinationKey: destinationProjectionKey(connection.activeDestinationKeyId),
      });
      if (
        connection.kind === "notification" &&
        (destination.keyId !== connection.activeDestinationKeyId ||
          destination.fingerprint !== connection.activeDestinationFingerprint ||
          !jsonEqual(destination.descriptor, connection.activeDestinationDescriptor))
      ) {
        return rejectConfigCandidate({
          operation,
          config,
          codeValue: "PROVIDER_DESTINATION_MISMATCH",
        });
      }
      if (
        destination.fingerprint !== connection.activeDestinationFingerprint ||
        !jsonEqual(destination.descriptor, connection.activeDestinationDescriptor)
      ) {
        return finishProbeFailure({
          operation,
          connection,
          secret,
          codeValue: "PROVIDER_DESTINATION_MISMATCH",
        });
      }
      const finishedAt = now();
      const safeResult: NpAgentJsonObject = {
        status: "ready",
        safeCode: null,
        capabilityIds: probe.capabilityIds,
        grantedPermissions: probe.grantedPermissions,
      };
      const [updated] = await resolveDb().transaction(async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        const connections = await tx
          .update(npAgentConnections)
          .set({
            status: "ready",
            lastVerifiedAt: finishedAt,
            lastVerifiedConfigVersion: connection.configVersion,
            lastVerifiedCredentialVersion: connection.credentialVersion,
            lastProbeResultDigest: hostProbeDigest(probe!, account),
            lastErrorCode: null,
            updatedAt: finishedAt,
          })
          .where(
            and(
              eq(npAgentConnections.siteId, connection.siteId),
              eq(npAgentConnections.id, connection.id),
              eq(npAgentConnections.configVersion, operation.expectedConfigVersion),
              eq(npAgentConnections.configHash, operation.expectedConfigHash),
              eq(npAgentConnections.activeSecretVersionId, secret.id),
              eq(npAgentConnections.credentialVersion, operation.expectedCredentialVersion!),
            ),
          )
          .returning({ id: npAgentConnections.id });
        if (connections.length !== 1) {
          fail("CONNECTION_OPERATION_STALE", "The connection changed before probe completion.");
        }
        return tx
          .update(npAgentConnectionOperations)
          .set({
            state: "succeeded",
            resultRedacted: safeResult,
            resultDigest: npCreateAgentProviderResultDigestV1("connection-probe-ready", safeResult),
            lastErrorCode: null,
            leaseUntil: null,
            finishedAt,
          })
          .where(
            and(
              eq(npAgentConnectionOperations.siteId, operation.siteId),
              eq(npAgentConnectionOperations.id, operation.id),
              eq(npAgentConnectionOperations.state, "running"),
              eq(npAgentConnectionOperations.attempt, operation.attempt),
            ),
          )
          .returning();
      });
      if (!updated) fail("CONNECTION_OPERATION_STALE", "The probe completion CAS was lost.");
      return operationProjection(updated);
    } catch (error) {
      return finishProbeFailure({
        operation,
        connection,
        secret,
        codeValue: providerSafeCode(error),
      });
    } finally {
      if (probe) npZeroAgentProviderProbeResultV1(probe);
    }
  }

  async function destroyTemporary(
    siteId: string,
    secretVersionIds: readonly string[],
  ): Promise<void> {
    for (const secretVersionId of secretVersionIds) {
      try {
        await options.vault.destroySecret({ operationId: randomUuid(), siteId, secretVersionId });
      } catch {
        // Each destroy has its own durable Vault journal; cleanup can resume it safely.
      }
    }
  }

  async function revokePendingOAuthRequests(
    db: NpAgentDb,
    siteId: string,
    connectionId: string,
    code: string,
  ): Promise<string[]> {
    const revoked = await db
      .update(npAgentConnectionAuthRequests)
      .set({ status: "revoked", lastErrorCode: code })
      .where(
        and(
          eq(npAgentConnectionAuthRequests.siteId, siteId),
          eq(npAgentConnectionAuthRequests.connectionId, connectionId),
          eq(npAgentConnectionAuthRequests.status, "pending"),
        ),
      )
      .returning({ pkceSecretVersionId: npAgentConnectionAuthRequests.pkceSecretVersionId });
    return revoked.map((request) => request.pkceSecretVersionId);
  }

  async function destroyAbandonedOperationSecrets(
    siteId: string,
    secretVersionIds: readonly string[],
  ): Promise<void> {
    for (const secretVersionId of secretVersionIds) {
      try {
        let [secret] = await resolveDb()
          .select()
          .from(npAgentConnectionSecretVersions)
          .where(
            and(
              eq(npAgentConnectionSecretVersions.siteId, siteId),
              eq(npAgentConnectionSecretVersions.id, secretVersionId),
            ),
          )
          .limit(1);
        if (!secret || ["active", "retiring", "destroyed"].includes(secret.status)) continue;
        if (!secret.secretRef) {
          await options.vault.reconcileOperation({
            siteId,
            operationId: secret.sealOperationId,
          });
          [secret] = await resolveDb()
            .select()
            .from(npAgentConnectionSecretVersions)
            .where(
              and(
                eq(npAgentConnectionSecretVersions.siteId, siteId),
                eq(npAgentConnectionSecretVersions.id, secretVersionId),
              ),
            )
            .limit(1);
        }
        if (
          !secret ||
          !secret.secretRef ||
          ["active", "retiring", "destroyed"].includes(secret.status)
        ) {
          continue;
        }
        if (secret.purpose === "connection-credential" && secret.status !== "revoked") {
          await options.vault.revokeSecret({ siteId, secretVersionId });
        }
        await options.vault.destroySecret({
          operationId: randomUuid(),
          siteId,
          secretVersionId,
        });
      } catch {
        // Active credentials are never selected; Vault inspection and later cleanup remain authoritative.
      }
    }
  }

  async function processOAuthExchange(
    operation: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const [authRequest] = await resolveDb()
      .select()
      .from(npAgentConnectionAuthRequests)
      .where(
        and(
          eq(npAgentConnectionAuthRequests.siteId, operation.siteId),
          eq(npAgentConnectionAuthRequests.id, operation.authRequestId ?? ""),
        ),
      )
      .limit(1);
    const { connection, config } = await loadConnectionConfig(
      resolveDb(),
      operation.siteId,
      operation.connectionId,
      operation.configSnapshotId,
    );
    if (!authRequest || authRequest.status !== "consumed" || !authRequest.codeSecretVersionId) {
      return finishOperationFailure(operation, "OAUTH_REQUEST_INVALID");
    }
    let codeLease: NpProviderOAuthCodeLeaseV1 | null = null;
    let pkceLease: NpProviderOAuthPkceLeaseV1 | null = null;
    let authResult: NpAgentProviderAuthOperationResultV1 | null = null;
    try {
      const { adapter, parsed } = await parseStoredConfig(connection, config);
      if (!adapter.oauth) return finishOperationFailure(operation, "OAUTH_UNSUPPORTED");
      const oauthClientConfigDigest = await resolveOAuthClientConfigDigest(
        operation.siteId,
        adapter.id,
      );
      if (oauthClientConfigDigest !== authRequest.oauthClientConfigDigest) {
        if (!connection.activeSecretVersionId) {
          await markConnectionAuthorizationError(connection, "OAUTH_CLIENT_CONFIG_CHANGED");
        }
        return finishOperationFailure(operation, "OAUTH_CLIENT_CONFIG_CHANGED");
      }
      codeLease = await options.vault.leaseProviderOAuthCode({
        siteId: operation.siteId,
        secretVersionId: authRequest.codeSecretVersionId,
      });
      pkceLease = await options.vault.leaseProviderOAuthPkce({
        siteId: operation.siteId,
        secretVersionId: authRequest.pkceSecretVersionId,
      });
      const raw = await callProvider(
        (signal) =>
          adapter.oauth!.exchangeAuthorizationCode(
            {
              schemaVersion: "np.agent-provider-oauth-exchange.v1",
              connection: structuredClone(parsed),
              redirectUri: authRequest.redirectUri,
              requestedPermissions: authRequest.requestedPermissions,
              expectedConfigVersion: operation.expectedConfigVersion,
              expectedConfigHash: operation.expectedConfigHash,
            },
            { codeLease: codeLease!, pkceLease: pkceLease!, signal },
          ),
        (late) => {
          try {
            npZeroAgentProviderAuthResultV1(late);
          } catch {
            // Hostile late secret output is discarded.
          }
        },
      );
      try {
        authResult = npRequireAgentProviderAuthOperationResultV1(raw, adapter, "exchange");
      } finally {
        try {
          npZeroAgentProviderAuthResultV1(raw);
        } catch {
          // Hostile raw result shapes are discarded without logging.
        }
      }
      if (authResult.status === "failed") {
        if (!connection.activeSecretVersionId) {
          await markConnectionAuthorizationError(connection, authResult.safeCode);
        }
        return finishOperationFailure(
          operation,
          authResult.safeCode,
          authResult.retryable ? "ambiguous" : "failed",
        );
      }
      if (!jsonEqual(authResult.credential.grantedPermissions, authRequest.requestedPermissions)) {
        if (!connection.activeSecretVersionId) {
          await markConnectionAuthorizationError(connection, "OAUTH_PERMISSION_MISMATCH");
        }
        return finishOperationFailure(operation, "OAUTH_PERMISSION_MISMATCH");
      }
      const envelope = npBuildAgentOAuthCredentialEnvelopeV1({
        adapter,
        credential: authResult.credential,
      });
      const [latestSecret] = await resolveDb()
        .select({ version: npAgentConnectionSecretVersions.version })
        .from(npAgentConnectionSecretVersions)
        .where(
          and(
            eq(npAgentConnectionSecretVersions.siteId, operation.siteId),
            eq(npAgentConnectionSecretVersions.connectionId, operation.connectionId),
            eq(npAgentConnectionSecretVersions.purpose, "connection-credential"),
          ),
        )
        .orderBy(desc(npAgentConnectionSecretVersions.version))
        .limit(1);
      const secretVersionId = randomUuid();
      let seal: NpAgentVaultOperationProjectionV1;
      try {
        seal = await options.vault.sealSecret({
          operationId: randomUuid(),
          secretVersionId,
          siteId: operation.siteId,
          connectionId: operation.connectionId,
          connectionKind: connection.kind as NpAgentConnectionKind,
          purpose: "connection-credential",
          version: (latestSecret?.version ?? 0) + 1,
          envelope,
          oauthRefreshGeneration: 1,
          onJournaled: ({ db }) => attachProducedSecret(operation, secretVersionId, db),
        });
      } finally {
        zeroCredentialEnvelope(envelope);
      }
      if (seal.state !== "succeeded") {
        if (!connection.activeSecretVersionId) {
          await markConnectionAuthorizationError(connection, "OAUTH_CREDENTIAL_SEAL_AMBIGUOUS");
        }
        return finishOperationFailure(operation, "OAUTH_CREDENTIAL_SEAL_AMBIGUOUS", "ambiguous");
      }
      const [secret] = await resolveDb()
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(eq(npAgentConnectionSecretVersions.id, secretVersionId))
        .limit(1);
      if (!secret) return finishOperationFailure(operation, "CONNECTION_SECRET_UNAVAILABLE");
      let probe: NpAgentProviderProbeResultV1 | null = null;
      try {
        const probed = await probeSecret({ connection, config, secret });
        probe = probed.probe;
        if (probe.status !== "ready") return rejectPendingSecret(operation, secret, probe.safeCode);
        if (!jsonEqual(probe.grantedPermissions, authResult.credential.grantedPermissions)) {
          return rejectPendingSecret(operation, secret, "OAUTH_PERMISSION_MISMATCH");
        }
        const exchangedAccountSubjectDigest = authResult.credential.providerSubject
          ? npProjectAgentAccountSubjectV1(
              {
                siteId: operation.siteId,
                adapterId: adapter.id,
                providerSubject: authResult.credential.providerSubject,
              },
              accountSubjectProjectionKey(connection.activeAccountSubjectKeyId),
            ).digest
          : null;
        if (
          authRequest.mode === "replace" &&
          exchangedAccountSubjectDigest !== null &&
          exchangedAccountSubjectDigest !== authRequest.expectedAccountSubjectDigest
        ) {
          return rejectPendingSecret(operation, secret, "PROVIDER_ACCOUNT_SUBJECT_MISMATCH");
        }
        return await activateProbedSecret({
          operation,
          connection,
          config,
          secret,
          adapter: probed.adapter,
          parsed: probed.parsed,
          probe,
          expectedAccountSubjectDigest:
            authRequest.mode === "replace"
              ? authRequest.expectedAccountSubjectDigest
              : exchangedAccountSubjectDigest,
        });
      } finally {
        if (probe) npZeroAgentProviderProbeResultV1(probe);
      }
    } catch (error) {
      const code = providerSafeCode(error);
      if (!connection.activeSecretVersionId) {
        await markConnectionAuthorizationError(connection, code);
      }
      return finishOperationFailure(operation, code, "ambiguous");
    } finally {
      codeLease?.dispose();
      pkceLease?.dispose();
      if (authResult) npZeroAgentProviderAuthResultV1(authResult);
      await destroyTemporary(operation.siteId, [
        authRequest.codeSecretVersionId,
        authRequest.pkceSecretVersionId,
      ]);
    }
  }

  async function processOperationRow(
    operationValue: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    if (TERMINAL_OPERATION_STATES.has(operationValue.state))
      return operationProjection(operationValue);
    if (operationValue.state === "awaiting_secret") return operationProjection(operationValue);
    if (operationValue.state === "running") return operationProjection(operationValue);
    const operation = await claimOperation(operationValue);
    if (operation.state !== "running") return operationProjection(operation);
    try {
      switch (operation.kind) {
        case "activate-secret":
          return await processActivateSecret(operation);
        case "probe":
          return await processProbe(operation);
        case "oauth-exchange":
          return await processOAuthExchange(operation);
        case "activate-config":
          return await processActivateConfig(operation);
        case "oauth-refresh":
          return await processOAuthRefresh(operation);
        case "destroy-secret":
          return await processDestroySecret(operation);
        default:
          return await finishOperationFailure(operation, "CONNECTION_OPERATION_KIND_INVALID");
      }
    } catch (error) {
      const current = await getOperation(operation.siteId, operation.id);
      if (TERMINAL_OPERATION_STATES.has(current.state)) return operationProjection(current);
      const code = providerSafeCode(error);
      if (operation.kind === "oauth-refresh" || operation.kind === "oauth-exchange") {
        try {
          const { connection } = await loadConnectionConfig(
            resolveDb(),
            operation.siteId,
            operation.connectionId,
            operation.configSnapshotId,
          );
          if (operation.kind === "oauth-refresh" || !connection.activeSecretVersionId) {
            await markConnectionAuthorizationError(connection, code);
          }
        } catch {
          // The operation still terminalizes even when its parent cannot be projected.
        }
      }
      return finishOperationFailure(
        current,
        code,
        operation.kind === "oauth-refresh" || operation.kind === "oauth-exchange"
          ? "ambiguous"
          : "failed",
      );
    }
  }

  async function rejectConfigCandidate(input: {
    operation: OperationRow;
    config: ConfigRow;
    codeValue: string;
    result?: NpAgentJsonObject;
  }): Promise<NpAgentConnectionOperationProjectionV1> {
    const code = SAFE_CODE_PATTERN.test(input.codeValue)
      ? input.codeValue
      : "PROVIDER_OPERATION_FAILED";
    const rejectedAt = now();
    const safeResult = input.result ?? { status: "failed", safeCode: code };
    const [updated] = await resolveDb().transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const configs = await tx
        .update(npAgentConnectionConfigVersions)
        .set({ state: "rejected", rejectedAt })
        .where(
          and(
            eq(npAgentConnectionConfigVersions.siteId, input.operation.siteId),
            eq(npAgentConnectionConfigVersions.id, input.config.id),
            eq(npAgentConnectionConfigVersions.state, "candidate"),
          ),
        )
        .returning({ id: npAgentConnectionConfigVersions.id });
      if (configs.length !== 1) {
        fail("CONNECTION_OPERATION_STALE", "The candidate config rejection CAS was lost.");
      }
      return tx
        .update(npAgentConnectionOperations)
        .set({
          state: "failed",
          resultRedacted: safeResult,
          resultDigest: npCreateAgentProviderResultDigestV1(
            "connection-config-rejected",
            safeResult,
          ),
          lastErrorCode: code,
          leaseUntil: null,
          finishedAt: rejectedAt,
        })
        .where(
          and(
            eq(npAgentConnectionOperations.siteId, input.operation.siteId),
            eq(npAgentConnectionOperations.id, input.operation.id),
            eq(npAgentConnectionOperations.state, "running"),
            eq(npAgentConnectionOperations.attempt, input.operation.attempt),
          ),
        )
        .returning();
    });
    if (!updated) fail("CONNECTION_OPERATION_STALE", "The config rejection CAS was lost.");
    return operationProjection(updated);
  }

  async function processActivateConfig(
    operation: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const { connection, config } = await loadConnectionConfig(
      resolveDb(),
      operation.siteId,
      operation.connectionId,
      operation.configSnapshotId,
    );
    if (config.state !== "candidate" || !connection.activeSecretVersionId) {
      return finishOperationFailure(operation, "CONNECTION_CONFIG_CANDIDATE_INVALID");
    }
    const [secret] = await resolveDb()
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, connection.activeSecretVersionId))
      .limit(1);
    if (!secret) {
      return rejectConfigCandidate({
        operation,
        config,
        codeValue: "CONNECTION_SECRET_UNAVAILABLE",
      });
    }
    let probe: NpAgentProviderProbeResultV1 | null = null;
    try {
      const result = await probeSecret({ connection, config, secret });
      probe = result.probe;
      if (probe.status !== "ready") {
        return rejectConfigCandidate({
          operation,
          config,
          codeValue: probe.safeCode,
          result: { status: probe.status, safeCode: probe.safeCode },
        });
      }
      const account = npProjectAgentAccountSubjectV1(
        {
          siteId: connection.siteId,
          adapterId: result.adapter.id,
          providerSubject: probe.providerSubject,
        },
        accountSubjectProjectionKey(connection.activeAccountSubjectKeyId),
      );
      if (account.digest !== connection.activeAccountSubjectDigest) {
        return rejectConfigCandidate({
          operation,
          config,
          codeValue: "PROVIDER_ACCOUNT_SUBJECT_MISMATCH",
        });
      }
      const destination = await npProjectAgentConnectionDestinationV1({
        adapter: result.adapter,
        siteId: connection.siteId,
        connectionKind: connection.kind as NpAgentConnectionKind,
        parsedConfig: result.parsed,
        accountSubjectKeyId: account.keyId,
        accountSubjectDigest: account.digest,
        destinationKey: destinationProjectionKey(connection.activeDestinationKeyId),
      });
      const finishedAt = now();
      const safeResult: NpAgentJsonObject = {
        status: "ready",
        safeCode: null,
        capabilityIds: probe.capabilityIds,
        grantedPermissions: probe.grantedPermissions,
      };
      const [completed] = await resolveDb().transaction(async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        await tx
          .update(npAgentConnectionConfigVersions)
          .set({ state: "retired", retiredAt: finishedAt })
          .where(
            and(
              eq(npAgentConnectionConfigVersions.id, connection.activeConfigSnapshotId),
              eq(npAgentConnectionConfigVersions.state, "active"),
            ),
          );
        const activated = await tx
          .update(npAgentConnectionConfigVersions)
          .set({ state: "active", activatedAt: finishedAt })
          .where(
            and(
              eq(npAgentConnectionConfigVersions.id, config.id),
              eq(npAgentConnectionConfigVersions.state, "candidate"),
            ),
          )
          .returning({ id: npAgentConnectionConfigVersions.id });
        if (activated.length !== 1)
          fail("CONNECTION_OPERATION_STALE", "The candidate config activation CAS was lost.");
        const connections = await tx
          .update(npAgentConnections)
          .set({
            activeConfigSnapshotId: config.id,
            config: config.config,
            configVersion: config.version,
            configHash: config.configHash,
            pricingCatalogFingerprint: config.pricingCatalogFingerprint,
            dataProcessingCeiling: config.dataProcessingCeiling,
            activeDestinationKeyId: destination.descriptor ? destination.keyId : null,
            activeDestinationDescriptor:
              (destination.descriptor as unknown as Record<string, unknown> | null) ?? null,
            activeDestinationFingerprint: destination.fingerprint,
            status: connection.status === "disabled" ? "disabled" : "ready",
            lastVerifiedAt: finishedAt,
            lastVerifiedConfigVersion: config.version,
            lastVerifiedCredentialVersion: connection.credentialVersion,
            lastProbeResultDigest: hostProbeDigest(probe!, account),
            lastErrorCode: null,
            updatedAt: finishedAt,
          })
          .where(
            and(
              eq(npAgentConnections.siteId, connection.siteId),
              eq(npAgentConnections.id, connection.id),
              eq(npAgentConnections.configVersion, operation.expectedConfigVersion),
              eq(npAgentConnections.configHash, operation.expectedConfigHash),
            ),
          )
          .returning({ id: npAgentConnections.id });
        if (connections.length !== 1)
          fail("CONNECTION_OPERATION_STALE", "The candidate connection CAS was lost.");
        return tx
          .update(npAgentConnectionOperations)
          .set({
            state: "succeeded",
            resultRedacted: safeResult,
            resultDigest: npCreateAgentProviderResultDigestV1(
              "connection-config-ready",
              safeResult,
            ),
            lastErrorCode: null,
            leaseUntil: null,
            finishedAt,
          })
          .where(
            and(
              eq(npAgentConnectionOperations.id, operation.id),
              eq(npAgentConnectionOperations.state, "running"),
            ),
          )
          .returning();
      });
      if (!completed)
        fail("CONNECTION_OPERATION_STALE", "The config operation completion CAS was lost.");
      return operationProjection(completed);
    } catch (error) {
      return rejectConfigCandidate({
        operation,
        config,
        codeValue: providerSafeCode(error),
      });
    } finally {
      if (probe) npZeroAgentProviderProbeResultV1(probe);
    }
  }

  async function processOAuthRefresh(
    operation: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const { connection, config } = await loadConnectionConfig(
      resolveDb(),
      operation.siteId,
      operation.connectionId,
      operation.configSnapshotId,
    );
    if (
      !operation.expectedSecretVersionId ||
      !operation.expectedRefreshGeneration ||
      !connection.activeSecretVersionId
    ) {
      return finishOperationFailure(operation, "OAUTH_REFRESH_PRECONDITION_INVALID");
    }
    const [secret] = await resolveDb()
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, operation.expectedSecretVersionId))
      .limit(1);
    if (!secret || secret.materialKind !== "oauth" || !secret.refreshTokenPresent)
      return finishOperationFailure(operation, "OAUTH_REFRESH_UNAVAILABLE");
    const { adapter, parsed } = await parseStoredConfig(connection, config);
    if (!adapter.oauth) return finishOperationFailure(operation, "OAUTH_UNSUPPORTED");
    const retainedRefresh: {
      value: { token: Uint8Array; expiresAt: string | null } | null;
    } = { value: null };
    let requestedPermissions: string[] = [];
    const metadataLease = await options.vault.leaseProviderCredential({
      siteId: operation.siteId,
      secretVersionId: secret.id,
      use: "runtime",
    });
    try {
      await metadataLease.use((credential) => {
        if (credential.kind !== "oauth" || credential.refresh.mode !== "present")
          fail("OAUTH_REFRESH_UNAVAILABLE", "The OAuth refresh material is absent.");
        retainedRefresh.value = {
          token: new Uint8Array(credential.refresh.token),
          expiresAt: credential.refresh.expiresAt,
        };
        requestedPermissions = [...credential.grantedPermissions];
        return Promise.resolve();
      });
    } finally {
      metadataLease.dispose();
    }
    let credentialLease: NpProviderCredentialLeaseV1 | null = null;
    let authResult: NpAgentProviderAuthOperationResultV1 | null = null;
    try {
      credentialLease = await options.vault.leaseProviderCredential({
        siteId: operation.siteId,
        secretVersionId: secret.id,
        use: "runtime",
      });
      const raw = await callProvider(
        (signal) =>
          adapter.oauth!.refreshCredential(
            {
              schemaVersion: "np.agent-provider-oauth-refresh.v1",
              connection: structuredClone(parsed),
              requestedPermissions,
              expectedConfigVersion: operation.expectedConfigVersion,
              expectedConfigHash: operation.expectedConfigHash,
              expectedSecretVersionId: secret.id,
              expectedCredentialVersion: operation.expectedCredentialVersion!,
              expectedRefreshGeneration: operation.expectedRefreshGeneration!,
            },
            { credentialLease: credentialLease!, signal },
          ),
        (late) => {
          try {
            npZeroAgentProviderAuthResultV1(late);
          } catch {
            // Hostile late secret output is discarded.
          }
        },
      );
      try {
        authResult = npRequireAgentProviderAuthOperationResultV1(raw, adapter, "refresh");
      } finally {
        try {
          npZeroAgentProviderAuthResultV1(raw);
        } catch {
          // Hostile raw result shapes are discarded without logging.
        }
      }
      if (authResult.status === "failed") {
        await markConnectionAuthorizationError(connection, authResult.safeCode);
        return finishOperationFailure(operation, authResult.safeCode, "ambiguous");
      }
      if (!jsonEqual(authResult.credential.grantedPermissions, requestedPermissions)) {
        await markConnectionAuthorizationError(connection, "OAUTH_PERMISSION_MISMATCH");
        return finishOperationFailure(operation, "OAUTH_PERMISSION_MISMATCH");
      }
      const envelope = npBuildAgentOAuthCredentialEnvelopeV1({
        adapter,
        credential: authResult.credential,
        retainedRefresh: retainedRefresh.value,
      });
      const secretVersionId = randomUuid();
      let seal: NpAgentVaultOperationProjectionV1;
      try {
        seal = await options.vault.sealSecret({
          operationId: randomUuid(),
          secretVersionId,
          siteId: operation.siteId,
          connectionId: operation.connectionId,
          connectionKind: connection.kind as NpAgentConnectionKind,
          purpose: "connection-credential",
          version: secret.version + 1,
          envelope,
          oauthRefreshGeneration: operation.expectedRefreshGeneration + 1,
          onJournaled: ({ db }) => attachProducedSecret(operation, secretVersionId, db),
        });
      } finally {
        zeroCredentialEnvelope(envelope);
      }
      if (seal.state !== "succeeded") {
        await markConnectionAuthorizationError(connection, "OAUTH_CREDENTIAL_SEAL_AMBIGUOUS");
        return finishOperationFailure(operation, "OAUTH_CREDENTIAL_SEAL_AMBIGUOUS", "ambiguous");
      }
      const [newSecret] = await resolveDb()
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(eq(npAgentConnectionSecretVersions.id, secretVersionId))
        .limit(1);
      if (!newSecret) return finishOperationFailure(operation, "CONNECTION_SECRET_UNAVAILABLE");
      let probe: NpAgentProviderProbeResultV1 | null = null;
      try {
        const probed = await probeSecret({ connection, config, secret: newSecret });
        probe = probed.probe;
        if (probe.status !== "ready")
          return rejectPendingSecret(operation, newSecret, probe.safeCode);
        if (!jsonEqual(probe.grantedPermissions, authResult.credential.grantedPermissions)) {
          await markConnectionAuthorizationError(connection, "OAUTH_PERMISSION_MISMATCH");
          return rejectPendingSecret(operation, newSecret, "OAUTH_PERMISSION_MISMATCH");
        }
        return activateProbedSecret({
          operation,
          connection,
          config,
          secret: newSecret,
          adapter: probed.adapter,
          parsed: probed.parsed,
          probe,
          expectedAccountSubjectDigest: connection.activeAccountSubjectDigest,
        });
      } finally {
        if (probe) npZeroAgentProviderProbeResultV1(probe);
      }
    } catch (error) {
      const code = providerSafeCode(error);
      await markConnectionAuthorizationError(connection, code);
      return finishOperationFailure(operation, code, "ambiguous");
    } finally {
      credentialLease?.dispose();
      retainedRefresh.value?.token.fill(0);
      if (authResult) npZeroAgentProviderAuthResultV1(authResult);
    }
  }

  async function processDestroySecret(
    operation: OperationRow,
  ): Promise<NpAgentConnectionOperationProjectionV1> {
    const secretId = operation.inputSecretVersionIds[0];
    if (!secretId) return finishOperationFailure(operation, "CONNECTION_SECRET_MISSING");
    try {
      await options.vault.revokeSecret({ siteId: operation.siteId, secretVersionId: secretId });
      const destroyed = await options.vault.destroySecret({
        operationId: randomUuid(),
        siteId: operation.siteId,
        secretVersionId: secretId,
      });
      if (destroyed.state !== "succeeded")
        return finishOperationFailure(operation, "VAULT_DESTROY_AMBIGUOUS", "ambiguous");
      const safeResult: NpAgentJsonObject = { status: "destroyed", safeCode: null };
      const [updated] = await resolveDb()
        .update(npAgentConnectionOperations)
        .set({
          state: "succeeded",
          resultRedacted: safeResult,
          resultDigest: npCreateAgentProviderResultDigestV1(
            "connection-secret-destroyed",
            safeResult,
          ),
          lastErrorCode: null,
          leaseUntil: null,
          finishedAt: now(),
        })
        .where(
          and(
            eq(npAgentConnectionOperations.id, operation.id),
            eq(npAgentConnectionOperations.state, "running"),
          ),
        )
        .returning();
      if (!updated)
        fail("CONNECTION_OPERATION_STALE", "The destroy operation completion CAS was lost.");
      return operationProjection(updated);
    } catch (error) {
      return finishOperationFailure(operation, providerSafeCode(error));
    }
  }

  async function admitOperation(input: {
    db?: NpAgentDb;
    admittedAt?: Date;
    siteId: string;
    connection: ConnectionRow;
    config: ConfigRow;
    source: "admin-invocation" | "runtime-refresh";
    invocationId?: string;
    runId?: string;
    kind: Exclude<NpAgentConnectionOperationKind, "oauth-exchange">;
    inputSecretVersionIds: string[];
    expectedSecretVersionId: string | null;
    expectedCredentialVersion: number | null;
    expectedRefreshGeneration: number | null;
    idempotencyKey: string;
    createdByUserId?: string | null;
  }): Promise<OperationRow> {
    const db = input.db ?? resolveDb();
    const [existing] = await db
      .select()
      .from(npAgentConnectionOperations)
      .where(
        and(
          eq(npAgentConnectionOperations.siteId, input.siteId),
          eq(npAgentConnectionOperations.connectionId, input.connection.id),
          eq(npAgentConnectionOperations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      const sameAuthority =
        input.source === "admin-invocation"
          ? existing.source === input.source && existing.invocationId === input.invocationId
          : existing.source === input.source;
      if (
        !sameAuthority ||
        existing.kind !== input.kind ||
        existing.expectedConfigVersion !== input.connection.configVersion ||
        existing.expectedConfigHash !== input.connection.configHash ||
        existing.configSnapshotId !== input.config.id ||
        existing.expectedSecretVersionId !== input.expectedSecretVersionId ||
        existing.expectedCredentialVersion !== input.expectedCredentialVersion ||
        existing.expectedRefreshGeneration !== input.expectedRefreshGeneration ||
        (input.source === "runtime-refresh" &&
          !jsonEqual(existing.inputSecretVersionIds, input.inputSecretVersionIds))
      ) {
        fail("CONNECTION_IDEMPOTENCY_CONFLICT", "The connection operation key is already bound.");
      }
      return existing;
    }
    const operationId = randomUuid();
    const authority =
      input.source === "admin-invocation"
        ? {
            kind: "admin-invocation" as const,
            invocationId: requireUuid(input.invocationId, "agent.connection.invocationId"),
          }
        : {
            kind: "runtime-refresh" as const,
            runId: requireUuid(input.runId, "agent.connection.runId"),
          };
    const canonical: NpAgentConnectionOperationRequestCanonicalV1 = {
      schemaVersion: "np.agent-connection-operation.v1",
      siteId: input.siteId,
      operationId,
      connectionId: input.connection.id,
      authority,
      kind: input.kind,
      expectedConfigVersion: input.connection.configVersion,
      expectedConfigHash: input.connection.configHash,
      configSnapshotId: input.config.id,
      adapterContractVersion: input.config.adapterContractVersion,
      adapterFingerprint: input.config.adapterFingerprint,
      inputSecretVersionIds: input.inputSecretVersionIds,
      expectedSecretVersionId: input.expectedSecretVersionId,
      expectedCredentialVersion: input.expectedCredentialVersion,
      expectedRefreshGeneration: input.expectedRefreshGeneration,
      idempotencyKey: input.idempotencyKey,
    };
    const requestHash = await npDigestAgentConnectionOperationCanonical(canonical);
    const createdAt = input.admittedAt ?? now();
    const [created] = await db
      .insert(npAgentConnectionOperations)
      .values({
        id: operationId,
        siteId: input.siteId,
        connectionId: input.connection.id,
        source: input.source,
        invocationId: input.invocationId ?? null,
        runId: input.runId ?? null,
        kind: input.kind,
        state: "queued",
        expectedConfigVersion: input.connection.configVersion,
        expectedConfigHash: input.connection.configHash,
        configSnapshotId: input.config.id,
        adapterContractVersion: input.config.adapterContractVersion,
        adapterFingerprint: input.config.adapterFingerprint,
        inputSecretVersionIds: input.inputSecretVersionIds,
        expectedSecretVersionId: input.expectedSecretVersionId,
        expectedCredentialVersion: input.expectedCredentialVersion,
        expectedRefreshGeneration: input.expectedRefreshGeneration,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        attempt: 1,
        deadlineAt: new Date(createdAt.getTime() + 60 * 1_000),
        createdByUserId: input.createdByUserId ?? null,
        createdAt,
      })
      .returning();
    if (!created)
      fail("CONNECTION_PERSISTENCE_FAILED", "The connection operation was not persisted.");
    return created;
  }

  async function prepareApiKeyAdmission(
    input: NpAgentConnectionApiKeyInputV1,
    db: NpAgentDb,
    admittedAt: Date,
  ): Promise<{
    operation: OperationRow;
    afterCommit: () => Promise<NpAgentConnectionOperationProjectionV1>;
  }> {
    requireIdentity(input.siteId, input.connectionId);
    requireUuid(input.invocationId, "agent.connection.invocationId");
    requireUuid(input.vaultOperationId, "agent.connection.vaultOperationId");
    if (
      !(input.apiKey instanceof Uint8Array) ||
      input.apiKey.byteLength === 0 ||
      input.apiKey.byteLength > npAgentProviderAdapterLimitsV1.apiKeyBytes
    ) {
      fail("PROVIDER_API_KEY_INVALID", "The provider API key is invalid.");
    }
    if (!(admittedAt instanceof Date) || !Number.isFinite(admittedAt.getTime())) {
      fail("CONNECTION_TIME_INVALID", "The connection admission timestamp is invalid.");
    }
    const { connection, config } = await loadConnectionConfig(db, input.siteId, input.connectionId);
    if (connection.authKind !== "api_key" || connection.status === "revoked") {
      fail("CONNECTION_STATE_CONFLICT", "The connection cannot accept an API key.");
    }
    if (
      connection.configVersion !== input.expectedConfigVersion ||
      connection.configHash !== input.expectedConfigHash
    ) {
      fail("CONNECTION_VERSION_CONFLICT", "The connection changed before credential rotation.");
    }
    const requestedSecretVersionId = randomUuid();
    const operation = await admitOperation({
      db,
      admittedAt,
      siteId: input.siteId,
      connection,
      config,
      source: "admin-invocation",
      invocationId: input.invocationId,
      kind: "activate-secret",
      inputSecretVersionIds: [requestedSecretVersionId],
      expectedSecretVersionId: connection.activeSecretVersionId,
      expectedCredentialVersion: connection.credentialVersion,
      expectedRefreshGeneration: null,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByUserId,
    });
    const secretVersionId = operation.inputSecretVersionIds[0];
    if (!secretVersionId) {
      fail("CONNECTION_OPERATION_MISMATCH", "The API-key operation has no credential journal.");
    }
    let dispatched = false;
    return {
      operation,
      afterCommit: async () => {
        if (dispatched) {
          return operationProjection(await getOperation(input.siteId, operation.id));
        }
        dispatched = true;
        const apiKey = new Uint8Array(input.apiKey);
        try {
          const current = await getOperation(input.siteId, operation.id);
          if (current.state !== "queued") return operationProjection(current);
          const [sealedSecret] = await resolveDb()
            .select()
            .from(npAgentConnectionSecretVersions)
            .where(
              and(
                eq(npAgentConnectionSecretVersions.siteId, input.siteId),
                eq(npAgentConnectionSecretVersions.id, secretVersionId),
              ),
            )
            .limit(1);
          if (!sealedSecret) {
            const [latest] = await resolveDb()
              .select({ version: npAgentConnectionSecretVersions.version })
              .from(npAgentConnectionSecretVersions)
              .where(
                and(
                  eq(npAgentConnectionSecretVersions.siteId, input.siteId),
                  eq(npAgentConnectionSecretVersions.connectionId, input.connectionId),
                  eq(npAgentConnectionSecretVersions.purpose, "connection-credential"),
                ),
              )
              .orderBy(desc(npAgentConnectionSecretVersions.version))
              .limit(1);
            const adapter = options.providerRegistry.resolve({
              id: config.adapterId,
              contractVersion: config.adapterContractVersion,
              fingerprint: config.adapterFingerprint,
            });
            const seal = await options.vault.sealSecret({
              operationId: input.vaultOperationId,
              secretVersionId,
              siteId: input.siteId,
              connectionId: input.connectionId,
              connectionKind: connection.kind as NpAgentConnectionKind,
              purpose: "connection-credential",
              version: (latest?.version ?? 0) + 1,
              envelope: {
                schemaVersion: "np.agent-credential-envelope.v1",
                kind: "api_key",
                adapterId: adapter.id,
                adapterContractVersion: adapter.contractVersion,
                adapterFingerprint: adapter.fingerprint,
                secret: apiKey,
              },
            });
            if (seal.state !== "succeeded") {
              if (!connection.activeSecretVersionId) {
                await markConnectionAuthorizationError(connection, "CREDENTIAL_SEAL_AMBIGUOUS");
              }
              return finishOperationFailure(current, "CREDENTIAL_SEAL_AMBIGUOUS", "ambiguous");
            }
          }
          return operationProjection(await getOperation(input.siteId, operation.id));
        } finally {
          apiKey.fill(0);
        }
      },
    };
  }

  async function findAuthRequestByState(state: string) {
    if (!STATE_PATTERN.test(state))
      fail("OAUTH_STATE_INVALID", "The provider OAuth state is invalid.");
    const candidates = [
      stateDigest(state, stateKeyring.active),
      ...Object.entries(stateKeyring.previous ?? {}).map(([id, key]) =>
        stateDigest(state, { id, key }),
      ),
    ];
    const [request] = await resolveDb()
      .select()
      .from(npAgentConnectionAuthRequests)
      .where(inArray(npAgentConnectionAuthRequests.stateHash, candidates))
      .limit(1);
    if (
      !request ||
      !candidates.some((candidate) => {
        const expected = Buffer.from(candidate, "utf8");
        const actual = Buffer.from(request.stateHash, "utf8");
        return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
      })
    ) {
      fail("OAUTH_STATE_INVALID", "The provider OAuth state is invalid.");
    }
    return request;
  }

  async function getOperation(siteId: string, operationId: string): Promise<OperationRow> {
    requireIdentity(siteId);
    requireUuid(operationId, "agent.connection.operationId");
    const [operation] = await resolveDb()
      .select()
      .from(npAgentConnectionOperations)
      .where(
        and(
          eq(npAgentConnectionOperations.siteId, siteId),
          eq(npAgentConnectionOperations.id, operationId),
        ),
      )
      .limit(1);
    if (!operation)
      fail("CONNECTION_OPERATION_NOT_FOUND", "The connection operation was not found.");
    return operation;
  }

  async function nextSecretVersion(
    siteId: string,
    connectionId: string,
    purpose: "connection-credential" | "provider-oauth-pkce" | "provider-oauth-code",
  ): Promise<number> {
    const [latest] = await resolveDb()
      .select({ version: npAgentConnectionSecretVersions.version })
      .from(npAgentConnectionSecretVersions)
      .where(
        and(
          eq(npAgentConnectionSecretVersions.siteId, siteId),
          eq(npAgentConnectionSecretVersions.connectionId, connectionId),
          eq(npAgentConnectionSecretVersions.purpose, purpose),
        ),
      )
      .orderBy(desc(npAgentConnectionSecretVersions.version))
      .limit(1);
    return (latest?.version ?? 0) + 1;
  }

  return {
    async createConnection(input: NpAgentConnectionCreateInputV1): Promise<NpAgentConnectionV1> {
      const id = input.id ?? randomUuid();
      requireIdentity(input.siteId, id);
      if (
        typeof input.name !== "string" ||
        input.name.trim() !== input.name ||
        input.name.length < 1 ||
        input.name.length > 120
      )
        fail("CONNECTION_NAME_INVALID", "The connection name is invalid.");
      const adapter = options.providerRegistry.resolve({
        id: input.adapterId,
        contractVersion: input.adapterContractVersion,
        fingerprint: input.adapterFingerprint,
      });
      if (input.provider !== adapter.id) {
        fail(
          "PROVIDER_CONFIG_RESULT_MISMATCH",
          "The provider must equal its registered adapter id.",
        );
      }
      const createdAt = now();
      const parsed = await npParseAgentProviderConnectionConfigV1({
        adapter,
        siteId: input.siteId,
        connectionId: id,
        kind: input.kind,
        provider: input.provider,
        authKind: input.authKind,
        configVersion: 1,
        config: input.config,
        dataProcessingCeiling: input.dataProcessingCeiling,
        effectiveAt: createdAt,
      });
      const configId = randomUuid();
      await resolveDb().transaction(async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        await tx.insert(npAgentConnections).values({
          id,
          siteId: input.siteId,
          kind: input.kind,
          provider: input.provider,
          adapterContractVersion: adapter.contractVersion,
          name: input.name,
          authKind: input.authKind,
          activeConfigSnapshotId: configId,
          config: parsed.config,
          configVersion: 1,
          configHash: parsed.configHash,
          pricingCatalogFingerprint: parsed.pricingCatalogFingerprint,
          dataProcessingCeiling: input.dataProcessingCeiling,
          status: "pending",
          createdBy: input.createdBy ?? null,
          createdAt,
          updatedAt: createdAt,
        });
        await tx.insert(npAgentConnectionConfigVersions).values({
          id: configId,
          siteId: input.siteId,
          connectionId: id,
          version: 1,
          adapterId: adapter.id,
          adapterContractVersion: adapter.contractVersion,
          adapterFingerprint: adapter.fingerprint,
          config: parsed.config,
          configHash: parsed.configHash,
          pricingCatalog: parsed.pricingCatalog,
          pricingCatalogFingerprint: parsed.pricingCatalogFingerprint,
          dataProcessingCeiling: input.dataProcessingCeiling,
          state: "active",
          createdAt,
          activatedAt: createdAt,
        });
      });
      return this.getConnection({ siteId: input.siteId, connectionId: id });
    },

    async admitApiKey(
      input: NpAgentConnectionApiKeyAdmissionInputV1,
    ): Promise<NpAgentConnectionApiKeyAdmissionV1> {
      const admitted = await prepareApiKeyAdmission(input, input.db, input.admittedAt);
      return {
        operation: operationProjection(admitted.operation),
        afterCommit: admitted.afterCommit,
      };
    },

    async setApiKey(
      input: NpAgentConnectionApiKeyInputV1,
    ): Promise<NpAgentConnectionOperationProjectionV1> {
      const admitted = await prepareApiKeyAdmission(input, resolveDb(), now());
      return admitted.afterCommit();
    },

    async testConnection(input: {
      siteId: string;
      connectionId: string;
      invocationId: string;
      idempotencyKey: string;
      expectedConfigVersion: number;
      expectedConfigHash: string;
      createdByUserId?: string | null;
    }): Promise<NpAgentConnectionOperationProjectionV1> {
      const { connection, config } = await loadConnectionConfig(
        resolveDb(),
        input.siteId,
        input.connectionId,
      );
      if (
        connection.configVersion !== input.expectedConfigVersion ||
        connection.configHash !== input.expectedConfigHash
      )
        fail("CONNECTION_VERSION_CONFLICT", "The connection changed before test.");
      if (!connection.activeSecretVersionId || !ACTIVE_CREDENTIAL_STATES.has(connection.status))
        fail("CONNECTION_STATE_CONFLICT", "The connection has no retained credential to probe.");
      const operation = await admitOperation({
        ...input,
        connection,
        config,
        source: "admin-invocation",
        kind: "probe",
        inputSecretVersionIds: [connection.activeSecretVersionId],
        expectedSecretVersionId: connection.activeSecretVersionId,
        expectedCredentialVersion: connection.credentialVersion,
        expectedRefreshGeneration: null,
      });
      return operationProjection(operation);
    },

    async disableConnection(input: {
      siteId: string;
      connectionId: string;
      expectedConfigVersion: number;
    }): Promise<NpAgentConnectionV1> {
      const disabledAt = now();
      const oauthTemporarySecretIds: string[] = [];
      const [updated] = await resolveDb().transaction(async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        const connections = await tx
          .update(npAgentConnections)
          .set({ status: "disabled", updatedAt: disabledAt })
          .where(
            and(
              eq(npAgentConnections.siteId, input.siteId),
              eq(npAgentConnections.id, input.connectionId),
              eq(npAgentConnections.configVersion, input.expectedConfigVersion),
              eq(npAgentConnections.status, "ready"),
            ),
          )
          .returning();
        if (!connections[0]) return [];
        oauthTemporarySecretIds.push(
          ...(await revokePendingOAuthRequests(
            tx,
            input.siteId,
            input.connectionId,
            "CONNECTION_STATUS_CHANGED",
          )),
        );
        return connections;
      });
      if (!updated)
        fail("CONNECTION_VERSION_CONFLICT", "The ready connection changed before disable.");
      await destroyTemporary(input.siteId, oauthTemporarySecretIds);
      return this.getConnection(input);
    },

    async enableConnection(input: {
      siteId: string;
      connectionId: string;
      invocationId: string;
      idempotencyKey: string;
      expectedConfigVersion: number;
      expectedConfigHash: string;
      createdByUserId?: string | null;
    }): Promise<NpAgentConnectionOperationProjectionV1> {
      const { connection, config } = await loadConnectionConfig(
        resolveDb(),
        input.siteId,
        input.connectionId,
      );
      if (
        connection.status !== "disabled" ||
        connection.configVersion !== input.expectedConfigVersion ||
        connection.configHash !== input.expectedConfigHash ||
        !connection.activeSecretVersionId
      )
        fail("CONNECTION_VERSION_CONFLICT", "The disabled connection changed before enable.");
      const operation = await admitOperation({
        ...input,
        connection,
        config,
        source: "admin-invocation",
        kind: "probe",
        inputSecretVersionIds: [connection.activeSecretVersionId],
        expectedSecretVersionId: connection.activeSecretVersionId,
        expectedCredentialVersion: connection.credentialVersion,
        expectedRefreshGeneration: null,
      });
      return operationProjection(operation);
    },

    async updateConfig(input: {
      siteId: string;
      connectionId: string;
      invocationId: string;
      idempotencyKey: string;
      expectedConfigVersion: number;
      expectedConfigHash: string;
      config: NpAgentJsonObject;
      dataProcessingCeiling: NpAgentProviderDataClass;
      createdByUserId?: string | null;
    }): Promise<NpAgentConnectionOperationProjectionV1 | NpAgentConnectionV1> {
      const { connection, config: activeConfig } = await loadConnectionConfig(
        resolveDb(),
        input.siteId,
        input.connectionId,
      );
      if (
        connection.configVersion !== input.expectedConfigVersion ||
        connection.configHash !== input.expectedConfigHash ||
        connection.status === "revoked"
      )
        fail("CONNECTION_VERSION_CONFLICT", "The connection config changed.");
      const adapter = options.providerRegistry.resolve({
        id: activeConfig.adapterId,
        contractVersion: activeConfig.adapterContractVersion,
        fingerprint: activeConfig.adapterFingerprint,
      });
      const createdAt = now();
      const parsed = await npParseAgentProviderConnectionConfigV1({
        adapter,
        siteId: input.siteId,
        connectionId: input.connectionId,
        kind: connection.kind as NpAgentConnectionKind,
        provider: connection.provider,
        authKind: connection.authKind as "api_key" | "oauth",
        configVersion: connection.configVersion + 1,
        config: input.config,
        dataProcessingCeiling: input.dataProcessingCeiling,
        effectiveAt: createdAt,
      });
      const candidateId = randomUuid();
      const oauthTemporarySecretIds: string[] = [];
      const candidateValues = {
        id: candidateId,
        siteId: input.siteId,
        connectionId: input.connectionId,
        version: parsed.configVersion,
        adapterId: adapter.id,
        adapterContractVersion: adapter.contractVersion,
        adapterFingerprint: adapter.fingerprint,
        config: parsed.config,
        configHash: parsed.configHash,
        pricingCatalog: parsed.pricingCatalog,
        pricingCatalogFingerprint: parsed.pricingCatalogFingerprint,
        dataProcessingCeiling: input.dataProcessingCeiling,
        state: "candidate",
        createdAt,
        activatedAt: null,
      } as const;
      if (!connection.activeSecretVersionId) {
        await resolveDb().transaction(async (rawTx) => {
          const tx = rawTx as NpAgentDb;
          oauthTemporarySecretIds.push(
            ...(await revokePendingOAuthRequests(
              tx,
              input.siteId,
              input.connectionId,
              "CONNECTION_CONFIG_CHANGED",
            )),
          );
          await tx.insert(npAgentConnectionConfigVersions).values(candidateValues);
          const retired = await tx
            .update(npAgentConnectionConfigVersions)
            .set({ state: "retired", retiredAt: createdAt })
            .where(
              and(
                eq(npAgentConnectionConfigVersions.id, activeConfig.id),
                eq(npAgentConnectionConfigVersions.state, "active"),
              ),
            )
            .returning({ id: npAgentConnectionConfigVersions.id });
          if (retired.length !== 1) {
            fail("CONNECTION_OPERATION_STALE", "The active config retirement CAS was lost.");
          }
          const activated = await tx
            .update(npAgentConnectionConfigVersions)
            .set({ state: "active", activatedAt: createdAt })
            .where(
              and(
                eq(npAgentConnectionConfigVersions.id, candidateId),
                eq(npAgentConnectionConfigVersions.state, "candidate"),
              ),
            )
            .returning({ id: npAgentConnectionConfigVersions.id });
          if (activated.length !== 1) {
            fail("CONNECTION_OPERATION_STALE", "The direct config activation CAS was lost.");
          }
          const connections = await tx
            .update(npAgentConnections)
            .set({
              activeConfigSnapshotId: candidateId,
              config: parsed.config,
              configVersion: parsed.configVersion,
              configHash: parsed.configHash,
              pricingCatalogFingerprint: parsed.pricingCatalogFingerprint,
              dataProcessingCeiling: input.dataProcessingCeiling,
              status: "pending",
              lastErrorCode: null,
              updatedAt: createdAt,
            })
            .where(
              and(
                eq(npAgentConnections.siteId, connection.siteId),
                eq(npAgentConnections.id, connection.id),
                eq(npAgentConnections.configVersion, connection.configVersion),
                eq(npAgentConnections.configHash, connection.configHash),
              ),
            )
            .returning({ id: npAgentConnections.id });
          if (connections.length !== 1) {
            fail(
              "CONNECTION_OPERATION_STALE",
              "The credentialless config activation CAS was lost.",
            );
          }
        });
        await destroyTemporary(input.siteId, oauthTemporarySecretIds);
        return this.getConnection(input);
      }
      const candidate = {
        ...activeConfig,
        id: candidateId,
        version: parsed.configVersion,
        config: parsed.config,
        configHash: parsed.configHash,
        pricingCatalog: parsed.pricingCatalog,
        pricingCatalogFingerprint: parsed.pricingCatalogFingerprint,
        dataProcessingCeiling: input.dataProcessingCeiling,
        state: "candidate",
      } as ConfigRow;
      const operation = await resolveDb().transaction(async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        oauthTemporarySecretIds.push(
          ...(await revokePendingOAuthRequests(
            tx,
            input.siteId,
            input.connectionId,
            "CONNECTION_CONFIG_CHANGED",
          )),
        );
        await tx.insert(npAgentConnectionConfigVersions).values(candidateValues);
        return admitOperation({
          ...input,
          db: tx,
          admittedAt: createdAt,
          connection,
          config: candidate,
          source: "admin-invocation",
          kind: "activate-config",
          inputSecretVersionIds: [connection.activeSecretVersionId!],
          expectedSecretVersionId: connection.activeSecretVersionId,
          expectedCredentialVersion: connection.credentialVersion,
          expectedRefreshGeneration: null,
        });
      });
      await destroyTemporary(input.siteId, oauthTemporarySecretIds);
      return operationProjection(operation);
    },

    async startOAuth(
      input: NpAgentConnectionOAuthStartInputV1,
    ): Promise<{ authorizationUrl: string; expiresAt: string; resourceId: string }> {
      requireUuid(input.staffSessionId, "agent.connection.staffSessionId");
      if (!/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(input.oauthClientConfigDigest)) {
        fail("OAUTH_CLIENT_CONFIG_INVALID", "The provider OAuth client config digest is invalid.");
      }
      let redirect: URL;
      try {
        redirect = new URL(input.redirectUri);
      } catch {
        return fail("OAUTH_REDIRECT_INVALID", "The provider OAuth redirect URI is invalid.");
      }
      if (
        redirect.protocol !== "https:" ||
        redirect.username !== "" ||
        redirect.password !== "" ||
        redirect.hash !== "" ||
        redirect.toString() !== input.redirectUri
      ) {
        fail(
          "OAUTH_REDIRECT_INVALID",
          "The provider OAuth redirect URI must be one exact HTTPS URL.",
        );
      }
      const startedAt = now();
      const [session] = await resolveDb()
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(
          and(
            eq(npSessions.id, input.staffSessionId),
            gt(npSessions.accessExpiresAt, startedAt),
            gt(npSessions.refreshExpiresAt, startedAt),
          ),
        )
        .limit(1);
      if (!session)
        fail("OAUTH_STAFF_SESSION_INVALID", "The provider OAuth staff session is invalid.");
      const { connection, config } = await loadConnectionConfig(
        resolveDb(),
        input.siteId,
        input.connectionId,
      );
      if (connection.authKind !== "oauth" || connection.status === "revoked")
        fail("CONNECTION_STATE_CONFLICT", "The connection cannot start provider OAuth.");
      if (
        connection.configVersion !== input.expectedConfigVersion ||
        connection.configHash !== input.expectedConfigHash
      ) {
        fail("CONNECTION_VERSION_CONFLICT", "The connection changed before OAuth setup.");
      }
      const [pendingRequest] = await resolveDb()
        .select({
          id: npAgentConnectionAuthRequests.id,
          expiresAt: npAgentConnectionAuthRequests.expiresAt,
          pkceSecretVersionId: npAgentConnectionAuthRequests.pkceSecretVersionId,
        })
        .from(npAgentConnectionAuthRequests)
        .where(
          and(
            eq(npAgentConnectionAuthRequests.siteId, input.siteId),
            eq(npAgentConnectionAuthRequests.connectionId, input.connectionId),
            eq(npAgentConnectionAuthRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (pendingRequest) {
        if (pendingRequest.expiresAt > startedAt) {
          fail("OAUTH_REQUEST_PENDING", "The connection already has a pending OAuth request.");
        }
        await options.vault.destroySecret({
          operationId: randomUuid(),
          siteId: input.siteId,
          secretVersionId: pendingRequest.pkceSecretVersionId,
          onJournaled: async ({ db }) => {
            const expired = await db
              .update(npAgentConnectionAuthRequests)
              .set({ status: "expired", lastErrorCode: "OAUTH_REQUEST_EXPIRED" })
              .where(
                and(
                  eq(npAgentConnectionAuthRequests.id, pendingRequest.id),
                  eq(npAgentConnectionAuthRequests.status, "pending"),
                  lte(npAgentConnectionAuthRequests.expiresAt, startedAt),
                ),
              )
              .returning({ id: npAgentConnectionAuthRequests.id });
            if (expired.length !== 1) {
              fail("OAUTH_REQUEST_PENDING", "The connection OAuth request changed during expiry.");
            }
          },
        });
      }
      const { adapter, parsed } = await parseStoredConfig(connection, config);
      if (!adapter.oauth) fail("OAUTH_UNSUPPORTED", "The provider adapter has no OAuth contract.");
      const oauthClientConfigDigest = await resolveOAuthClientConfigDigest(
        input.siteId,
        adapter.id,
      );
      if (oauthClientConfigDigest !== input.oauthClientConfigDigest) {
        fail("OAUTH_CLIENT_CONFIG_CHANGED", "The provider OAuth client configuration changed.");
      }
      const mode = input.mode ?? (connection.activeSecretVersionId ? "replace" : "initial");
      if (
        (mode === "initial" &&
          (connection.activeSecretVersionId !== null ||
            connection.credentialVersion !== null ||
            !["pending", "error"].includes(connection.status))) ||
        (mode === "replace" &&
          (!connection.activeSecretVersionId ||
            !connection.credentialVersion ||
            !connection.activeAccountSubjectKeyId ||
            !connection.activeAccountSubjectDigest ||
            !["ready", "disabled", "error"].includes(connection.status)))
      ) {
        fail(
          "OAUTH_MODE_INVALID",
          "The provider OAuth setup mode disagrees with connection state.",
        );
      }
      const permissions = [...input.requestedPermissions].sort();
      if (
        permissions.length < 1 ||
        permissions.length > npAgentProviderAdapterLimitsV1.permissionItems ||
        new Set(permissions).size !== permissions.length ||
        permissions.some((entry) => !adapter.oauth!.permissionInventory.includes(entry))
      )
        fail("OAUTH_PERMISSION_INVALID", "The requested provider permissions are invalid.");
      const verifier = randomByteSource(48);
      if (!(verifier instanceof Uint8Array) || verifier.byteLength !== 48) {
        if (verifier instanceof Uint8Array) verifier.fill(0);
        fail(
          "PROVIDER_RANDOM_SOURCE_INVALID",
          "The provider random source returned invalid PKCE entropy.",
        );
      }
      // 48 random bytes encode to exactly 64 base64url characters without padding.
      const verifierText = Buffer.from(verifier).toString("base64url");
      verifier.fill(0);
      const verifierBytes = new TextEncoder().encode(verifierText);
      try {
        const stateEntropy = randomByteSource(32);
        if (!(stateEntropy instanceof Uint8Array) || stateEntropy.byteLength !== 32) {
          if (stateEntropy instanceof Uint8Array) stateEntropy.fill(0);
          fail(
            "PROVIDER_RANDOM_SOURCE_INVALID",
            "The provider random source returned invalid state entropy.",
          );
        }
        const state = `npps1.${Buffer.from(stateEntropy).toString("base64url")}`;
        stateEntropy.fill(0);
        const stateHash = stateDigest(state, stateKeyring.active);
        const authRequestId = randomUuid();
        const pkceSecretVersionId = randomUuid();
        const expiresAt = new Date(startedAt.getTime() + 10 * 60 * 1_000);
        const authorizationInput = {
          schemaVersion: "np.agent-provider-oauth-authorize.v1",
          connection: parsed,
          redirectUri: input.redirectUri,
          state,
          codeChallenge: sha256Pkce(verifierBytes),
          codeChallengeMethod: "S256",
          requestedPermissions: permissions,
          expiresAt: expiresAt.toISOString(),
        } as const;
        const [authorizationValue, repeatedAuthorizationValue] = (() => {
          try {
            return [
              adapter.oauth.buildAuthorizationUrl(structuredClone(authorizationInput)),
              adapter.oauth.buildAuthorizationUrl(structuredClone(authorizationInput)),
            ];
          } catch {
            return fail(
              "PROVIDER_AUTHORIZATION_CALLBACK_FAILED",
              "The provider authorization callback failed without a safe result.",
            );
          }
        })();
        if (JSON.stringify(authorizationValue) !== JSON.stringify(repeatedAuthorizationValue)) {
          fail(
            "PROVIDER_AUTHORIZATION_NONDETERMINISTIC",
            "The provider authorization URL builder is not deterministic.",
          );
        }
        const authorization = npRequireAgentProviderAuthorizationUrlV1(
          authorizationValue,
          adapter.oauth.authorizationOrigins,
        );
        const pkceVersion = await nextSecretVersion(
          input.siteId,
          input.connectionId,
          "provider-oauth-pkce",
        );
        const seal = await options.vault.sealSecret({
          operationId: randomUuid(),
          secretVersionId: pkceSecretVersionId,
          siteId: input.siteId,
          connectionId: input.connectionId,
          connectionKind: connection.kind as NpAgentConnectionKind,
          purpose: "provider-oauth-pkce",
          version: pkceVersion,
          temporaryExpiresAt: expiresAt,
          envelope: {
            schemaVersion: "np.agent-credential-envelope.v1",
            kind: "provider_oauth_pkce",
            verifier: verifierBytes,
          },
          onJournaled: async ({ db, now: journaledAt }) => {
            const [existing] = await db
              .select()
              .from(npAgentConnectionAuthRequests)
              .where(eq(npAgentConnectionAuthRequests.id, authRequestId))
              .limit(1);
            if (existing) return;
            await db.insert(npAgentConnectionAuthRequests).values({
              id: authRequestId,
              siteId: input.siteId,
              connectionId: input.connectionId,
              mode,
              expectedConnectionStatus: connection.status,
              provider: connection.provider,
              adapterContractVersion: adapter.contractVersion,
              adapterContractFingerprint: adapter.fingerprint,
              oauthClientConfigDigest,
              connectionConfigVersion: connection.configVersion,
              connectionConfigHash: connection.configHash,
              configSnapshotId: config.id,
              expectedSecretVersionId: connection.activeSecretVersionId,
              expectedCredentialVersion: connection.credentialVersion,
              expectedAccountSubjectKeyId: connection.activeAccountSubjectKeyId,
              expectedAccountSubjectDigest: connection.activeAccountSubjectDigest,
              staffSessionId: input.staffSessionId,
              redirectUri: input.redirectUri,
              stateHash,
              hashKeyId: stateKeyring.active.id,
              pkceSecretVersionId,
              requestedPermissions: permissions,
              status: "pending",
              createdAt: journaledAt,
              expiresAt,
            });
          },
        });
        if (seal.state !== "succeeded")
          fail(
            "OAUTH_PKCE_SEAL_PENDING",
            "The provider OAuth setup is awaiting vault reconciliation.",
            true,
          );
        return {
          authorizationUrl: authorization.authorizationUrl,
          expiresAt: expiresAt.toISOString(),
          resourceId: authRequestId,
        };
      } finally {
        verifierBytes.fill(0);
      }
    },

    async handleOAuthCallback(
      input: NpAgentConnectionOAuthCallbackInputV1,
    ): Promise<NpAgentConnectionOperationProjectionV1 | { status: "denied"; resourceId: string }> {
      requireUuid(input.staffSessionId, "agent.connection.staffSessionId");
      const hasCode = input.code !== undefined;
      const hasError = input.error !== undefined;
      if (hasCode === hasError) {
        fail("OAUTH_CALLBACK_INVALID", "The provider OAuth callback must contain code or denial.");
      }
      const authRequest = await findAuthRequestByState(input.state);
      if (authRequest.staffSessionId !== input.staffSessionId) {
        fail("OAUTH_STAFF_SESSION_INVALID", "The provider OAuth callback session is invalid.");
      }
      if (authRequest.status === "denied") {
        return { status: "denied", resourceId: authRequest.id };
      }
      if (authRequest.status === "consumed" && authRequest.connectionOperationId) {
        return operationProjection(
          await getOperation(authRequest.siteId, authRequest.connectionOperationId),
        );
      }
      if (authRequest.status !== "pending") {
        fail("OAUTH_CALLBACK_TERMINAL", "The provider OAuth callback is already terminal.");
      }
      const callbackAt = now();
      const [session] = await resolveDb()
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(
          and(
            eq(npSessions.id, input.staffSessionId),
            gt(npSessions.accessExpiresAt, callbackAt),
            gt(npSessions.refreshExpiresAt, callbackAt),
          ),
        )
        .limit(1);
      if (!session)
        fail("OAUTH_STAFF_SESSION_INVALID", "The provider OAuth callback session expired.");
      if (authRequest.expiresAt <= callbackAt) {
        await options.vault.destroySecret({
          operationId: randomUuid(),
          siteId: authRequest.siteId,
          secretVersionId: authRequest.pkceSecretVersionId,
          onJournaled: async ({ db }) => {
            const expired = await db
              .update(npAgentConnectionAuthRequests)
              .set({ status: "expired", lastErrorCode: "OAUTH_REQUEST_EXPIRED" })
              .where(
                and(
                  eq(npAgentConnectionAuthRequests.id, authRequest.id),
                  eq(npAgentConnectionAuthRequests.status, "pending"),
                  lte(npAgentConnectionAuthRequests.expiresAt, callbackAt),
                ),
              )
              .returning({ id: npAgentConnectionAuthRequests.id });
            if (expired.length !== 1) {
              fail("OAUTH_CALLBACK_REPLAYED", "The provider OAuth callback was already consumed.");
            }
          },
        });
        fail("OAUTH_REQUEST_EXPIRED", "The provider OAuth request expired.");
      }
      const adapter = options.providerRegistry.resolve({
        id: authRequest.provider,
        contractVersion: authRequest.adapterContractVersion,
        fingerprint: authRequest.adapterContractFingerprint,
      });
      const oauthClientConfigDigest = await resolveOAuthClientConfigDigest(
        authRequest.siteId,
        adapter.id,
      );
      if (oauthClientConfigDigest !== authRequest.oauthClientConfigDigest) {
        fail("OAUTH_CLIENT_CONFIG_CHANGED", "The provider OAuth client configuration changed.");
      }
      if (input.error !== undefined) {
        if (input.error !== "access_denied")
          fail("OAUTH_CALLBACK_INVALID", "The provider OAuth callback error is invalid.");
        await options.vault.destroySecret({
          operationId: randomUuid(),
          siteId: authRequest.siteId,
          secretVersionId: authRequest.pkceSecretVersionId,
          onJournaled: async ({ db, now: deniedAt }) => {
            const denied = await db
              .update(npAgentConnectionAuthRequests)
              .set({ status: "denied", deniedAt, lastErrorCode: "AUTHORIZATION_DENIED" })
              .where(
                and(
                  eq(npAgentConnectionAuthRequests.id, authRequest.id),
                  eq(npAgentConnectionAuthRequests.status, "pending"),
                  gt(npAgentConnectionAuthRequests.expiresAt, deniedAt),
                ),
              )
              .returning({ id: npAgentConnectionAuthRequests.id });
            if (denied.length !== 1) {
              fail("OAUTH_CALLBACK_REPLAYED", "The provider OAuth callback was already consumed.");
            }
          },
        });
        return { status: "denied", resourceId: authRequest.id };
      }
      if (
        !(input.code instanceof Uint8Array) ||
        input.code.byteLength === 0 ||
        input.code.byteLength > npAgentProviderAdapterLimitsV1.authorizationCodeBytes
      )
        fail("OAUTH_CODE_INVALID", "The provider authorization code is invalid.");
      const code = new Uint8Array(input.code);
      const codeSecretVersionId = randomUuid();
      const codeVaultOperationId = randomUuid();
      const connectionOperationId = randomUuid();
      try {
        const { connection } = await loadConnectionConfig(
          resolveDb(),
          authRequest.siteId,
          authRequest.connectionId,
          authRequest.configSnapshotId,
        );
        const codeVersion = await nextSecretVersion(
          authRequest.siteId,
          authRequest.connectionId,
          "provider-oauth-code",
        );
        const canonical: NpAgentConnectionOperationRequestCanonicalV1 = {
          schemaVersion: "np.agent-connection-operation.v1",
          siteId: authRequest.siteId,
          operationId: connectionOperationId,
          connectionId: authRequest.connectionId,
          authority: { kind: "oauth-setup", authRequestId: authRequest.id },
          kind: "oauth-exchange",
          expectedConfigVersion: authRequest.connectionConfigVersion,
          expectedConfigHash: authRequest.connectionConfigHash,
          configSnapshotId: authRequest.configSnapshotId,
          adapterContractVersion: authRequest.adapterContractVersion,
          adapterFingerprint: authRequest.adapterContractFingerprint,
          inputSecretVersionIds: [codeSecretVersionId, authRequest.pkceSecretVersionId],
          expectedSecretVersionId: authRequest.expectedSecretVersionId,
          expectedCredentialVersion: authRequest.expectedCredentialVersion,
          expectedRefreshGeneration: null,
          idempotencyKey: `oauth-exchange:${authRequest.id}`,
        };
        const requestHash = await npDigestAgentConnectionOperationCanonical(canonical);
        await options.vault.sealSecret({
          operationId: codeVaultOperationId,
          secretVersionId: codeSecretVersionId,
          siteId: authRequest.siteId,
          connectionId: authRequest.connectionId,
          connectionKind: connection.kind as NpAgentConnectionKind,
          purpose: "provider-oauth-code",
          version: codeVersion,
          temporaryExpiresAt: authRequest.expiresAt,
          envelope: {
            schemaVersion: "np.agent-credential-envelope.v1",
            kind: "provider_oauth_code",
            code,
          },
          onJournaled: async ({ db, now: journaledAt }) => {
            const [current] = await db
              .select()
              .from(npAgentConnectionAuthRequests)
              .where(eq(npAgentConnectionAuthRequests.id, authRequest.id))
              .for("update")
              .limit(1);
            if (current?.status === "consumed") {
              if (
                current.connectionOperationId !== connectionOperationId ||
                current.codeSecretVersionId !== codeSecretVersionId
              )
                fail("OAUTH_CALLBACK_REPLAYED", "The OAuth callback is bound to another journal.");
              return;
            }
            const [session] = await db
              .select({ id: npSessions.id })
              .from(npSessions)
              .where(
                and(
                  eq(npSessions.id, authRequest.staffSessionId),
                  gt(npSessions.accessExpiresAt, journaledAt),
                  gt(npSessions.refreshExpiresAt, journaledAt),
                ),
              )
              .limit(1);
            const [currentConnection] = await db
              .select()
              .from(npAgentConnections)
              .where(
                and(
                  eq(npAgentConnections.siteId, current?.siteId ?? ""),
                  eq(npAgentConnections.id, current?.connectionId ?? ""),
                ),
              )
              .for("update")
              .limit(1);
            const [currentConfig] = await db
              .select()
              .from(npAgentConnectionConfigVersions)
              .where(
                and(
                  eq(npAgentConnectionConfigVersions.siteId, current?.siteId ?? ""),
                  eq(npAgentConnectionConfigVersions.id, current?.configSnapshotId ?? ""),
                ),
              )
              .limit(1);
            if (
              !current ||
              current.status !== "pending" ||
              current.expiresAt <= journaledAt ||
              !session ||
              current.staffSessionId !== input.staffSessionId ||
              current.oauthClientConfigDigest !== oauthClientConfigDigest ||
              !currentConnection ||
              !currentConfig ||
              currentConnection.status !== current.expectedConnectionStatus ||
              currentConnection.provider !== current.provider ||
              currentConnection.adapterContractVersion !== current.adapterContractVersion ||
              currentConnection.configVersion !== current.connectionConfigVersion ||
              currentConnection.configHash !== current.connectionConfigHash ||
              currentConnection.activeConfigSnapshotId !== current.configSnapshotId ||
              currentConnection.activeSecretVersionId !== current.expectedSecretVersionId ||
              currentConnection.credentialVersion !== current.expectedCredentialVersion ||
              currentConnection.activeAccountSubjectKeyId !== current.expectedAccountSubjectKeyId ||
              currentConnection.activeAccountSubjectDigest !==
                current.expectedAccountSubjectDigest ||
              currentConfig.adapterContractVersion !== current.adapterContractVersion ||
              currentConfig.adapterFingerprint !== current.adapterContractFingerprint ||
              currentConfig.configHash !== current.connectionConfigHash
            )
              fail(
                "OAUTH_CALLBACK_PRECONDITION_FAILED",
                "The provider OAuth callback facts changed.",
              );
            await db.insert(npAgentConnectionOperations).values({
              id: connectionOperationId,
              siteId: current.siteId,
              connectionId: current.connectionId,
              source: "oauth-setup",
              kind: "oauth-exchange",
              state: "awaiting_secret",
              expectedConfigVersion: current.connectionConfigVersion,
              expectedConfigHash: current.connectionConfigHash,
              configSnapshotId: current.configSnapshotId,
              adapterContractVersion: current.adapterContractVersion,
              adapterFingerprint: current.adapterContractFingerprint,
              authRequestId: current.id,
              inputSecretVersionIds: [codeSecretVersionId, current.pkceSecretVersionId],
              expectedSecretVersionId: current.expectedSecretVersionId,
              expectedCredentialVersion: current.expectedCredentialVersion,
              idempotencyKey: `oauth-exchange:${current.id}`,
              requestHash,
              attempt: 1,
              createdAt: journaledAt,
            });
            await db
              .update(npAgentConnectionAuthRequests)
              .set({
                status: "consumed",
                consumedAt: journaledAt,
                codeSecretVersionId,
                codeVaultOperationId,
                connectionOperationId,
              })
              .where(
                and(
                  eq(npAgentConnectionAuthRequests.id, current.id),
                  eq(npAgentConnectionAuthRequests.status, "pending"),
                ),
              );
          },
        });
        const operation = await getOperation(authRequest.siteId, connectionOperationId);
        return operationProjection(operation);
      } finally {
        code.fill(0);
      }
    },

    async refreshOAuth(input: {
      siteId: string;
      connectionId: string;
      runId: string;
    }): Promise<NpAgentConnectionOperationProjectionV1> {
      const { connection, config } = await loadConnectionConfig(
        resolveDb(),
        input.siteId,
        input.connectionId,
      );
      if (
        connection.authKind !== "oauth" ||
        connection.status !== "ready" ||
        !connection.activeSecretVersionId ||
        !connection.credentialVersion
      )
        fail("OAUTH_REFRESH_UNAVAILABLE", "The connection has no refreshable OAuth credential.");
      const [secret] = await resolveDb()
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(eq(npAgentConnectionSecretVersions.id, connection.activeSecretVersionId))
        .limit(1);
      if (!secret?.refreshTokenPresent || !secret.refreshGeneration)
        fail("OAUTH_REFRESH_UNAVAILABLE", "The connection has no refresh token.");
      const idempotencyKey = `refresh:${connection.id}:${secret.id}:${secret.refreshGeneration.toString()}`;
      const operation = await admitOperation({
        siteId: input.siteId,
        connection,
        config,
        source: "runtime-refresh",
        runId: input.runId,
        kind: "oauth-refresh",
        inputSecretVersionIds: [secret.id],
        expectedSecretVersionId: secret.id,
        expectedCredentialVersion: connection.credentialVersion,
        expectedRefreshGeneration: secret.refreshGeneration,
        idempotencyKey,
      });
      return processOperationRow(operation);
    },

    async revokeConnection(input: {
      siteId: string;
      connectionId: string;
      expectedConfigVersion: number;
    }): Promise<NpAgentConnectionV1> {
      const revokedAt = now();
      let secretId: string | null = null;
      const oauthTemporarySecretIds: string[] = [];
      await resolveDb().transaction(async (rawTx) => {
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
          connection.configVersion !== input.expectedConfigVersion ||
          connection.status === "revoked"
        )
          fail("CONNECTION_VERSION_CONFLICT", "The connection changed before revoke.");
        secretId = connection.activeSecretVersionId;
        oauthTemporarySecretIds.push(
          ...(await revokePendingOAuthRequests(
            tx,
            input.siteId,
            input.connectionId,
            "CONNECTION_REVOKED",
          )),
        );
        if (secretId)
          await tx
            .update(npAgentConnectionSecretVersions)
            .set({ status: "revoked", retiredAt: revokedAt })
            .where(
              and(
                eq(npAgentConnectionSecretVersions.id, secretId),
                eq(npAgentConnectionSecretVersions.status, "active"),
              ),
            );
        await tx
          .update(npAgentConnections)
          .set({
            status: "revoked",
            activeSecretVersionId: null,
            credentialVersion: null,
            activeAccountSubjectKeyId: null,
            activeAccountSubjectDigest: null,
            activeDestinationKeyId: null,
            activeDestinationDescriptor: null,
            activeDestinationFingerprint: null,
            lastErrorCode: null,
            updatedAt: revokedAt,
          })
          .where(
            and(
              eq(npAgentConnections.id, connection.id),
              eq(npAgentConnections.configVersion, connection.configVersion),
            ),
          );
      });
      if (secretId) {
        try {
          await options.vault.destroySecret({
            operationId: randomUuid(),
            siteId: input.siteId,
            secretVersionId: secretId,
          });
        } catch {
          // Revocation already removed runtime authority; the Vault journal owns cleanup.
        }
      }
      await destroyTemporary(input.siteId, oauthTemporarySecretIds);
      return this.getConnection(input);
    },

    async processOperation(input: {
      siteId: string;
      operationId: string;
    }): Promise<NpAgentConnectionOperationProjectionV1> {
      const operation = await getOperation(input.siteId, input.operationId);
      return processOperationRow(operation);
    },

    async reconcileOperations(input: {
      siteId: string;
      limit?: number;
    }): Promise<NpAgentConnectionOperationProjectionV1[]> {
      const limit = input.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail("CONNECTION_RECONCILE_LIMIT_INVALID", "The reconciliation limit is invalid.");
      const at = now();
      const rows = await resolveDb()
        .select()
        .from(npAgentConnectionOperations)
        .where(
          and(
            eq(npAgentConnectionOperations.siteId, input.siteId),
            or(
              eq(npAgentConnectionOperations.state, "queued"),
              and(
                eq(npAgentConnectionOperations.state, "running"),
                lte(npAgentConnectionOperations.leaseUntil, at),
              ),
            ),
          ),
        )
        .limit(limit);
      const results: NpAgentConnectionOperationProjectionV1[] = [];
      for (const row of rows) {
        if (row.state === "running") {
          const [reclaimed] = await resolveDb()
            .update(npAgentConnectionOperations)
            .set({
              state:
                row.kind === "oauth-exchange" || row.kind === "oauth-refresh"
                  ? "ambiguous"
                  : "queued",
              attempt: row.attempt + 1,
              leaseUntil: null,
              ...(row.kind === "oauth-exchange" || row.kind === "oauth-refresh"
                ? { lastErrorCode: "PROVIDER_OPERATION_AMBIGUOUS", finishedAt: at }
                : { startedAt: null }),
            })
            .where(
              and(
                eq(npAgentConnectionOperations.id, row.id),
                eq(npAgentConnectionOperations.state, "running"),
                lte(npAgentConnectionOperations.leaseUntil, at),
              ),
            )
            .returning();
          if (!reclaimed) continue;
          if (reclaimed.state === "ambiguous") {
            try {
              const { connection } = await loadConnectionConfig(
                resolveDb(),
                reclaimed.siteId,
                reclaimed.connectionId,
                reclaimed.configSnapshotId,
              );
              await markConnectionAuthorizationError(connection, "PROVIDER_OPERATION_AMBIGUOUS");
            } catch {
              // The operation remains terminal and safe even if its parent disappeared.
            }
            await destroyAbandonedOperationSecrets(
              reclaimed.siteId,
              reclaimed.inputSecretVersionIds,
            );
            results.push(operationProjection(reclaimed));
            continue;
          }
          results.push(await processOperationRow(reclaimed));
        } else results.push(await processOperationRow(row));
      }
      return results;
    },

    async inspectOperation(input: {
      siteId: string;
      operationId: string;
    }): Promise<NpAgentConnectionOperationProjectionV1> {
      return operationProjection(await getOperation(input.siteId, input.operationId));
    },

    async getConnection(input: {
      siteId: string;
      connectionId: string;
      expectedConfigVersion?: number;
    }): Promise<NpAgentConnectionV1> {
      const { connection, config } = await loadConnectionConfig(
        resolveDb(),
        input.siteId,
        input.connectionId,
      );
      if (
        input.expectedConfigVersion !== undefined &&
        connection.configVersion !== input.expectedConfigVersion
      )
        fail("CONNECTION_VERSION_CONFLICT", "The connection version changed.");
      return npRequireAgentConnectionV1({
        schemaVersion: "np.agent-connection.v1",
        id: connection.id,
        siteId: connection.siteId,
        kind: connection.kind,
        provider: connection.provider,
        adapterId: config.adapterId,
        adapterContractVersion: config.adapterContractVersion,
        adapterFingerprint: config.adapterFingerprint,
        name: connection.name,
        authKind: connection.authKind,
        safeConfig: connection.config,
        configVersion: connection.configVersion,
        configHash: connection.configHash,
        pricingCatalogFingerprint: connection.pricingCatalogFingerprint,
        dataProcessingCeiling: connection.dataProcessingCeiling,
        status: connection.status,
        credential: connection.activeSecretVersionId
          ? { state: "stored", version: connection.credentialVersion }
          : { state: "absent" },
        verification: connection.lastVerifiedAt
          ? {
              verifiedAt: connection.lastVerifiedAt.toISOString(),
              configVersion: connection.lastVerifiedConfigVersion,
              credentialVersion: connection.lastVerifiedCredentialVersion,
              resultDigest: connection.lastProbeResultDigest,
            }
          : null,
        lastErrorCode: connection.lastErrorCode,
        dependentAgentCount: 0,
        createdBy: connection.createdBy,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
      });
    },

    dispose(): void {
      projectionKeyring.accountSubject.bytes.fill(0);
      for (const key of Object.values(projectionKeyring.accountSubjectPrevious ?? {})) key.fill(0);
      projectionKeyring.destination.bytes.fill(0);
      for (const key of Object.values(projectionKeyring.destinationPrevious ?? {})) key.fill(0);
      stateKeyring.active.key.fill(0);
      for (const key of Object.values(stateKeyring.previous ?? {})) key.fill(0);
    },
  };
}

function zeroCredentialEnvelope(envelope: NpAgentConnectionCredentialEnvelopeV1): void {
  if (envelope.kind === "api_key") envelope.secret.fill(0);
  else {
    envelope.accessToken.fill(0);
    if (envelope.refresh.mode === "present") envelope.refresh.token.fill(0);
  }
}

export type NpAgentConnectionServiceV1 = ReturnType<typeof createAgentConnectionServiceV1>;
