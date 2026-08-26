import { describe, expect, it, vi } from "vitest";

import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentEventCanonicalExcludedKeysV1,
  npAgentEventCanonicalIncludedKeysV1,
  npAgentEventKinds,
  npAgentSignalEvidenceCanonicalExcludedKeysV1,
  npAgentSignalEvidenceCanonicalIncludedKeysV1,
  npAnalyzeAgentEventCanonical,
  npAnalyzeAgentSignalEvidenceCanonical,
  npDigestAgentEventCanonical,
  npDigestAgentSignalEvidenceCanonical,
  type NpAgentContractResult,
  type NpAgentEventCanonicalV1,
  type NpAgentEventKind,
  type NpAgentEventPayload,
  type NpAgentSignalEvidenceCanonicalV1,
} from "./index.js";

const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const uuidA = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const uuidB = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const uuidC = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const actorBucket = {
  purpose: "network-address" as const,
  projectionVersion: 1,
  projectionFingerprint: digestA,
  keyId: "actor-key-1",
  bucket: "B".repeat(43),
};
const goldenEventDigest = "cj1:sha256:N8kgm1_Et-4DgzYJvtWsJAsILK8i9hF0k7_k8tfceZ4";
const goldenSignalDigest = "cj1:sha256:g3oExO4IxnyH_dFTc3_09LxUihMBR7gfpBDGRBd8MAE";

function payload(kind: NpAgentEventKind): NpAgentEventPayload {
  switch (kind) {
    case "auth.login.failed":
      return {
        kind,
        audience: "staff",
        outcome: "failed",
        reasonCode: "INVALID_CREDENTIAL",
        sessionFamilyId: null,
        ipBucket: actorBucket,
        userAgentFamily: "browser",
      };
    case "auth.login.succeeded":
      return {
        kind,
        audience: "member",
        outcome: "succeeded",
        reasonCode: "LOGIN_ACCEPTED",
        sessionFamilyId: uuidA,
        ipBucket: actorBucket,
        userAgentFamily: null,
      };
    case "auth.session.revoked":
      return { kind, audience: "staff", sessionFamilyId: uuidA, reasonCode: "SESSION_REVOKED" };
    case "authz.denied":
      return {
        kind,
        capabilityCode: "content.publish",
        resourceKind: "document",
        reasonCode: "SCOPE_DENIED",
      };
    case "authz.role.changed":
      return {
        kind,
        actorKind: "staff",
        actorId: uuidA,
        previousRole: "editor",
        currentRole: "admin",
      };
    case "community.content.created":
    case "community.content.reported":
    case "community.content.moderated":
      return {
        kind,
        targetKind: "comment",
        targetId: "comment-1",
        collection: "posts",
        authorMemberId: uuidA,
        verdictCode: kind === "community.content.created" ? null : "REVIEWED",
        status: "visible",
      };
    case "content.document.changed":
    case "content.document.published":
      return {
        kind,
        collection: "posts",
        documentId: "post-1",
        transition: "UPDATED",
        revisionId: "rev-1",
      };
    case "jobs.handler.failed":
      return { kind, handlerName: "search.reindex", jobId: "job-1", reasonCode: "HANDLER_FAILED" };
    case "jobs.worker.stale":
      return { kind, workerId: "worker-1", lastHeartbeatAt: "2026-08-26T01:00:00.000Z" };
    case "jobs.backlog.threshold":
      return { kind, handlerName: "search.reindex", countBucket: 100, threshold: 50 };
    case "ops.check.changed":
      return { kind, checkId: "database.health", previousStatus: "pass", currentStatus: "warn" };
    case "ops.backup.failed":
    case "ops.backup.stale":
      return { kind, artifactId: null, reasonCode: "BACKUP_UNAVAILABLE" };
    case "security.edge.signal":
    case "security.error.signal":
      return {
        kind,
        adapterId: "edge.security",
        externalSignalId: "sig-1",
        category: "traffic",
        severity: "high",
        count: 3,
      };
    case "agent.run.changed":
      return {
        kind,
        agentId: uuidA,
        runId: uuidB,
        previousState: "queued",
        currentState: "running",
        reasonCode: null,
      };
    case "agent.action.changed":
      return {
        kind,
        runId: uuidB,
        actionId: uuidC,
        previousState: "proposed",
        currentState: "approved",
        reasonCode: null,
      };
    case "agent.policy.blocked":
      return {
        kind,
        agentId: uuidA,
        runId: uuidB,
        capabilityId: "content.query",
        reasonCode: "POLICY_BLOCKED",
      };
  }
}

