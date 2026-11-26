import { createHash } from "node:crypto";
import {
  npBuildPreviewCheckIdsV1,
  npRequireAgentSiteBlueprintV1,
  npRequireBuildPreviewReportForBlueprintV1,
  type NpAgentBuildPreviewReportV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { composeSiteBuildBrowserPreviewChecksV1 } from "./browser-preview-checks.js";

type Capture = {
  pageId: string;
  viewport: "desktop" | "mobile";
  document: unknown;
  interaction: unknown;
  /** Exact document HTTP response observed inside this browser run. */
  status: number;
};

/**
 * Combines actual two-viewport observations in the blueprint's frozen route
 * order. Transport validation does not attest execution; root owns those leases.
 */
export async function composeSiteBuildPreviewReportV1(input: {
  blueprint: unknown;
  blueprintHash: string;
  captures: readonly Capture[];
}): Promise<NpAgentBuildPreviewReportV1> {
  const fail = (): never => {
    throw new SiteBuildError("input");
  };
  const blueprint = npRequireAgentSiteBlueprintV1(input.blueprint);
  const preview = blueprint.commands.find((command) => command.template === "preview-render");
  if (
    !preview ||
    !Array.isArray(input.captures) ||
    input.captures.length !== preview.routes.length * 2
  )
    return fail();
  const captures = new Map<string, Capture>();
  for (const capture of input.captures) {
    if (
      !preview.routes.some((page) => page.pageId === capture.pageId) ||
      !["desktop", "mobile"].includes(capture.viewport) ||
      !Number.isInteger(capture.status) ||
      capture.status < 100 ||
      capture.status > 599
    )
      return fail();
    const key = `${capture.pageId}\0${capture.viewport}`;
    if (captures.has(key)) return fail();
    captures.set(key, capture);
  }
  const observedRoutes = preview.routes.map(({ pageId, route, locale, audience }) => {
    const desktop = captures.get(`${pageId}\0desktop`),
      mobile = captures.get(`${pageId}\0mobile`);
    if (!desktop || !mobile || desktop.status !== mobile.status) return fail();
    return { pageId, route, locale, audience, status: desktop.status };
  });
  const report: NpAgentBuildPreviewReportV1 = {
    schemaVersion: "np.agent-build-preview-report.v1",
    blueprintHash: input.blueprintHash,
    comparisonInputsDigest: preview.comparisonInputsDigest,
    renderEnvironmentFingerprint: preview.renderEnvironmentFingerprint,
    routes: [],
    issues: [],
  };
  for (const route of observedRoutes) {
    const page = {
      pageId: route.pageId,
      route: route.route,
      locale: route.locale,
      audience: route.audience,
    };
    const merged = new Map<string, NpAgentBuildPreviewReportV1["issues"][number]>();
    for (const viewport of ["desktop", "mobile"] as const) {
      const capture = captures.get(`${page.pageId}\0${viewport}`);
      const screenshot = preview.artifacts.find(
        (artifact) =>
          artifact.kind === "screenshot" &&
          artifact.pageId === page.pageId &&
          artifact.viewport === viewport,
      );
      if (!capture || !screenshot) return fail();
      const checks = await composeSiteBuildBrowserPreviewChecksV1({
        page,
        viewport,
        document: capture.document,
        interaction: capture.interaction,
        observedRoutes,
        screenshotPath: screenshot.path,
      });
      for (const issue of checks.issues) {
        const key = JSON.stringify([issue.pageId, issue.checkId, issue.code, issue.target]);
        const existing = merged.get(key);
        if (existing)
          existing.evidenceArtifactPaths = [
            ...new Set([...existing.evidenceArtifactPaths, ...issue.evidenceArtifactPaths]),
          ].sort();
        else
          merged.set(key, {
            ...issue,
            id: `preview-${createHash("sha256").update(key).digest("base64url")}`,
          });
      }
    }
    const issues = [...merged.values()].sort((left, right) =>
      Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)),
    );
    report.issues.push(...issues);
    report.routes.push({
      ...page,
      checks: npBuildPreviewCheckIdsV1.map((id) => {
        const members = issues.filter((issue) => issue.checkId === id);
        return {
          id,
          status: members.some((issue) => issue.severity === "error")
            ? "fail"
            : members.length
              ? "warning"
              : "pass",
          issueIds: members.map((issue) => issue.id),
        };
      }),
    });
  }
  return npRequireBuildPreviewReportForBlueprintV1(blueprint, report);
}
