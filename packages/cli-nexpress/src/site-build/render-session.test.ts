import { beforeEach, describe, expect, it, vi } from "vitest";
import { npBuildInstalledCatalogDigestV1 } from "@nexpress/core/agent-contract";
import type * as RuntimeCache from "./render-runtime-cache.js";
import { SiteBuildError } from "./artifact-io.js";
import {
  prepareSiteBuildRenderSessionV1,
  reuseSiteBuildRenderSessionV1,
} from "./render-session.js";

// Orchestration doubles only. These tests are not native sandbox or rendering evidence.
const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  base: vi.fn(),
  withDocker: vi.fn(),
  project: vi.fn(),
  build: vi.fn(),
  freeze: vi.fn(),
  createCache: vi.fn(),
  reuseCache: vi.fn(),
  image: vi.fn(),
  native: vi.fn(),
  projectClose: vi.fn(),
  capsuleClose: vi.fn(),
  originalLease: vi.fn(),
  capsuleLease: vi.fn(),
  cacheLease: vi.fn(),
}));
vi.mock("./linux-project.js", () => ({
  observeSiteBuildLinuxProjectInputsV1: mocks.origin,
  prepareSiteBuildLinuxProjectV1: mocks.project,
}));
vi.mock("./renderer-image.js", () => ({ prepareSiteBuildRendererBaseV1: mocks.base }));
vi.mock("./docker-host.js", () => ({ withSiteBuildDockerV1: mocks.withDocker }));
vi.mock("./linux-build.js", () => ({ prepareSiteBuildLinuxBuildV1: mocks.build }));
vi.mock("./render-capsule.js", () => ({ freezePreparedSiteBuildRenderProjectV1: mocks.freeze }));
vi.mock("./render-runtime-cache.js", async (original) => ({
  ...(await original<typeof RuntimeCache>()),
  createSiteBuildRenderRuntimeCacheV1: mocks.createCache,
  reuseSiteBuildRenderRuntimeCacheV1: mocks.reuseCache,
}));
vi.mock("./linux-sandbox.js", () => ({
  prepareSiteBuildLinuxSandboxImageV1: mocks.image,
  runSiteBuildLinuxSandboxV1: mocks.native,
}));

const hex = "a".repeat(64),
  digest = `nb1:sha256:${"A".repeat(43)}`,
  imageId = `sha256:${hex}`;
