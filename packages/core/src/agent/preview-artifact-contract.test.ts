import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  npDigestAgentPreviewArtifactContentV1,
  npRequireAgentPreviewArtifactUploadResolutionV1,
  npRequireAgentPreviewArtifactUploadSetV1,
  npDigestAgentPreviewArtifactUploadSetV1,
  npAgentPreviewArtifactUploadIdempotencyV1,
} from "./preview-artifact-contract.js";
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const set = {
  schemaVersion: "np.agent-preview-artifact-upload-set.v1",
  siteId: "default",
  changeSetId: "00000000-0000-4000-8000-000000000001",
  previewId: "00000000-0000-4000-8000-000000000002",
  generation: 1,
  planHash: digest,
  previewContractFingerprint: digest,
  uploads: [],
};
describe("Private preview artifact contract", () => {
  it("frames raw bytes with the exact ac1 domain and unsigned big endian length", () => {
    const bytes = new TextEncoder().encode("preview"),
      length = Buffer.alloc(8);
    length.writeBigUInt64BE(7n);
    expect(npDigestAgentPreviewArtifactContentV1(bytes)).toBe(
      `ac1:sha256:${createHash("sha256").update("np.agent-artifact-content.v1\0").update(length).update(bytes).digest("base64url")}`,
    );
    expect(npDigestAgentPreviewArtifactContentV1(bytes)).not.toBe(
      `ac1:sha256:${createHash("sha256").update(bytes).digest("base64url")}`,
    );
    expect(() => npDigestAgentPreviewArtifactContentV1(new Uint8Array(2097153))).toThrow();
  });
  it("accepts an empty frozen set and rejects extra authority or unknown keys", () => {
    expect(npRequireAgentPreviewArtifactUploadSetV1(set)).toEqual(set);
    expect(npDigestAgentPreviewArtifactUploadSetV1(set)).toMatch(
      /^aus1:sha256:[A-Za-z0-9_-]{43}$/u,
    );
    expect(() =>
      npRequireAgentPreviewArtifactUploadSetV1({ ...set, credential: "excluded" }),
    ).toThrow();
    expect(() =>
      npRequireAgentPreviewArtifactUploadSetV1({
        ...set,
        uploads: [
          {
            ordinal: 2,
            artifactId: set.previewId,
            uploadRequestDigest: "aur1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          },
        ],
      }),
    ).toThrow();
  });
  it("requires terminal promises and never infers no effect from pending", () => {
    expect(
      npRequireAgentPreviewArtifactUploadResolutionV1({
        status: "unknown",
        resolvedAt: null,
        safeCode: null,
      }),
    ).toEqual({ status: "unknown", resolvedAt: null, safeCode: null });
    expect(() =>
      npRequireAgentPreviewArtifactUploadResolutionV1({
        status: "not_started",
        resolvedAt: null,
        safeCode: null,
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentPreviewArtifactUploadResolutionV1({
        status: "committed",
        resolvedAt: "2026-09-08T00:00:00.000Z",
        safeCode: "INTERNAL",
      }),
    ).toThrow();
    expect(
      npAgentPreviewArtifactUploadIdempotencyV1(
        "aur1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toMatch(/^npau1_[A-Za-z0-9_-]{43}$/u);
  });
});
