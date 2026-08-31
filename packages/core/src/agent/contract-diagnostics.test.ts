import { describe, expect, it } from "vitest";

import { createAgentFakeProviderAdapterV1 } from "./provider-fake.js";
import { NpAgentConnectionAuthAdapterRegistryV1 } from "./provider-auth-contract.js";
import { createLocalEnvelopeVaultAdapterV1 } from "./vault-local-envelope.js";
import { NpAgentVaultAdapterRegistryV1 } from "./vault-runtime.js";
import {
  npAgentDiagnosticsSchemaInventoryV1,
  npCollectAgentHealthSummaryV1,
  type NpAgentDiagnosticsQueryClientV1,
} from "./contract-diagnostics.js";

function queryClient(
  options: {
    issues?: Array<{ code: string; count: string; oldest_age_seconds: string | null }>;
    provider?: { adapter_id: string; contract_version: string; fingerprint: string }[];
    vault?: { adapter_id: string; contract_version: string; fingerprint: string }[];
  } = {},
): NpAgentDiagnosticsQueryClientV1 {
  const castRows = <T extends Record<string, unknown>>(rows: Record<string, unknown>[]): T[] =>
    rows as unknown as T[];
  const result = <T extends Record<string, unknown>>(rows: Record<string, unknown>[]) =>
    Promise.resolve({ rows: castRows<T>(rows) });
  return {
    query: <T extends Record<string, unknown>>(text: string): Promise<{ rows: T[] }> => {
      if (text.includes("to_regclass")) {
        return result<T>([{ missing_count: "0" }]);
      }
      if (text.includes("pg_constraint")) {
        return result<T>([{ missing_count: "0", unvalidated_count: "0" }]);
      }
      if (text.includes("with violations")) {
        return result<T>(options.issues ?? []);
      }
      if (text.includes("with state_rows")) {
        return result<T>([
          {
            entity: "connection",
            state: "ready",
            count: "1",
            oldest_age_seconds: "60",
          },
        ]);
      }
      if (text.includes("cfg.adapter_id")) {
        return result<T>(options.provider ?? []);
      }
      if (text.includes("sec.vault_adapter")) {
        return result<T>(options.vault ?? []);
      }
      throw new Error("unexpected query");
    },
  };
}

describe("Agent contract diagnostics", () => {
  it("freezes the complete R1 table inventory and critical constraint inventory", () => {
    expect(npAgentDiagnosticsSchemaInventoryV1.tables).toHaveLength(18);
    expect(npAgentDiagnosticsSchemaInventoryV1.tables).toEqual(
      [...npAgentDiagnosticsSchemaInventoryV1.tables].sort(),
    );
    expect(new Set(npAgentDiagnosticsSchemaInventoryV1.constraints).size).toBe(
      npAgentDiagnosticsSchemaInventoryV1.constraints.length,
    );
  });

  it("returns safe counts and unknown runtime readiness without adapter registries", async () => {
    const provider = createAgentFakeProviderAdapterV1();
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        provider: [
          {
            adapter_id: provider.id,
            contract_version: provider.contractVersion.toString(),
            fingerprint: provider.fingerprint,
          },
        ],
      }),
      now: new Date("2026-08-30T06:00:00.000Z"),
    });
    expect(result).toMatchObject({
      state: "warn",
      issueCount: 0,
      states: [{ entity: "connection", state: "ready", count: 1, oldestAgeSeconds: 60 }],
      readiness: {
        providers: { state: "unknown", requiredCount: 1, availableCount: 0 },
        vault: { state: "not-required", requiredCount: 0, availableCount: 0 },
      },
    });
  });

  it("matches exact frozen provider and vault adapter identities", async () => {
    const provider = createAgentFakeProviderAdapterV1();
    const providerRegistry = new NpAgentConnectionAuthAdapterRegistryV1().register(provider);
    const vaultAdapter = createLocalEnvelopeVaultAdapterV1({
      environment: "development",
      explicitlyEnabled: true,
      activeKey: {
        id: "diagnostic-kek",
        version: "v1",
        key: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      },
    });
    const vaultRegistry = new NpAgentVaultAdapterRegistryV1();
    vaultRegistry.register(vaultAdapter, { active: true });
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        provider: [
          {
            adapter_id: provider.id,
            contract_version: provider.contractVersion.toString(),
            fingerprint: provider.fingerprint,
          },
        ],
        vault: [
          {
            adapter_id: vaultAdapter.id,
            contract_version: vaultAdapter.contractVersion.toString(),
            fingerprint: vaultAdapter.fingerprint,
          },
        ],
      }),
      providerRegistry,
      vaultRegistry,
      now: new Date("2026-08-30T06:00:00.000Z"),
    });
    expect(result.state).toBe("ok");
    expect(result.readiness).toEqual({
      providers: { state: "ready", requiredCount: 1, availableCount: 1 },
      vault: { state: "ready", requiredCount: 1, availableCount: 1 },
    });
    await vaultRegistry.shutdown();
  });

  it("fails closed to one stable issue without leaking query errors", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: { query: () => Promise.reject(new Error("postgres secret-ref=do-not-leak")) },
      now: new Date("2026-08-30T06:00:00.000Z"),
    });
    expect(result).toMatchObject({
      state: "error",
      issueCount: 1,
      issues: [{ code: "AGENT_SCHEMA_UNAVAILABLE", count: 1, oldestAgeSeconds: null }],
      readiness: {
        providers: { state: "unknown", requiredCount: 0, availableCount: 0 },
        vault: { state: "unknown", requiredCount: 0, availableCount: 0 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
  });

  it("rejects partially numeric database values instead of truncating them", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        issues: [
          {
            code: "AGENT_EXPIRY_BACKLOG",
            count: "1 forged",
            oldest_age_seconds: null,
          },
        ],
      }),
      now: new Date("2026-08-30T06:00:00.000Z"),
    });
    expect(result).toMatchObject({
      state: "error",
      issueCount: 1,
      issues: [{ code: "AGENT_SCHEMA_UNAVAILABLE", count: 1 }],
    });
  });
});
