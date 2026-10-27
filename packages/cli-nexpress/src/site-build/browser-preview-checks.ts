import { createHash } from "node:crypto";
import {
  npBuildFileDigest,
  npBuildPreviewCheckIdsV1,
  npBuildPreviewIssueSummariesV1,
  type NpAgentBuildPreviewCheckIdV1,
  type NpAgentBuildPreviewIssueCodeV1,
  type NpAgentBuildPreviewReportV1,
} from "@nexpress/core/agent-contract";
import {
  detach,
  fields,
  one,
  path,
  locale,
  requireSiteBuildBrowserPreviewObservationV1,
} from "./browser-preview-probes.js";
export {
  createSiteBuildBrowserPreviewProgramV1,
  requireSiteBuildBrowserPreviewObservationV1,
  NP_SITE_BUILD_BROWSER_PREVIEW_CHECKS_SOURCE_V1,
} from "./browser-preview-probes.js";
export type {
  NpSiteBuildBrowserPreviewInputV1,
  NpSiteBuildBrowserPreviewObservationV1,
} from "./browser-preview-probes.js";
type Page = Omit<NpAgentBuildPreviewReportV1["routes"][number], "checks">;
type Issue = NpAgentBuildPreviewReportV1["issues"][number];
const fail = (): never => {
  throw new TypeError("Invalid Build browser preview observation");
};

