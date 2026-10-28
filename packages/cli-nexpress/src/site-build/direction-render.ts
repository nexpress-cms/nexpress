import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npBuildInstalledCatalogDigestV1,
  npParseBuildInstalledCatalogJsonV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentDirectionRenderReceiptRecordV1,
  npRequireAgentDirectionRenderSourceV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  npRequireBuildRenderReceiptBindingsV1,
  type NpAgentBuildRenderEnvironmentV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentDesignDirectionSetV1,
  type NpAgentDirectionRenderReceiptRecordV1,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { combineSiteBuildPngMontageV1 } from "./png-canonicalizer.js";
import { requireSiteBuildBrowserRequestPolicyV1 } from "./browser-request-policy.js";
import {
  runSiteBuildLinuxSandboxV1,
  type NpSiteBuildLinuxSandboxImageV1,
  type NpSiteBuildLinuxAuditV1,
} from "./linux-sandbox.js";
import type { NpFrozenPreparedSiteBuildRenderProjectV1 } from "./render-capsule.js";
import { fingerprintSiteBuildBrowserRequestPolicyV1 } from "./render-observation.js";
import {
  assertSiteBuildObservationActiveV1,
  type NpSiteBuildObservationCancellationV1,
} from "./observation-deadline.js";

type Capsule = Pick<
  NpFrozenPreparedSiteBuildRenderProjectV1,
  "project" | "renderer" | "runtimeFilesDigest" | "assertOriginalUnchanged"
>;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const equalBytes = (left: Uint8Array, right: Uint8Array) => Buffer.from(left).equals(right);
const token = (digest: string) =>
  Buffer.from(digest.slice(digest.lastIndexOf(":") + 1), "base64url").toString("hex");

/** The receipt transport is adjacent to its reviewed image; it is never an executable input. */
export function siteBuildDirectionReceiptPathV1(imagePath: string): string {
  if (!/^\.nexpress\/site\/review\/directions\/[a-f0-9]{64}\.png$/u.test(imagePath))
    throw new SiteBuildError("path");
  return imagePath.slice(0, -4) + ".receipt.json";
}

