import { createHash } from "node:crypto";
import { npDigestAgentEventCanonical } from "../agent-contract/canonical-events.js";
import { npCreateAgentRuntimeJobStateV1 } from "../agent-contract/runtime-job-state-contract.js";
import { describe, expect, it, vi } from "vitest";
import * as cancelledLifecycle from "./cancelled-changeset-lifecycle.js";
import * as cancelledAttribution from "./cancelled-changeset-source-release.js";
import {
  npRequireAgentSourceReleaseV1,
  npDigestAgentSourceReleaseV1,
} from "../agent-contract/source-release-contract.js";
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
    lifecycleEdges?: Record<string, unknown>[];
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
      if (text.includes("source_release_lifecycle_edges"))
        return result<T>(options.lifecycleEdges ?? []);
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
  it.each(["valid", "missing audit", "wrong digest", "extra edge", "wrong release"])(
    "checks all cancelled ChangeSet receipt owners: %s",
    async (variant) => {
      const id = (n: number) => `018f0f30-cd7b-7cc2-8b16-${n.toString().padStart(12, "0")}`;
      const digest = `cj1:sha256:${"a".repeat(43)}`;
      const releasedAt = "2026-09-18T00:00:00.000Z";
      const body = npRequireAgentSourceReleaseV1({
        schemaVersion: "np.agent-source-release.v1",
        verifierVersion: 1,
        kind: "runtime-run",
        siteId: "site-a",
        sourceId: id(1),
        releasedAt,
        principalId: id(2),
        agentId: id(3),
        agentVersionId: id(4),
        admissionFingerprint: digest,
        runLimitsHash: digest,
        budgetSnapshotHash: digest,
        state: "succeeded",
        finishedAt: "2026-09-01T00:00:00.000Z",
        retentionEligibleAt: "2026-09-02T00:00:00.000Z",
        deadlineAt: "2026-09-01T01:00:00.000Z",
        admissionKeyDigest: digest,
      });
      const proof = vi
        .spyOn(cancelledAttribution, "npVerifyCancelledChangeSetAttributionV1")
        .mockResolvedValue({
          actionDigest: digest,
          invocationDigest: digest,
          changeSetDigest: digest,
          auditDigest: digest,
        });
      try {
        const edges = [
          ["changeset-action", id(5), "action-run"],
          ["changeset-invocation", id(6), "invocation-authority-run"],
          ["changeset-source", id(7), "changeset-run"],
          ["changeset-audit", id(8), "audit-changeset"],
        ].map(([owner_kind, owner_id, edge_code]) => ({
          owner_kind,
          owner_id,
          edge_code,
          owner_evidence_digest: digest,
          verifier_version: 1,
          released_at: releasedAt,
        }));
        if (variant === "missing audit") edges.pop();
        if (variant === "wrong digest") edges[3].owner_evidence_digest = "corrupt";
        if (variant === "extra edge") edges.push({ ...edges[0] });
        const result = await npCollectAgentHealthSummaryV1({
          client: queryClient({
            releasedAttributionRows: [
              {
                id: id(5),
                action: {
                  id: id(5),
                  capability_id: "changeset.create",
                  run_id: null,
                  run_source_release_id: id(9),
                },
                invocation: { id: id(6) },
                changeset: {
                  id: id(7),
                  run_id: null,
                  run_source_release_id: variant === "wrong release" ? id(10) : id(9),
                  title: "private-retained-title",
                },
                audit: { id: id(8) },
                release: {
                  id: id(9),
                  site_id: "site-a",
                  source_id: id(1),
                  source_kind: "runtime-run",
                  evidence_body: body,
                  evidence_digest: await npDigestAgentSourceReleaseV1(body),
                  released_at: releasedAt,
                  principal_id: id(2),
                  admission_key_digest: digest,
                },
                edges,
              },
            ],
          }),
        });
        expect(result.issues.some((issue) => issue.code === "AGENT_RELATION_ORPHANED")).toBe(
          variant !== "valid",
        );
        expect(JSON.stringify(result)).not.toContain("private-retained-title");
        if (variant === "valid")
          expect(proof).toHaveBeenCalledWith(
            expect.objectContaining({
              releasedAt: new Date(releasedAt),
              runId: id(1),
              agentId: id(3),
            }),
          );
      } finally {
        proof.mockRestore();
      }
    },
  );
  it.each([
    "valid",
    "requester-only release",
    "missing lifecycle edge",
    "wrong digest",
    "wrong time",
    "wrong verifier",
    "failed lifecycle",
    "wrong locator",
    "missing action",
  ])(
    "checks complete validated lifecycle once across released create and validate Actions: %s",
    async (variant) => {
      const id = (n: number) => `018f0f30-cd7b-7cc2-8b16-${n.toString().padStart(12, "0")}`;
      const digest = `cj1:sha256:${"a".repeat(43)}`;
      const releasedAt = "2026-09-18T00:00:00.000Z";
      const body = npRequireAgentSourceReleaseV1({
        schemaVersion: "np.agent-source-release.v1",
        verifierVersion: 1,
        kind: "runtime-run",
        siteId: "site-a",
        sourceId: id(1),
        releasedAt,
        principalId: id(2),
        agentId: id(3),
        agentVersionId: id(4),
        admissionFingerprint: digest,
        runLimitsHash: digest,
        budgetSnapshotHash: digest,
        state: "succeeded",
        finishedAt: "2026-09-01T00:00:00.000Z",
        retentionEligibleAt: "2026-09-02T00:00:00.000Z",
        deadlineAt: "2026-09-01T01:00:00.000Z",
        admissionKeyDigest: digest,
      });
      const releaseDigest = await npDigestAgentSourceReleaseV1(body);
      const proof = vi.spyOn(cancelledLifecycle, "npReadCancelledChangeSetLifecycleV1");
      try {
        const edges = [
          ["changeset-action", id(5), "action-run"],
          ["changeset-invocation", id(6), "invocation-authority-run"],
          ["changeset-source", id(7), "changeset-run"],
          ["changeset-audit", id(8), "audit-changeset"],
          ["changeset-action", id(10), "action-run"],
          ["changeset-invocation", id(11), "invocation-authority-run"],
          ["changeset-validation", id(12), "validation-authority-run"],
          ["changeset-preview", id(13), "preview-authority-run"],
        ].map(([owner_kind, owner_id, edge_code]) => ({
          owner_kind,
          owner_id,
          edge_code,
          owner_evidence_digest: digest,
          verifier_version: 1,
          released_at: releasedAt,
        }));
        if (variant === "requester-only release") edges.splice(0, 4);
        type Lifecycle = NonNullable<
          Awaited<ReturnType<typeof cancelledLifecycle.npReadCancelledChangeSetLifecycleV1>>
        >;
        proof.mockResolvedValue(
          variant === "failed lifecycle"
            ? null
            : ({
                creator: variant !== "requester-only release",
                actions: (variant === "requester-only release"
                  ? [10]
                  : variant === "missing action"
                    ? [5]
                    : [5, 10]
                ).map((n) => ({
                  id: id(n),
                  runId: null,
                  runSourceReleaseId: variant === "wrong locator" ? id(14) : id(9),
                })),
                validationIds: [id(12)],
                previewIds: [id(13)],
                edges: edges.map((edge) => ({
                  kind: edge.owner_kind,
                  id: edge.owner_id,
                  code: edge.edge_code,
                  digest: edge.owner_evidence_digest,
                })),
              } as unknown as Lifecycle),
        );
        if (variant === "missing lifecycle edge") edges.pop();
        if (variant === "wrong digest") edges[6].owner_evidence_digest = "corrupt";
        if (variant === "wrong time") edges[6].released_at = "2026-09-17T00:00:00.000Z";
        if (variant === "wrong verifier") edges[6].verifier_version = 2;
        const result = await npCollectAgentHealthSummaryV1({
          client: queryClient({
            lifecycleEdges: edges,
            releasedAttributionRows: (variant === "requester-only release" ? [10] : [5, 10]).map(
              (n) => ({
                id: id(n),
                action: {
                  id: id(n),
                  capability_id: n === 5 ? "changeset.create" : "changeset.validate",
                  run_id: null,
                  run_source_release_id: id(9),
                },
                invocation: { id: id(n === 5 ? 6 : 11) },
                changeset: {
                  id: id(7),
                  run_id: variant === "requester-only release" ? id(15) : null,
                  run_source_release_id: variant === "requester-only release" ? null : id(9),
                  validation_generation: 1,
                  title: "private-retained-title",
                },
                audit: { id: id(8) },
                release: {
                  id: id(9),
                  site_id: "site-a",
                  source_id: id(1),
                  source_kind: "runtime-run",
                  evidence_body: body,
                  evidence_digest: releaseDigest,
                  released_at: releasedAt,
                  principal_id: id(2),
                  admission_key_digest: digest,
                },
                edges,
              }),
            ),
          }),
        });
        expect(result.issues.some((issue) => issue.code === "AGENT_RELATION_ORPHANED")).toBe(
          !["valid", "requester-only release"].includes(variant),
        );
        expect(JSON.stringify(result)).not.toContain("private-retained-title");
        expect(proof).toHaveBeenCalledTimes(1);
        expect(proof).toHaveBeenCalledWith(
          expect.objectContaining({ source: body, releasedAt: new Date(releasedAt) }),
        );
      } finally {
        proof.mockRestore();
      }
    },
  );
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
    expect(npAgentDiagnosticsSchemaInventoryV1.tables).toHaveLength(50);
    expect(npAgentDiagnosticsSchemaInventoryV1.constraints).toHaveLength(343);
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
