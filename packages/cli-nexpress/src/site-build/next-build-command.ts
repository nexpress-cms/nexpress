import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SiteBuildError } from "./artifact-io.js";
import { inspectSiteInstalledPackagesV1 } from "./installed-packages.js";
import { prepareSiteBuildDeterministicNextBuildV1 } from "./deterministic-next-build.js";
import { deriveSiteBuildNextPreviewRuntimeV1 } from "./next-preview-runtime.js";
import {
  observeSiteBuildNextArtifactsV1,
  prepareSiteBuildNextPreviewControlsV1,
  verifySiteBuildNextPreviewControlsV1,
  installSiteBuildNextCacheMappingsV1,
  requireSiteBuildDeterministicNextEvidenceV1,
  type NpSiteBuildLinuxBuildReceiptV1,
} from "./linux-build.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

type Source = Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
type Artifact = NpSiteBuildLinuxBuildReceiptV1["artifacts"][number];
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

export interface NpSiteBuildCommandNextDerivationV1 {
  schemaVersion: "np.site-build-command-next-derivation.v1";
  scope: "private-build-copy";
  sourceBefore: Source;
  sourceAfter: Source;
  buildId: string;
  previewConfig: NonNullable<NpSiteBuildLinuxBuildReceiptV1["previewConfig"]>;
  nextPreviewRuntime: NonNullable<NpSiteBuildLinuxBuildReceiptV1["nextPreviewRuntime"]>;
  deterministicNext: NonNullable<NpSiteBuildLinuxBuildReceiptV1["deterministicNext"]>;
  runtimeCache: NpSiteBuildLinuxBuildReceiptV1["runtimeCache"];
  artifacts: Artifact[];
  artifactManifestSha256: string;
}

/** The live runtime owner separately inventories all compiled bytes. Keep the
 * executor receipt bounded rather than duplicate the entire Next tree in it. */
export type NpSiteBuildCommandNextSummaryV1 = Omit<
  NpSiteBuildCommandNextDerivationV1,
  "sourceBefore" | "sourceAfter" | "artifacts"
> & { sourceBeforeDigest: string; sourceAfterDigest: string };

/**
 * Fixed build-template adapter. The executor owns the bounded workspace, its
 * successful command and removal; no model argv or artifact receipt is accepted
 * as a substitute. The same compiled preview owners serve renderer preparation.
 */
export async function prepareSiteBuildCommandNextV1(input: {
  project: string;
  dependencies: string;
  baseImageId: string;
  config: "src/nexpress.config.ts" | "nexpress.config.ts";
  source: Source;
  clock: { now: string; randomSeed: string };
  assertDependenciesUnchanged(): Promise<void>;
}) {
  await input.assertDependenciesUnchanged();
  if ((await readSiteSourceTreeV1(input.project)).digest !== input.source.digest)
    throw new SiteBuildError("conflict");
  const packages = await inspectSiteInstalledPackagesV1(input.project);
  const deterministic = await prepareSiteBuildDeterministicNextBuildV1({
    scope: "private-build-copy",
    project: input.project,
    dependencies: input.dependencies,
    source: input.source,
    packages,
    baseImageId: input.baseImageId,
    clock: input.clock,
  });
  const preview = await prepareSiteBuildNextPreviewControlsV1(
    input.project,
    input.config,
    deterministic.parentDirectory,
    input.source,
    packages,
    deterministic,
  );
  const assertPreparedUnchanged = async () => {
    await input.assertDependenciesUnchanged();
    await packages.assertUnchanged();
    await deterministic.assertUnchanged();
  };
  await assertPreparedUnchanged();
  let finalized = false;
  return {
    controls: {
      directory: deterministic.parentDirectory,
      files: [...new Set([...preview.helper.files, preview.carrier.path])],
    },
    argv: ["/usr/local/bin/node", `/np/project/${preview.carrier.path}`],
    assertPreparedUnchanged,
    /** Invoke only after the actual workspace finalizer exported these rows and
     * its awaited owner confirmed builder removal. This function starts no tool. */
    async finalizeAfterBuilderRemoval(exported: readonly Artifact[]) {
      if (finalized) throw new SiteBuildError("conflict");
      finalized = true;
      await input.assertDependenciesUnchanged();
      await packages.assertUnchanged();
      if (
        hash(JSON.stringify(await observeSiteBuildNextArtifactsV1(input.project))) !==
        hash(JSON.stringify(exported))
      )
        throw new SiteBuildError("conflict");
      const sourceAfter = await readSiteSourceTreeV1(input.project);
      const buildId = (await readFile(join(input.project, ".next/BUILD_ID"), "utf8")).trim();
      const runtimeCache = await installSiteBuildNextCacheMappingsV1(input.project);
      const nextPreviewRuntime = await deriveSiteBuildNextPreviewRuntimeV1({
        scope: "private-build-copy",
        project: input.project,
        packages,
      });
      const artifacts = await observeSiteBuildNextArtifactsV1(input.project);
      const previewConfig = await verifySiteBuildNextPreviewControlsV1(
        input.project,
        preview,
        sourceAfter,
        artifacts,
      );
      const deterministicNext = requireSiteBuildDeterministicNextEvidenceV1(
        deterministic,
        buildId,
        artifacts,
      );
      for (const file of [
        { path: nextPreviewRuntime.entry.path, ...nextPreviewRuntime.entry.derived },
        nextPreviewRuntime.requiredServerFiles,
        ...nextPreviewRuntime.evidence,
      ]) {
        const actual = artifacts.find((row) => row.path === file.path);
        if (actual?.kind !== "file" || actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
          throw new SiteBuildError("conflict");
      }
      if ((await readSiteSourceTreeV1(input.project)).digest !== sourceAfter.digest)
        throw new SiteBuildError("conflict");
      await input.assertDependenciesUnchanged();
      await packages.assertUnchanged();
      const receipt: NpSiteBuildCommandNextDerivationV1 = {
        schemaVersion: "np.site-build-command-next-derivation.v1",
        scope: "private-build-copy",
        sourceBefore: input.source,
        sourceAfter,
        buildId,
        previewConfig,
        nextPreviewRuntime,
        deterministicNext,
        runtimeCache,
        artifacts,
        artifactManifestSha256: hash(JSON.stringify(artifacts)),
      };
      return receipt;
    },
  };
}
