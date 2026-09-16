import { createHash } from "node:crypto";
import { npDigestAgentEventCanonical } from "../agent-contract/canonical-events.js";
import { npCreateAgentRuntimeJobStateV1 } from "../agent-contract/runtime-job-state-contract.js";
import { describe, expect, it } from "vitest";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../agent-contract/runtime-contract.js";

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
    runtimeRows?: Record<string, unknown>[];
    triggerRows?: Record<string, unknown>[];
    eventRows?: Record<string, unknown>[];
    runtimeAdmissionRows?: Record<string, unknown>[];
    sourceReleaseRows?: Record<string, unknown>[];
    releasedAttributionRows?: Record<string, unknown>[];
    releasedAuditRows?: Record<string, unknown>[];
    missingReferenceGuards?: number;
    missingAdmissionKeyIndex?: number;
  } = {},
): NpAgentDiagnosticsQueryClientV1 {
  const castRows = <T extends Record<string, unknown>>(rows: Record<string, unknown>[]): T[] =>
    rows as unknown as T[];
  const result = <T extends Record<string, unknown>>(rows: Record<string, unknown>[]) =>
    Promise.resolve({ rows: castRows<T>(rows) });
  return {
    query: <T extends Record<string, unknown>>(text: string): Promise<{ rows: T[] }> => {
      if (text.includes("reference_fence_coverage"))
        return result<T>([{ missing_count: String(options.missingReferenceGuards ?? 0) }]);
      if (text.includes("source_release_key_index"))
        return result<T>([{ missing_count: String(options.missingAdmissionKeyIndex ?? 0) }]);
      if (text.includes("to_regclass")) {
        return result<T>([{ missing_count: "0" }]);
      }
      if (text.includes("pg_constraint")) {
        return result<T>([{ missing_count: "0", unvalidated_count: "0" }]);
      }
      if (text.includes("with violations")) {
        return result<T>(options.issues ?? []);
      }
      if (text.includes("runtime_trigger_rows")) return result<T>(options.triggerRows ?? []);
      if (text.includes("runtime_event_rows")) return result<T>(options.eventRows ?? []);
      if (text.includes("runtime_control_rows")) return result<T>(options.runtimeRows ?? []);
      if (text.includes("runtime_admission_rows"))
        return result<T>(options.runtimeAdmissionRows ?? []);
      if (text.includes("source_release_rows")) return result<T>(options.sourceReleaseRows ?? []);
      if (text.includes("source_release_attribution_rows"))
        return result<T>(options.releasedAttributionRows ?? []);
      if (text.includes("source_release_audit_rows"))
        return result<T>(options.releasedAuditRows ?? []);
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
  it("detects retained audit digest corruption without returning audit payloads", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        releasedAuditRows: [
          {
            id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
            auditId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
            siteId: "private-site",
            actorKind: "system",
            action: "agent.runtime.admitted",
            targetType: "agent-run",
            targetId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
            payload: { private: "private-audit-body" },
            createdAt: new Date("2026-09-16T00:00:00Z"),
            digest: "invalid",
            version: 1,
            sameReleaseTime: true,
          },
        ],
      }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RELATION_ORPHANED",
      count: 1,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("private-audit-body");
  });
  it("does not accept released Action attribution from a receipt pointer alone", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        releasedAttributionRows: [
          {
            id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
            action: { input_canonical: { private: "retained-action-secret" } },
            invocation: null,
            release: null,
            edges: [],
          },
        ],
      }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RELATION_ORPHANED",
      count: 1,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("retained-action-secret");
  });
  it("fails readiness on missing ingress guards and consumed-key uniqueness", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({ missingReferenceGuards: 2, missingAdmissionKeyIndex: 1 }),
    });
    expect(result.state).toBe("error");
    expect(result.issues).toContainEqual({
      code: "AGENT_SCHEMA_CONSTRAINT_MISSING",
      count: 3,
      oldestAgeSeconds: null,
    });
  });
  it("contains malformed release receipts behind aggregate evidence counts", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        sourceReleaseRows: [
          {
            id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
            evidenceBody: { privateBody: "private-receipt-marker" },
            evidenceDigest: "invalid",
          },
        ],
      }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RELATION_ORPHANED",
      count: 1,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("private-receipt-marker");
    expect(JSON.stringify(result)).not.toContain("018f0f30-cd7b-7cc2-8b16-8c052c259bd1");
  });
  it("contains malformed private run-source evidence behind aggregate issue codes", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        runtimeAdmissionRows: [
          {
            id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
            runtimeAdmissionSources: { rawCredential: "private-runtime-source-marker" },
          },
        ],
      }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RUNTIME_DIVERGED",
      count: 1,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("private-runtime-source-marker");
    expect(JSON.stringify(result)).not.toContain("018f0f30-cd7b-7cc2-8b16-8c052c259bd1");
  });
  it("validates private runtime control records without projecting their values", async () => {
    const healthy = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        runtimeRows: [
          {
            site_id: "default",
            settings: npCreateDisabledAgentRuntimeSettingsV1(),
            control: { revision: 1, currentResumePlan: null, lastResumeReceipt: null },
            control_present: true,
            settings_present: true,
            jobs_present: false,
            jobs: null,
          },
        ],
      }),
    });
    expect(healthy.issueCount).toBe(0);
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        runtimeRows: [
          {
            site_id: "default",
            settings: npCreateDisabledAgentRuntimeSettingsV1(),
            control: { revision: 1, rawCredential: "private-credential-marker" },
            control_present: true,
            settings_present: true,
            jobs_present: false,
            jobs: null,
          },
        ],
      }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RUNTIME_DIVERGED",
      count: 1,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("private-credential-marker");
    expect(JSON.stringify(result)).not.toContain("rawCredential");
  });
  it("accepts coordination-only metadata and contains invalid private cursors", async () => {
    const row = {
      site_id: "default",
      settings_present: false,
      settings: null,
      control_present: false,
      control: null,
      jobs_present: true,
      jobs: npCreateAgentRuntimeJobStateV1(),
    };
    expect(
      (await npCollectAgentHealthSummaryV1({ client: queryClient({ runtimeRows: [row] }) }))
        .issueCount,
    ).toBe(0);
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({ runtimeRows: [{ ...row, jobs: { privateMarker: "private-cursor" } }] }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RUNTIME_DIVERGED",
      count: 1,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("private-cursor");
  });
  it("verifies valid stored event envelopes and manual trigger filter fingerprints", async () => {
    const body = {
      version: "np.agent-event.v1",
      siteId: "default",
      kind: "jobs.handler.failed",
      occurredAt: "2026-09-14T00:00:00.000Z",
      source: { kind: "jobs", component: "worker" },
      subject: null,
      actor: null,
      causation: null,
      correlationId: null,
      deduplicationKey: null,
      privacy: "internal",
      payload: {
        kind: "jobs.handler.failed",
        handlerName: "worker",
        jobId: "job-1",
        reasonCode: "FAILED",
      },
    };
    const event = {
      id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
      body_bounded: true,
      site_id: body.siteId,
      kind: body.kind,
      occurred_at: new Date(body.occurredAt),
      source_kind: body.source.kind,
      source_component: body.source.component,
      subject: null,
      actor: null,
      causation: null,
      correlation_id: null,
      deduplication_key: null,
      privacy: body.privacy,
      payload: body.payload,
      event_hash: await npDigestAgentEventCanonical(body),
      causal_root_run_id: null,
      causal_run_id: null,
      causal_action_id: null,
      causal_depth: null,
    };
    const trigger = {
      id: event.id,
      body_bounded: true,
      kind: "manual",
      filter: {},
      filter_hash: `cj1:sha256:${createHash("sha256").update("{}").digest("base64url")}`,
    };
    expect(
      (
        await npCollectAgentHealthSummaryV1({
          client: queryClient({ eventRows: [event], triggerRows: [trigger] }),
        })
      ).issueCount,
    ).toBe(0);
    const cause = {
      rootRunId: event.id,
      sourceRunId: event.id,
      sourceActionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
      depth: 0,
    };
    const causalEvent = {
      ...event,
      causation: cause,
      event_hash: await npDigestAgentEventCanonical({ ...body, causation: cause }),
      causal_root_run_id: cause.rootRunId,
      causal_run_id: cause.sourceRunId,
      causal_action_id: cause.sourceActionId,
      causal_depth: cause.depth,
    };
    expect(
      (await npCollectAgentHealthSummaryV1({ client: queryClient({ eventRows: [causalEvent] }) }))
        .issueCount,
    ).toBe(0);
    for (const row of [
      {
        ...causalEvent,
        causal_root_run_id: null,
        causal_run_id: null,
        causal_action_id: null,
        causal_depth: null,
      },
      { ...causalEvent, causal_depth: 1 },
      { ...event, causal_run_id: event.id },
    ]) {
      const broken = await npCollectAgentHealthSummaryV1({
        client: queryClient({ eventRows: [row] }),
      });
      expect(broken.issues).toContainEqual({
        code: "AGENT_RUNTIME_DIVERGED",
        count: 1,
        oldestAgeSeconds: null,
      });
      expect(JSON.stringify(broken)).not.toContain(cause.sourceActionId);
      expect(JSON.stringify(broken)).not.toContain("causation");
    }
    const changed = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        eventRows: [{ ...event, payload: { ...body.payload, jobId: "changed" } }],
        triggerRows: [{ ...trigger, filter_hash: "invalid" }],
      }),
    });
    expect(changed.issues).toContainEqual({
      code: "AGENT_RUNTIME_DIVERGED",
      count: 2,
      oldestAgeSeconds: null,
    });
  });
  it("contains malformed event and trigger evidence behind aggregate counts", async () => {
    const result = await npCollectAgentHealthSummaryV1({
      client: queryClient({
        triggerRows: [
          {
            id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
            filter: { privateBody: "private-trigger" },
            filter_hash: "invalid",
          },
        ],
        eventRows: [
          { id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2", payload: { raw: "private-event" } },
        ],
      }),
    });
    expect(result.issues).toContainEqual({
      code: "AGENT_RUNTIME_DIVERGED",
      count: 2,
      oldestAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("private-trigger");
    expect(JSON.stringify(result)).not.toContain("private-event");
  });
  it("freezes the complete R1 table inventory and critical constraint inventory", () => {
    expect(npAgentDiagnosticsSchemaInventoryV1.tables).toHaveLength(43);
    expect(npAgentDiagnosticsSchemaInventoryV1.constraints).toHaveLength(284);
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
