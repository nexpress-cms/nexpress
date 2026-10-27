import { describe, expect, it } from "vitest";
import vector from "./__fixtures__/canonical-v1.json" with { type: "json" };
import { npBuildCanonicalDigest, npRequireAgentSiteBlueprintV1 } from "./contract.js";
import {
  npBuildPreviewCheckIdsV1,
  npBuildPreviewIssueSummariesV1,
  npRequireAgentBuildPreviewReportV1,
  npRequireBuildPreviewReportForBlueprintV1,
  type NpAgentBuildPreviewReportV1,
} from "./preview-report.js";

const digest = `nb1:sha256:${"A".repeat(43)}`;
async function fixture() {
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      vector.structured.find((entry) => entry.purpose === "np.build-site-blueprint.v1")!.canonical,
    ),
  );
  blueprint.commands.push({
    id: "preview",
    cwd: "project",
    prerequisites: ["format"],
    timeoutSeconds: 3600,
    template: "preview-render",
    comparisonInputsDigest: digest,
    renderEnvironmentFingerprint: digest,
    routes: blueprint.pages.map((page) => ({
      pageId: page.id,
      route: page.route,
      locale: page.locale,
      audience: page.audience,
      fixtureIds: ["sample-home"],
    })),
    viewports: {
      desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
      mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
    },
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: [
      ...blueprint.pages.flatMap((page) =>
        (["desktop", "mobile"] as const).map((viewport) => ({
          kind: "screenshot" as const,
          pageId: page.id,
          viewport,
          path: `.nexpress/site/review/final/${page.id}-${viewport}.png`,
        })),
      ),
      { kind: "report", path: ".nexpress/site/review/final/report.json" },
    ],
    verificationResultPath: ".nexpress/site/review/final/result.json",
  });
  blueprint.verification.push(
    {
      id: "preview-exit",
      commandId: "preview",
      required: true,
      expected: "exit-zero",
      artifactPath: null,
    },
    {
      id: "preview-review",
      commandId: "preview",
      required: true,
      expected: "review-artifact",
      artifactPath: ".nexpress/site/review/final/result.json",
    },
  );
  const report: NpAgentBuildPreviewReportV1 = {
    schemaVersion: "np.agent-build-preview-report.v1",
    blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    comparisonInputsDigest: digest,
    renderEnvironmentFingerprint: digest,
    routes: blueprint.pages.map((page) => ({
      pageId: page.id,
      route: page.route,
      locale: page.locale,
      audience: page.audience,
      checks: npBuildPreviewCheckIdsV1.map((id) => ({ id, status: "pass", issueIds: [] })),
    })),
    issues: [],
  };
  return { blueprint, report };
}
describe("bounded observed preview report transport", () => {
  it("enforces the report byte ceiling even when every individual field is bounded", async () => {
    const { report } = await fixture();
    report.issues = Array.from({ length: 1000 }, (_, index) => ({
      id: `origin-${index}`,
      pageId: report.routes[0].pageId,
      checkId: "links" as const,
      severity: "warning" as const,
      code: "EXTERNAL_LINK_UNVERIFIED" as const,
      safeSummary: npBuildPreviewIssueSummariesV1.EXTERNAL_LINK_UNVERIFIED,
      target: { kind: "external-origin" as const, origin: `https://${"a".repeat(1500)}.invalid` },
      evidenceArtifactPaths: [],
    }));
    report.routes[0].checks[1] = {
      id: "links",
      status: "warning",
      issueIds: report.issues.map((issue) => issue.id).sort(),
    };
    expect(Buffer.byteLength(JSON.stringify(report))).toBeGreaterThan(512 * 1024);
    expect(() => npRequireAgentBuildPreviewReportV1(report)).toThrow();
  });
  it("binds the exact required route, audience, locale, environment and declared evidence without granting execution", async () => {
    const { blueprint, report } = await fixture();
    expect(await npRequireBuildPreviewReportForBlueprintV1(blueprint, report)).toEqual(report);
    report.routes[0].audience = "member";
    await expect(npRequireBuildPreviewReportForBlueprintV1(blueprint, report)).rejects.toThrow();
    report.routes[0].audience = "public";
    report.renderEnvironmentFingerprint = `nb1:sha256:${"B".repeat(42)}A`;
    await expect(npRequireBuildPreviewReportForBlueprintV1(blueprint, report)).rejects.toThrow();
  });
  it("rejects unreported failures, dangling or duplicate issue references and raw private summaries", async () => {
    const { report } = await fixture();
    report.issues.push({
      id: "overflow",
      pageId: report.routes[0].pageId,
      checkId: "overflow",
      severity: "error",
      code: "LAYOUT_OVERFLOW",
      safeSummary: npBuildPreviewIssueSummariesV1.LAYOUT_OVERFLOW,
      target: null,
      evidenceArtifactPaths: [],
    });
    expect(() => npRequireAgentBuildPreviewReportV1(report)).toThrow();
    const check = report.routes[0].checks[4];
    check.issueIds = ["overflow"];
    check.status = "fail";
    expect(npRequireAgentBuildPreviewReportV1(report).routes[0].checks[4].status).toBe("fail");
    report.issues[0].safeSummary = "password=private-dom-text";
    expect(() => npRequireAgentBuildPreviewReportV1(report)).toThrow();
    report.issues[0].safeSummary = npBuildPreviewIssueSummariesV1.LAYOUT_OVERFLOW;
    check.status = "pass";
    expect(() => npRequireAgentBuildPreviewReportV1(report)).toThrow();
  });
  it("keeps unrequested links explicit warnings and unsupported required checks blocking", async () => {
    const { blueprint, report } = await fixture();
    const pageId = report.routes[0].pageId;
    report.issues.push({
      id: "link",
      pageId,
      checkId: "links",
      severity: "warning",
      code: "EXTERNAL_LINK_UNVERIFIED",
      safeSummary: npBuildPreviewIssueSummariesV1.EXTERNAL_LINK_UNVERIFIED,
      target: { kind: "external-origin", origin: "https://example.invalid" },
      evidenceArtifactPaths: [],
    });
    report.routes[0].checks[1] = { id: "links", status: "warning", issueIds: ["link"] };
    expect(await npRequireBuildPreviewReportForBlueprintV1(blueprint, report)).toEqual(report);
    report.issues[0].target = {
      kind: "external-origin",
      origin: "https://example.invalid/private?secret=value",
    };
    expect(() => npRequireAgentBuildPreviewReportV1(report)).toThrow();
    report.issues[0] = {
      id: "unsupported",
      pageId,
      checkId: "links",
      severity: "warning",
      code: "CHECK_UNSUPPORTED",
      safeSummary: npBuildPreviewIssueSummariesV1.CHECK_UNSUPPORTED,
      target: null,
      evidenceArtifactPaths: [],
    };
    report.routes[0].checks[1].issueIds = ["unsupported"];
    expect(() => npRequireAgentBuildPreviewReportV1(report)).toThrow();
    report.issues[0].severity = "error";
    report.routes[0].checks[1].status = "fail";
    expect(npRequireAgentBuildPreviewReportV1(report).routes[0].checks[1].status).toBe("fail");
  });
});
