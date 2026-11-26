import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildInstalledPackageContentDigestV1,
  npRequireAgentBuildCommandRegistryV1,
  type NpBuildInstalledPackageContentV1,
} from "@nexpress/core/agent-contract";
import executionVectors from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import type { NpObservedBuildPackageV1, NpObservedBuildPackagesV1 } from "./installed-packages.js";
import type { NpSiteBuildLinuxImageEnvironmentObservationV1 } from "./linux-environment.js";
import type { NpSiteBuildLinuxSandboxImageV1 } from "./linux-sandbox.js";
import { observeSiteBuildRenderCommandRegistryV1 } from "./render-command-registry.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const imageId = `sha256:${"a".repeat(64)}`;
const nodeSha = "b".repeat(64);
const registryVector = executionVectors.structured.find(
  (item) => item.purpose === "np.build-command-registry.v1",
)!;
const vectorRegistry = () =>
  npRequireAgentBuildCommandRegistryV1(JSON.parse(registryVector.canonical));

async function fixture(entrySource = "export const fixture = 1;\n") {
  const files: NpBuildInstalledPackageContentV1["files"] = [
    { path: "dist/index.js", mode: "100644", sha256: sha(entrySource) },
    {
      path: "package.json",
      mode: "100644",
      sha256: sha('{"name":"@nexpress/cli","version":"0.4.6"}\n'),
    },
  ];
  const contentDigest = await npBuildInstalledPackageContentDigestV1({
    schemaVersion: "np.installed-package-content.v1",
    name: "@nexpress/cli",
    version: "0.4.6",
    files,
  });
  const cli: NpObservedBuildPackageV1 = {
    root: "/fixture-sensitive/node_modules/@nexpress/cli",
    name: "@nexpress/cli",
    version: "0.4.6",
    contentDigest,
    manifest: { name: "@nexpress/cli", version: "0.4.6", scripts: { build: "fixture-sensitive" } },
    files,
    dependencies: new Map(),
  };
  const assertUnchanged = vi.fn(async () => {});
  const packages: NpObservedBuildPackagesV1 = {
    packages: [{ name: cli.name, version: cli.version, contentDigest }],
    instances: [cli],
    rootImports: new Map([["@nexpress/cli", cli]]),
    assertUnchanged,
  };
  const image: NpSiteBuildLinuxSandboxImageV1 = {
    schemaVersion: "np.site-build-linux-sandbox-image.v1",
    imageId,
    baseImageId: `sha256:${"c".repeat(64)}`,
    recipeDigest: "d".repeat(64),
    supervisorSha256: "e".repeat(64),
    supervisorSourceSha256: "f".repeat(64),
    fontconfigSha256: "1".repeat(64),
    driverFiles: [
      { path: "index.js", sha256: files[0].sha256 },
      { path: "site-build-render-driver.js", sha256: "2".repeat(64) },
    ],
  };
  const environment: NpSiteBuildLinuxImageEnvironmentObservationV1 = {
    schemaVersion: "np.site-build-linux-environment-observation.v1",
    imageId,
    architecture: "arm64",
    kernel: { release: "fixture-kernel", version: "fixture-kernel-version" },
    node: { version: "v24.11.1", sha256: nodeSha },
    browser: { version: "155.0.0.0", sha256: "3".repeat(64) },
    postgres: { version: "postgres (PostgreSQL) 16.10", sha256: "4".repeat(64) },
    fonts: [{ path: "usr/share/fonts/fixture.ttf", sha256: "5".repeat(64) }],
    fontconfigSha256: image.fontconfigSha256,
    scope: "environment-observation-only",
  };
  return { image, environment, packages, cli, assertUnchanged };
}
async function refreshContent(input: Awaited<ReturnType<typeof fixture>>) {
  input.cli.contentDigest = await npBuildInstalledPackageContentDigestV1({
    schemaVersion: "np.installed-package-content.v1",
    name: input.cli.name,
    version: input.cli.version,
    files: input.cli.files,
  });
  input.packages.packages[0] = {
    name: input.cli.name,
    version: input.cli.version,
    contentDigest: input.cli.contentDigest,
  };
}

