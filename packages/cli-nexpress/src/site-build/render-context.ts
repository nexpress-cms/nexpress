import {
  npBuildFileDigest,
  npRequireAgentBuildRenderFixtureRefV1,
  npRequireAgentBuildRenderFixtureV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentSiteBriefV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError, type SiteArtifactFiles } from "./artifact-io.js";
import { reuseSiteBuildRenderSessionV1 } from "./render-session.js";
import {
  observeSiteBuildLinuxSandboxEnvironmentV1,
  prepareSiteBuildLinuxSandboxImageV1,
  runSiteBuildLinuxSandboxV1,
} from "./linux-sandbox.js";
import { observeSiteBuildRenderEnvironmentV1 } from "./render-observation.js";
import { observeSiteBuildRenderPathsV1 } from "./direction-render.js";
import { observeSiteBuildForumReadRequestsV1 } from "./forum-read-policy.js";
import { requireSiteBuildBrowserRequestPolicyV1 } from "./browser-request-policy.js";
import { observeSiteBuildNextMetadataAssetsV1 } from "./next-metadata-assets.js";

/** Re-observe private runtime and finite request policy; persisted claims alone are insufficient. */
export async function observeSiteBuildRenderContextV1(input: {
  cwd: string;
  files: SiteArtifactFiles;
  /** Explicit already-leased fixture transport; runtime/session artifacts stay in files. */
  fixtureFiles?: SiteArtifactFiles;
  runtimePath: string;
  brief: NpAgentSiteBriefV1;
  drafts: NpAgentDesignDirectionDraftSetV1;
  /** In-process packed-copy relocation only; never taken from a saved session. */
  tarballProjectRoot?: string;
}) {
  const { cwd, files, runtimePath, brief, drafts } = input;
  const fixturePaths = new Map<string, string>();
  let fixtureTotal = 0;
  for (const sample of drafts.comparisonInputs.sampleContent) {
    const reference = npRequireAgentBuildRenderFixtureRefV1(sample.data);
    const previousDigest = fixturePaths.get(reference.stagedArtifactPath);
    if (previousDigest) {
      if (previousDigest !== reference.digest) throw new SiteBuildError("conflict");
      continue;
    }
    fixturePaths.set(reference.stagedArtifactPath, reference.digest);
    const bytes = await (input.fixtureFiles ?? files).read(
      reference.stagedArtifactPath,
      4 * 1024 * 1024,
    );
    if ((fixtureTotal += bytes.length) > 4 * 1024 * 1024) throw new SiteBuildError("input");
    if ((await npBuildFileDigest("np.build-staged-artifact.v1", bytes)) !== reference.digest)
      throw new SiteBuildError("conflict");
    npRequireAgentBuildRenderFixtureV1(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  }
  const observed = await reuseSiteBuildRenderSessionV1({
    session: JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await files.read(runtimePath, 4 * 1024 * 1024),
      ),
    ),
    projectRoot: cwd,
    tarballProjectRoot: input.tarballProjectRoot,
  });
  const image = await prepareSiteBuildLinuxSandboxImageV1();
  const observation = await observeSiteBuildLinuxSandboxEnvironmentV1(image);
  const paths = await observeSiteBuildRenderPathsV1(
    observed.capsule.project,
    drafts.comparisonInputs.informationArchitecture.map((page) => page.route),
  );
  const metadata = await observeSiteBuildNextMetadataAssetsV1({
    project: observed.capsule.project,
    packages: observed.installedPackages,
    assertCapsuleUnchanged: () => observed.capsule.assertOriginalUnchanged(),
  });
  paths.requestPolicy = requireSiteBuildBrowserRequestPolicyV1({
    ...paths.requestPolicy,
    metadataRequests: [...metadata.metadataRequests],
  });
  if (
    drafts.directions.some((direction) =>
      direction.pageBindings.some(
        (binding) =>
          binding.source === "custom" &&
          !binding.templateId.startsWith("pages.") &&
          !binding.templateId.startsWith("posts."),
      ),
    )
  ) {
    const requests = new Set<string>();
    for (const direction of drafts.directions) {
      const projected = await runSiteBuildLinuxSandboxV1({
        image,
        project: observed.capsule.project,
        inputBytes: Buffer.from(
          JSON.stringify({
            mode: "projection",
            config: observed.config,
            renderer: observed.capsule.renderer,
            clockNow: observed.clock.now,
            randomSeed: observed.clock.randomSeed,
            brief,
            drafts,
            directionId: direction.id,
          }),
        ),
        artifacts: [{ name: "fixture.json", maxBytes: 4 * 1024 * 1024 }],
      });
      const bytes = projected.artifacts.get("fixture.json");
      if (!bytes) throw new SiteBuildError("input");
      const projection: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      for (const request of observeSiteBuildForumReadRequestsV1(
        projection,
        observed.capsule.renderer,
      ))
        requests.add(request);
    }
    if (requests.size)
      paths.requestPolicy = requireSiteBuildBrowserRequestPolicyV1({
        ...paths.requestPolicy,
        readRequests: [...requests].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
      });
  }
  const rendering = await observeSiteBuildRenderEnvironmentV1({
    image,
    observation,
    capsule: observed.capsule,
    packages: observed.installedPackages,
    presentation: {
      locales: [...brief.locales].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
      viewports: drafts.comparisonInputs.viewports,
      clock: observed.clock,
    },
    requestPolicy: paths.requestPolicy,
  });
  await metadata.assertUnchanged();
  return {
    observed,
    ...rendering,
    metadataEvidence: metadata.evidence,
    context: {
      brief,
      drafts,
      config: observed.config,
      capsule: {
        ...observed.capsule,
        async assertOriginalUnchanged() {
          await observed.capsule.assertOriginalUnchanged();
          await metadata.assertUnchanged();
        },
      },
      image,
      environment: rendering.environment,
      paths,
    },
  };
}
