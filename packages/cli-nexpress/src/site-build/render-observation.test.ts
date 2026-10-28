import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildInstalledPackageContentDigestV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  type NpBuildInstalledPackageContentV1,
} from "@nexpress/core/agent-contract";
import executionVectors from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import { isSiteBuildBrowserRequestAllowedV1 } from "./browser-request-policy.js";
import type { NpObservedBuildPackageV1 } from "./installed-packages.js";
import { NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1 } from "./linux-supervisor-source.js";
import {
  fingerprintSiteBuildBrowserRequestPolicyV1,
  observeSiteBuildRenderEnvironmentV1,
  type NpSiteBuildRenderObservationInputV1,
} from "./render-observation.js";
import {
  NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1,
  NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1,
} from "./render-worker-source.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
const owners = [
  "@nexpress/app",
  "@nexpress/blocks",
  "@nexpress/cli",
  "@nexpress/core",
  "@nexpress/theme",
  "react",
  "react-dom",
];
async function fixture() {
  const instances: NpObservedBuildPackageV1[] = [];
  for (const name of owners) {
    const files: NpBuildInstalledPackageContentV1["files"] = [
      {
        path: "package.json",
        mode: "100644",
        sha256: sha(JSON.stringify({ name, version: "0.4.6" })),
      },
    ];
    if (name === "@nexpress/cli")
      for (const path of [
        "chunk-fixture.js",
        "index.js",
        "site-build-loader.js",
        "site-build-render-driver.js",
      ])
        files.push({ path: `dist/${path}`, mode: "100644", sha256: sha(path) });
    files.sort((left, right) => compare(left.path, right.path));
    const contentDigest = await npBuildInstalledPackageContentDigestV1({
      schemaVersion: "np.installed-package-content.v1",
      name,
      version: "0.4.6",
      files,
    });
    instances.push({
      name,
      version: "0.4.6",
      contentDigest,
      files,
      root: `/fixture-private/node_modules/${name}`,
      manifest: { name, scripts: { test: "fixture-secret" } },
      dependencies: new Map(),
    });
  }
  const cli = instances.find((instance) => instance.name === "@nexpress/cli")!;
  const packageLease = vi.fn(async () => {}),
    sourceLease = vi.fn(async () => {});
  const packages = {
    instances,
    packages: instances.map(({ name, version, contentDigest }) => ({
      name,
      version,
      contentDigest,
    })),
    rootImports: new Map([["@nexpress/cli", cli]]),
    assertUnchanged: packageLease,
  };
  const renderer = npRequireAgentBuildDirectionRendererV1({
    schemaVersion: "np.agent-build-direction-renderer.v1",
    implementation: "np.site-build.v1",
    projectSources: { schemaVersion: "np.agent-build-source-tree.v1", files: [] },
    packages: packages.packages,
  });
  const driverFiles = [
    ...cli.files
      .filter((file) => file.path.startsWith("dist/"))
      .map((file) => ({ path: file.path.slice(5), sha256: file.sha256 })),
    { path: "clock.mjs", sha256: sha(NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1) },
    { path: "worker.mjs", sha256: sha(NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1) },
    { path: "package.json", sha256: sha('{"type":"module"}\n') },
  ].sort((left, right) => compare(left.path, right.path));
  const imageId = `sha256:${"a".repeat(64)}`;
  const input: NpSiteBuildRenderObservationInputV1 = {
    image: {
      schemaVersion: "np.site-build-linux-sandbox-image.v1",
      imageId,
      baseImageId: `sha256:${"b".repeat(64)}`,
      recipeDigest: "c".repeat(64),
      supervisorSha256: "d".repeat(64),
      supervisorSourceSha256: sha(NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1),
      fontconfigSha256: "e".repeat(64),
      driverFiles,
    },
    observation: {
      schemaVersion: "np.site-build-linux-environment-observation.v1",
      imageId,
      architecture: "arm64",
      kernel: { release: "fixture-kernel", version: "fixture-version" },
      node: { version: "v24.11.1", sha256: "f".repeat(64) },
      browser: { version: "155.0.0.0", sha256: "1".repeat(64) },
      postgres: { version: "postgres (PostgreSQL) 16.10", sha256: "2".repeat(64) },
      fonts: [{ path: "usr/share/fonts/fixture.ttf", sha256: "3".repeat(64) }],
      fontconfigSha256: "e".repeat(64),
      scope: "environment-observation-only",
    },
    capsule: { renderer, runtimeFilesDigest: "4".repeat(64), assertOriginalUnchanged: sourceLease },
    packages,
    presentation: {
      locales: ["en", "ko"],
      viewports: {
        desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
        mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
      },
      clock: { now: "2026-01-02T03:04:05.000Z", randomSeed: "5".repeat(64) },
    },
    requestPolicy: {
      documentPaths: ["/", "/about"],
      imagePaths: ["/fixture.svg"],
      imageWidths: [390, 1440],
      imageQualities: [75],
    },
  };
  return { input, cli, packageLease, sourceLease };
}