const renderer = {
  schemaVersion: "np.agent-build-direction-renderer.v1",
  implementation: "np.site-build.v1",
  projectSources: { schemaVersion: "np.agent-build-source-tree.v1", files: [] },
  packages: [
    "@nexpress/app",
    "@nexpress/blocks",
    "@nexpress/cli",
    "@nexpress/core",
    "@nexpress/theme",
    "react",
    "react-dom",
  ]
    .map((name) => ({ name, version: "1.0.0", contentDigest: `npkg1:sha256:${"A".repeat(43)}` }))
    .concat([{ name: "next", version: "16.4.2", contentDigest: `npkg1:sha256:${"A".repeat(43)}` }])
    .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name))),
};
const catalog = {
  schemaVersion: "np.agent-build-installed-catalog.v1",
  observation: "configured-declarations",
  sourceCapsule: renderer,
  collections: [],
  themes: [
    {
      id: "fixture",
      package: "@nexpress/theme",
      version: "1.0.0",
      tokens: {},
      templates: [],
      navigationLocations: [],
      blocks: [],
      patterns: [],
    },
  ],
  plugins: [],
  locales: [],
  defaultLocale: null,
};
const cache = {
  schemaVersion: "np.site-build-render-runtime-cache.v1",
  project: "/owned-capsule/project",
  runtimeFilesDigest: hex,
  runtimeTreeDigest: hex,
  originProfile: "np.site-build-render-origin.v1",
  originInputsDigest: hex,
  rendererDigest: hex,
};
const clock = { now: "2026-01-01T00:00:00.000Z", randomSeed: "e".repeat(64) };
const options = () => ({
  projectRoot: "/consumer",
  config: "src/nexpress.config.ts",
  fixtures: [
    { path: ".nexpress/site/fixtures/community-v1.json", bytes: Buffer.from('{"version":1}') },
  ],
  clock,
});
let events: string[];
let wrapperFails: boolean;
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  events = [];
  wrapperFails = false;
  for (const callback of [
    mocks.projectClose,
    mocks.capsuleClose,
    mocks.originalLease,
    mocks.capsuleLease,
    mocks.cacheLease,
  ])
    callback.mockResolvedValue(undefined);
  mocks.origin.mockImplementation(() => {
    events.push("origin");
    return {
      schemaVersion: "np.site-build-linux-project-inputs.v1",
      sourceManifestSha256: hex,
      sourceLockSha256: hex,
      sourceTreeDigest: digest,
      renderSourceProfile: "np.site-build-render-input-sources.v1",
      renderSourceTreeDigest: digest,
      tarballs: [],
    };
  });
  mocks.base.mockImplementation(() => {
    events.push("base");
    return { imageId };
  });
  mocks.withDocker.mockImplementation(
    async (run: (host: { endpoint: string; config: string }) => Promise<unknown>) => {
      const result = await run({
        endpoint: "unix:///unit.sock",
        config: "/owned-empty-docker-config",
      });
      if (wrapperFails) throw new SiteBuildError("unavailable");
      return result;
    },
  );
  mocks.project.mockImplementation(() => {
    events.push("project");
    return {
      root: "/private-prepared",
      project: "/private-prepared/project",
      receipt: {
        imageId,
        packages: renderer.packages,
        sourceManifestSha256: hex,
        sourceLockSha256: hex,
        sourceTreeDigest: digest,
        tarballs: [],
      },
      assertSourceUnchanged: mocks.originalLease,
      close: mocks.projectClose,
    };
  });
  mocks.build.mockImplementation(() => {
    events.push("build");
    return {
      buildId: "unit-next-build",
      migrations: "generated-private-baseline",
      changedSources: ["next-env.d.ts"],
      artifactManifestSha256: hex,
      sourceAfter: { digest },
      deterministicNext: {
        preparation: {
          context: { baseImageId: imageId, clock },
          buildId: "unit-next-build",
        },
      },
      previewConfig: {
        scope: "forum-build-preview-analytics-only",
        rendererStage: "pre-command-source-and-prepared-linux-packages",
        preCommandSourceDigest: `nb1:sha256:${"B".repeat(42)}A`,
        preCommandRendererDigest: `nb1:sha256:${"C".repeat(42)}A`,
        finalSourceDigest: digest,
        runtimeManifestSha256: hex,
        preparation: { configPath: "src/nexpress.config.ts" },
      },
      nextPreviewRuntime: {
        scope: "private-preview-next-isr-flush-to-disk-false",
        owner: { name: "next", version: "16.4.2", contentDigest: `npkg1:sha256:${"A".repeat(43)}` },
        entry: { original: { sha256: hex }, derived: { sha256: "b".repeat(64) } },
        requiredServerFiles: { sha256: hex },
        evidence: [{ path: ".next/np-build-next-preview-runtime/manifest.json", sha256: hex }],
        nativeVerification: "required-separately",
      },
      commands: ["schema-generate", "migration-generate", "next-build"].map((id) => ({
        id,
        exitCode: 0,
        stdout: { path: "/raw-logs/not-published", sha256: hex },
        stderr: { path: "/raw-logs/not-published", sha256: hex },
      })),
    };
  });
  mocks.freeze.mockImplementation(() => {
    events.push("freeze");
    return {
      root: "/owned-capsule",
      project: cache.project,
      renderer,
      runtimeFilesDigest: hex,
      assertOriginalUnchanged: mocks.capsuleLease,
      close: mocks.capsuleClose,
    };
  });
  const observation = () => ({
    cache,
    renderer,
    originInputs: {},
    installedPackages: { unit: "observed-package-double" },
    assertUnchanged: mocks.cacheLease,
  });
  mocks.createCache.mockImplementation(() => {
    events.push("cache");
    return observation();
  });
  mocks.reuseCache.mockImplementation(() => observation());
  mocks.image.mockImplementation(() => {
    events.push("image");
    return { imageId, baseImageId: imageId };
  });
  mocks.native.mockImplementation(() => {
    events.push("catalog");
    return {
      audit: { reason: "unit-test-double" },
      artifacts: new Map([["catalog.json", Buffer.from(JSON.stringify(catalog))]]),
    };
  });
});

