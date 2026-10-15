import { describe, expect, it } from "vitest";
import { npCreateAgentModeratorAssessmentFixtureCorpusV1 } from "./moderator-assessment-fixtures.js";
import { npDigestAgentModeratorAssessmentExcerptV1 } from "./moderator-assessment-source.js";
import { npAgentModeratorAssessmentResponseSchemaV1 } from "../agent-contract/moderator-assessment-recipe-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "./provider-auth-contract.js";
import { analyzeAgentCanonicalJsonValue } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";

describe("versioned semantic assessment local conformance corpus", () => {
  it("preserves reproducible bilingual current, hostile, hard-negative and unavailable source bindings", () => {
    const corpus = npCreateAgentModeratorAssessmentFixtureCorpusV1();
    expect(corpus).toEqual(npCreateAgentModeratorAssessmentFixtureCorpusV1());
    expect(corpus.version).toBe(1);
    expect(corpus.cases).toHaveLength(8);
    expect(new Set(corpus.cases.map((item) => item.locale))).toEqual(new Set(["en", "ko"]));
    expect(new Set(corpus.cases.map((item) => item.expected.label))).toEqual(
      new Set(["spam", "abuse", "benign", "uncertain"]),
    );
    for (const item of corpus.cases) {
      for (const [index, excerpt] of item.input.excerpts.entries()) {
        const source = item.input.metadata.sources[index];
        expect(excerpt.text.length).toBeLessThanOrEqual(2000);
        expect(excerpt.id).toBe(source.id);
        expect(excerpt.digest).toBe(source.excerptDigest);
        expect(excerpt.digest).toBe(
          npDigestAgentModeratorAssessmentExcerptV1({
            subject: source.subject,
            currentVersionDigest: source.currentVersionDigest,
            text: excerpt.text,
          }),
        );
      }
      expect(item.expected.evidenceDigests).toEqual(
        item.input.metadata.sources.map((source) => source.excerptDigest).sort(),
      );
      if (item.availability !== "current") expect(item.expected.label).toBe("uncertain");
    }
  });
  it("accepts bounded synthetic classifications while rejecting capability/effect substitutions", () => {
    const schema = npAgentModeratorAssessmentResponseSchemaV1();
    for (const item of npCreateAgentModeratorAssessmentFixtureCorpusV1().cases) {
      const decision = item.expected;
      expect(() =>
        npRequireAgentProviderSchemaValueV1(
          schema,
          npRequireAgentContractResult(
            analyzeAgentCanonicalJsonValue({ task: "moderation-classification", decision }),
          ),
        ),
      ).not.toThrow();
    }
    expect(() =>
      npRequireAgentProviderSchemaValueV1(schema, {
        task: "interactive-capability",
        decision: {
          kind: "propose-capability",
          capabilityId: "moderation.quarantine",
          arguments: {},
        },
      }),
    ).toThrow();
  });
});
