import { z } from "zod";
import { requireArtifact } from "./artifact.js";
import { npBuildCanonicalDigest, npRequireAgentSiteBlueprintV1 } from "./contract.js";
import {
  compareUtf8,
  digest,
  fail,
  fileDigest,
  id,
  locale,
  route,
  under,
  unique,
} from "./primitives.js";

export const npBuildPreviewCheckIdsV1 = Object.freeze([
  "interaction-smoke",
  "links",
  "metadata",
  "accessibility",
  "overflow",
] as const);
export type NpAgentBuildPreviewCheckIdV1 = (typeof npBuildPreviewCheckIdsV1)[number];
/** Fixed summaries prevent authored DOM text, errors and request parameters from entering reports. */
export const npBuildPreviewIssueSummariesV1 = Object.freeze({
  INTERACTION_FAILED: "A bounded interaction check failed.",
  LINK_TARGET_MISSING: "An internal link target was unavailable.",
  INTERNAL_LINK_UNVERIFIED: "An internal link was outside the observed preview route inventory.",
  LINK_SCHEME_UNVERIFIED: "A link using an unrequested scheme was not verified.",
  EXTERNAL_LINK_UNVERIFIED: "An external link was not requested by the isolated preview.",
  METADATA_MISSING: "Required document metadata was missing.",
  METADATA_INVALID: "Document metadata did not match the preview route.",
  ACCESSIBILITY_VIOLATION: "An automated accessibility check found a violation.",
  LAYOUT_OVERFLOW: "Content exceeded the viewport width.",
  AUDIENCE_MISMATCH: "The route did not enforce its declared preview audience.",
  UNEXPECTED_REQUEST: "The page attempted a request outside its finite read policy.",
  CHECK_TIMEOUT: "A bounded preview check did not finish.",
  CHECK_UNSUPPORTED: "A required preview check has no supported installed owner.",
} as const);
export type NpAgentBuildPreviewIssueCodeV1 = keyof typeof npBuildPreviewIssueSummariesV1;
export interface NpAgentBuildPreviewReportV1 {
  schemaVersion: "np.agent-build-preview-report.v1";
  blueprintHash: string;
  comparisonInputsDigest: string;
  renderEnvironmentFingerprint: string;
  routes: Array<{
    pageId: string;
    route: string;
    locale: string | null;
    audience: "public" | "member";
    checks: Array<{
      id: NpAgentBuildPreviewCheckIdV1;
      status: "pass" | "warning" | "fail";
      issueIds: string[];
    }>;
  }>;
  issues: Array<{
    id: string;
    pageId: string;
    checkId: NpAgentBuildPreviewCheckIdV1;
    severity: "warning" | "error";
    code: NpAgentBuildPreviewIssueCodeV1;
    safeSummary: string;
    target:
      | { kind: "route"; route: string }
      | { kind: "selector"; selectorDigest: string }
      | { kind: "external-origin"; origin: string }
      | null;
    evidenceArtifactPaths: string[];
  }>;
}
const checkId = z.enum(npBuildPreviewCheckIdsV1);
const code = z.enum([
  "INTERACTION_FAILED",
  "LINK_TARGET_MISSING",
  "INTERNAL_LINK_UNVERIFIED",
  "LINK_SCHEME_UNVERIFIED",
  "EXTERNAL_LINK_UNVERIFIED",
  "METADATA_MISSING",
  "METADATA_INVALID",
  "ACCESSIBILITY_VIOLATION",
  "LAYOUT_OVERFLOW",
  "AUDIENCE_MISMATCH",
  "UNEXPECTED_REQUEST",
  "CHECK_TIMEOUT",
  "CHECK_UNSUPPORTED",
]);
const externalOrigin = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
    } catch {
      return false;
    }
  });
const codeChecks: Record<NpAgentBuildPreviewIssueCodeV1, readonly NpAgentBuildPreviewCheckIdV1[]> =
  {
    INTERACTION_FAILED: ["interaction-smoke"],
    LINK_TARGET_MISSING: ["links"],
    INTERNAL_LINK_UNVERIFIED: ["links"],
    LINK_SCHEME_UNVERIFIED: ["links"],
    EXTERNAL_LINK_UNVERIFIED: ["links"],
    METADATA_MISSING: ["metadata"],
    METADATA_INVALID: ["metadata"],
    ACCESSIBILITY_VIOLATION: ["accessibility"],
    LAYOUT_OVERFLOW: ["overflow"],
    AUDIENCE_MISMATCH: ["interaction-smoke"],
    UNEXPECTED_REQUEST: npBuildPreviewCheckIdsV1,
    CHECK_TIMEOUT: npBuildPreviewCheckIdsV1,
    CHECK_UNSUPPORTED: npBuildPreviewCheckIdsV1,
  };