describe("explicit render session orchestration", () => {
  it("runs actual owners in order, binds the returned catalog and retains only the readonly capsule", async () => {
    const input = options(),
      originalFixture = Buffer.from(input.fixtures[0].bytes);
    const pending = prepareSiteBuildRenderSessionV1(input);
    input.fixtures[0].bytes.fill(0);
    const prepared = await pending;
    expect(events).toEqual([
      "origin",
      "base",
      "project",
      "build",
      "freeze",
      "cache",
      "image",
      "catalog",
    ]);
    expect(mocks.project).toHaveBeenCalledWith({
      projectRoot: "/consumer",
      imageId,
      dockerEndpoint: "unix:///unit.sock",
      dockerConfig: "/owned-empty-docker-config",
    });
    expect(mocks.build).toHaveBeenCalledWith({
      project: "/private-prepared/project",
      baseImageId: imageId,
      previewConfig: "forum-build-preview-analytics-only",
      deterministicNextClock: clock,
    });
    expect(mocks.freeze.mock.calls[0][0].fixtures[0].bytes).toEqual(originalFixture);
    expect(mocks.native.mock.calls[0][0]).toMatchObject({
      project: cache.project,
      artifacts: [{ name: "catalog.json", maxBytes: 4 * 1024 * 1024 }],
    });
    expect(JSON.parse(Buffer.from(mocks.native.mock.calls[0][0].inputBytes).toString())).toEqual({
      mode: "catalog",
      config: "src/nexpress.config.ts",
      clockNow: clock.now,
      randomSeed: clock.randomSeed,
      renderer,
    });
    expect(prepared.fingerprint).toBe(await npBuildInstalledCatalogDigestV1(prepared.catalog));
    expect(prepared.session.renderer).toEqual(renderer);
    expect(prepared.session.buildReceiptSummary?.commands).toHaveLength(3);
    expect(prepared.session.buildReceiptSummary?.previewConfig).toMatchObject({
      rendererStage: "pre-command-source-and-prepared-linux-packages",
      finalSourceDigest: digest,
      runtimeManifestSha256: hex,
    });
    expect(prepared.session.buildReceiptSummary?.nextPreviewRuntime).toEqual({
      scope: "private-preview-next-isr-flush-to-disk-false",
      ownerVersion: "16.4.2",
      ownerContentDigest: `npkg1:sha256:${"A".repeat(43)}`,
      originalEntrySha256: hex,
      derivedEntrySha256: "b".repeat(64),
      requiredServerFilesSha256: hex,
      runtimeManifestSha256: hex,
      nativeVerification: "required-separately",
    });
    expect(JSON.stringify(prepared.session)).not.toContain("private-prepared");
    expect(JSON.stringify(prepared.session)).not.toContain("raw-logs");
    expect(mocks.projectClose).toHaveBeenCalledOnce();
    expect(mocks.capsuleClose).not.toHaveBeenCalled();
    await prepared.close();
    expect(mocks.capsuleClose).toHaveBeenCalledOnce();
  });

  it.each([
    "missing",
    "config",
    "final-source",
    "runtime-missing",
    "runtime-owner",
    "deterministic-missing",
    "deterministic-clock",
    "deterministic-base",
    "deterministic-id",
  ] as const)(
    "rejects a %s preview derivation before freezing/catalog loading",
    async (mismatch) => {
      const build = await mocks.build();
      events = [];
      if (mismatch === "missing") delete build.previewConfig;
      if (mismatch === "config") build.previewConfig.preparation.configPath = "nexpress.config.ts";
      if (mismatch === "final-source")
        build.previewConfig.finalSourceDigest = `nb1:sha256:${"D".repeat(42)}A`;
      if (mismatch === "runtime-missing") delete build.nextPreviewRuntime;
      if (mismatch === "runtime-owner")
        build.nextPreviewRuntime.owner.contentDigest = `npkg1:sha256:${"B".repeat(42)}A`;
      if (mismatch === "deterministic-missing") delete build.deterministicNext;
      if (mismatch === "deterministic-clock")
        build.deterministicNext.preparation.context.clock = {
          ...clock,
          randomSeed: "f".repeat(64),
        };
      if (mismatch === "deterministic-base")
        build.deterministicNext.preparation.context.baseImageId = `sha256:${"b".repeat(64)}`;
      if (mismatch === "deterministic-id")
        build.deterministicNext.preparation.buildId = "another-build";
      mocks.build.mockResolvedValue(build);
      await expect(prepareSiteBuildRenderSessionV1(options())).rejects.toThrow("conflict");
      expect(mocks.freeze).not.toHaveBeenCalled();
      expect(mocks.native).not.toHaveBeenCalled();
      expect(mocks.projectClose).toHaveBeenCalledOnce();
    },
  );

  it.each(["docker-wrapper", "build", "cache", "catalog"] as const)(
    "cleans every acquired owner on %s failure",
    async (stage) => {
      if (stage === "docker-wrapper") wrapperFails = true;
      if (stage === "build") mocks.build.mockRejectedValue(new SiteBuildError("unavailable"));
      if (stage === "cache") mocks.createCache.mockRejectedValue(new SiteBuildError("conflict"));
      if (stage === "catalog") mocks.native.mockRejectedValue(new SiteBuildError("unavailable"));
      await expect(prepareSiteBuildRenderSessionV1(options())).rejects.toThrow();
      expect(mocks.projectClose).toHaveBeenCalledOnce();
      expect(mocks.capsuleClose).toHaveBeenCalledTimes(
        stage === "cache" || stage === "catalog" ? 1 : 0,
      );
    },
  );

  it("rejects a catalog bound to a different frozen renderer and closes its owners", async () => {
    const different = structuredClone(catalog);
    different.sourceCapsule.packages[0].contentDigest = `npkg1:sha256:${"B".repeat(42)}A`;
    mocks.native.mockResolvedValue({
      artifacts: new Map([["catalog.json", Buffer.from(JSON.stringify(different))]]),
    });
    await expect(prepareSiteBuildRenderSessionV1(options())).rejects.toThrow("conflict");
    expect(mocks.projectClose).toHaveBeenCalledOnce();
    expect(mocks.capsuleClose).toHaveBeenCalledOnce();
  });

  it("reuses through the fresh cache observer without rebuilding or asserting image/environment evidence", async () => {
    const prepared = await prepareSiteBuildRenderSessionV1(options());
    for (const owner of [
      mocks.origin,
      mocks.base,
      mocks.project,
      mocks.build,
      mocks.freeze,
      mocks.image,
      mocks.native,
    ])
      owner.mockClear();
    const context = await reuseSiteBuildRenderSessionV1({
      session: JSON.parse(JSON.stringify(prepared.session)) as unknown,
      projectRoot: "/consumer",
    });
    expect(mocks.reuseCache).toHaveBeenCalledWith({
      cache,
      originalProjectRoot: "/consumer",
      expectedRenderer: renderer,
    });
    expect(context).toMatchObject({
      config: "src/nexpress.config.ts",
      clock,
      installedPackages: { unit: "observed-package-double" },
      capsule: { project: cache.project, renderer, runtimeFilesDigest: hex },
    });
    await context.capsule.assertOriginalUnchanged();
    for (const owner of [
      mocks.origin,
      mocks.base,
      mocks.project,
      mocks.build,
      mocks.freeze,
      mocks.image,
      mocks.native,
    ])
      expect(owner).not.toHaveBeenCalled();
    expect(mocks.capsuleClose).not.toHaveBeenCalled();
    await prepared.close();
  });

  it("rejects untrusted session getters, fields and malformed clock/summary before reuse", async () => {
    const prepared = await prepareSiteBuildRenderSessionV1(options());
    let executed = false;
    const getter = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        executed = true;
        return "np.site-build-render-session.v1";
      },
    });
    for (const session of [
      getter,
      { ...prepared.session, unexpected: true },
      { ...prepared.session, config: "../nexpress.config.ts" },
      { ...prepared.session, clock: { ...clock, now: "2026-02-31T00:00:00.000Z" } },
      {
        ...prepared.session,
        buildReceiptSummary: {
          ...prepared.session.buildReceiptSummary,
          artifactManifestSha256: "not-a-hash",
        },
      },
      ...[
        { scope: "normal-next" },
        { ownerVersion: "16.4.3" },
        { ownerContentDigest: "invalid" },
        { originalEntrySha256: "invalid" },
        { derivedEntrySha256: "invalid" },
        { requiredServerFilesSha256: "invalid" },
        { runtimeManifestSha256: "invalid" },
        { nativeVerification: "passed" },
        { rawPath: "/private/path" },
      ].map((patch) => ({
        ...prepared.session,
        buildReceiptSummary: {
          ...prepared.session.buildReceiptSummary,
          nextPreviewRuntime: {
            ...prepared.session.buildReceiptSummary?.nextPreviewRuntime,
            ...patch,
          },
        },
      })),
    ])
      await expect(
        reuseSiteBuildRenderSessionV1({ session, projectRoot: "/consumer" }),
      ).rejects.toThrow("input");
    expect(executed).toBe(false);
    expect(mocks.reuseCache).not.toHaveBeenCalled();
    mocks.reuseCache.mockRejectedValue(new SiteBuildError("conflict"));
    await expect(
      reuseSiteBuildRenderSessionV1({ session: prepared.session, projectRoot: "/consumer" }),
    ).rejects.toThrow("conflict");
    expect(mocks.build).toHaveBeenCalledOnce();
    await prepared.close();
  });
  it("rejects a well-shaped Next preview owner drift before reusing the capsule", async () => {
    const prepared = await prepareSiteBuildRenderSessionV1(options());
    const summary = prepared.session.buildReceiptSummary;
    if (!summary?.nextPreviewRuntime) throw new Error("missing-runtime-summary-fixture");
    const session = {
      ...prepared.session,
      buildReceiptSummary: {
        ...summary,
        nextPreviewRuntime: {
          ...summary.nextPreviewRuntime,
          ownerContentDigest: `npkg1:sha256:${"B".repeat(42)}A`,
        },
      },
    };
    await expect(
      reuseSiteBuildRenderSessionV1({ session, projectRoot: "/consumer" }),
    ).rejects.toThrow("conflict");
    expect(mocks.reuseCache).not.toHaveBeenCalled();
    await prepared.close();
  });
});
