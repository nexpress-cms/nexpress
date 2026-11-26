import {
  npBuildCanonicalDigest,
  npBuildDesignDirectionDraftSetBytesV1,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  npParseBuildJsonV1,
  type NpAgentBuildPreviewReportV1,
  type NpAgentBuildRenderEnvironmentV1,
  type NpAgentBuildVerificationResultBodyV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { requireSiteBuildBrowserPreviewObservationV1, fields } from "./browser-preview-probes.js";
import {
  isSiteBuildBrowserRequestAllowedV1,
  requireSiteBuildBrowserRequestPolicyV1,
} from "./browser-request-policy.js";
import type { observeSiteBuildRenderPathsV1 } from "./direction-render.js";
import {
  runSiteBuildLinuxSandboxV1,
  type NpSiteBuildLinuxAuditV1,
  type NpSiteBuildLinuxSandboxImageV1,
} from "./linux-sandbox.js";
import { canonicalizeSiteBuildPngV1 } from "./png-canonicalizer.js";
import { composeSiteBuildPreviewReportV1 } from "./preview-report.js";
import type { NpFrozenPreparedSiteBuildRenderProjectV1 } from "./render-capsule.js";
import { fingerprintSiteBuildBrowserRequestPolicyV1 } from "./render-observation.js";
import {
  assertSiteBuildObservationActiveV1,
  type NpSiteBuildObservationCancellationV1,
} from "./observation-deadline.js";

type Viewport = "desktop" | "mobile";
type Capsule = Pick<
  NpFrozenPreparedSiteBuildRenderProjectV1,
  "project" | "renderer" | "runtimeFilesDigest" | "assertOriginalUnchanged"
>;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fail = (reason: "input" | "conflict" | "unavailable" = "conflict"): never => {
  throw new SiteBuildError(reason);
};
const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_CHECKS = 3 * 1024 * 1024;
const MAX_AGGREGATE = 512 * 1024 * 1024;

export interface NpSiteBuildFinalPreviewProgressV1 {
  phase:
    | "lineage"
    | "source-lease"
    | "native"
    | "native-completed"
    | "capture"
    | "report"
    | "final-lease";
  pageId: string | null;
  viewport: Viewport | null;
  completedCaptures: number;
  /** Present only after this invocation actually returned a native audit. */
  nativeAudit: NpSiteBuildLinuxAuditV1 | null;
}

export interface NpSiteBuildFinalPreviewResultV1 {
  status: "passed" | "failed";
  report: NpAgentBuildPreviewReportV1;
  artifacts: Array<{ path: string; bytes: Uint8Array }>;
  artifactRecords: NpAgentBuildVerificationResultBodyV1["artifacts"];
  audits: Array<{
    pageId: string;
    viewport: Viewport;
    audit: NpSiteBuildLinuxAuditV1;
    seedMaterialization: { receipt: unknown; bytes: number; digest: string };
  }>;
  lineage: {
    reviewedComparisonInputsDigest: string;
    currentComparisonInputsDigest: string;
    reviewedSelectedProjectionDigest: string;
    currentSelectedProjectionDigest: string;
    renderEnvironmentFingerprint: string;
    rendererFingerprint: string;
    runtimeFilesDigest: string;
    requestPolicySha256: string;
    defaultLocale: string | null;
  };
}

/**
 * Trusted execution coordinator. The caller owns the fresh App candidate/catalog
 * lineage and seed reconciliation. Parsed JSON does not establish that provenance.
 * Each route/viewport invokes a fresh native sandbox; this owner publishes nothing.
 * Forward the command observer's signal and remainingMs unchanged so every route
 * shares its total budget. Active native cancellation is awaited through cleanup.
 */
export async function renderPreparedSiteBuildFinalPreviewV1(
  options: NpSiteBuildObservationCancellationV1 & {
    brief: unknown;
    reviewedDrafts: unknown;
    drafts: unknown;
    selectedDirectionId: string;
    blueprint: unknown;
    config: string;
    /** Actual current installed catalog observation; never inferred from locale order. */
    defaultLocale: string | null;
    capsule: Capsule;
    image: NpSiteBuildLinuxSandboxImageV1;
    environment: NpAgentBuildRenderEnvironmentV1;
    paths: Awaited<ReturnType<typeof observeSiteBuildRenderPathsV1>>;
    progress?: (event: { pageId: string; viewport: Viewport }) => void;
    /** Diagnostic observations only; they never attest the complete preview. */
    observeProgress?: (event: NpSiteBuildFinalPreviewProgressV1) => void;
  },
): Promise<NpSiteBuildFinalPreviewResultV1> {
  assertSiteBuildObservationActiveV1(options);
  const parsed = await (async () => {
    try {
      const brief = npRequireBuildReadyBriefV1(options.brief);
      return {
        brief,
        reviewed: await npRequireBuildDirectionSetForBriefV1(
          brief,
          options.reviewedDrafts,
          "draft",
        ),
        current: await npRequireBuildDirectionSetForBriefV1(brief, options.drafts, "draft"),
        blueprint: await npRequireBuildBlueprintForBriefV1(brief, options.blueprint),
        environment: npRequireAgentBuildRenderEnvironmentV1(options.environment),
        renderer: npRequireAgentBuildDirectionRendererV1(options.capsule.renderer),
      };
    } catch {
      return fail("input");
    }
  })();
  const { brief, reviewed, current, blueprint, environment, renderer } = parsed;
  const selected = reviewed.directions.find(
    (direction) => direction.id === options.selectedDirectionId,
  );
  const currentSelected = current.directions.find(
    (direction) => direction.id === options.selectedDirectionId,
  );
  const preview = blueprint.commands.find((command) => command.template === "preview-render");
  if (
    !selected ||
    !currentSelected ||
    !preview ||
    blueprint.selectedDirectionId !== selected.id ||
    blueprint.discoveryFingerprint !== reviewed.discoveryFingerprint
  )
    return fail();

  // The fresh App owner may rebase only these catalog observations and their
  // mechanically propagated identities. All authored semantics remain exact.
  const expectedCurrent = structuredClone(reviewed);
  expectedCurrent.comparisonInputs.projectionInputs.discoveryFingerprint =
    current.comparisonInputs.projectionInputs.discoveryFingerprint;
  expectedCurrent.comparisonInputs.projectionInputs.blockDefinitionFingerprints = [
    ...current.comparisonInputs.projectionInputs.blockDefinitionFingerprints,
  ];
  expectedCurrent.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    expectedCurrent.comparisonInputs,
  );
  expectedCurrent.discoveryFingerprint = current.discoveryFingerprint;
  for (const direction of expectedCurrent.directions) {
    direction.discoveryFingerprint = current.discoveryFingerprint;
    direction.comparisonInputsDigest = expectedCurrent.comparisonInputsDigest;
  }
  if (
    !Buffer.from(npBuildDesignDirectionDraftSetBytesV1(expectedCurrent)).equals(
      npBuildDesignDirectionDraftSetBytesV1(current),
    )
  )
    return fail();
  const projection = npBuildDirectionProjectionV1(selected);
  const currentProjection = npBuildDirectionProjectionV1(currentSelected);
  const reviewedProjectionDigest = await npBuildCanonicalDigest(
    "np.build-design-direction-projection.v1",
    projection,
  );
  const currentProjectionDigest = await npBuildCanonicalDigest(
    "np.build-design-direction-projection.v1",
    currentProjection,
  );
  const blueprintProjection = {
    ...projection,
    themeBase: blueprint.theme.package,
    tokens: blueprint.theme.tokens,
    pageBindings: blueprint.pages
      .map((page) => ({
        pageId: page.id,
        source: page.source,
        patternId: page.patternId,
        overrides: page.patternOverrides,
        templateId: page.templateId,
        blocks: page.blocks,
      }))
      .sort((a, b) => compare(a.pageId, b.pageId)),
  };
  if (
    reviewedProjectionDigest !== blueprint.selectedDirectionProjectionDigest ||
    reviewedProjectionDigest !==
      (await npBuildCanonicalDigest(
        "np.build-design-direction-projection.v1",
        blueprintProjection,
      )) ||
    reviewedProjectionDigest !==
      (await npBuildCanonicalDigest("np.build-design-direction-projection.v1", {
        ...currentProjection,
        comparisonInputsDigest: projection.comparisonInputsDigest,
        discoveryFingerprint: projection.discoveryFingerprint,
      })) ||
    preview.comparisonInputsDigest !== reviewed.comparisonInputsDigest ||
    !same(
      preview.routes,
      reviewed.comparisonInputs.informationArchitecture.map(
        ({ pageId, route, locale, audience, fixtureIds }) => ({
          pageId,
          route,
          locale,
          audience,
          fixtureIds,
        }),
      ),
    ) ||
    !same(preview.viewports, reviewed.comparisonInputs.viewports) ||
    !same(environment.viewports, preview.viewports) ||
    environment.commandRegistryFingerprint !== blueprint.commandRegistryFingerprint
  )
    return fail();
  const renderEnvironmentFingerprint = await npBuildCanonicalDigest(
    "np.build-render-environment.v1",
    environment,
  );
  if (renderEnvironmentFingerprint !== preview.renderEnvironmentFingerprint) return fail();
  if (
    preview.artifacts.some(
      (artifact) => !artifact.path.endsWith(artifact.kind === "screenshot" ? ".png" : ".json"),
    )
  )
    return fail("input");
  const defaultLocale = options.defaultLocale;
  if (
    defaultLocale !== null &&
    (typeof defaultLocale !== "string" || !environment.locales.includes(defaultLocale))
  )
    return fail("input");
  const routes = preview.routes.map((route) => {
    const locale = route.locale ?? defaultLocale;
    if (locale === null) return fail("unavailable");
    if (!environment.locales.includes(locale)) return fail();
    return { ...route, resolvedLocale: locale };
  });
  const config = options.config;
  if (
    !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.[cm]?[jt]s$/u.test(config) ||
    config.split("/").some((part) => part === "." || part === "..")
  )
    return fail("input");
  let paths: typeof options.paths;
  try {
    paths = {
      allowedPaths: [...options.paths.allowedPaths],
      requestPolicy: requireSiteBuildBrowserRequestPolicyV1(options.paths.requestPolicy),
    };
  } catch {
    return fail("input");
  }
  if (
    paths.allowedPaths.length > 20_000 ||
    new Set(paths.allowedPaths).size !== paths.allowedPaths.length ||
    paths.allowedPaths.some(
      (path) => !isSiteBuildBrowserRequestAllowedV1(path, "GET", "http://127.0.0.1:18080", [path]),
    ) ||
    routes.some(
      (route) =>
        !paths.allowedPaths.includes(route.route) ||
        !paths.requestPolicy.documentPaths.includes(route.route),
    )
  )
    return fail("input");
  const policySha = fingerprintSiteBuildBrowserRequestPolicyV1(paths.requestPolicy);
  const rendererFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    renderer,
  );
  const runtimeFilesDigest = options.capsule.runtimeFilesDigest;
  const project = options.capsule.project;
  const imageSnapshot = encode(options.image);
  const checkLive = async () => {
    assertSiteBuildObservationActiveV1(options);
    await options.capsule.assertOriginalUnchanged();
    const image = options.image;
    if (
      environment.sandbox !== "np.linux-build-sandbox.v1" ||
      image.schemaVersion !== "np.site-build-linux-sandbox-image.v1" ||
      !imageSnapshot.equals(encode(image)) ||
      environment.linux.imageId !== image.imageId ||
      environment.linux.imageRecipeSha256 !== image.recipeDigest ||
      environment.linux.supervisor.binarySha256 !== image.supervisorSha256 ||
      environment.linux.supervisor.sourceSha256 !== image.supervisorSourceSha256 ||
      environment.linux.fontconfigSha256 !== image.fontconfigSha256 ||
      !same(environment.linux.driverFiles, image.driverFiles) ||
      environment.linux.runtimeFilesSha256 !== runtimeFilesDigest ||
      options.capsule.runtimeFilesDigest !== runtimeFilesDigest ||
      options.capsule.project !== project ||
      policySha !== environment.linux.requestPolicy.sha256 ||
      policySha !== fingerprintSiteBuildBrowserRequestPolicyV1(options.paths.requestPolicy) ||
      !same(paths.allowedPaths, options.paths.allowedPaths) ||
      rendererFingerprint !==
        (await npBuildCanonicalDigest("np.build-direction-renderer.v1", options.capsule.renderer))
    )
      return fail();
    assertSiteBuildObservationActiveV1(options);
  };
  const observeProgress = (
    phase: NpSiteBuildFinalPreviewProgressV1["phase"],
    pageId: string | null = null,
    viewport: Viewport | null = null,
    nativeAudit: NpSiteBuildLinuxAuditV1 | null = null,
  ) =>
    options.observeProgress?.({
      phase,
      pageId,
      viewport,
      completedCaptures: captures.length,
      nativeAudit: nativeAudit === null ? null : structuredClone(nativeAudit),
    });
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const captures: Parameters<typeof composeSiteBuildPreviewReportV1>[0]["captures"][number][] = [];
  const artifacts: NpSiteBuildFinalPreviewResultV1["artifacts"] = [];
  const artifactRecords: NpSiteBuildFinalPreviewResultV1["artifactRecords"] = [];
  const audits: NpSiteBuildFinalPreviewResultV1["audits"] = [];
  let totalBytes = 0;
  observeProgress("lineage");
  await checkLive();
  for (const route of routes)
    for (const viewport of ["desktop", "mobile"] as const) {
      assertSiteBuildObservationActiveV1(options);
      options.progress?.({ pageId: route.pageId, viewport });
      observeProgress("source-lease", route.pageId, viewport);
      await checkLive();
      observeProgress("native", route.pageId, viewport);
      assertSiteBuildObservationActiveV1(options);
      const result = await runSiteBuildLinuxSandboxV1({
        signal: options.signal,
        image: options.image,
        project,
        inputBytes: encode({
          mode: "final-render",
          config,
          renderer,
          brief,
          drafts: current,
          blueprint,
          directionId: selected.id,
          clockNow: environment.clock.now,
          randomSeed: environment.clock.randomSeed,
          routes: [
            {
              pageId: route.pageId,
              path: route.route,
              audience: route.audience,
              locale: route.resolvedLocale,
            },
          ],
          viewport: environment.viewports[viewport],
          ...paths,
        }),
        artifacts: [
          { name: "page-000.png", maxBytes: MAX_IMAGE },
          { name: "preview-checks-000.json", maxBytes: MAX_CHECKS },
          { name: "seed-materialization.json", maxBytes: 1024 * 1024 },
        ],
      });
      observeProgress("native-completed", route.pageId, viewport, result.audit);
      await checkLive();
      const png = result.artifacts.get("page-000.png"),
        checks = result.artifacts.get("preview-checks-000.json"),
        materialized = result.artifacts.get("seed-materialization.json");
      if (
        result.artifacts.size !== 3 ||
        !png ||
        !checks ||
        !checks.length ||
        checks.length > MAX_CHECKS ||
        !materialized ||
        !materialized.length ||
        materialized.length > 1024 * 1024 ||
        png.length < 24 ||
        png.length > MAX_IMAGE
      )
        return fail("input");
      let seedReceipt: unknown;
      try {
        seedReceipt = npParseBuildJsonV1(
          new TextDecoder("utf-8", { fatal: true }).decode(materialized),
        );
        const seed = fields(seedReceipt, [
          "scope",
          "documents",
          "theme",
          "navigation",
          "media",
          "transaction",
          "pendingCacheInvalidations",
          "cacheInvalidations",
        ]);
        const documents = fields(seed.documents, ["created", "unchanged"]);
        const navigation = fields(seed.navigation, ["created", "unchanged"]);
        const media = fields(seed.media, [
          "staged",
          "referenceOnlyRetained",
          "fetched",
          "uploaded",
        ]);
        if (
          seed.scope !== "ordinary-site-build-seed" ||
          !["written", "unchanged"].includes(String(seed.theme)) ||
          seed.transaction !== "individual-facade-commits" ||
          !same(seed.pendingCacheInvalidations, []) ||
          !Array.isArray(seed.cacheInvalidations) ||
          !same(
            documents.created,
            blueprint.seed.documents.map((document) => document.documentId),
          ) ||
          !same(documents.unchanged, []) ||
          !same(
            navigation.created,
            blueprint.navigation.map((navigation) => navigation.location).sort(compare),
          ) ||
          !same(navigation.unchanged, []) ||
          media.staged !== "unsupported-allocated-id-owner-required" ||
          media.fetched !== 0 ||
          media.uploaded !== 0 ||
          !same(
            media.referenceOnlyRetained,
            blueprint.seed.media.map((media) => media.mediaId),
          )
        )
          return fail("input");
      } catch {
        return fail("input");
      }
      let document: ReturnType<typeof requireSiteBuildBrowserPreviewObservationV1>;
      let interaction: ReturnType<typeof requireSiteBuildBrowserPreviewObservationV1>;
      try {
        const capture = fields(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(checks)),
          [
            "schemaVersion",
            "pageId",
            "route",
            "locale",
            "audience",
            "status",
            "document",
            "interaction",
          ],
        );
        if (
          capture.schemaVersion !== "np.site-build-page-preview-observations.v1" ||
          capture.pageId !== route.pageId ||
          capture.route !== route.route ||
          capture.locale !== route.resolvedLocale ||
          capture.audience !== route.audience ||
          capture.status !== 200
        )
          return fail("input");
        document = requireSiteBuildBrowserPreviewObservationV1(capture.document);
        interaction = requireSiteBuildBrowserPreviewObservationV1(capture.interaction);
        if (
          document.phase !== "document" ||
          interaction.phase !== "interaction" ||
          document.metadataOwner !== interaction.metadataOwner ||
          (route.audience === "member") !== (document.metadataOwner === "forum-member") ||
          [document, interaction].some(
            (observation) =>
              observation.route !== route.route ||
              observation.locale !== route.resolvedLocale ||
              observation.themePackage !== blueprint.theme.package,
          )
        )
          return fail("input");
      } catch {
        return fail("input");
      }
      const dimensions = environment.viewports[viewport];
      const data = Buffer.from(png);
      if (
        data.readUInt32BE(16) !== dimensions.width * dimensions.deviceScaleFactor ||
        data.readUInt32BE(20) !== dimensions.height * dimensions.deviceScaleFactor ||
        !data.equals(canonicalizeSiteBuildPngV1(data))
      )
        return fail("input");
      const declaration = preview.artifacts.find(
        (artifact) =>
          artifact.kind === "screenshot" &&
          artifact.pageId === route.pageId &&
          artifact.viewport === viewport,
      );
      if (!declaration || !declaration.path.endsWith(".png")) return fail("input");
      if ((totalBytes += data.length) > MAX_AGGREGATE) return fail("input");
      artifacts.push({ path: declaration.path, bytes: data });
      artifactRecords.push({
        kind: "screenshot",
        path: declaration.path,
        bytes: data.length,
        mime: "image/png",
        pageId: route.pageId,
        viewport,
        digest: await npBuildFileDigest("np.build-verification-artifact.v1", data),
      });
      captures.push({ pageId: route.pageId, viewport, status: 200, document, interaction });
      audits.push({
        pageId: route.pageId,
        viewport,
        audit: result.audit,
        seedMaterialization: {
          receipt: seedReceipt,
          bytes: materialized.length,
          digest: await npBuildFileDigest("np.build-verification-artifact.v1", materialized),
        },
      });
      observeProgress("capture", route.pageId, viewport);
    }
  observeProgress("report");
  assertSiteBuildObservationActiveV1(options);
  const report = await composeSiteBuildPreviewReportV1({ blueprint, blueprintHash, captures });
  const reportBytes = encode(report),
    declaration = preview.artifacts.find((artifact) => artifact.kind === "report");
  if (
    !declaration ||
    !declaration.path.endsWith(".json") ||
    totalBytes + reportBytes.length > MAX_AGGREGATE
  )
    return fail("input");
  artifacts.push({ path: declaration.path, bytes: reportBytes });
  artifactRecords.push({
    kind: "report",
    path: declaration.path,
    bytes: reportBytes.length,
    mime: "application/json",
    pageId: null,
    viewport: null,
    digest: await npBuildFileDigest("np.build-verification-artifact.v1", reportBytes),
  });
  artifacts.sort((a, b) => compare(a.path, b.path));
  artifactRecords.sort((a, b) => compare(a.path, b.path));
  observeProgress("final-lease");
  await checkLive();
  assertSiteBuildObservationActiveV1(options);
  return {
    status: report.routes.some((route) => route.checks.some((check) => check.status === "fail"))
      ? "failed"
      : "passed",
    report,
    artifacts,
    artifactRecords,
    audits,
    lineage: {
      reviewedComparisonInputsDigest: reviewed.comparisonInputsDigest,
      currentComparisonInputsDigest: current.comparisonInputsDigest,
      reviewedSelectedProjectionDigest: reviewedProjectionDigest,
      currentSelectedProjectionDigest: currentProjectionDigest,
      renderEnvironmentFingerprint,
      rendererFingerprint,
      runtimeFilesDigest,
      requestPolicySha256: policySha,
      defaultLocale,
    },
  };
}