describe("observed Linux render command registry", () => {
  it("binds the actual CLI payload and image Node with leases around construction", async () => {
    const input = await fixture();
    const { registry, fingerprint } = await observeSiteBuildRenderCommandRegistryV1(input);
    expect(input.assertUnchanged).toHaveBeenCalledTimes(2);
    expect(registry).toEqual({
      ...vectorRegistry(),
      node: { version: "v24.11.1", platform: "linux", arch: "arm64", sha256: nodeSha },
      entrypoints: [
        {
          package: input.cli.name,
          version: input.cli.version,
          contentDigest: input.cli.contentDigest,
          path: "dist/index.js",
          sha256: input.cli.files[0].sha256,
        },
      ],
    });
    expect(fingerprint).toBe(
      await npBuildCanonicalDigest("np.build-command-registry.v1", registry),
    );
    expect(JSON.stringify({ registry, fingerprint })).not.toContain("fixture-sensitive");
    expect(JSON.parse(JSON.stringify(registry))).toEqual(registry);
    input.cli.files[0].sha256 = "0".repeat(64);
    input.environment.node.sha256 = "0".repeat(64);
    expect(registry.entrypoints[0].sha256).not.toBe("0".repeat(64));
    expect(registry.node.sha256).toBe(nodeSha);
  });
  it("keeps Core's independent canonical vector and exact closed policies", async () => {
    expect(await npBuildCanonicalDigest("np.build-command-registry.v1", vectorRegistry())).toBe(
      registryVector.digest,
    );
    const { registry } = await observeSiteBuildRenderCommandRegistryV1(await fixture());
    for (const mutation of [
      { ...registry, shell: true },
      { ...registry, packageScripts: true },
      { ...registry, inheritedEnvironment: true },
      { ...registry, policies: [...registry.policies].reverse() },
      {
        ...registry,
        policies: registry.policies.map((policy) => ({ ...policy, argv: ["--eval"] })),
      },
      { ...registry, sourceExclusions: { ...registry.sourceExclusions, roots: ["src"] } },
    ])
      expect(() => npRequireAgentBuildCommandRegistryV1(mutation)).toThrow();
  });
  it("rejects installed/image CLI index drift, missing entries and duplicate image entries", async () => {
    for (const change of [
      "different",
      "missing-image",
      "duplicate-image",
      "missing-installed",
    ] as const) {
      const input = await fixture();
      if (change === "different") input.image.driverFiles[0].sha256 = "0".repeat(64);
      if (change === "missing-image") input.image.driverFiles.shift();
      if (change === "duplicate-image")
        input.image.driverFiles.push({ ...input.image.driverFiles[0] });
      if (change === "missing-installed") {
        input.cli.files.shift();
        await refreshContent(input);
      }
      await expect(observeSiteBuildRenderCommandRegistryV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });
  it("rehashes complete installed contents instead of accepting matching summary assertions", async () => {
    for (const change of ["file-sha", "file-mode", "claimed-digest"] as const) {
      const input = await fixture();
      if (change === "file-sha") input.cli.files[1].sha256 = "0".repeat(64);
      if (change === "file-mode") input.cli.files[1].mode = "100755";
      if (change === "claimed-digest") {
        input.cli.contentDigest = `npkg1:sha256:${"A".repeat(43)}`;
        input.packages.packages[0].contentDigest = input.cli.contentDigest;
      }
      await expect(observeSiteBuildRenderCommandRegistryV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });
  it("uses the Core package inventory owner for unsafe, duplicate and unordered payloads", async () => {
    for (const change of ["credential", "duplicate", "unordered"] as const) {
      const input = await fixture();
      if (change === "credential") input.cli.files[1].path = ".env";
      if (change === "duplicate") input.cli.files.push({ ...input.cli.files[0] });
      if (change === "unordered") input.cli.files.reverse();
      await expect(observeSiteBuildRenderCommandRegistryV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });
  it("requires the root-import instance and same observed CLI summary", async () => {
    for (const change of [
      "missing-root",
      "alias",
      "missing-instance",
      "summary",
      "duplicate-summary",
    ] as const) {
      const input = await fixture();
      if (change === "missing-root") input.packages.rootImports = new Map();
      if (change === "alias") input.cli.name = "other-cli";
      if (change === "missing-instance") input.packages.instances = [];
      if (change === "summary") input.packages.packages[0].version = "0.4.7";
      if (change === "duplicate-summary")
        input.packages.packages.push({ ...input.packages.packages[0] });
      await expect(observeSiteBuildRenderCommandRegistryV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });
  it("rejects environment/image identity mismatches and malformed observation bindings", async () => {
    for (const change of [
      "image",
      "image-tag",
      "schema",
      "scope",
      "arch",
      "node-version",
      "node-sha",
    ] as const) {
      const input = await fixture();
      if (change === "image") input.environment.imageId = `sha256:${"0".repeat(64)}`;
      if (change === "image-tag") input.image.imageId = input.environment.imageId = "node:24";
      if (change === "schema") Object.assign(input.environment, { schemaVersion: "untrusted" });
      if (change === "scope") Object.assign(input.environment, { scope: "execution-authority" });
      if (change === "arch") Object.assign(input.environment, { architecture: "riscv64" });
      if (change === "node-version") input.environment.node.version = "$(fixture-sensitive)";
      if (change === "node-sha") input.environment.node.sha256 = "0".repeat(63);
      await expect(observeSiteBuildRenderCommandRegistryV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
    }
  });
  it("changes identity for observed Node, architecture and any installed payload change", async () => {
    const baseline = await observeSiteBuildRenderCommandRegistryV1(await fixture());
    for (const change of ["node-version", "node-sha", "arch", "index", "package-mode"] as const) {
      const input = await fixture();
      if (change === "node-version") input.environment.node.version = "v24.11.2";
      if (change === "node-sha") input.environment.node.sha256 = "0".repeat(64);
      if (change === "arch") input.environment.architecture = "x64";
      if (change === "index") {
        input.cli.files[0].sha256 = sha("export const fixture = 2;\n");
        input.image.driverFiles[0].sha256 = input.cli.files[0].sha256;
        await refreshContent(input);
      }
      if (change === "package-mode") {
        input.cli.files[1].mode = "100755";
        await refreshContent(input);
      }
      const observed = await observeSiteBuildRenderCommandRegistryV1(input);
      expect(observed.fingerprint).not.toBe(baseline.fingerprint);
      expect(observed.registry.node).toEqual({
        platform: "linux",
        arch: input.environment.architecture,
        ...input.environment.node,
      });
    }
  });
  it("fails closed on either observer lease failure without exposing its local details", async () => {
    for (const failure of ["before", "after"] as const) {
      const input = await fixture();
      if (failure === "after") input.assertUnchanged.mockResolvedValueOnce(undefined);
      input.assertUnchanged.mockRejectedValueOnce(new Error("/fixture-sensitive/.env"));
      await expect(observeSiteBuildRenderCommandRegistryV1(input)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
      expect(input.assertUnchanged).toHaveBeenCalledTimes(failure === "before" ? 1 : 2);
    }
  });
});
