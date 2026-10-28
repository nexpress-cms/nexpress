import {
  npBuildCanonicalDigest,
  npBuildCommandPoliciesV1,
  npBuildInstalledPackageContentDigestV1,
  npBuildSourceExcludedDirectoryNamesV1,
  npBuildSourceExcludedRootsV1,
  npRequireAgentBuildCommandRegistryV1,
  npRequireBuildInstalledPackageContentV1,
  type NpAgentBuildCommandRegistryV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpObservedBuildPackagesV1 } from "./installed-packages.js";
import type { NpSiteBuildLinuxImageEnvironmentObservationV1 } from "./linux-environment.js";
import type { NpSiteBuildLinuxSandboxImageV1 } from "./linux-sandbox.js";

/**
 * Read-only construction from trusted, in-process observers, not untrusted JSON.
 * Reuses their existing lease; it does not read files, launch an executable or
 * grant execution authority. The caller owns image branding and authorization.
 */
export async function observeSiteBuildRenderCommandRegistryV1({
  image,
  environment,
  packages,
}: {
  image: NpSiteBuildLinuxSandboxImageV1;
  environment: NpSiteBuildLinuxImageEnvironmentObservationV1;
  packages: NpObservedBuildPackagesV1;
}): Promise<{ registry: NpAgentBuildCommandRegistryV1; fingerprint: string }> {
  try {
    await packages.assertUnchanged();
    if (
      image.schemaVersion !== "np.site-build-linux-sandbox-image.v1" ||
      environment.schemaVersion !== "np.site-build-linux-environment-observation.v1" ||
      environment.scope !== "environment-observation-only" ||
      !/^sha256:[a-f0-9]{64}$/u.test(image.imageId) ||
      image.imageId !== environment.imageId
    )
      throw new SiteBuildError("unavailable");
    const cli = packages.rootImports.get("@nexpress/cli");
    if (!cli || cli.name !== "@nexpress/cli" || !packages.instances.includes(cli))
      throw new SiteBuildError("unavailable");
    // Revalidate and hash the observer's complete installed payload, including
    // package.json and file modes. A root-import summary is not that inventory.
    const inventory = npRequireBuildInstalledPackageContentV1({
      schemaVersion: "np.installed-package-content.v1",
      name: cli.name,
      version: cli.version,
      files: cli.files,
    });
    const claimedContentDigest = cli.contentDigest;
    const summaries = packages.packages.filter(
      (entry) =>
        entry.name === inventory.name &&
        entry.version === inventory.version &&
        entry.contentDigest === claimedContentDigest,
    );
    const entrypoint = inventory.files.find((file) => file.path === "dist/index.js");
    const imageEntrypoints = image.driverFiles.filter((file) => file.path === "index.js");
    if (
      summaries.length !== 1 ||
      !entrypoint ||
      imageEntrypoints.length !== 1 ||
      imageEntrypoints[0].sha256 !== entrypoint.sha256
    )
      throw new SiteBuildError("unavailable");
    const node = {
      platform: "linux",
      arch: environment.architecture,
      version: environment.node.version,
      sha256: environment.node.sha256,
    };
    const contentDigest = await npBuildInstalledPackageContentDigestV1(inventory);
    if (contentDigest !== claimedContentDigest) throw new SiteBuildError("unavailable");
    const registry = npRequireAgentBuildCommandRegistryV1({
      schemaVersion: "np.agent-build-command-registry.v1",
      implementation: "np.site-build.v1",
      node,
      entrypoints: [
        {
          package: inventory.name,
          version: inventory.version,
          contentDigest,
          path: entrypoint.path,
          sha256: entrypoint.sha256,
        },
      ],
      policies: npBuildCommandPoliciesV1.map((policy) => ({ ...policy })),
      sourceExclusions: {
        roots: [...npBuildSourceExcludedRootsV1],
        directoryNames: [...npBuildSourceExcludedDirectoryNamesV1],
      },
      shell: false,
      packageScripts: false,
      inheritedEnvironment: false,
    });
    const fingerprint = await npBuildCanonicalDigest("np.build-command-registry.v1", registry);
    await packages.assertUnchanged();
    return { registry, fingerprint };
  } catch {
    // Observer/contract errors can contain local locators. They are not part of
    // the registry or a user-visible failure from this read-only constructor.
    throw new SiteBuildError("unavailable");
  }
}
