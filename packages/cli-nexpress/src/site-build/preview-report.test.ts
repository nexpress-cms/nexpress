import { describe, expect, it } from "vitest";
import {
  npBuildCanonicalDigest,
  npRequireAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import { composeSiteBuildPreviewReportV1 } from "./preview-report.js";

async function fixture() {
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonical.structured.find((entry) => entry.purpose === "np.build-site-blueprint.v1")!
        .canonical,
    ),
  );
  const digest = `nb1:sha256:${"A".repeat(43)}`;
  blueprint.commands.push({
    id: "preview",
    cwd: "project",
    prerequisites: ["format"],
    timeoutSeconds: 60,
    template: "preview-render",
    comparisonInputsDigest: digest,
    renderEnvironmentFingerprint: digest,
    routes: [{ pageId: "home", route: "/", locale: null, audience: "public", fixtureIds: [] }],
    viewports: {
      desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
      mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
    },
    checks: ["interaction-smoke", "links", "metadata", "accessibility", "overflow"],
    artifacts: [
      {
        kind: "screenshot",
        pageId: "home",
        viewport: "desktop",
        path: ".nexpress/site/review/final/home-desktop.png",
      },
      {
        kind: "screenshot",
        pageId: "home",
        viewport: "mobile",
        path: ".nexpress/site/review/final/home-mobile.png",
      },
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
  const common = {
    schemaVersion: "np.site-build-browser-preview-observation.v1",
    themePackage: "@nexpress/theme-default",
    route: "/",
    locale: "ko",
    metadataOwner: "page",
    routeMatches: true,
  };
  const captures = (["mobile", "desktop"] as const).map((viewport) => ({
    pageId: "home",
    viewport,
    status: 200,
    document: {
      ...common,
      phase: "document",
      complete: true,
      metadata: { missing: false, invalid: false },
      accessibility: [],
      overflow: { root: viewport === "mobile", controls: false },
      links: [{ kind: "external", origin: "https://example.invalid" }],
    },
    interaction: { ...common, phase: "interaction", supported: true, passed: true },
  }));
  return {
    blueprint,
    blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    captures,
  };
}
describe("two-viewport final preview report", () => {
  it("retains the worst viewport result and merges equal warnings with actual screenshot evidence", async () => {
    const input = await fixture();
    const report = await composeSiteBuildPreviewReportV1(input);
    expect(report.routes[0].checks.map((check) => check.status)).toEqual([
      "pass",
      "warning",
      "pass",
      "pass",
      "fail",
    ]);
    const link = report.issues.find((issue) => issue.code === "EXTERNAL_LINK_UNVERIFIED")!;
    expect(link.evidenceArtifactPaths).toEqual([
      ".nexpress/site/review/final/home-desktop.png",
      ".nexpress/site/review/final/home-mobile.png",
    ]);
    expect(
      report.issues.find((issue) => issue.code === "LAYOUT_OVERFLOW")!.evidenceArtifactPaths,
    ).toEqual([".nexpress/site/review/final/home-mobile.png"]);
    expect(
      await composeSiteBuildPreviewReportV1({ ...input, captures: [...input.captures].reverse() }),
    ).toEqual(report);
  });
  it("rejects missing/duplicate captures, inconsistent HTTP observations and stale blueprint binding", async () => {
    const input = await fixture();
    for (const captures of [
      input.captures.slice(1),
      [input.captures[0], input.captures[0]],
      [input.captures[0], { ...input.captures[1], status: 404 }],
    ])
      await expect(composeSiteBuildPreviewReportV1({ ...input, captures })).rejects.toThrow();
    await expect(
      composeSiteBuildPreviewReportV1({ ...input, blueprintHash: `nb1:sha256:${"B".repeat(42)}A` }),
    ).rejects.toThrow();
  });
});
