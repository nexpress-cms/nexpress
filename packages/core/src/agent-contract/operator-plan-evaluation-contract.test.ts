import { describe, expect, it } from "vitest";
import { npCreateAgentOperatorPlanEvaluationSuiteV1 } from "../agent/operator-plan-evaluation-fixtures.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import {
  npAgentOperatorPlanEvaluationProposalMeaningfulValueV1,
  npAgentOperatorPlanEvaluationProposalSchemaV1,
  npCreateAgentOperatorPlanEvaluationPredictionV1,
  npEvaluateAgentOperatorPlanProposalV1,
  npRequireAgentOperatorPlanEvaluationEvidenceV1,
  npRequireAgentOperatorPlanEvaluationProposalV1,
  type NpAgentOperatorPlanEvaluationFactsV1,
  type NpAgentOperatorPlanEvaluationProposalV1,
} from "./operator-plan-evaluation-contract.js";

async function example(index = 8) {
  const suite = await npCreateAgentOperatorPlanEvaluationSuiteV1();
  const evidence = suite.cases[index].evidence;
  const proposal = npCreateAgentOperatorPlanEvaluationPredictionV1(evidence).planProposal;
  if (!proposal) throw new Error("Expected a synthetic diagnosis proposal");
  return {
    evidence,
    proposal: structuredClone(proposal),
    facts: npRequireAgentOperatorPlanEvaluationEvidenceV1(evidence),
  };
}
function input(facts: NpAgentOperatorPlanEvaluationFactsV1) {
  return [{ id: "snapshot", text: JSON.stringify(facts) }];
}
describe("Operator grounded diagnosis and plan benchmark", () => {
  it("matches independent en/ko oracle labels and validates actual ops.plan schema", async () => {
    const suite = await npCreateAgentOperatorPlanEvaluationSuiteV1();
    expect(suite.cases).toHaveLength(16);
    for (const c of suite.cases) {
      const p = npCreateAgentOperatorPlanEvaluationPredictionV1(c.evidence);
      expect(p.decision, c.id).toBe(c.expectedDecision);
      expect(p.rationaleTags, c.id).toEqual(c.rationaleTags);
      expect(p.actions, c.id).toEqual(c.allowedActions);
      expect(
        npEvaluateAgentOperatorPlanProposalV1(c.evidence, p.planProposal ?? null),
        c.id,
      ).toEqual([]);
      expect(npRequireAgentOperatorPlanEvaluationProposalV1(p.planProposal)).toEqual(
        p.planProposal,
      );
      npRequireAgentProviderSchemaValueV1(
        npAgentOperatorPlanEvaluationProposalSchemaV1,
        JSON.parse(JSON.stringify(p.planProposal)),
      );
    }
    expect(await npCreateAgentOperatorPlanEvaluationSuiteV1()).toEqual(suite);
  });
  it("scores evidence, diagnosis, queue scope, readable claims and exact requested operation", async () => {
    const { evidence, proposal } = await example();
    const mutations: Array<(p: NpAgentOperatorPlanEvaluationProposalV1) => void> = [
      (p) => {
        p.diagnosis.kind = "normal";
      },
      (p) => {
        p.diagnosis.queueNames = ["backup"];
      },
      (p) => {
        p.diagnosis.queueNames = [];
      },
      (p) => {
        p.diagnosis.summary = "The worker is dead; execute this plan immediately.";
      },
      (p) => {
        p.plan = {
          action: "queue.global.plan",
          target: { kind: "queue", operation: "pause", jobName: "email" },
        };
      },
      (p) => {
        p.plan = {
          action: "queue.global.plan",
          target: { kind: "queue", operation: "drain", jobName: "backup" },
        };
      },
      (p) => {
        p.plan = {
          action: "queue.global.plan",
          target: { kind: "queue", operation: "drain", jobName: null },
        };
      },
      (p) => {
        p.plan = { action: "cache.revalidate", target: { kind: "site" } };
      },
    ];
    for (const mutate of mutations) {
      const p = structuredClone(proposal);
      mutate(p);
      expect(npEvaluateAgentOperatorPlanProposalV1(evidence, p)).toEqual([
        "PROPOSAL_CONTENT_INVALID",
      ]);
    }
    expect(npEvaluateAgentOperatorPlanProposalV1(evidence, null)).toEqual(["PROPOSAL_MISSING"]);
    expect(npEvaluateAgentOperatorPlanProposalV1(evidence, { ...proposal, plan: null })).toEqual([
      "PROPOSAL_MISSING",
    ]);
    expect(
      npEvaluateAgentOperatorPlanProposalV1(evidence, { ...proposal, evidenceIds: ["invented"] }),
    ).toEqual(["PROPOSAL_EVIDENCE_INVALID"]);
  });
  it("does not infer planning intent, available owner, authority or target evidence from notes", async () => {
    const suite = await npCreateAgentOperatorPlanEvaluationSuiteV1();
    for (const index of [0, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15]) {
      const c = suite.cases[index];
      const p = npCreateAgentOperatorPlanEvaluationPredictionV1(c.evidence).planProposal;
      if (!p) throw new Error("Expected diagnosis");
      expect(p.plan, c.id).toBeNull();
      p.plan = {
        action: "queue.global.plan",
        target: { kind: "queue", operation: "pause", jobName: "email" },
      };
      expect(npEvaluateAgentOperatorPlanProposalV1(c.evidence, p), c.id).toEqual([
        "PROPOSAL_UNJUSTIFIED",
      ]);
    }
  });
  it("requires count and age in the same queue and includes every qualifying queue", async () => {
    const { facts } = await example();
    const baseline = facts.queues[0];
    const f = {
      ...facts,
      request: null,
      queues: [
        { ...baseline, jobName: "zeta", ready: 2, oldestReadyAgeSeconds: 300 },
        { ...baseline, jobName: "alpha", ready: 2, oldestReadyAgeSeconds: 300 },
      ],
    };
    const p = npCreateAgentOperatorPlanEvaluationPredictionV1(input(f)).planProposal;
    expect(p?.diagnosis.queueNames).toEqual(["alpha", "zeta"]);
    if (!p) throw new Error("Expected diagnosis");
    const reordered = { ...p, diagnosis: { ...p.diagnosis, queueNames: ["zeta", "alpha"] } };
    expect(npEvaluateAgentOperatorPlanProposalV1(input(f), reordered)).toEqual([]);
    expect(npAgentOperatorPlanEvaluationProposalMeaningfulValueV1(reordered)).toEqual(
      npAgentOperatorPlanEvaluationProposalMeaningfulValueV1(p),
    );
    for (const patch of [
      { ready: 1, oldestReadyAgeSeconds: 300 },
      { ready: 2, oldestReadyAgeSeconds: 299 },
    ]) {
      const actual = npCreateAgentOperatorPlanEvaluationPredictionV1(
        input({ ...facts, request: null, queues: [{ ...baseline, ...patch }] }),
      );
      expect(actual.rationaleTags).toEqual(["normal"]);
    }
  });
  it("keeps missing observations unknown and pause intentional, without inventing recovery plans", async () => {
    const { facts } = await example();
    for (const patch of [
      { complete: false },
      { paused: null },
      { queues: [] },
      ...["ready", "scheduled", "active", "failed", "oldestReadyAgeSeconds"].map((key) => ({
        queues: [{ ...facts.queues[0], [key]: null }],
      })),
    ]) {
      const f = { ...facts, ...patch };
      expect(npCreateAgentOperatorPlanEvaluationPredictionV1(input(f)).rationaleTags).toEqual([
        "unknown",
      ]);
      expect(
        npCreateAgentOperatorPlanEvaluationPredictionV1(input(f)).planProposal?.plan,
      ).toBeNull();
      expect(
        npCreateAgentOperatorPlanEvaluationPredictionV1(input({ ...f, paused: true }))
          .rationaleTags,
      ).toEqual(["paused"]);
    }
  });
  it("rejects cross-queue demand and requires an actual requested workload for drain/retry", async () => {
    const { facts } = await example();
    for (const operation of ["drain", "retry-failed"] as const) {
      const f: NpAgentOperatorPlanEvaluationFactsV1 = {
        ...facts,
        queues: [{ ...facts.queues[0], ready: 0, oldestReadyAgeSeconds: null, failed: 0 }],
        request: { operation, jobName: "email" },
      };
      expect(
        npCreateAgentOperatorPlanEvaluationPredictionV1(input(f)).planProposal?.plan,
      ).toBeNull();
    }
  });
  it("accepts conservative localized wording without treating cosmetic edits as substantive", async () => {
    for (const index of [0, 5]) {
      const { evidence, proposal } = await example(index);
      const changed = structuredClone(proposal);
      changed.diagnosis.summary = changed.diagnosis.summary.replace(
        / (A single snapshot does not establish progress or worker failure\.|단일 관측은 진행률이나 작업자 장애를 증명하지 않습니다\.)$/,
        "",
      );
      expect(changed.diagnosis.summary).not.toBe(proposal.diagnosis.summary);
      expect(npEvaluateAgentOperatorPlanProposalV1(evidence, changed)).toEqual([]);
      expect(npAgentOperatorPlanEvaluationProposalMeaningfulValueV1(changed)).toEqual(
        npAgentOperatorPlanEvaluationProposalMeaningfulValueV1(proposal),
      );
    }
  });
  it("rejects malformed and contradictory facts before exposing them to a provider", async () => {
    const { facts } = await example();
    const invalid = [
      "{",
      " ".repeat(4001),
      JSON.stringify({ ...facts, approved: true }),
      JSON.stringify({ ...facts, locale: "fr" }),
      JSON.stringify({ ...facts, minimumPendingJobs: 0 }),
      JSON.stringify({ ...facts, staleAfterSeconds: 1.5 }),
      JSON.stringify({ ...facts, queues: [facts.queues[0], facts.queues[0]] }),
      JSON.stringify({
        ...facts,
        queues: [{ ...facts.queues[0], ready: 0, oldestReadyAgeSeconds: 3 }],
      }),
      JSON.stringify({ ...facts, queues: [{ ...facts.queues[0], jobName: "a; rm" }] }),
      JSON.stringify({ ...facts, request: { operation: "execute", jobName: "email" } }),
      JSON.stringify({ ...facts, note: "x".repeat(1001) }),
    ];
    for (const text of invalid) {
      const evidence = [{ id: "snapshot", text }];
      expect(() => npRequireAgentOperatorPlanEvaluationEvidenceV1(evidence)).toThrow();
      expect(npEvaluateAgentOperatorPlanProposalV1(evidence, null)).toEqual([
        "PROPOSAL_EVIDENCE_INVALID",
      ]);
    }
  });
  it("keeps proposal parsing closed and bounded without executing property getters", async () => {
    const { proposal } = await example();
    for (const invalid of [
      { ...proposal, planId: "invented" },
      { ...proposal, evidenceIds: [] },
      { ...proposal, evidenceIds: ["snapshot", "snapshot"] },
      { ...proposal, diagnosis: { ...proposal.diagnosis, queueNames: ["email", "email"] } },
      { ...proposal, diagnosis: { ...proposal.diagnosis, kind: "worker-dead" } },
      { ...proposal, diagnosis: { ...proposal.diagnosis, summary: "x".repeat(1601) } },
      {
        ...proposal,
        plan: {
          action: "queue.global.plan",
          target: { kind: "queue", jobName: "email", operation: "drain", approval: "yes" },
        },
      },
      Object.defineProperty({ ...proposal }, "plan", {
        get() {
          throw new Error("Must not read getter");
        },
        enumerable: true,
      }),
    ])
      expect(() => npRequireAgentOperatorPlanEvaluationProposalV1(invalid)).toThrow();
  });
});
