import {
  NpAgentVaultError,
  npAgentVaultLimitsV1,
  npRequireAgentVaultAdapterV1,
  npRequireVaultHealthV1,
  type NpAgentVaultAdapterV1,
  type NpVaultHealthV1,
  type NpVaultPlaintextLeaseV1,
} from "./vault-contract.js";

const AAD_DIGEST_PATTERN = /^cj1:sha256:[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function adapterKey(adapter: { id: string; contractVersion: number; fingerprint: string }): string {
  return `${adapter.id}\0${adapter.contractVersion.toString()}\0${adapter.fingerprint}`;
}

export interface NpAgentVaultAdapterDescriptorV1 {
  id: string;
  contractVersion: number;
  fingerprint: string;
  kind: NpAgentVaultAdapterV1["kind"];
  algorithm: NpAgentVaultAdapterV1["algorithm"];
  active: boolean;
}

export class NpAgentVaultAdapterRegistryV1 {
  private readonly adapters = new Map<string, NpAgentVaultAdapterV1>();
  private activeKey: string | null = null;
  private closed = false;

  register(adapterValue: unknown, options: { active?: boolean } = {}): void {
    if (this.closed) {
      throw new NpAgentVaultError("VAULT_REGISTRY_CLOSED", "The Agent vault registry is closed.");
    }
    const adapter = npRequireAgentVaultAdapterV1(adapterValue);
    const key = adapterKey(adapter);
    const existing = this.adapters.get(key);
    if (existing && existing !== adapter) {
      throw new NpAgentVaultError(
        "VAULT_ADAPTER_CONFLICT",
        "A different Agent vault adapter already owns this frozen identity.",
      );
    }
    if (options.active === true) {
      if (this.activeKey !== null && this.activeKey !== key) {
        throw new NpAgentVaultError(
          "VAULT_ACTIVE_ADAPTER_CONFLICT",
          "Only one Agent vault adapter may be active.",
        );
      }
    }
    this.adapters.set(key, adapter);
    if (options.active === true) this.activeKey = key;
  }

  getActive(): NpAgentVaultAdapterV1 {
    if (this.closed) {
      throw new NpAgentVaultError("VAULT_REGISTRY_CLOSED", "The Agent vault registry is closed.");
    }
    if (this.activeKey === null) {
      throw new NpAgentVaultError(
        "VAULT_DISABLED",
        "Agent provider credentials are disabled for this deployment.",
      );
    }
    return this.adapters.get(this.activeKey)!;
  }

  resolve(input: {
    id: string;
    contractVersion: number;
    fingerprint: string;
  }): NpAgentVaultAdapterV1 {
    if (this.closed) {
      throw new NpAgentVaultError("VAULT_REGISTRY_CLOSED", "The Agent vault registry is closed.");
    }
    const adapter = this.adapters.get(adapterKey(input));
    if (!adapter) {
      throw new NpAgentVaultError(
        "VAULT_ADAPTER_UNAVAILABLE",
        "The exact frozen Agent vault adapter is unavailable.",
      );
    }
    return adapter;
  }

  list(): NpAgentVaultAdapterDescriptorV1[] {
    return [...this.adapters.entries()]
      .map(([key, adapter]) => ({
        id: adapter.id,
        contractVersion: adapter.contractVersion,
        fingerprint: adapter.fingerprint,
        kind: adapter.kind,
        algorithm: adapter.algorithm,
        active: key === this.activeKey,
      }))
      .sort((left, right) =>
        left.id !== right.id
          ? left.id < right.id
            ? -1
            : 1
          : left.contractVersion !== right.contractVersion
            ? left.contractVersion - right.contractVersion
            : left.fingerprint < right.fingerprint
              ? -1
              : left.fingerprint > right.fingerprint
                ? 1
                : 0,
      );
  }

  async healthCheck(options: { deadlineMilliseconds?: number } = {}): Promise<NpVaultHealthV1> {
    const adapter = this.getActive();
    if (!adapter.healthCheck) {
      return {
        schemaVersion: "np.agent-vault-health.v1",
        status: "degraded",
        checkedAt: new Date().toISOString(),
        keyId: null,
        safeCodes: ["VAULT_HEALTH_UNSUPPORTED"],
      };
    }
    return npRequireVaultHealthV1(
      await npCallAgentVaultAdapterV1(
        (signal) => adapter.healthCheck!({ signal }),
        options.deadlineMilliseconds,
      ),
    );
  }

  async shutdown(options: { deadlineMilliseconds?: number } = {}): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const unique = [...new Set(this.adapters.values())];
    this.activeKey = null;
    this.adapters.clear();
    await Promise.all(
      unique.map(async (adapter) => {
        if (!adapter.shutdown) return;
        const result = await npCallAgentVaultAdapterV1(
          (signal) => adapter.shutdown!({ signal }),
          options.deadlineMilliseconds,
        );
        if (result !== undefined) {
          throw new NpAgentVaultError(
            "VAULT_ADAPTER_RESULT_INVALID",
            "Agent vault adapter shutdown must resolve to void.",
          );
        }
      }),
    );
  }
}

