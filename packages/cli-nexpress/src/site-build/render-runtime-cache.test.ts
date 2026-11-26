import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { observeSiteBuildLinuxProjectInputsV1 } from "./linux-project.js";
import {
  freezePreparedSiteBuildRenderProjectV1,
  type NpFrozenPreparedSiteBuildRenderProjectV1,
} from "./render-capsule.js";
import {
  createSiteBuildRenderRuntimeCacheV1,
  reuseSiteBuildRenderRuntimeCacheV1,
  siteBuildRenderOriginInputsDigestV1,
} from "./render-runtime-cache.js";

const roots: string[] = [],
  capsules: NpFrozenPreparedSiteBuildRenderProjectV1[] = [];
async function fixture(relative = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-runtime-cache-unit-")));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(project);
  const names = [
    "@nexpress/app",
    "@nexpress/blocks",
    "@nexpress/cli",
    "@nexpress/core",
    "@nexpress/theme",
    "react",
    "react-dom",
  ];
  const manifest = {
    packageManager: "pnpm@10.33.0",
    dependencies: Object.fromEntries(names.map((name) => [name, "1.0.0"])),
    pnpm: {
      overrides: { unused: relative ? "file:../unused.tgz" : `file:${join(root, "unused.tgz")}` },
    },
  };
  await writeFile(join(root, "unused.tgz"), "unused override bytes v1");
  await writeFile(join(project, "package.json"), JSON.stringify(manifest));
  await writeFile(join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters:\n  .: {}\n");
  await mkdir(join(project, "src"));
  await writeFile(join(project, "src/nexpress.config.ts"), "export default {};\n");
  await mkdir(join(project, ".next/server"), { recursive: true });
  await writeFile(join(project, ".next/BUILD_ID"), "same-immutable-next-build-id");
  await writeFile(join(project, ".next/server/page.js"), "actual compiled page v1\n");
  for (const name of names) {
    const path = join(project, "node_modules", name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    await writeFile(
      join(path, "index.js"),
      "throw new Error('must never execute package entries');\n",
    );
  }
  const originInputs = await observeSiteBuildLinuxProjectInputsV1(project);
  const capsule = await freezePreparedSiteBuildRenderProjectV1({
    project,
    input: { mode: "catalog" },
    originInputs,
  });
  capsules.push(capsule);
  return { root, project, capsule, originInputs };
}
async function mutateReadonly(path: string, bytes: string): Promise<void> {
  await chmod(path, 0o600);
  try {
    await writeFile(path, bytes);
  } finally {
    await chmod(path, 0o444);
  }
}
afterEach(async () => {
  for (const capsule of capsules.splice(0)) await capsule.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("observed immutable render runtime cache", () => {
  it("reobserves candidate bytes and the original relative tarball root on create, reuse and live leases", async () => {
    const value = await fixture(true),
      candidate = join(value.root, "candidate", "project");
    await cp(value.project, candidate, { recursive: true });
    await writeFile(
      join(candidate, "src/nexpress.config.ts"),
      "export default {candidate:true};\n",
    );
    const originInputs = await observeSiteBuildLinuxProjectInputsV1(candidate, {
      tarballProjectRoot: value.project,
    });
    expect(originInputs.sourceTreeDigest).not.toBe(value.originInputs.sourceTreeDigest);
    expect(originInputs.tarballs).toEqual(value.originInputs.tarballs);
    const capsule = await freezePreparedSiteBuildRenderProjectV1({
      project: candidate,
      input: { mode: "catalog" },
      originInputs,
    });
    capsules.push(capsule);
    const options = {
      project: capsule.project,
      originalProjectRoot: candidate,
      tarballProjectRoot: value.project,
    };
    const observed = await createSiteBuildRenderRuntimeCacheV1(options);
    const reused = await reuseSiteBuildRenderRuntimeCacheV1({
      cache: observed.cache,
      originalProjectRoot: candidate,
      tarballProjectRoot: value.project,
      expectedRenderer: capsule.renderer,
    });
    expect(reused.cache).toEqual(observed.cache);
    expect(reused.cache).not.toHaveProperty("tarballProjectRoot");
    expect(reused.originInputs.sourceManifestSha256).toBe(originInputs.sourceManifestSha256);
    await reused.assertUnchanged();
    const baselineManifest = join(value.project, "package.json"),
      bytes = await readFile(baselineManifest);
    await writeFile(baselineManifest, Buffer.concat([bytes, Buffer.from("\n")]));
    await expect(observed.assertUnchanged()).rejects.toThrow("conflict");
    await writeFile(baselineManifest, bytes);
    await writeFile(join(value.root, "unused.tgz"), "changed origin tarball bytes");
    await expect(observed.assertUnchanged()).rejects.toThrow("conflict");
    await expect(
      reuseSiteBuildRenderRuntimeCacheV1({
        cache: observed.cache,
        originalProjectRoot: candidate,
        tarballProjectRoot: value.project,
        expectedRenderer: capsule.renderer,
      }),
    ).rejects.toThrow("conflict");
  });
  it("binds original inputs and reobserves the same immutable Next bytes while input bytes can change", async () => {
    const value = await fixture();
    const observed = await createSiteBuildRenderRuntimeCacheV1({
      project: value.capsule.project,
      originalProjectRoot: value.project,
    });
    expect(observed.renderer).toEqual(value.capsule.renderer);
    expect(observed.cache.runtimeFilesDigest).toBe(value.capsule.runtimeFilesDigest);
    expect(observed.cache.originInputsDigest).toBe(
      siteBuildRenderOriginInputsDigestV1(value.originInputs),
    );
    expect(observed.cache.runtimeTreeDigest).not.toBe(observed.cache.runtimeFilesDigest);
    await observed.assertUnchanged();
    await mkdir(join(value.project, ".nexpress/site/drafts"), { recursive: true });
    for (const path of ["brief.json", "catalog.json", "drafts/direction.json", "blueprint.json"])
      await writeFile(join(value.project, ".nexpress/site", path), '{"authoring":"new artifact"}');
    expect(
      siteBuildRenderOriginInputsDigestV1({
        ...value.originInputs,
        sourceTreeDigest: `nb1:sha256:${"A".repeat(43)}`,
      }),
    ).toBe(observed.cache.originInputsDigest);
    await mutateReadonly(
      join(value.capsule.project, ".nexpress/site/tmp/render-input.json"),
      '{"mode":"fixture"}',
    );
    const reused = await reuseSiteBuildRenderRuntimeCacheV1({
      cache: JSON.parse(JSON.stringify(observed.cache)) as unknown,
      originalProjectRoot: value.project,
      expectedRenderer: value.capsule.renderer,
    });
    expect(reused.cache).toEqual(observed.cache);
    expect(await readFile(join(value.capsule.project, ".next/BUILD_ID"), "utf8")).toBe(
      "same-immutable-next-build-id",
    );
    expect((await lstat(value.capsule.project)).mode & 0o777).toBe(0o555);
    await reused.assertUnchanged();
  });

  it("rejects untrusted getter claims and detects metadata or compiled-byte tampering", async () => {
    const value = await fixture();
    const observed = await createSiteBuildRenderRuntimeCacheV1({
      project: value.capsule.project,
      originalProjectRoot: value.project,
    });
    let executed = false;
    const getter = Object.defineProperty({}, "project", {
      enumerable: true,
      get() {
        executed = true;
        return value.capsule.project;
      },
    });
    await expect(
      reuseSiteBuildRenderRuntimeCacheV1({
        cache: getter,
        originalProjectRoot: value.project,
        expectedRenderer: value.capsule.renderer,
      }),
    ).rejects.toThrow();
    expect(executed).toBe(false);
    const metadataPath = join(value.capsule.project, ".np-build-runtime.json"),
      original = await readFile(metadataPath, "utf8");
    await mutateReadonly(metadataPath, `${original}\n`);
    await expect(
      reuseSiteBuildRenderRuntimeCacheV1({
        cache: observed.cache,
        originalProjectRoot: value.project,
        expectedRenderer: value.capsule.renderer,
      }),
    ).rejects.toThrow("conflict");
    await mutateReadonly(metadataPath, original);
    await mutateReadonly(
      join(value.capsule.project, ".next/server/page.js"),
      "modified compiled page\n",
    );
    await expect(
      reuseSiteBuildRenderRuntimeCacheV1({
        cache: observed.cache,
        originalProjectRoot: value.project,
        expectedRenderer: value.capsule.renderer,
      }),
    ).rejects.toThrow("conflict");
  });

  it("fails closed on current source, manifest, lock or override-only artifact drift", async () => {
    const value = await fixture();
    const observed = await createSiteBuildRenderRuntimeCacheV1({
      project: value.capsule.project,
      originalProjectRoot: value.project,
    });
    for (const path of ["src/nexpress.config.ts", "package.json", "pnpm-lock.yaml"]) {
      const full = join(value.project, path),
        original = await readFile(full, "utf8");
      await writeFile(full, `${original}\n`);
      await expect(
        reuseSiteBuildRenderRuntimeCacheV1({
          cache: observed.cache,
          originalProjectRoot: value.project,
          expectedRenderer: value.capsule.renderer,
        }),
      ).rejects.toThrow("conflict");
      await writeFile(full, original);
    }
    await writeFile(join(value.root, "unused.tgz"), "unused override bytes v2");
    await expect(observed.assertUnchanged()).rejects.toThrow("conflict");
    await expect(
      reuseSiteBuildRenderRuntimeCacheV1({
        cache: observed.cache,
        originalProjectRoot: value.project,
        expectedRenderer: value.capsule.renderer,
      }),
    ).rejects.toThrow("conflict");
  });

  it("requires the independent expected renderer even for a self-consistent replacement cache", async () => {
    const value = await fixture();
    await writeFile(join(value.project, ".next/server/page.js"), "a different compiled payload\n");
    const replacement = await freezePreparedSiteBuildRenderProjectV1({
      project: value.project,
      input: {},
      originInputs: value.originInputs,
    });
    capsules.push(replacement);
    const selfConsistent = await createSiteBuildRenderRuntimeCacheV1({
      project: replacement.project,
      originalProjectRoot: value.project,
    });
    await expect(
      reuseSiteBuildRenderRuntimeCacheV1({
        cache: selfConsistent.cache,
        originalProjectRoot: value.project,
        expectedRenderer: value.capsule.renderer,
      }),
    ).rejects.toThrow("conflict");
  });

  it("rejects aliases from executable paths into the intentionally mutable input", async () => {
    const value = await fixture();
    const next = join(value.capsule.project, ".next");
    await chmod(next, 0o755);
    try {
      await symlink("../.nexpress/site/tmp/render-input.json", join(next, "input-alias.js"));
    } finally {
      await chmod(next, 0o555);
    }
    await expect(
      createSiteBuildRenderRuntimeCacheV1({
        project: value.capsule.project,
        originalProjectRoot: value.project,
      }),
    ).rejects.toThrow("path");
  });

  it("detaches origin descriptors without executing getters and requires an origin binding for cache creation", async () => {
    const value = await fixture();
    let executed = false;
    const getter = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        executed = true;
        return "np.site-build-linux-project-inputs.v1";
      },
    });
    await expect(
      freezePreparedSiteBuildRenderProjectV1({
        project: value.project,
        input: {},
        originInputs: getter,
      }),
    ).rejects.toThrow("input");
    expect(executed).toBe(false);
    const unbound = await freezePreparedSiteBuildRenderProjectV1({
      project: value.project,
      input: {},
    });
    capsules.push(unbound);
    await expect(
      createSiteBuildRenderRuntimeCacheV1({
        project: unbound.project,
        originalProjectRoot: value.project,
      }),
    ).rejects.toThrow();
  });
});