/** Automated DOM subset only: no WCAG AA, destination fetch, audience or execution attestation. */
export async function composeSiteBuildBrowserPreviewChecksV1(value: {
  page: Page;
  viewport: "desktop" | "mobile";
  document: unknown;
  interaction: unknown;
  observedRoutes: readonly (Page & { status: number })[];
  screenshotPath?: string;
}): Promise<{
  scope: "automated-dom-subset";
  page: NpAgentBuildPreviewReportV1["routes"][number];
  issues: Issue[];
}> {
  const detached = detach(value);
  const screenshotPresent =
    detached !== null && typeof detached === "object" && Object.hasOwn(detached, "screenshotPath");
  const d = fields(detached, [
    "page",
    "viewport",
    "document",
    "interaction",
    "observedRoutes",
    ...(screenshotPresent ? ["screenshotPath"] : []),
  ]);
  const pageData = fields(d.page, ["pageId", "route", "locale", "audience"]);
  if (
    typeof pageData.pageId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(pageData.pageId)
  )
    return fail();
  const page: Page = {
    pageId: pageData.pageId,
    route: path(pageData.route),
    locale: pageData.locale === null ? null : locale(pageData.locale),
    audience: one(pageData.audience, ["public", "member"]),
  };
  const viewport = one(d.viewport, ["desktop", "mobile"]);
  const doc = requireSiteBuildBrowserPreviewObservationV1(d.document),
    interaction = requireSiteBuildBrowserPreviewObservationV1(d.interaction);
  if (
    doc.phase !== "document" ||
    interaction.phase !== "interaction" ||
    doc.route !== page.route ||
    interaction.route !== page.route ||
    doc.locale !== interaction.locale ||
    (page.locale !== null && page.locale !== doc.locale) ||
    doc.themePackage !== interaction.themePackage ||
    doc.metadataOwner !== interaction.metadataOwner ||
    (page.audience === "member") !== (doc.metadataOwner === "forum-member")
  )
    return fail();
  if (!Array.isArray(d.observedRoutes) || d.observedRoutes.length > 200) return fail();
  const outcomes = d.observedRoutes.map((value) => {
    const r = fields(value, ["pageId", "route", "locale", "audience", "status"]);
    if (
      typeof r.pageId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(r.pageId) ||
      typeof r.status !== "number" ||
      r.status < 100 ||
      r.status > 599
    )
      return fail();
    return {
      pageId: r.pageId,
      route: path(r.route),
      locale: r.locale === null ? null : locale(r.locale),
      audience: one(r.audience, ["public", "member"]),
      status: r.status,
    };
  });
  if (
    new Set(outcomes.map((o) => `${o.route}\0${o.locale}\0${o.audience}`)).size !== outcomes.length
  )
    return fail();
  const evidence =
    d.screenshotPath === undefined
      ? []
      : typeof d.screenshotPath === "string" &&
          /^\.nexpress\/site\/review\/final\/[A-Za-z0-9][A-Za-z0-9._/-]{0,300}\.png$/u.test(
            d.screenshotPath,
          ) &&
          !d.screenshotPath.split("/").some((p) => p === ".." || p === "." || !p)
        ? [d.screenshotPath]
        : fail();
  const issues: Issue[] = [];
  const selectors = {
    interaction: "button[aria-controls]",
    links: "a[href],area[href]",
    metadata: "head",
    lang: "html[lang]",
    "image-alt": "img:not([alt])",
    "control-name": "input,select,textarea,button",
    "link-name": "a[href]",
    "duplicate-id": "[id]",
    root: "html",
    controls: "input,select,textarea,button,a",
  } as const;
  const add = (
    checkId: NpAgentBuildPreviewCheckIdV1,
    code: NpAgentBuildPreviewIssueCodeV1,
    target: Issue["target"],
    screenshot = true,
  ) => {
    const key = JSON.stringify([checkId, code, target]);
    if (issues.some((i) => JSON.stringify([i.checkId, i.code, i.target]) === key)) return;
    // Opaque local identifier only; this is neither an artifact digest nor execution evidence.
    const digest = createHash("sha256")
      .update(`${page.pageId}\0${viewport}\0${key}`)
      .digest("base64url");
    issues.push({
      id: `preview-${digest}`,
      pageId: page.pageId,
      checkId,
      code,
      severity: [
        "INTERNAL_LINK_UNVERIFIED",
        "EXTERNAL_LINK_UNVERIFIED",
        "LINK_SCHEME_UNVERIFIED",
      ].includes(code)
        ? "warning"
        : "error",
      safeSummary: npBuildPreviewIssueSummariesV1[code],
      target,
      evidenceArtifactPaths: screenshot ? [...evidence] : [],
    });
  };
  const selected = async (key: keyof typeof selectors): Promise<Issue["target"]> => ({
    kind: "selector",
    selectorDigest: await npBuildFileDigest(
      "np.build-verification-artifact.v1",
      new TextEncoder().encode(selectors[key]),
    ),
  });
  if (!doc.routeMatches || !interaction.routeMatches)
    add("interaction-smoke", "INTERACTION_FAILED", { kind: "route", route: page.route }, false);
  if (!interaction.supported)
    add("interaction-smoke", "CHECK_UNSUPPORTED", await selected("interaction"), false);
  else if (!interaction.passed)
    add("interaction-smoke", "INTERACTION_FAILED", await selected("interaction"), false);
  if (!doc.complete)
    for (const check of ["links", "accessibility", "overflow"] as const)
      add(check, "CHECK_UNSUPPORTED", null, false);
  if (doc.metadata.missing) add("metadata", "METADATA_MISSING", await selected("metadata"));
  if (doc.metadata.invalid) add("metadata", "METADATA_INVALID", await selected("metadata"));
  for (const rule of doc.accessibility)
    add("accessibility", "ACCESSIBILITY_VIOLATION", await selected(rule));
  for (const rule of ["root", "controls"] as const)
    if (doc.overflow[rule]) add("overflow", "LAYOUT_OVERFLOW", await selected(rule));
  for (const link of doc.links) {
    if (link.kind === "unrequested-scheme") {
      add("links", "LINK_SCHEME_UNVERIFIED", null);
      continue;
    }
    if (link.kind === "unsupported") {
      add("links", "CHECK_UNSUPPORTED", await selected("links"));
      continue;
    }
    if (link.kind === "external") {
      add("links", "EXTERNAL_LINK_UNVERIFIED", {
        kind: "external-origin",
        origin: link.origin,
      });
      continue;
    }
    const target: Issue["target"] = { kind: "route", route: link.route };
    if (link.fragment === "missing") {
      add("links", "LINK_TARGET_MISSING", target);
      continue;
    }
    const observed = outcomes.find(
      (o) => o.route === link.route && o.locale === page.locale && o.audience === page.audience,
    );
    if (link.query || link.fragment === "unverified" || !observed)
      add("links", "INTERNAL_LINK_UNVERIFIED", target);
    else if (observed.status < 200 || observed.status >= 300)
      add("links", "LINK_TARGET_MISSING", target);
  }
  issues.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    scope: "automated-dom-subset",
    page: {
      ...page,
      checks: npBuildPreviewCheckIdsV1.map((id) => {
        const members = issues.filter((issue) => issue.checkId === id);
        return {
          id,
          status: members.some((i) => i.severity === "error")
            ? "fail"
            : members.length
              ? "warning"
              : "pass",
          issueIds: members.map((i) => i.id),
        };
      }),
    },
    issues,
  };
}
