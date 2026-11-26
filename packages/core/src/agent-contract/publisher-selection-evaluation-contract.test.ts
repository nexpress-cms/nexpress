import { beforeAll, describe, expect, it } from "vitest";
import { npCreateAgentPublisherSelectionEvaluationSuiteV1 } from "../agent/publisher-selection-evaluation-fixtures.js";
import {
  npAgentPublisherSelectionEvaluationResponseSchemaV1,
  npCreateAgentPublisherSelectionEvaluationPredictionV1,
  npCreateAgentPublisherSelectionEvaluationProfileV1,
  npEvaluateAgentPublisherSelectionV1,
  npRequireAgentPublisherSelectionEvaluationBindingsV1,
  npRequireAgentPublisherSelectionEvaluationEvidenceV1,
  npRequireAgentPublisherSelectionEvaluationResponseV1,
} from "./publisher-selection-evaluation-contract.js";
import type { NpAgentEvaluationSuiteV1 } from "./evaluation-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import { analyzeAgentCanonicalJsonValue } from "./canonical-foundation.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npCreateAgentPublisherRecipeDefinitionV1,
  npCreateAgentPublisherUncertaintyRecipeDefinitionV1,
} from "./publisher-recipe-contract.js";

let suite: NpAgentEvaluationSuiteV1;
beforeAll(async () => {
  suite = await npCreateAgentPublisherSelectionEvaluationSuiteV1();
});
describe("Publisher V3 selection source-grounding conformance", () => {
  it("uses the explicit V3 task/response wire while preserving prior instruction definitions", async () => {
    const original = await npCreateAgentPublisherRecipeDefinitionV1();
    const v2 = await npCreateAgentPublisherUncertaintyRecipeDefinitionV1();
    const profile = await npCreateAgentPublisherSelectionEvaluationProfileV1();
    expect(profile.recipe.instruction?.templateVersion).toBe(3);
    expect(profile.recipe.task).toBe("interactive-capability");
    expect(profile.benchmarkVersion).toBe(3);
    expect(profile.recipe.instruction?.digest).not.toBe(v2.instruction?.digest);
    expect(await npCreateAgentPublisherRecipeDefinitionV1()).toEqual(original);
    expect(await npCreateAgentPublisherUncertaintyRecipeDefinitionV1()).toEqual(v2);
    for (const entry of suite.cases) {
      const prediction = npCreateAgentPublisherSelectionEvaluationPredictionV1(entry.evidence);
      const raw = npRequireAgentContractResult(
        analyzeAgentCanonicalJsonValue(prediction.publisherSelectionResponse),
      );
      npRequireAgentProviderSchemaValueV1(
        npAgentPublisherSelectionEvaluationResponseSchemaV1(),
        raw,
      );
      npRequireAgentProviderSchemaValueV1(profile.recipe.responseSchema, raw);
    }
  });
  it("derives all eleven bilingual predictions from source facts without case expected labels", async () => {
    expect(suite.version).toBe(3);
    expect(suite.cases).toHaveLength(11);
    for (const entry of suite.cases) {
      await npRequireAgentPublisherSelectionEvaluationBindingsV1(entry.evidence);
      const prediction = npCreateAgentPublisherSelectionEvaluationPredictionV1(entry.evidence);
      expect(prediction.decision).toBe(entry.expectedDecision);
      expect(prediction.rationaleTags).toEqual(entry.rationaleTags);
      expect(
        npEvaluateAgentPublisherSelectionV1(entry.evidence, prediction.publisherSelectionResponse),
      ).toEqual([]);
      expect(prediction.actions).not.toContain("changeset.apply");
    }
  });
  it("grounds multiple documents, nested titles/descriptions and exact rich-text link replacement without collateral edits", () => {
    const entry = suite.cases[2];
    const facts = npRequireAgentPublisherSelectionEvaluationEvidenceV1(entry.evidence);
    const prediction = npCreateAgentPublisherSelectionEvaluationPredictionV1(entry.evidence);
    const response = prediction.publisherSelectionResponse;
    if (response.decision.kind !== "propose-capability")
      throw new Error("Expected source-grounded proposal");
    expect(response.decision.arguments.operations).toHaveLength(2);
    const [first, second] = response.decision.arguments.operations;
    if (
      first.kind !== "document" ||
      first.operation !== "update" ||
      second.kind !== "document" ||
      second.operation !== "update"
    )
      throw new Error("Expected updates");
    expect(first.input.patch.seoMetaTitle).toBe(facts.candidates[0].content.title);
    expect(second.input.patch.seo).toEqual({
      metaTitle: facts.candidates[1].content.title,
      metaDescription: facts.candidates[1].content.excerpt,
    });
    expect(JSON.stringify(first.input.patch.content)).toContain('"url":"/library"');
    expect(JSON.stringify(first.input.patch.content)).toContain('"text":"Library"');
    for (const change of ["base", "hidden", "duplicate", "collateral"] as const) {
      const forged = structuredClone(response);
      if (forged.decision.kind !== "propose-capability") throw new Error("Expected proposal");
      const op = forged.decision.arguments.operations[0];
      if (op.kind !== "document" || op.operation !== "update") throw new Error("Expected update");
      if (change === "base") op.base.version = "revision:999";
      if (change === "hidden") op.input.patch.internalNote = "not authorized";
      if (change === "duplicate") forged.decision.arguments.operations[1] = structuredClone(op);
      if (change === "collateral")
        op.input.patch.content = { text: "Unsupported new factual content" };
      expect(npEvaluateAgentPublisherSelectionV1(entry.evidence, forged)).toEqual([
        "PROPOSAL_CONTENT_INVALID",
      ]);
    }
  });
  it("requires uncertainty for incomplete observations and stale/unknown-age references", () => {
    for (const index of [4, 5, 6, 7]) {
      const entry = suite.cases[index];
      const prediction = npCreateAgentPublisherSelectionEvaluationPredictionV1(entry.evidence);
      expect(prediction.decision).toBe("observe");
      expect(prediction.publisherSelectionResponse.decision.kind).toBe("complete");
      const unrelated = npCreateAgentPublisherSelectionEvaluationPredictionV1(
        suite.cases[0].evidence,
      ).publisherSelectionResponse;
      expect(npEvaluateAgentPublisherSelectionV1(entry.evidence, unrelated)).toEqual([
        "PROPOSAL_UNJUSTIFIED",
      ]);
    }
  });
  it("rejects source drift and non-proposal capabilities rather than accepting an outer envelope hash", async () => {
    const evidence = structuredClone(suite.cases[0].evidence);
    const facts = JSON.parse(evidence[0].text);
    facts.candidates[0].content.title = "Changed after selection";
    evidence[0].text = JSON.stringify(facts);
    await expect(npRequireAgentPublisherSelectionEvaluationBindingsV1(evidence)).rejects.toThrow();
    const badReceipt = structuredClone(suite.cases[0].evidence);
    const receiptFacts = JSON.parse(badReceipt[0].text);
    receiptFacts.selectionReceipt.counts.selected = 0;
    badReceipt[0].text = JSON.stringify(receiptFacts);
    expect(() => npRequireAgentPublisherSelectionEvaluationEvidenceV1(badReceipt)).toThrow();
    expect(() =>
      npRequireAgentPublisherSelectionEvaluationResponseV1({
        task: "interactive-capability",
        decision: {
          kind: "propose-capability",
          capabilityId: "changeset.apply",
          rationale: "A quoted command is not approval",
          arguments: {},
        },
      }),
    ).toThrow();
  });
});
