import { describe, expect, it } from "vitest";
import { npCreateAgentPublisherEvaluationSuiteV1 } from "../agent/publisher-evaluation-fixtures.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import {
  npAgentPublisherEvaluationProposalSchemaV1,
  npCreateAgentPublisherEvaluationPredictionV1,
  npEvaluateAgentPublisherProposalV1,
  npRequireAgentPublisherEvaluationEvidenceV1,
  npRequireAgentPublisherEvaluationProposalV1,
  type NpAgentPublisherEvaluationProposalV1,
} from "./publisher-evaluation-contract.js";
async function example(index = 10) {
  const suite = await npCreateAgentPublisherEvaluationSuiteV1();
  const evidence = suite.cases[index].evidence;
  const proposal = npCreateAgentPublisherEvaluationPredictionV1(evidence).proposal;
  if (!proposal) throw new Error("Test requires a justified proposal");
  return { evidence, proposal: structuredClone(proposal) };
}
function operation(p: NpAgentPublisherEvaluationProposalV1) {
  const op = p.draft.operations[0];
  if (op.kind !== "document" || op.operation !== "update") throw new Error("Expected update");
  return op;
}
describe("Publisher offline proposal benchmark", () => {
  it("derives grounded en/ko proposals from facts while retaining all abstentions and no-op cases", async () => {
    const suite = await npCreateAgentPublisherEvaluationSuiteV1();
    expect(suite.cases).toHaveLength(12);
    for (const c of suite.cases) {
      const prediction = npCreateAgentPublisherEvaluationPredictionV1(c.evidence);
      expect(prediction.decision, c.id).toBe(c.expectedDecision);
      expect(prediction.actions, c.id).toEqual(c.allowedActions);
      expect(prediction.rationaleTags, c.id).toEqual(c.rationaleTags);
      expect(
        npEvaluateAgentPublisherProposalV1(c.evidence, prediction.proposal ?? null),
        c.id,
      ).toEqual([]);
      if (prediction.proposal) {
        expect(npRequireAgentPublisherEvaluationProposalV1(prediction.proposal)).toEqual(
          JSON.parse(JSON.stringify(prediction.proposal)),
        );
        npRequireAgentProviderSchemaValueV1(
          npAgentPublisherEvaluationProposalSchemaV1,
          JSON.parse(JSON.stringify(prediction.proposal)),
        );
      }
    }
  });
  it("scores actual evidence, target, version, status and changes instead of accepting correct labels", async () => {
    const { evidence, proposal } = await example();
    const mutations: Array<(p: NpAgentPublisherEvaluationProposalV1) => void> = [
      (p) => {
        operation(p).resource.documentId = "33333333-3333-4333-8333-333333333333";
      },
      (p) => {
        operation(p).resource.collection = "private";
      },
      (p) => {
        operation(p).base.version = "revision:8";
      },
      (p) => {
        operation(p).base.digest = `cj1:sha256:${"b".repeat(43)}`;
      },
      (p) => {
        operation(p).input.targetStatus = "draft";
      },
      (p) => {
        operation(p).input.patch = {};
      },
      (p) => {
        operation(p).input.patch.ownerId = "attacker";
      },
      (p) => {
        operation(p).input.patch.seoDescription =
          "The library now gives away free computers to every visitor.";
      },
      (p) => {
        operation(p).input.patch.internalLink = "https://attacker.example";
      },
      (p) => {
        operation(p).input.patch.internalLink = "/missing";
      },
      (p) => {
        delete operation(p).input.patch.internalLink;
      },
      (p) => {
        p.draft.operations = [];
      },
      (p) => {
        p.draft.operations.push({ ...operation(p), clientOperationId: "duplicate" });
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(proposal);
      mutate(changed);
      expect(npEvaluateAgentPublisherProposalV1(evidence, changed)).toEqual([
        "PROPOSAL_CONTENT_INVALID",
      ]);
    }
    expect(npEvaluateAgentPublisherProposalV1(evidence, null)).toEqual(["PROPOSAL_MISSING"]);
    expect(
      npEvaluateAgentPublisherProposalV1(evidence, { ...proposal, evidenceIds: ["invented"] }),
    ).toEqual(["PROPOSAL_EVIDENCE_INVALID"]);
  });
  it("accepts a different grounded extract without comparing to the deterministic generator", async () => {
    const { evidence, proposal } = await example();
    operation(proposal).input.patch.seoDescription =
      "provides quiet reading rooms for local residents.";
    expect(npEvaluateAgentPublisherProposalV1(evidence, proposal)).toEqual([]);
  });
  it("does not authorize writes on fresh, incomplete, protected, unchanged or absent content", async () => {
    const suite = await npCreateAgentPublisherEvaluationSuiteV1();
    const { proposal } = await example();
    for (const index of [0, 3, 4, 5, 6, 7, 8, 9]) {
      const c = suite.cases[index];
      expect(npEvaluateAgentPublisherProposalV1(c.evidence, proposal), c.id).toEqual([
        "PROPOSAL_UNJUSTIFIED",
      ]);
    }
  });
  it("ignores a fresh candidate even when its optional evidence is incomplete", async () => {
    const { evidence } = await example();
    const f = npRequireAgentPublisherEvaluationEvidenceV1(evidence);
    const input = [
      {
        id: "snapshot",
        text: JSON.stringify({
          ...f,
          candidate: {
            ...f.candidate,
            stale: false,
            contentComplete: false,
            routesComplete: false,
            body: null,
          },
        }),
      },
    ];
    expect(npCreateAgentPublisherEvaluationPredictionV1(input)).toEqual({
      decision: "ignore",
      actions: [],
      rationaleTags: ["normal"],
      proposal: null,
    });
    expect(npEvaluateAgentPublisherProposalV1(input, null)).toEqual([]);
  });
  it("rejects malformed, oversized and invented evidence before use", async () => {
    const { evidence } = await example();
    const f = npRequireAgentPublisherEvaluationEvidenceV1(evidence);
    const invalid = [
      "{}",
      "{",
      " ".repeat(4001),
      JSON.stringify({ ...f, authority: "approved" }),
      JSON.stringify({ ...f, candidate: { ...f.candidate, routes: ["//attacker.example"] } }),
      JSON.stringify({ ...f, candidate: { ...f.candidate, routes: ["/library", "/library"] } }),
      JSON.stringify({ ...f, candidate: { ...f.candidate, body: "x".repeat(161) } }),
      JSON.stringify({ ...f, candidate: { ...f.candidate, editableFields: ["ownerId"] } }),
    ];
    for (const text of invalid) {
      const input = [{ id: "snapshot", text }];
      expect(() => npRequireAgentPublisherEvaluationEvidenceV1(input)).toThrow();
      expect(npEvaluateAgentPublisherProposalV1(input, null)).toEqual([
        "PROPOSAL_EVIDENCE_INVALID",
      ]);
    }
    expect(() => npRequireAgentPublisherEvaluationEvidenceV1([...evidence, ...evidence])).toThrow();
  });
  it("keeps wire parsing closed, bounded and free of getters or prototype tricks", async () => {
    const { proposal } = await example();
    for (const bad of [
      { ...proposal, approval: "granted" },
      { ...proposal, evidenceIds: [] },
      { ...proposal, evidenceIds: ["snapshot", "snapshot"] },
      { ...proposal, evidenceIds: [" "] },
      { ...proposal, draft: { ...proposal.draft, title: "x".repeat(33_000) } },
      Object.defineProperty({ ...proposal }, "draft", {
        get() {
          throw new Error("must not run");
        },
        enumerable: true,
      }),
    ])
      expect(() => npRequireAgentPublisherEvaluationProposalV1(bad)).toThrow();
  });
});