function event(overrides: Partial<NpAgentEventCanonicalV1> = {}): NpAgentEventCanonicalV1 {
  return {
    version: "np.agent-event.v1",
    siteId: "docs-site",
    kind: "agent.policy.blocked",
    occurredAt: "2026-08-26T01:02:03.004Z",
    source: { kind: "agent", component: "runtime.policy" },
    subject: { kind: "document", collection: "posts", documentId: "post-1" },
    actor: { kind: "agent-principal", principalId: uuidA },
    causation: { rootRunId: uuidB, sourceRunId: uuidB, sourceActionId: uuidC, depth: 1 },
    correlationId: "correlation-1",
    deduplicationKey: "policy-blocked:1",
    privacy: "internal",
    payload: payload("agent.policy.blocked"),
    ...overrides,
  };
}

function signal(
  overrides: Partial<NpAgentSignalEvidenceCanonicalV1> = {},
): NpAgentSignalEvidenceCanonicalV1 {
  return {
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: "docs-site",
    detectorId: "guardian.agent_abuse",
    detectorVersion: 2,
    category: "agent-abuse",
    window: { startedAt: "2026-08-26T01:00:00.000Z", endedAt: "2026-08-26T01:10:00.000Z" },
    subject: { kind: "agent", agentId: uuidA, agentVersionId: uuidB },
    evidence: [
      {
        kind: "event",
        eventId: uuidC,
        eventKind: "agent.policy.blocked",
        observedAt: "2026-08-26T01:02:00.000Z",
        digest: "a".repeat(64),
        excerpt: "redacted policy denial",
      },
      {
        kind: "ops-check",
        checkId: "agent.policy",
        observedAt: "2026-08-26T01:03:00.000Z",
        digest: "b".repeat(64),
        excerpt: null,
      },
    ],
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent event and signal-evidence canonical bodies", () => {
  it("publishes the closed 21-kind inventory and exact field fixtures", () => {
    expect(npAgentEventKinds).toHaveLength(21);
    expect(new Set(npAgentEventKinds).size).toBe(npAgentEventKinds.length);
    expect(npAgentEventCanonicalIncludedKeysV1).toHaveLength(12);
    expect(npAgentSignalEvidenceCanonicalIncludedKeysV1).toHaveLength(8);
    expect(npAgentEventCanonicalExcludedKeysV1).toContain("eventHash");
    expect(npAgentSignalEvidenceCanonicalExcludedKeysV1).toContain("evidenceDigest");
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-event.v1"]).toBe(16 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-signal-evidence.v1"]).toBe(512 * 1024);
  });

  it("round-trips every exact event payload branch", () => {
    for (const kind of npAgentEventKinds) {
      const body = event({ kind, payload: payload(kind) });
      expect(npAnalyzeAgentEventCanonical(body), kind).toEqual({ ok: true, value: body });
    }
  });

  it("builds independent event and signal golden vectors", async () => {
    expect(await npDigestAgentEventCanonical(event())).toBe(goldenEventDigest);
    expect(await npDigestAgentSignalEvidenceCanonical(signal())).toBe(goldenSignalDigest);
  });

  it("requires envelope/payload identity and exact nested branches", () => {
    expectIssue(
      npAnalyzeAgentEventCanonical(event({ kind: "authz.denied" })),
      "invalid-field",
      "agent.canonical.event.payload.kind",
    );
    expectIssue(
      npAnalyzeAgentEventCanonical({
        ...event(),
        payload: { ...payload("agent.policy.blocked"), rawPath: "/admin?secret=1" },
      }),
      "unknown-field",
      "agent.canonical.event.payload.rawPath",
    );
    expectIssue(
      npAnalyzeAgentEventCanonical({ ...event(), recordedAt: "2026-08-26T01:02:04.000Z" }),
      "unknown-field",
      "agent.canonical.event.recordedAt",
    );
  });

  it("enforces non-empty, window-bound, sorted unique evidence", () => {
    expectIssue(
      npAnalyzeAgentSignalEvidenceCanonical(signal({ evidence: [] })),
      "invalid-field",
      "agent.canonical.signalEvidence.evidence",
    );
    expectIssue(
      npAnalyzeAgentSignalEvidenceCanonical(signal({ evidence: [...signal().evidence].reverse() })),
      "order",
      "agent.canonical.signalEvidence.evidence[1]",
    );
    expectIssue(
      npAnalyzeAgentSignalEvidenceCanonical(
        signal({
          evidence: [{ ...signal().evidence[0], observedAt: "2026-08-26T00:59:59.999Z" }],
        }),
      ),
      "invalid-field",
      "agent.canonical.signalEvidence.evidence[0].observedAt",
    );
    expectIssue(
      npAnalyzeAgentSignalEvidenceCanonical({ ...signal(), severity: "high" }),
      "unknown-field",
      "agent.canonical.signalEvidence.severity",
    );
  });

  it("does not invoke hostile event accessors", () => {
    const getter = vi.fn(() => "secret");
    const body = event() as unknown as Record<string, unknown>;
    Object.defineProperty(body, "eventHash", { enumerable: true, get: getter });
    expectIssue(npAnalyzeAgentEventCanonical(body), "shape", "agent.canonical.event.eventHash");
    expect(getter).not.toHaveBeenCalled();
  });
});