/** Observe only ordinary immutable Next/public files, never package scripts or a URL wildcard. */
export async function observeSiteBuildRenderPathsV1(project: string, documentPaths: string[]) {
  const allowed = new Set(documentPaths),
    images = new Set<string>();
  let entries = 0;
  for (const [root, prefix] of [
    [".next/static", "/_next/static"],
    ["public", ""],
  ] as const) {
    const walk = async (relative: string, depth: number): Promise<void> => {
      if (++entries > 20_000 || depth > 32) throw new SiteBuildError("input");
      const path = join(project, root, relative),
        before = await lstat(path, { bigint: true });
      if (before.isSymbolicLink()) throw new SiteBuildError("path");
      if (before.isDirectory()) {
        const directory = await opendir(path);
        for await (const entry of directory)
          await walk(relative ? `${relative}/${entry.name}` : entry.name, depth + 1);
      } else {
        if (!before.isFile() || before.nlink !== 1n) throw new SiteBuildError("path");
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const actual = await handle.stat({ bigint: true });
          if (actual.ino !== before.ino || actual.dev !== before.dev || actual.size !== before.size)
            throw new SiteBuildError("conflict");
        } finally {
          await handle.close();
        }
        const url = `${prefix}/${relative}`;
        if (
          url.length > 2048 ||
          relative
            .split("/")
            .some(
              (part) =>
                !part ||
                /[%?#\\]/u.test(part) ||
                Array.from(part).some(
                  (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
                ),
            )
        )
          throw new SiteBuildError("path");
        allowed.add(url);
        if (root === "public" && /\.(?:png|jpe?g|webp|gif|avif|svg)$/iu.test(relative))
          images.add(url);
      }
      const after = await lstat(path, { bigint: true });
      if (
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.mode !== before.mode ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs
      )
        throw new SiteBuildError("conflict");
    };
    try {
      await walk("", 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Both roots are required by the normal prepared scaffold. A missing
      // subtree during traversal is a conflict, not permission to omit assets.
      if (entries > 1 || root !== "public") throw new SiteBuildError("input");
    }
  }
  const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  const policy = requireSiteBuildBrowserRequestPolicyV1({
    documentPaths: [...documentPaths].sort(compare),
    imagePaths: [...images].sort(compare),
    imageWidths: [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageQualities: [75],
  });
  return { allowedPaths: [...allowed].sort(compare), requestPolicy: policy };
}

export interface NpSiteBuildDirectionRenderResultV1 {
  set: NpAgentDesignDirectionSetV1;
  artifacts: Array<{ path: string; bytes: Uint8Array }>;
  receipts: NpAgentDirectionRenderReceiptRecordV1[];
  audits: NpSiteBuildLinuxAuditV1[];
}

/**
 * Internal execution owner. Image/environment/capsule must come from the CLI's
 * live observers. Every page runs in a fresh native sandbox with its own DB,
 * and no cache receipt can replace an actual browser run.
 * Forward the command observer's signal/remainingMs to share one total budget;
 * cancellation waits for the active native owner before rejecting.
 */
export async function renderPreparedSiteBuildDirectionsV1(
  options: NpSiteBuildObservationCancellationV1 & {
    brief: unknown;
    drafts: unknown;
    config: string;
    capsule: Capsule;
    image: NpSiteBuildLinuxSandboxImageV1;
    environment: NpAgentBuildRenderEnvironmentV1;
    paths: Awaited<ReturnType<typeof observeSiteBuildRenderPathsV1>>;
    progress?: (event: {
      directionId: string;
      viewport: "desktop" | "mobile";
      pageId: string;
    }) => void;
  },
): Promise<NpSiteBuildDirectionRenderResultV1> {
  assertSiteBuildObservationActiveV1(options);
  const brief = npRequireBuildReadyBriefV1(options.brief);
  const drafts = await npRequireBuildDirectionSetForBriefV1(brief, options.drafts, "draft");
  const environment = npRequireAgentBuildRenderEnvironmentV1(options.environment);
  if (
    environment.sandbox !== "np.linux-build-sandbox.v1" ||
    environment.linux.imageId !== options.image.imageId ||
    environment.linux.runtimeFilesSha256 !== options.capsule.runtimeFilesDigest ||
    JSON.stringify(environment.viewports) !== JSON.stringify(drafts.comparisonInputs.viewports)
  )
    throw new SiteBuildError("conflict");
  const paths = {
    allowedPaths: [...options.paths.allowedPaths],
    requestPolicy: requireSiteBuildBrowserRequestPolicyV1(options.paths.requestPolicy),
  };
  if (
    environment.linux.requestPolicy.sha256 !==
    fingerprintSiteBuildBrowserRequestPolicyV1(paths.requestPolicy)
  )
    throw new SiteBuildError("conflict");
  const base = {
    config: options.config,
    renderer: options.capsule.renderer,
    clockNow: environment.clock.now,
    randomSeed: environment.clock.randomSeed,
  };
  await options.capsule.assertOriginalUnchanged();
  assertSiteBuildObservationActiveV1(options);
  const catalog = await runSiteBuildLinuxSandboxV1({
    signal: options.signal,
    image: options.image,
    project: options.capsule.project,
    inputBytes: encode({ ...base, mode: "catalog" }),
    artifacts: [{ name: "catalog.json", maxBytes: 4 * 1024 * 1024 }],
  });
  assertSiteBuildObservationActiveV1(options);
  const catalogBytes = catalog.artifacts.get("catalog.json");
  if (!catalogBytes) throw new SiteBuildError("input");
  const observedCatalog = npParseBuildInstalledCatalogJsonV1(decode(catalogBytes));
  if ((await npBuildInstalledCatalogDigestV1(observedCatalog)) !== drafts.discoveryFingerprint)
    throw new SiteBuildError("conflict");
  const rendererFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    options.capsule.renderer,
  );
  const renderEnvironmentFingerprint = await npBuildCanonicalDigest(
    "np.build-render-environment.v1",
    environment,
  );
  const sourceTreeDigest = await npBuildCanonicalDigest(
    "np.build-source-tree.v1",
    options.capsule.renderer.projectSources,
  );
  const artifacts: NpSiteBuildDirectionRenderResultV1["artifacts"] = [],
    receipts: NpAgentDirectionRenderReceiptRecordV1[] = [],
    audits = [catalog.audit];
  const directions = [];
  for (const direction of drafts.directions) {
    assertSiteBuildObservationActiveV1(options);
    const projection = npBuildDirectionProjectionV1(direction);
    const projectionDigest = await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      projection,
    );
    const previewArtifact =
      {} as NpAgentDesignDirectionSetV1["directions"][number]["previewArtifact"];
    for (const viewportName of ["desktop", "mobile"] as const) {
      const source = npRequireAgentDirectionRenderSourceV1({
        schemaVersion: "np.agent-direction-render-source.v1",
        briefHash: drafts.briefHash,
        comparisonInputsDigest: drafts.comparisonInputsDigest,
        directionId: direction.id,
        directionProjection: projection,
        directionProjectionDigest: projectionDigest,
        viewportName,
        viewport: environment.viewports[viewportName],
        orderedPageIds: drafts.comparisonInputs.previewPageIds,
        sourceTreeDigest,
        rendererFingerprint,
        renderEnvironmentFingerprint,
      });
      const renderSourceDigest = await npBuildCanonicalDigest(
        "np.build-direction-render-source.v1",
        source,
      );
      const identity = token(renderSourceDigest),
        pages: Uint8Array[] = [];
      for (const pageId of source.orderedPageIds) {
        assertSiteBuildObservationActiveV1(options);
        const route = drafts.comparisonInputs.informationArchitecture.find(
          (page) => page.pageId === pageId,
        );
        if (!route) throw new SiteBuildError("unavailable");
        const locale = route.locale ?? observedCatalog.defaultLocale;
        if (locale === null) throw new SiteBuildError("unavailable");
        if (!environment.locales.includes(locale)) throw new SiteBuildError("conflict");
        options.progress?.({ directionId: direction.id, viewport: viewportName, pageId });
        assertSiteBuildObservationActiveV1(options);
        const rendered = await runSiteBuildLinuxSandboxV1({
          signal: options.signal,
          image: options.image,
          project: options.capsule.project,
          inputBytes: encode({
            ...base,
            mode: "render",
            brief,
            drafts,
            directionId: direction.id,
            routes: [{ pageId, path: route.route, audience: route.audience, locale }],
            viewport: source.viewport,
            ...paths,
          }),
          artifacts: [{ name: "page-000.png", maxBytes: 10 * 1024 * 1024 }],
        });
        assertSiteBuildObservationActiveV1(options);
        const png = rendered.artifacts.get("page-000.png");
        if (!png) throw new SiteBuildError("input");
        const header = Buffer.from(png);
        if (
          header.length < 24 ||
          header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          header.readUInt32BE(16) !== source.viewport.width * source.viewport.deviceScaleFactor ||
          header.readUInt32BE(20) !== source.viewport.height * source.viewport.deviceScaleFactor
        )
          throw new SiteBuildError("input");
        pages.push(png);
        audits.push(rendered.audit);
        await options.capsule.assertOriginalUnchanged();
        assertSiteBuildObservationActiveV1(options);
      }
      const png = combineSiteBuildPngMontageV1(pages),
        path = `.nexpress/site/review/directions/${identity}.png`;
      const output = {
        relativePath: path,
        digest: await npBuildFileDigest("np.build-preview-artifact.v1", png),
        mime: "image/png" as const,
        bytes: png.byteLength,
      };
      const {
        schemaVersion: _schema,
        briefHash: _brief,
        directionProjection: _projection,
        ...sourceFields
      } = source;
      const body = {
        ...sourceFields,
        schemaVersion: "np.agent-direction-render-receipt.v1" as const,
        renderSourceDigest,
        output,
      };
      const observedAt = new Date().toISOString();
      const receipt = npRequireAgentDirectionRenderReceiptRecordV1({
        schemaVersion: "np.agent-direction-render-receipt-record.v1",
        id: `render-${identity}`,
        body,
        digest: await npBuildCanonicalDigest("np.build-direction-render-receipt.v1", body),
        observedAt,
      });
      await npRequireBuildRenderReceiptBindingsV1(source, receipt);
      previewArtifact[viewportName] = {
        ...output,
        id: `preview-${identity}`,
        viewport: source.viewport,
        directionId: direction.id,
        pageIds: source.orderedPageIds,
        directionProjectionDigest: projectionDigest,
        rendererFingerprint,
        renderReceiptId: receipt.id,
        renderReceiptDigest: receipt.digest,
        comparisonInputsDigest: drafts.comparisonInputsDigest,
        createdAt: observedAt,
        expiresAt: null,
      };
      artifacts.push(
        { path, bytes: png },
        { path: siteBuildDirectionReceiptPathV1(path), bytes: encode(receipt) },
      );
      receipts.push(receipt);
    }
    directions.push({ ...projection, projectionDigest, previewArtifact });
  }
  const set = await npRequireBuildDirectionSetForBriefV1(
    brief,
    { ...drafts, schemaVersion: "np.agent-design-direction-set.v1", directions },
    "sealed",
  );
  assertSiteBuildObservationActiveV1(options);
  return { set, artifacts, receipts, audits };
}

/** Reconstruct draft inputs without permitting model-authored preview evidence. */
export function siteBuildDraftFromSealedDirectionsV1(
  set: NpAgentDesignDirectionSetV1,
): NpAgentDesignDirectionDraftSetV1 {
  return {
    ...set,
    schemaVersion: "np.agent-design-direction-draft-set.v1",
    directions: set.directions.map((direction) => {
      const projection = npBuildDirectionProjectionV1(direction);
      return { ...projection, schemaVersion: "np.agent-design-direction-draft.v1" };
    }) as NpAgentDesignDirectionDraftSetV1["directions"],
  };
}

/** Always call the renderer first. Receipt/hash checks alone cannot pass this verification. */
export async function validatePreparedSiteBuildDirectionsV1(
  options: Omit<Parameters<typeof renderPreparedSiteBuildDirectionsV1>[0], "drafts"> & {
    sealedSet: unknown;
    artifactProject: string;
  },
): Promise<NpSiteBuildDirectionRenderResultV1> {
  assertSiteBuildObservationActiveV1(options);
  const set = await npRequireBuildDirectionSetForBriefV1(
    options.brief,
    options.sealedSet,
    "sealed",
  );
  const rendered = await renderPreparedSiteBuildDirectionsV1({
    ...options,
    drafts: siteBuildDraftFromSealedDirectionsV1(set),
  });
  const files = await SiteArtifactFiles.at(options.artifactProject);
  for (const direction of set.directions)
    for (const name of ["desktop", "mobile"] as const) {
      assertSiteBuildObservationActiveV1(options);
      const expected = direction.previewArtifact[name],
        fresh = rendered.set.directions.find((item) => item.id === direction.id)?.previewArtifact[
          name
        ];
      if (
        !fresh ||
        expected.relativePath !== fresh.relativePath ||
        expected.digest !== fresh.digest ||
        expected.bytes !== fresh.bytes ||
        expected.id !== fresh.id ||
        expected.mime !== fresh.mime ||
        expected.rendererFingerprint !== fresh.rendererFingerprint ||
        expected.renderReceiptDigest !== fresh.renderReceiptDigest ||
        expected.renderReceiptId !== fresh.renderReceiptId ||
        (expected.expiresAt !== null && expected.expiresAt <= new Date().toISOString())
      )
        throw new SiteBuildError("conflict");
      const image = rendered.artifacts.find((item) => item.path === fresh.relativePath);
      const receiptBytes = rendered.artifacts.find(
        (item) => item.path === siteBuildDirectionReceiptPathV1(fresh.relativePath),
      );
      if (
        !image ||
        !receiptBytes ||
        !equalBytes(image.bytes, await files.readReviewPng(expected.relativePath))
      )
        throw new SiteBuildError("conflict");
      const record = npRequireAgentDirectionRenderReceiptRecordV1(
        JSON.parse(
          decode(
            await files.read(siteBuildDirectionReceiptPathV1(expected.relativePath), 32 * 1024),
          ),
        ),
      );
      const observed = npRequireAgentDirectionRenderReceiptRecordV1(
        JSON.parse(decode(receiptBytes.bytes)),
      );
      if (
        record.observedAt !== expected.createdAt ||
        record.id !== expected.renderReceiptId ||
        record.digest !== expected.renderReceiptDigest ||
        JSON.stringify(record.body) !== JSON.stringify(observed.body)
      )
        throw new SiteBuildError("conflict");
    }
  assertSiteBuildObservationActiveV1(options);
  return { ...rendered, set };
}

export const siteBuildSealedDirectionBytesV1 = (set: NpAgentDesignDirectionSetV1) =>
  npBuildCanonicalBytes("np.build-design-direction-set.v1", set).canonicalJsonUtf8;
