import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  npBuildCanonicalDigest,
  npBuildInstalledPackageContentDigestV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireBuildInstalledPackageContentV1,
  type NpAgentBuildCommandRegistryV1,
  type NpAgentBuildRenderEnvironmentV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  isSiteBuildBrowserRequestAllowedV1,
  requireSiteBuildBrowserRequestPolicyV1,
  type NpSiteBuildBrowserRequestPolicyV1,
} from "./browser-request-policy.js";
import type { NpObservedBuildPackagesV1 } from "./installed-packages.js";
import type { NpSiteBuildLinuxImageEnvironmentObservationV1 } from "./linux-environment.js";
import type { NpSiteBuildLinuxSandboxImageV1 } from "./linux-sandbox.js";
import { NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1 } from "./linux-supervisor-source.js";
import type { NpFrozenPreparedSiteBuildRenderProjectV1 } from "./render-capsule.js";
import { observeSiteBuildRenderCommandRegistryV1 } from "./render-command-registry.js";
import {
  NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1,
  NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1,
} from "./render-worker-source.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
const fail = (): never => {
  throw new SiteBuildError("unavailable");
};

/** Identity of the finite policy and exact shared host/browser evaluator; no network request is made. */
export function fingerprintSiteBuildBrowserRequestPolicyV1(value: unknown): string {
  try {
    const policy = requireSiteBuildBrowserRequestPolicyV1(value);
    const canonical = {
      documentPaths: [...policy.documentPaths].sort(compare),
      imagePaths: [...policy.imagePaths].sort(compare),
      imageWidths: [...policy.imageWidths].sort((left, right) => left - right),
      imageQualities: [...policy.imageQualities].sort((left, right) => left - right),
      ...(policy.readRequests === undefined
        ? {}
        : { readRequests: [...policy.readRequests].sort(compare) }),
      ...(policy.metadataRequests === undefined
        ? {}
        : { metadataRequests: [...policy.metadataRequests].sort(compare) }),
    };
    return sha(
      `np.site-build-browser-requests.v1\0${Function.prototype.toString.call(isSiteBuildBrowserRequestAllowedV1)}\0${JSON.stringify(canonical)}`,
    );
  } catch {
    return fail();
  }
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value))
    return fail();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    return fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !field.enumerable || !("value" in field)) return fail();
    result[key] = field.value;
  }
  return result;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : fail();
}
function number(value: unknown): number {
  return typeof value === "number" ? value : fail();
}
function presentationData(value: unknown) {
  const body = dataRecord(value, ["locales", "viewports", "clock"]);
  const locales = body.locales;
  if (
    locales === null ||
    typeof locales !== "object" ||
    types.isProxy(locales) ||
    !Array.isArray(locales) ||
    Object.getPrototypeOf(locales) !== Array.prototype
  )
    return fail();
  const length = Object.getOwnPropertyDescriptor(locales, "length");
  if (
    !length ||
    !("value" in length) ||
    !Number.isSafeInteger(length.value) ||
    length.value < 1 ||
    length.value > 20 ||
    Reflect.ownKeys(locales).length !== length.value + 1
  )
    return fail();
  const detached: string[] = [];
  for (let index = 0; index < length.value; index++) {
    const entry = Object.getOwnPropertyDescriptor(locales, String(index));
    if (!entry || !entry.enumerable || !("value" in entry)) return fail();
    detached.push(text(entry.value));
  }
  const viewports = dataRecord(body.viewports, ["desktop", "mobile"]);
  const viewport = (input: unknown) => {
    const row = dataRecord(input, ["width", "height", "deviceScaleFactor"]);
    return {
      width: number(row.width),
      height: number(row.height),
      deviceScaleFactor: number(row.deviceScaleFactor),
    };
  };
  const clock = dataRecord(body.clock, ["now", "randomSeed"]);
  return {
    locales: detached,
    viewports: { desktop: viewport(viewports.desktop), mobile: viewport(viewports.mobile) },
    clock: { now: text(clock.now), randomSeed: text(clock.randomSeed) },
  };
}

export interface NpSiteBuildRenderObservationInputV1 {
  image: NpSiteBuildLinuxSandboxImageV1;
  observation: NpSiteBuildLinuxImageEnvironmentObservationV1;
  capsule: Pick<
    NpFrozenPreparedSiteBuildRenderProjectV1,
    "renderer" | "runtimeFilesDigest" | "assertOriginalUnchanged"
  >;
  packages: NpObservedBuildPackagesV1;
  presentation: Pick<NpAgentBuildRenderEnvironmentV1, "locales" | "viewports" | "clock">;
  requestPolicy: NpSiteBuildBrowserRequestPolicyV1;
}

/**
 * Compose identities from trusted in-process observers. The caller owns image
 * branding and execution authorization. The capsule lease checks its original
 * prepared sources; runtimeFilesDigest comes from the existing copy owner.
 * No file/executable/network observation is added here. The fixed cache profile
 * names an implementation; actual cache/sandbox/render acceptance is separate.
 */
