import { describe, expect, it } from "vitest";
import executionVectors from "./__fixtures__/execution-v1.json" with { type: "json" };
import {
  npBuildCanonicalDigest,
  npRequireAgentBuildCommandRegistryV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentBuildVerificationResultBodyV1,
  npRequireAgentBuildVerificationResultV1,
  npRequireAgentBuildVerificationObservationV1,
  npRequireBuildVerificationObservationForResultV1,
} from "./index.js";

const registry = () =>
  npRequireAgentBuildCommandRegistryV1(JSON.parse(executionVectors.structured[0].canonical));
const environment = () =>
  npRequireAgentBuildRenderEnvironmentV1(JSON.parse(executionVectors.structured[1].canonical));
const resultBody = () =>
  npRequireAgentBuildVerificationResultBodyV1(JSON.parse(executionVectors.structured[2].canonical));

describe("Build execution descriptors and verification artifacts", () => {
  it("rejects caller-expanded command policies, scripts, exclusions and executable inventories", () => {
    const baseline = registry();
    for (const mutation of [
      { ...baseline, shell: true },
      { ...baseline, packageScripts: true },
      { ...baseline, inheritedEnvironment: true },
      {
        ...baseline,
        policies: baseline.policies.map((policy) => ({ ...policy, argv: ["--eval", "untrusted"] })),
      },
      { ...baseline, policies: [...baseline.policies].reverse() },
      { ...baseline, sourceExclusions: { ...baseline.sourceExclusions, roots: [".git", "src"] } },
      { ...baseline, entrypoints: [...baseline.entrypoints, baseline.entrypoints[0]] },
      { ...baseline, entrypoints: [{ ...baseline.entrypoints[0], path: "../../index.js" }] },
    ])
      expect(() => npRequireAgentBuildCommandRegistryV1(mutation)).toThrow();
  });

  it("binds the browser, fonts, locale order, deterministic clock and fixed presentation settings", async () => {
    const baseline = environment();
    const originalHash = await npBuildCanonicalDigest("np.build-render-environment.v1", baseline);
    expect(
      await npBuildCanonicalDigest("np.build-render-environment.v1", {
        ...baseline,
        browser: { ...baseline.browser, sha256: "f".repeat(64) },
      }),
    ).not.toBe(originalHash);
    for (const mutation of [
      { ...baseline, fonts: [] },
      { ...baseline, fonts: [...baseline.fonts, baseline.fonts[0]] },
      { ...baseline, locales: [...baseline.locales].reverse() },
      { ...baseline, timezone: "Asia/Seoul" },
      { ...baseline, colorScheme: "dark" },
      { ...baseline, clock: { ...baseline.clock, now: "not-a-clock" } },
      { ...baseline, imageCanonicalizer: "caller-provided" },
    ])
      expect(() => npRequireAgentBuildRenderEnvironmentV1(mutation)).toThrow();
  });

  it("keeps actual logs/timing outside the reproducible body and validates observation bindings", async () => {
    const body = resultBody();
    const manifestDigest = await npBuildCanonicalDigest("np.build-verification-result.v1", body);
    const result = npRequireAgentBuildVerificationResultV1({ ...body, manifestDigest });
    const observation = {
      schemaVersion: "np.agent-build-verification-observation.v1",
      manifestDigest,
      commandResults: [
        {
          commandId: "preview",
          exitCode: 0,
          outputDigest: body.blueprintHash,
          durationMs: 1234,
          outputArtifactPath: ".nexpress/site/audit/run-1/preview.json",
        },
      ],
      startedAt: "2026-10-23T00:00:00.000Z",
      finishedAt: "2026-10-23T00:00:02.000Z",
    };
    expect(await npRequireBuildVerificationObservationForResultV1(result, observation)).toEqual(
      observation,
    );
    const second = {
      ...observation,
      commandResults: [{ ...observation.commandResults[0], durationMs: 1500 }],
      finishedAt: "2026-10-23T00:00:03.000Z",
    };
    expect(await npRequireBuildVerificationObservationForResultV1(result, second)).toEqual(second);
    expect(await npBuildCanonicalDigest("np.build-verification-result.v1", body)).toBe(
      manifestDigest,
    );
    await expect(
      npRequireBuildVerificationObservationForResultV1(result, {
        ...observation,
        manifestDigest: body.blueprintHash,
      }),
    ).rejects.toThrow();
    await expect(
      npRequireBuildVerificationObservationForResultV1(result, {
        ...observation,
        commandResults: [{ ...observation.commandResults[0], exitCode: 1 }],
      }),
    ).rejects.toThrow();
    expect(() =>
      npRequireAgentBuildVerificationObservationV1({
        ...observation,
        finishedAt: "2025-01-01T00:00:00.000Z",
      }),
    ).toThrow();
    for (const extra of [
      { manifestDigest },
      { startedAt: observation.startedAt },
      { durationMs: 0 },
      { outputDigest: body.blueprintHash },
    ])
      expect(() => npRequireAgentBuildVerificationResultBodyV1({ ...body, ...extra })).toThrow();
  });

  it("requires the complete Linux runtime identity and binds changes to its environment digest", async () => {
    const baseline = npRequireAgentBuildRenderEnvironmentV1(
      JSON.parse(executionVectors.structured[3].canonical),
    );
    if (baseline.sandbox !== "np.linux-build-sandbox.v1") throw new Error("Linux vector required");
    const original = await npBuildCanonicalDigest("np.build-render-environment.v1", baseline);
    for (const linux of [
      { ...baseline.linux, runtimeFilesSha256: "f".repeat(64) },
      { ...baseline.linux, imageId: `sha256:${"f".repeat(64)}` },
      { ...baseline.linux, kernel: { ...baseline.linux.kernel, release: "changed-kernel" } },
      {
        ...baseline.linux,
        supervisor: { ...baseline.linux.supervisor, sourceSha256: "f".repeat(64) },
      },
      {
        ...baseline.linux,
        requestPolicy: { ...baseline.linux.requestPolicy, sha256: "f".repeat(64) },
      },
    ])
      expect(
        await npBuildCanonicalDigest("np.build-render-environment.v1", { ...baseline, linux }),
      ).not.toBe(original);
    for (const linux of [
      undefined,
      { ...baseline.linux, architecture: "unknown" },
      { ...baseline.linux, cacheProfile: "ambient-cache" },
      { ...baseline.linux, driverFiles: [...baseline.linux.driverFiles].reverse() },
      {
        ...baseline.linux,
        driverFiles: [...baseline.linux.driverFiles, baseline.linux.driverFiles[0]],
      },
      { ...baseline.linux, node: { ...baseline.linux.node, sha256: "unknown" } },
    ])
      expect(() => npRequireAgentBuildRenderEnvironmentV1({ ...baseline, linux })).toThrow();
    expect(() =>
      npRequireAgentBuildRenderEnvironmentV1({ ...environment(), linux: baseline.linux }),
    ).toThrow();
  });

  it("requires complete unique page/viewport artifacts, safe output paths and exact MIME extensions", () => {
    const body = resultBody();
    for (const artifacts of [
      body.artifacts.slice(1),
      [...body.artifacts, body.artifacts[0]],
      body.artifacts.map((artifact) => ({ ...artifact, path: "src/report.json" })),
      body.artifacts.map((artifact, i) =>
        i === 0 ? { ...artifact, mime: "image/webp" } : artifact,
      ),
      [...body.artifacts].reverse(),
    ])
      expect(() => npRequireAgentBuildVerificationResultBodyV1({ ...body, artifacts })).toThrow();
  });

  it("inspects descriptors before reading caller data for every new owner", () => {
    let calls = 0;
    for (const [parse, value] of [
      [npRequireAgentBuildCommandRegistryV1, registry()],
      [npRequireAgentBuildRenderEnvironmentV1, environment()],
      [npRequireAgentBuildVerificationResultBodyV1, resultBody()],
    ] as const) {
      Object.defineProperty(value, "schemaVersion", {
        enumerable: true,
        get() {
          calls++;
          throw new Error("secret");
        },
      });
      expect(() => parse(value)).toThrow();
    }
    expect(calls).toBe(0);
  });
});