export interface NpAgentVaultRuntimeIntentV1 {
  mode: "disabled" | "local-envelope" | "custom";
  environment: "development" | "production" | "hosted";
}

export function npRequireAgentVaultRuntimeIntentV1(value: unknown): NpAgentVaultRuntimeIntentV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NpAgentVaultError(
      "VAULT_CONFIG_INVALID",
      "Agent vault runtime intent must be an object.",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("mode") ||
    !keys.includes("environment") ||
    keys.some((key) => typeof key !== "string")
  ) {
    throw new NpAgentVaultError(
      "VAULT_CONFIG_INVALID",
      "Agent vault runtime intent must contain only mode and environment.",
    );
  }
  for (const key of ["mode", "environment"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new NpAgentVaultError(
        "VAULT_CONFIG_INVALID",
        "Agent vault runtime intent fields must be enumerable data properties.",
      );
    }
  }
  if (!(["disabled", "local-envelope", "custom"] as unknown[]).includes(record.mode)) {
    throw new NpAgentVaultError("VAULT_CONFIG_INVALID", "Agent vault mode is unsupported.");
  }
  if (!(["development", "production", "hosted"] as unknown[]).includes(record.environment)) {
    throw new NpAgentVaultError("VAULT_CONFIG_INVALID", "Agent vault environment is unsupported.");
  }
  if (record.mode === "local-envelope" && record.environment !== "development") {
    throw new NpAgentVaultError(
      "VAULT_LOCAL_ENVELOPE_FORBIDDEN",
      "The local-envelope Agent vault is development-only.",
    );
  }
  return {
    mode: record.mode as NpAgentVaultRuntimeIntentV1["mode"],
    environment: record.environment as NpAgentVaultRuntimeIntentV1["environment"],
  };
}

export function npDecodeAgentVaultMasterKeyV1(
  value: string,
  options: { applicationSecret?: string } = {},
): Uint8Array {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/u.test(value) ||
    value === options.applicationSecret
  ) {
    throw new NpAgentVaultError(
      "VAULT_MASTER_KEY_INVALID",
      "The local-envelope master key must be one dedicated base64-encoded 32-byte key.",
    );
  }
  const decoded = Buffer.from(value, "base64");
  const decodedText = decoded.toString("utf8").toLowerCase();
  if (
    decoded.length !== 32 ||
    decoded.toString("base64") !== value ||
    decoded.every((byte) => byte === decoded[0]) ||
    /change|replace|example|placeholder|your[_ -]?key|development[_ -]?key|test[_ -]?key/u.test(
      decodedText,
    )
  ) {
    decoded.fill(0);
    throw new NpAgentVaultError(
      "VAULT_MASTER_KEY_INVALID",
      "The local-envelope master key must be one dedicated base64-encoded 32-byte key.",
    );
  }
  const result = new Uint8Array(decoded);
  decoded.fill(0);
  return result;
}

export class NpVaultPlaintextLease implements NpVaultPlaintextLeaseV1 {
  private state: "ready" | "using" | "disposed" = "ready";
  private readonly bytes: Uint8Array;
  readonly expiresAt: string;

