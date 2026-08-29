import { describe, expect, it, vi } from "vitest";

import {
  NpAgentVaultAdapterRegistryV1,
  NpAgentVaultError,
  NpVaultPlaintextLease,
  npAgentVaultRetryDelaySeconds,
  npCallAgentVaultAdapterV1,
  npDecodeAgentVaultMasterKeyV1,
  npRequireAgentVaultRuntimeIntentV1,
} from "./index.js";

function adapter() {
  return {
    id: "fake-vault",
    contractVersion: 1,
    fingerprint: "sha256:fake-vault-v1",
    kind: "custom:fake-vault" as const,
    algorithm: "custom:fake-vault" as const,
    seal: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
    inspectOperation: vi.fn(),
  };
}

describe("Agent vault runtime boundary", () => {
  it("keeps disabled as the default and resolves only an exact frozen adapter", () => {
    const registry = new NpAgentVaultAdapterRegistryV1();
    expect(() => registry.getActive()).toThrowError(
      expect.objectContaining({ code: "VAULT_DISABLED" }),
    );
    const fake = adapter();
    registry.register(fake, { active: true });
    expect(registry.getActive()).toBe(fake);
    expect(
      registry.resolve({
        id: fake.id,
        contractVersion: fake.contractVersion,
        fingerprint: fake.fingerprint,
      }),
    ).toBe(fake);
    expect(() => registry.resolve({ ...fake, fingerprint: "sha256:changed" })).toThrowError(
      expect.objectContaining({ code: "VAULT_ADAPTER_UNAVAILABLE" }),
    );
    expect(registry.list()).toEqual([
      expect.objectContaining({ id: "fake-vault", active: true, kind: "custom:fake-vault" }),
    ]);
    const conflicting = { ...adapter(), id: "other-vault" };
    expect(() => registry.register(conflicting, { active: true })).toThrowError(
      expect.objectContaining({ code: "VAULT_ACTIVE_ADAPTER_CONFLICT" }),
    );
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects local-envelope intent outside explicit development mode", () => {
    expect(
      npRequireAgentVaultRuntimeIntentV1({ mode: "disabled", environment: "production" }),
    ).toEqual({ mode: "disabled", environment: "production" });
    expect(() =>
      npRequireAgentVaultRuntimeIntentV1({
        mode: "local-envelope",
        environment: "production",
      }),
    ).toThrowError(expect.objectContaining({ code: "VAULT_LOCAL_ENVELOPE_FORBIDDEN" }));
    expect(
      npRequireAgentVaultRuntimeIntentV1({
        mode: "local-envelope",
        environment: "development",
      }),
    ).toEqual({ mode: "local-envelope", environment: "development" });
    expect(() =>
      npRequireAgentVaultRuntimeIntentV1(
        Object.defineProperty({ environment: "development" }, "mode", {
          enumerable: true,
          get: () => "local-envelope",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "VAULT_CONFIG_INVALID" }));
  });

  it("accepts only a dedicated canonical base64 32-byte master key", () => {
    const source = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const encoded = Buffer.from(source).toString("base64");
    const decoded = npDecodeAgentVaultMasterKeyV1(encoded);
    expect(decoded).toEqual(source);
    decoded.fill(0);
    for (const invalid of ["", "A".repeat(44), Buffer.alloc(32).toString("base64")]) {
      expect(() => npDecodeAgentVaultMasterKeyV1(invalid)).toThrow(NpAgentVaultError);
    }
    expect(() =>
      npDecodeAgentVaultMasterKeyV1(encoded, { applicationSecret: encoded }),
    ).toThrowError(expect.objectContaining({ code: "VAULT_MASTER_KEY_INVALID" }));
  });

  it("makes plaintext leases expiring, single-use, and zeroizing", async () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const lease = new NpVaultPlaintextLease(
      "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
      `cj1:sha256:${"A".repeat(43)}`,
      Uint8Array.of(1, 2, 3),
      new Date(now.getTime() + 1_000),
      () => now,
    );
    expect(() => JSON.stringify(lease)).toThrowError(
      expect.objectContaining({ code: "VAULT_LEASE_SERIALIZATION_FORBIDDEN" }),
    );
    expect(Object.keys(lease)).not.toContain("bytes");
    let exposed: Uint8Array | null = null;
    await expect(
      lease.use((bytes) => {
        exposed = bytes;
        expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
        return Promise.resolve("used");
      }),
    ).resolves.toBe("used");
    expect(exposed).toEqual(Uint8Array.of(0, 0, 0));
    await expect(lease.use(() => Promise.resolve(undefined))).rejects.toMatchObject({
      code: "VAULT_LEASE_CONSUMED",
    });
  });

  it("aborts at the host deadline and ignores late adapter results", async () => {
    vi.useFakeTimers();
    const late = vi.fn();
    const pending = npCallAgentVaultAdapterV1(
      async () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50)),
      10,
      late,
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: "VAULT_ADAPTER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    await vi.advanceTimersByTimeAsync(40);
    expect(late).toHaveBeenCalledWith("late");
    vi.useRealTimers();
  });

  it("uses the frozen capped retry ladder", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 65_535].map(npAgentVaultRetryDelaySeconds)).toEqual([
      5, 15, 30, 60, 300, 900, 3_600, 3_600, 3_600,
    ]);
  });
});