export async function observeSiteBuildRenderEnvironmentV1(
  input: NpSiteBuildRenderObservationInputV1,
): Promise<{
  environment: NpAgentBuildRenderEnvironmentV1;
  fingerprint: string;
  rendererFingerprint: string;
  commandRegistry: NpAgentBuildCommandRegistryV1;
  commandRegistryFingerprint: string;
}> {
  try {
    const { image, observation, capsule, packages } = input;
    const presentation = presentationData(input.presentation);
    const requestPolicySha256 = fingerprintSiteBuildBrowserRequestPolicyV1(input.requestPolicy);
    await capsule.assertOriginalUnchanged();
    const renderer = npRequireAgentBuildDirectionRendererV1(capsule.renderer);
    const observed = npRequireAgentBuildDirectionRendererV1({
      ...renderer,
      packages: packages.packages,
    });
    if (
      JSON.stringify(renderer.packages) !== JSON.stringify(observed.packages) ||
      packages.instances.length > 2000
    )
      return fail();
    const command = await observeSiteBuildRenderCommandRegistryV1({
      image,
      environment: observation,
      packages,
    });
    const summaries = new Set<string>();
    let fileCount = 0;
    const cli = packages.rootImports.get("@nexpress/cli");
    let cliFiles: Map<string, string> | undefined;
    for (const instance of packages.instances) {
      if ((fileCount += instance.files.length) > 300_000) return fail();
      const inventory = npRequireBuildInstalledPackageContentV1({
        schemaVersion: "np.installed-package-content.v1",
        name: instance.name,
        version: instance.version,
        files: instance.files,
      });
      const contentDigest = await npBuildInstalledPackageContentDigestV1(inventory);
      if (contentDigest !== instance.contentDigest) return fail();
      summaries.add(`${inventory.name}\0${inventory.version}\0${contentDigest}`);
      if (instance === cli)
        cliFiles = new Map(inventory.files.map((file) => [file.path, file.sha256]));
    }
    if (
      !cliFiles ||
      summaries.size !== renderer.packages.length ||
      renderer.packages.some(
        (entry) => !summaries.has(`${entry.name}\0${entry.version}\0${entry.contentDigest}`),
      )
    )
      return fail();
    const driverFiles = new Map(image.driverFiles.map((file) => [file.path, file.sha256]));
    for (const path of [
      "index.js",
      "site-build-render-driver.js",
      "site-build-loader.js",
      "worker.mjs",
      "clock.mjs",
    ])
      if (!driverFiles.has(path)) return fail();
    for (const file of image.driverFiles)
      if (file.path.endsWith(".js") && cliFiles.get(`dist/${file.path}`) !== file.sha256)
        return fail();
    if (
      image.supervisorSourceSha256 !== sha(NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1) ||
      image.fontconfigSha256 !== observation.fontconfigSha256 ||
      driverFiles.get("worker.mjs") !== sha(NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1) ||
      driverFiles.get("clock.mjs") !== sha(NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1)
    )
      return fail();
    const environment = npRequireAgentBuildRenderEnvironmentV1({
      schemaVersion: "np.agent-build-render-environment.v1",
      implementation: "np.site-build.v1",
      commandRegistryFingerprint: command.fingerprint,
      browser: { engine: "chromium", ...observation.browser },
      fonts: observation.fonts,
      ...presentation,
      timezone: "UTC",
      colorScheme: "light",
      reducedMotion: "reduce",
      imageCanonicalizer: "np.png-rgba.v1",
      sandbox: "np.linux-build-sandbox.v1",
      linux: {
        architecture: observation.architecture,
        kernel: observation.kernel,
        imageId: image.imageId,
        imageRecipeSha256: image.recipeDigest,
        supervisor: {
          binarySha256: image.supervisorSha256,
          sourceSha256: image.supervisorSourceSha256,
        },
        node: observation.node,
        postgres: observation.postgres,
        fontconfigSha256: observation.fontconfigSha256,
        runtimeFilesSha256: capsule.runtimeFilesDigest,
        cacheProfile: "np.site-build-next-cache.v1",
        requestPolicy: {
          implementation: "np.site-build-browser-requests.v1",
          sha256: requestPolicySha256,
        },
        driverFiles: image.driverFiles,
      },
    });
    const rendererFingerprint = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      renderer,
    );
    const fingerprint = await npBuildCanonicalDigest("np.build-render-environment.v1", environment);
    await packages.assertUnchanged();
    await capsule.assertOriginalUnchanged();
    return {
      environment,
      fingerprint,
      rendererFingerprint,
      commandRegistry: command.registry,
      commandRegistryFingerprint: command.fingerprint,
    };
  } catch {
    return fail();
  }
}
