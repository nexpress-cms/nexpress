import { describe, expect, it, vi } from "vitest";
import { npRequireAgentEvidenceRequestV1 } from "../agent-contract/canonical-provider.js";
import { createAgentRuntimeContextV1 } from "./runtime-context.js";
import { npIsAgentRuntimeDocumentEvidenceReaderV1 } from "./read-capability-executors.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";

const reference = {
  kind: "document",
  collection: "posts",
  documentId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  projection: "bounded-text",
};

describe("Runtime context source boundary", () => {
  it("reuses the closed evidence owner without exposing arbitrary selectors", () => {
    expect(npRequireAgentEvidenceRequestV1(reference)).toEqual(reference);
    for (const input of [
      { ...reference, url: "https://example.test" },
      { ...reference, query: "select * from users" },
      { ...reference, classification: "public-only" },
      { ...reference, projection: "raw" },
      { ...reference, collection: "posts", documentId: "x".repeat(129) },
      { kind: "url", url: "https://example.test" },
      { kind: "plugin", method: "invoke" },
    ])
      expect(() => npRequireAgentEvidenceRequestV1(input)).toThrow();
  });

  it("does not evaluate attacker-controlled source getters", () => {
    const getter = vi.fn(() => "posts");
    const value = Object.defineProperty({ ...reference }, "collection", {
      get: getter,
      enumerable: true,
    });
    expect(() => npRequireAgentEvidenceRequestV1(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects a generic callback masquerading as the framework document reader", () => {
    expect(npIsAgentRuntimeDocumentEvidenceReaderV1({ read: vi.fn(), projectText: vi.fn() })).toBe(
      false,
    );
  });

  it("rejects over-bound or duplicate requests before touching current authority", async () => {
    const withCurrentRun = vi.fn();
    const admission: NpAgentRuntimeAdmissionV1 = { admit: vi.fn(), withCurrentRun };
    const context = createAgentRuntimeContextV1({ admission });
    const base = {
      siteId: "default",
      runId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
      providerCallId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
      sequence: 1,
      retryOfId: null,
      idempotencyKey: "fixture",
    };
    const parsed = npRequireAgentEvidenceRequestV1(reference);
    await expect(
      context.prepare({ ...base, evidence: Array.from({ length: 33 }, () => parsed) }),
    ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE" });
    await expect(context.prepare({ ...base, evidence: [parsed, parsed] })).rejects.toMatchObject({
      code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE",
    });
    expect(withCurrentRun).not.toHaveBeenCalled();
  });
});
