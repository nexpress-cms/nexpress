import { realpath } from "node:fs/promises";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildContractLimitsV1,
  npBuildDirectionLimitsV1,
  npParseAgentDesignDirectionSetV1,
  npParseAgentSiteBlueprintV1,
  npParseAgentSiteBriefV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { observeSiteBuildRenderContextV1 } from "./render-context.js";
import {
  siteBuildDraftFromSealedDirectionsV1,
  validatePreparedSiteBuildDirectionsV1,
} from "./direction-render.js";
import { runSiteBuildLinuxSandboxV1 } from "./linux-sandbox.js";
import { prepareSiteBuildRepositoryEditPlanV1 } from "./repository-edit-plan.js";
import { observeSiteBuildDirtyPathsV1 } from "./repository-status.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { requireSiteBuildRepositorySeedFilesV1 } from "./repository-seed.js";

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** Dry-run only. Real declarations, exact staged bytes and fresh render evidence are checked. */
export async function runSiteBuildPlanValidationV1(
  values: Map<string, string>,
  cwd: string,
): Promise<unknown> {
  const project = await realpath(cwd);
  const files = await SiteArtifactFiles.at(project);
  const brief = npRequireBuildReadyBriefV1(
    npParseAgentSiteBriefV1(
      decode(await files.read(values.get("--brief")!, npBuildContractLimitsV1.brief.bytes)),
    ),
  );
  const directions = await npRequireBuildDirectionSetForBriefV1(
    brief,
    npParseAgentDesignDirectionSetV1(
      decode(await files.read(values.get("--directions")!, npBuildDirectionLimitsV1.set.bytes)),
    ),
    "sealed",
  );
  const blueprint = await npRequireBuildBlueprintForBriefV1(
    brief,
    npParseAgentSiteBlueprintV1(
      decode(await files.read(values.get("--blueprint")!, npBuildContractLimitsV1.blueprint.bytes)),
    ),
  );
  const baseline = await readSiteSourceTreeV1(project);
  const dirtyPaths = await observeSiteBuildDirtyPathsV1(project);
  const plan = await prepareSiteBuildRepositoryEditPlanV1({
    scope: "private-build-copy",
    project,
    blueprint,
    baseline: baseline.manifest,
    dirtyPaths,
  });
  try {
    // Applying to this disposable copy is a preflight. No original source changes.
    const candidate = await plan.apply();
    const rendering = await observeSiteBuildRenderContextV1({
      cwd: project,
      files,
      runtimePath: values.get("--runtime")!,
      brief,
      drafts: siteBuildDraftFromSealedDirectionsV1(directions),
    });
    if (blueprint.commandRegistryFingerprint !== rendering.commandRegistryFingerprint)
      throw new SiteBuildError("conflict");
    const preview = blueprint.commands.find((command) => command.template === "preview-render");
    if (!preview) throw new SiteBuildError("conflict");
    // This stage observes the reviewed baseline. A changed candidate has a
    // different runtime/source inventory; only its actual build may validate
    // the final preview environment. Never stamp the baseline onto that claim.
    const result = await runSiteBuildLinuxSandboxV1({
      image: rendering.context.image,
      project: rendering.context.capsule.project,
      inputBytes: Buffer.from(
        JSON.stringify({
          mode: "blueprint",
          config: rendering.context.config,
          renderer: rendering.context.capsule.renderer,
          clockNow: rendering.observed.clock.now,
          randomSeed: rendering.observed.clock.randomSeed,
          brief,
          directions,
          blueprint,
        }),
      ),
      artifacts: [
        { name: "blueprint.json", maxBytes: npBuildContractLimitsV1.blueprint.bytes },
        { name: "repository-seed.json", maxBytes: npBuildContractLimitsV1.blueprint.bytes },
      ],
    });
    const returned = result.artifacts.get("blueprint.json");
    const expected = npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint);
    if (
      !returned ||
      !Buffer.from(
        npBuildCanonicalBytes(
          "np.build-site-blueprint.v1",
          npParseAgentSiteBlueprintV1(decode(returned)),
        ).canonicalJsonUtf8,
      ).equals(expected.canonicalJsonUtf8)
    )
      throw new SiteBuildError("conflict");
    const seedArtifactBytes = result.artifacts.get("repository-seed.json");
    if (!seedArtifactBytes) throw new SiteBuildError("unavailable");
    const configPath = rendering.context.config;
    if (configPath !== "src/nexpress.config.ts" && configPath !== "nexpress.config.ts")
      throw new SiteBuildError("unavailable");
    // The native configured App owner produced these bytes. The repository
    // continuation must consume that exact theme/seed/navigation projection,
    // and the edit owner has already checked every staged byte against the plan.
    const repositorySeed = await requireSiteBuildRepositorySeedFilesV1({
      blueprint,
      configPath,
      seedArtifactBytes,
    });
    const rerender = await validatePreparedSiteBuildDirectionsV1({
      ...rendering.context,
      sealedSet: directions,
      artifactProject: project,
    });
    await plan.assertOriginalUnchanged();
    await rendering.context.capsule.assertOriginalUnchanged();
    const status = await files.write(values.get("--out")!, expected.canonicalJsonUtf8);
    return {
      schemaVersion: "np.site-build-cli-result.v1",
      operation: "plan validate",
      status,
      path: values.get("--out"),
      blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
      validationScope: "installed-declarations-file-preconditions-fresh-native-rerender",
      executable: false,
      sourceWrites: 0,
      baselineTreeDigest: baseline.digest,
      privateCandidateTreeDigest: candidate.treeDigest,
      previewEnvironmentValidation: "deferred-until-candidate-build",
      stagedPaths: candidate.paths,
      deferredCommandPaths: candidate.deferredCommandPaths,
      repositorySeedPaths: repositorySeed.files.map((file) => file.path),
      seedMaterialization: "deferred-until-candidate-preview-and-explicit-repository-seed",
      renderedImages: 6,
      freshPageJobs: rerender.audits.length - 1,
      unverified: [
        "candidate-exports",
        "commands",
        "schema",
        "migrations",
        "candidate-render-environment",
        "candidate-preview",
      ],
    };
  } finally {
    await plan.close();
  }
}