const schema: z.ZodType<NpAgentBuildPreviewReportV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-preview-report.v1"),
    blueprintHash: digest,
    comparisonInputsDigest: digest,
    renderEnvironmentFingerprint: digest,
    routes: unique(
      z.strictObject({
        pageId: id,
        route,
        locale: locale.nullable(),
        audience: z.enum(["public", "member"]),
        checks: unique(
          z.strictObject({
            id: checkId,
            status: z.enum(["pass", "warning", "fail"]),
            issueIds: unique(id, 2000),
          }),
          5,
          (entry) => entry.id,
        ).length(5),
      }),
      200,
      (entry) => entry.pageId,
    ).min(1),
    issues: unique(
      z.strictObject({
        id,
        pageId: id,
        checkId,
        severity: z.enum(["warning", "error"]),
        code,
        safeSummary: z.string().max(160),
        target: z
          .discriminatedUnion("kind", [
            z.strictObject({ kind: z.literal("route"), route }),
            z.strictObject({ kind: z.literal("selector"), selectorDigest: fileDigest }),
            z.strictObject({ kind: z.literal("external-origin"), origin: externalOrigin }),
          ])
          .nullable(),
        evidenceArtifactPaths: unique(under(".nexpress/site/review/final"), 20),
      }),
      2000,
      (entry) => entry.id,
    ),
  })
  .superRefine((value, ctx) => {
    const issues = new Map(value.issues.map((issue) => [issue.id, issue]));
    const referenced = new Set<string>();
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(value.routes.map((entry) => entry.route)).size !== value.routes.length)
      invalid("preview routes must be unique");
    for (const page of value.routes) {
      if (page.checks.some((check, index) => check.id !== npBuildPreviewCheckIdsV1[index]))
        invalid("preview checks require the fixed complete order");
      for (const check of page.checks) {
        if (
          check.issueIds.some(
            (key, index) => index > 0 && compareUtf8(check.issueIds[index - 1], key) >= 0,
          )
        )
          invalid("preview issue references must be in UTF-8 order");
        const members = check.issueIds.map((key) => issues.get(key));
        if (
          members.some(
            (issue) => !issue || issue.pageId !== page.pageId || issue.checkId !== check.id,
          )
        )
          invalid("preview issues require exact route and check references");
        for (const key of check.issueIds) {
          if (referenced.has(key)) invalid("preview issues must be referenced exactly once");
          referenced.add(key);
        }
        const expected = members.some((issue) => issue?.severity === "error")
          ? "fail"
          : members.length
            ? "warning"
            : "pass";
        if (check.status !== expected)
          invalid("check status must agree with its observed issue severities");
      }
    }
    if (value.issues.some((issue) => !referenced.has(issue.id)))
      invalid("unreferenced preview issue");
    for (const issue of value.issues) {
      if (
        ![
          "EXTERNAL_LINK_UNVERIFIED",
          "INTERNAL_LINK_UNVERIFIED",
          "LINK_SCHEME_UNVERIFIED",
        ].includes(issue.code) &&
        issue.severity !== "error"
      )
        invalid("failed required checks must not be downgraded to warnings");
      if (
        issue.safeSummary !== npBuildPreviewIssueSummariesV1[issue.code] ||
        !codeChecks[issue.code].includes(issue.checkId)
      )
        invalid("preview issue requires its fixed code, check and safe summary");
      if (
        issue.code === "EXTERNAL_LINK_UNVERIFIED" &&
        (issue.severity !== "warning" || issue.target?.kind !== "external-origin")
      )
        invalid("unrequested external links must remain explicit origin-only warnings");
      if (
        issue.code === "INTERNAL_LINK_UNVERIFIED" &&
        (issue.severity !== "warning" || issue.target?.kind !== "route")
      )
        invalid("unobserved internal links must remain explicit route-only warnings");
      if (
        issue.code === "LINK_SCHEME_UNVERIFIED" &&
        (issue.severity !== "warning" || issue.target !== null)
      )
        invalid("unrequested link schemes must remain address-free warnings");
      if (issue.code === "CHECK_UNSUPPORTED" && issue.severity !== "error")
        invalid("unsupported required checks must block completion");
    }
  });
/** Structure and safe transport only. A caller-written report is not execution evidence. */
export const npRequireAgentBuildPreviewReportV1 = (value: unknown): NpAgentBuildPreviewReportV1 =>
  requireArtifact(value, schema, { bytes: 512 * 1024, depth: 8 });

/** Exact artifact binding only; the host must freshly observe browser checks and referenced file bytes. */
export async function npRequireBuildPreviewReportForBlueprintV1(
  blueprintValue: unknown,
  reportValue: unknown,
): Promise<NpAgentBuildPreviewReportV1> {
  const blueprint = npRequireAgentSiteBlueprintV1(blueprintValue);
  const report = npRequireAgentBuildPreviewReportV1(reportValue);
  const preview = blueprint.commands.find((entry) => entry.template === "preview-render");
  if (
    !preview ||
    report.blueprintHash !==
      (await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint)) ||
    report.comparisonInputsDigest !== preview.comparisonInputsDigest ||
    report.renderEnvironmentFingerprint !== preview.renderEnvironmentFingerprint ||
    report.routes.length !== preview.routes.length
  )
    return fail(
      "build.preview",
      "preview report must bind the exact blueprint, environment and route inventory",
    );
  const declaredPaths = new Set(preview.artifacts.map((entry) => entry.path));
  for (const [index, page] of report.routes.entries()) {
    const declared = preview.routes[index];
    if (
      !declared ||
      declared.pageId !== page.pageId ||
      declared.route !== page.route ||
      declared.locale !== page.locale ||
      declared.audience !== page.audience
    )
      return fail(
        "build.preview.routes",
        "preview route must match its exact declared audience and locale",
      );
  }
  if (
    report.issues.some((issue) =>
      issue.evidenceArtifactPaths.some((path) => !declaredPaths.has(path)),
    )
  )
    return fail(
      "build.preview.issues",
      "preview evidence must belong to declared review artifacts",
    );
  return report;
}
