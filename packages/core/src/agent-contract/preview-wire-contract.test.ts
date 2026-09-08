import { describe, expect, it } from "vitest";
import {
  npRequireAgentPreviewReportV1,
  npRequireAgentPreviewReportPartsV1,
  npRequireAgentChangeSetPreviewRequestV1,
  npRequireAgentChangeSetPreviewLaunchRequestV1,
  npAgentPreviewIssueMessagesV1,
  npDigestAgentPreviewWireContractV1,
} from "./changeset-wire-contract.js";
const digest = `cj1:sha256:${"a".repeat(43)}`;
const id = "00000000-0000-4000-8000-000000000001";
const report = () => ({
  schemaVersion: "np.agent-preview-report.v1",
  siteId: "default",
  changeSetId: id,
  previewId: id,
  generation: 1,
  planHash: digest,
  previewContractFingerprint: digest,
  part: 1,
  totalParts: 1,
  results: [
    {
      id: "result-1",
      checkId: "broken-links",
      status: "warning",
      route: { route: "/", locale: null, audience: "public" },
      issueIds: ["issue-1"],
    },
  ],
  issues: [
    {
      id: "issue-1",
      resultId: "result-1",
      severity: "warning",
      code: "EXTERNAL_UNVERIFIED",
      safeMessage: npAgentPreviewIssueMessagesV1.EXTERNAL_UNVERIFIED,
      target: null,
      evidenceRefs: [],
    },
  ],
  generatedAt: "2026-09-08T00:00:00.000Z",
});
describe("closed preview reports and admission", () => {
  it("accepts the complete bounded set", () =>
    expect(npRequireAgentPreviewReportPartsV1([report()])).toEqual([report()]));
  it("keeps empty evidence honest", () =>
    expect(npRequireAgentPreviewReportPartsV1([])).toEqual([]));
  it.each(["body", "cookie", "locator", "rawError", "html"])("rejects %s at the boundary", (key) =>
    expect(() => npRequireAgentPreviewReportV1({ ...report(), [key]: "private" })).toThrow(),
  );
  it("rejects arbitrary prose and external URLs with queries", () => {
    const value = {
      ...report(),
      issues: [{ ...report().issues[0], safeMessage: "someone@example.com" }],
    };
    expect(() => npRequireAgentPreviewReportV1(value)).toThrow();
    expect(() =>
      npRequireAgentPreviewReportV1({
        ...report(),
        issues: [
          {
            ...report().issues[0],
            target: { kind: "external-origin", origin: "https://example.com/?secret=1" },
          },
        ],
      }),
    ).toThrow();
  });
  it("requires complete contiguous multipart identity", () => {
    expect(() => npRequireAgentPreviewReportPartsV1([{ ...report(), totalParts: 2 }])).toThrow();
    expect(() =>
      npRequireAgentPreviewReportPartsV1([report(), { ...report(), part: 2, totalParts: 2 }]),
    ).toThrow();
  });
  it("rejects dangling and multiply owned issues", () => {
    const value = report();
    value.issues[0].resultId = "missing";
    expect(() => npRequireAgentPreviewReportPartsV1([value])).toThrow();
    const duplicate = report();
    duplicate.results[0].issueIds.push("issue-1");
    expect(() => npRequireAgentPreviewReportPartsV1([duplicate])).toThrow();
  });
  it("rejects report size and evidence-count overflow", () => {
    expect(() =>
      npRequireAgentPreviewReportV1({
        ...report(),
        results: Array.from({ length: 1001 }, () => report().results[0]),
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentPreviewReportV1({
        ...report(),
        issues: [
          {
            ...report().issues[0],
            evidenceRefs: Array.from({ length: 9 }, () => ({ kind: "artifact", id })),
          },
        ],
      }),
    ).toThrow();
  });
  it("reuses row/plan/idempotency fences and canonical routes", () => {
    const request = { idempotencyKey: "preview-1", expectedVersion: 1, expectedPlanHash: digest };
    expect(npRequireAgentChangeSetPreviewRequestV1(request)).toEqual(request);
    expect(
      npRequireAgentChangeSetPreviewLaunchRequestV1({ ...request, route: "/posts" }).route,
    ).toBe("/posts");
    for (const route of ["//evil.test", "/a/../b", "/a?token=x", "/a#token", "/a/%2f"])
      expect(() => npRequireAgentChangeSetPreviewLaunchRequestV1({ ...request, route })).toThrow();
  });
  it("has a deterministic wire fingerprint", async () => {
    expect(await npDigestAgentPreviewWireContractV1()).toMatch(/^cj1:sha256:[A-Za-z0-9_-]{43}$/u);
    expect(await npDigestAgentPreviewWireContractV1()).toBe(
      "cj1:sha256:Ac6wsMutlY515VQOeQR7u0xiKIbYtY-bhL3iOkd-CJ4",
    );
  });
});