describe("Linux render identity composition", () => {
  it("composes observed identities, independent fingerprints and detached Core bodies", async () => {
    const { input, sourceLease, packageLease } = await fixture();
    const result = await observeSiteBuildRenderEnvironmentV1(input);
    expect(result.environment).toEqual({
      schemaVersion: "np.agent-build-render-environment.v1",
      implementation: "np.site-build.v1",
      commandRegistryFingerprint: result.commandRegistryFingerprint,
      browser: { engine: "chromium", ...input.observation.browser },
      fonts: input.observation.fonts,
      ...input.presentation,
      timezone: "UTC",
      colorScheme: "light",
      reducedMotion: "reduce",
      imageCanonicalizer: "np.png-rgba.v1",
      sandbox: "np.linux-build-sandbox.v1",
      linux: {
        architecture: input.observation.architecture,
        kernel: input.observation.kernel,
        imageId: input.image.imageId,
        imageRecipeSha256: input.image.recipeDigest,
        supervisor: {
          binarySha256: input.image.supervisorSha256,
          sourceSha256: input.image.supervisorSourceSha256,
        },
        node: input.observation.node,
        postgres: input.observation.postgres,
        fontconfigSha256: input.observation.fontconfigSha256,
        runtimeFilesSha256: input.capsule.runtimeFilesDigest,
        cacheProfile: "np.site-build-next-cache.v1",
        requestPolicy: {
          implementation: "np.site-build-browser-requests.v1",
          sha256: fingerprintSiteBuildBrowserRequestPolicyV1(input.requestPolicy),
        },
        driverFiles: input.image.driverFiles,
      },
    });
    expect(result.fingerprint).toBe(
      await npBuildCanonicalDigest("np.build-render-environment.v1", result.environment),
    );
    expect(result.rendererFingerprint).toBe(
      await npBuildCanonicalDigest("np.build-direction-renderer.v1", input.capsule.renderer),
    );
    expect(result.commandRegistryFingerprint).toBe(
      await npBuildCanonicalDigest("np.build-command-registry.v1", result.commandRegistry),
    );
    expect(result.commandRegistry.node).toEqual({
      platform: "linux",
      arch: input.observation.architecture,
      ...input.observation.node,
    });
    expect(sourceLease).toHaveBeenCalledTimes(2);
    expect(packageLease).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toMatch(/fixture-private|fixture-secret/u);
    input.observation.fonts[0].sha256 = "0".repeat(64);
    input.presentation.clock.now = "changed";
    expect(result.environment.fonts[0].sha256).toBe("3".repeat(64));
    expect(result.environment.clock.now).toBe("2026-01-02T03:04:05.000Z");
  });

  it("retains the Core Linux canonical vector and closed presentation/cache identities", async () => {
    const vector = executionVectors.structured.find(
      (item) =>
        item.purpose === "np.build-render-environment.v1" &&
        item.canonical.includes("np.linux-build-sandbox.v1"),
    )!;
    const body = npRequireAgentBuildRenderEnvironmentV1(JSON.parse(vector.canonical));
    expect(await npBuildCanonicalDigest("np.build-render-environment.v1", body)).toBe(
      vector.digest,
    );
    const { environment } = await observeSiteBuildRenderEnvironmentV1((await fixture()).input);
    if (environment.sandbox !== "np.linux-build-sandbox.v1")
      throw new Error("Linux environment required");
    for (const mutation of [
      { ...environment, timezone: "Asia/Seoul" },
      { ...environment, colorScheme: "dark" },
      { ...environment, imageCanonicalizer: "caller" },
      { ...environment, linux: { ...environment.linux, cacheProfile: "caller" } },
    ])
      expect(() => npRequireAgentBuildRenderEnvironmentV1(mutation)).toThrow();
  });

  it("binds the finite request policy and exact evaluator with deterministic set order", async () => {
    const { input } = await fixture();
    const actual = fingerprintSiteBuildBrowserRequestPolicyV1(input.requestPolicy);
    const expected = sha(
      `np.site-build-browser-requests.v1\0${Function.prototype.toString.call(isSiteBuildBrowserRequestAllowedV1)}\0${JSON.stringify(input.requestPolicy)}`,
    );
    expect(actual).toBe(expected);
    expect(
      fingerprintSiteBuildBrowserRequestPolicyV1({
        ...input.requestPolicy,
        documentPaths: [...input.requestPolicy.documentPaths].reverse(),
        imageWidths: [...input.requestPolicy.imageWidths].reverse(),
      }),
    ).toBe(actual);
    expect(
      fingerprintSiteBuildBrowserRequestPolicyV1({ ...input.requestPolicy, imageQualities: [80] }),
    ).not.toBe(actual);
    const hydration = { ...input.requestPolicy, readRequests: ["/api/members/me"] };
    const metadata = {
      ...input.requestPolicy,
      metadataRequests: ["/icon.svg?icon.2l-vijnscfdt2.svg"],
    };
    expect(fingerprintSiteBuildBrowserRequestPolicyV1(hydration)).not.toBe(actual);
    expect(fingerprintSiteBuildBrowserRequestPolicyV1(metadata)).not.toBe(actual);
    expect(
      fingerprintSiteBuildBrowserRequestPolicyV1({
        ...metadata,
        metadataRequests: ["/icon.svg?icon.changed.svg"],
      }),
    ).not.toBe(fingerprintSiteBuildBrowserRequestPolicyV1(metadata));
    expect(
      fingerprintSiteBuildBrowserRequestPolicyV1({
        ...hydration,
        readRequests: ["/api/notifications?count=1"],
      }),
    ).not.toBe(fingerprintSiteBuildBrowserRequestPolicyV1(hydration));
    const getter = vi.fn(() => []);
    const unsafe = { ...input.requestPolicy };
    Object.defineProperty(unsafe, "documentPaths", { enumerable: true, get: getter });
    expect(() => fingerprintSiteBuildBrowserRequestPolicyV1(unsafe)).toThrow(SiteBuildError);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects renderer, installed contents and image asset cross-binding failures", async () => {
    for (const change of [
      "image",
      "renderer-packages",
      "instance",
      "chunk",
      "worker",
      "clock",
      "source",
      "fontconfig",
      "missing-loader",
    ] as const) {
      const { input } = await fixture();
      if (change === "image") input.observation.imageId = `sha256:${"0".repeat(64)}`;
      if (change === "renderer-packages") input.capsule.renderer.packages[0].version = "0.4.7";
      if (change === "instance") input.packages.instances[0].files[0].sha256 = "0".repeat(64);
      if (["chunk", "worker", "clock"].includes(change)) {
        const path = change === "chunk" ? "chunk-fixture.js" : `${change}.mjs`;
        input.image.driverFiles.find((file) => file.path === path)!.sha256 = "0".repeat(64);
      }
      if (change === "source") input.image.supervisorSourceSha256 = "0".repeat(64);
      if (change === "fontconfig") input.observation.fontconfigSha256 = "0".repeat(64);
      if (change === "missing-loader")
        input.image.driverFiles = input.image.driverFiles.filter(
          (file) => file.path !== "site-build-loader.js",
        );
      await expect(observeSiteBuildRenderEnvironmentV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });

  it("uses Core limits for locales, viewports, clocks, fonts and observed hashes", async () => {
    for (const change of [
      "locale-order",
      "locale-duplicate",
      "viewport",
      "clock",
      "random",
      "fonts",
      "runtime",
      "kernel",
      "drivers",
    ] as const) {
      const { input } = await fixture();
      if (change === "locale-order") input.presentation.locales.reverse();
      if (change === "locale-duplicate") input.presentation.locales = ["en", "en"];
      if (change === "viewport") input.presentation.viewports.mobile.width = 1;
      if (change === "clock") input.presentation.clock.now = "invalid";
      if (change === "random") input.presentation.clock.randomSeed = "x".repeat(64);
      if (change === "fonts") input.observation.fonts.push({ ...input.observation.fonts[0] });
      if (change === "runtime") input.capsule.runtimeFilesDigest = "0".repeat(63);
      if (change === "kernel") input.observation.kernel.release = "x".repeat(129);
      if (change === "drivers") input.image.driverFiles.reverse();
      await expect(observeSiteBuildRenderEnvironmentV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });

  it("does not execute presentation getters, proxy traps or nested array accessors", async () => {
    for (const change of [
      "root-proxy",
      "clock-getter",
      "viewport-proxy",
      "locale-getter",
    ] as const) {
      const { input } = await fixture();
      const invoked = vi.fn(() => {
        throw new Error("must not execute");
      });
      if (change === "root-proxy")
        input.presentation = new Proxy(input.presentation, {
          ownKeys: invoked,
          get: invoked,
          getPrototypeOf: invoked,
        });
      if (change === "clock-getter")
        Object.defineProperty(input.presentation.clock, "now", { enumerable: true, get: invoked });
      if (change === "viewport-proxy")
        input.presentation.viewports.desktop = new Proxy(input.presentation.viewports.desktop, {
          ownKeys: invoked,
          get: invoked,
          getPrototypeOf: invoked,
        });
      if (change === "locale-getter")
        Object.defineProperty(input.presentation.locales, "0", { enumerable: true, get: invoked });
      await expect(observeSiteBuildRenderEnvironmentV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
      expect(invoked).not.toHaveBeenCalled();
    }
  });

  it("changes fingerprints when observed execution inputs or prepared runtime change", async () => {
    const original = await observeSiteBuildRenderEnvironmentV1((await fixture()).input);
    for (const change of [
      "browser",
      "font",
      "runtime",
      "supervisor",
      "recipe",
      "policy",
      "clock",
      "viewport",
    ] as const) {
      const { input } = await fixture();
      if (change === "browser") input.observation.browser.sha256 = "0".repeat(64);
      if (change === "font") input.observation.fonts[0].sha256 = "0".repeat(64);
      if (change === "runtime") input.capsule.runtimeFilesDigest = "0".repeat(64);
      if (change === "supervisor") input.image.supervisorSha256 = "0".repeat(64);
      if (change === "recipe") input.image.recipeDigest = "0".repeat(64);
      if (change === "policy") input.requestPolicy.imageQualities = [80];
      if (change === "clock") input.presentation.clock.now = "2026-01-02T03:04:06.000Z";
      if (change === "viewport") input.presentation.viewports.desktop.width = 1441;
      const changed = await observeSiteBuildRenderEnvironmentV1(input);
      expect(changed.fingerprint).not.toBe(original.fingerprint);
      expect(changed.rendererFingerprint).toBe(original.rendererFingerprint);
    }
  });

  it("checks source and package leases through completion and redacts their errors", async () => {
    for (const change of ["source-before", "source-after", "package-after"] as const) {
      const { input, sourceLease, packageLease } = await fixture();
      const lease = change.startsWith("source") ? sourceLease : packageLease;
      if (change === "source-after") lease.mockResolvedValueOnce(undefined);
      if (change === "package-after")
        lease.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      lease.mockRejectedValueOnce(new Error("/fixture-private/.env"));
      await expect(observeSiteBuildRenderEnvironmentV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });
});