  constructor(
    readonly secretVersionId: string,
    readonly aadDigest: string,
    value: Uint8Array,
    expiresAt: Date,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!UUID_PATTERN.test(secretVersionId) || !AAD_DIGEST_PATTERN.test(aadDigest)) {
      throw new NpAgentVaultError("VAULT_LEASE_INVALID", "Agent vault lease metadata is invalid.");
    }
    if (!(value instanceof Uint8Array) || value.byteLength === 0) {
      throw new NpAgentVaultError("VAULT_LEASE_INVALID", "Agent vault lease bytes are invalid.");
    }
    const maximum = now().getTime() + npAgentVaultLimitsV1.plaintextLeaseSeconds * 1_000;
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > maximum) {
      throw new NpAgentVaultError(
        "VAULT_LEASE_INVALID",
        "Agent vault lease exceeds the maximum lifetime.",
      );
    }
    this.bytes = new Uint8Array(value);
    this.expiresAt = expiresAt.toISOString();
    Object.defineProperty(this, "bytes", { enumerable: false });
  }

  toJSON(): never {
    throw new NpAgentVaultError(
      "VAULT_LEASE_SERIALIZATION_FORBIDDEN",
      "Agent vault plaintext leases cannot be serialized.",
    );
  }

  async use<T>(consumer: (bytes: Uint8Array) => Promise<T>): Promise<T> {
    if (typeof consumer !== "function") {
      throw new NpAgentVaultError("VAULT_LEASE_INVALID", "Agent vault lease consumer is invalid.");
    }
    if (this.state !== "ready") {
      throw new NpAgentVaultError("VAULT_LEASE_CONSUMED", "Agent vault lease is single-use.");
    }
    if (this.now().getTime() >= new Date(this.expiresAt).getTime()) {
      this.dispose();
      throw new NpAgentVaultError("VAULT_LEASE_EXPIRED", "Agent vault lease has expired.");
    }
    this.state = "using";
    try {
      return await consumer(this.bytes);
    } finally {
      this.bytes.fill(0);
      this.state = "disposed";
    }
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.bytes.fill(0);
    this.state = "disposed";
  }
}

export function npRequireVaultPlaintextLeaseV1(
  value: unknown,
  expected: { secretVersionId: string; aadDigest: string; now?: Date },
): NpVaultPlaintextLeaseV1 {
  if (typeof value !== "object" || value === null) {
    throw new NpAgentVaultError("VAULT_LEASE_INVALID", "Agent vault adapter returned no lease.");
  }
  const lease = value as Partial<NpVaultPlaintextLeaseV1>;
  if (
    lease.secretVersionId !== expected.secretVersionId ||
    lease.aadDigest !== expected.aadDigest ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.use !== "function" ||
    typeof lease.dispose !== "function"
  ) {
    throw new NpAgentVaultError(
      "VAULT_LEASE_INVALID",
      "Agent vault adapter returned mismatched lease metadata.",
    );
  }
  const expiresAt = new Date(lease.expiresAt);
  const now = expected.now ?? new Date();
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.toISOString() !== lease.expiresAt ||
    expiresAt <= now ||
    expiresAt.getTime() > now.getTime() + npAgentVaultLimitsV1.plaintextLeaseSeconds * 1_000
  ) {
    lease.dispose();
    throw new NpAgentVaultError("VAULT_LEASE_INVALID", "Agent vault lease lifetime is invalid.");
  }
  return lease as NpVaultPlaintextLeaseV1;
}

export async function npCallAgentVaultAdapterV1<T>(
  call: (signal: AbortSignal) => T | Promise<T>,
  deadlineMilliseconds = npAgentVaultLimitsV1.adapterCallMilliseconds,
  onLateResult?: (value: T) => void,
): Promise<T> {
  if (
    !Number.isInteger(deadlineMilliseconds) ||
    deadlineMilliseconds < 1 ||
    deadlineMilliseconds > npAgentVaultLimitsV1.adapterCallMilliseconds
  ) {
    throw new NpAgentVaultError(
      "VAULT_DEADLINE_INVALID",
      "Agent vault adapter deadline exceeds the frozen bound.",
    );
  }
  const controller = new AbortController();
  let settled = false;
  let timedOut = false;
  const pending = Promise.resolve()
    .then(() => call(controller.signal))
    .then(
      (value) => {
        if (timedOut) onLateResult?.(value);
        return value;
      },
      (error: unknown) => {
        if (timedOut) {
          throw error instanceof Error
            ? error
            : new NpAgentVaultError(
                "VAULT_ADAPTER_ERROR",
                "A late Agent vault adapter call rejected with an invalid error.",
              );
        }
        throw error;
      },
    );
  // Always observe a late rejection after the deadline race has already returned.
  void pending.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      controller.abort();
      reject(
        new NpAgentVaultError(
          "VAULT_ADAPTER_TIMEOUT",
          "Agent vault adapter call exceeded its deadline.",
          true,
        ),
      );
    }, deadlineMilliseconds);
    pending.finally(() => clearTimeout(timer)).catch(() => undefined);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    settled = true;
  }
}
