import { createHash } from "node:crypto";
import { ChildProcess } from "node:child_process";
import type * as NodeChildProcess from "node:child_process";
import type * as NodeFs from "node:fs/promises";
import { PassThrough } from "node:stream";
import { createServer, type Server } from "node:net";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
  access,
  cp,
  chmod,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  observeSiteBuildLinuxProjectInputsV1,
  prepareSiteBuildCandidateRenderSourcesV1,
  requirePreparedSiteBuildCandidateRenderSourcesV1,
  prepareSiteBuildLinuxProjectV1,
} from "./linux-project.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), observe: vi.fn(), inputRoots: [] as string[] }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof NodeFs>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    mkdtemp: async (prefix: string) => {
      const path = await actual.mkdtemp(prefix);
      if (prefix.endsWith("np-linux-project-inputs-")) mocks.inputRoots.push(path);
      return path;
    },
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof NodeChildProcess>()),
  spawn: mocks.spawn,
}));
vi.mock("./installed-packages.js", () => ({ inspectSiteInstalledPackagesV1: mocks.observe }));

const imageId = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];
const servers: Server[] = [];
let onInstall: (() => Promise<void>) | undefined;
let installFails = false;

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-linux-project-unit-")));
  roots.push(root);
  const projectRoot = join(root, "project"),
    dockerConfig = join(root, "docker-config");
  await mkdir(projectRoot);
  await mkdir(dockerConfig);
  await mkdir(join(root, "t"));
  const tarball = Buffer.from("Synthetic tarball bytes; the fake installer never executes them.");
  const tarballPath = join(root, "t", "fixture.tgz");
  await writeFile(tarballPath, tarball);
  const reference = `file:${tarballPath}`;
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  const manifest = {
    name: "synthetic-project",
    version: "0.1.0",
    private: true,
    packageManager: "pnpm@10.33.0",
    scripts: { postinstall: "this script must never execute" },
    dependencies: { "@fixture/package": reference },
    pnpm: { overrides: { "@fixture/package": reference } },
  };
  const lock = `lockfileVersion: '9.0'\n\nsettings:\n  excludeLinksFromLockfile: false\n\noverrides:\n  '@fixture/package': ${reference}\n\nimporters:\n  .:\n    dependencies:\n      '@fixture/package':\n        specifier: ${reference}\n        version: file:../t/fixture.tgz\n\npackages:\n  '@fixture/package@file:../t/fixture.tgz':\n    resolution: {integrity: ${integrity}, tarball: file:../t/fixture.tgz}\n\nsnapshots:\n  '@fixture/package@file:../t/fixture.tgz': {}\n`;
  await writeFile(join(projectRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(projectRoot, "pnpm-lock.yaml"), lock);
  await mkdir(join(projectRoot, "drizzle", "meta"), { recursive: true });
  await mkdir(join(projectRoot, "src", "db"), { recursive: true });
  await writeFile(join(projectRoot, "drizzle", "0000_reviewed.sql"), "select 1;\n");
  await writeFile(join(projectRoot, "drizzle", "meta", "_journal.json"), "{}\n");
  await writeFile(join(projectRoot, "src", "db", "collections.ts"), "export const schema = {};\n");
  const socket = join(root, "docker.sock"),
    server = createServer();
  servers.push(server);
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(socket, accept);
  });
  const input = { projectRoot, imageId, dockerEndpoint: `unix://${socket}`, dockerConfig };
  return {
    root,
    projectRoot,
    dockerConfig,
    input,
    tarball,
    tarballPath,
    reference,
    lock,
    manifest,
  };
}

beforeEach(() => {
  mocks.inputRoots.length = 0;
  onInstall = undefined;
  installFails = false;
  mocks.observe.mockResolvedValue({
    packages: [
      {
        name: "@img/sharp-linux-arm64",
        version: "0.35.4",
        contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
      },
    ],
    assertUnchanged: vi.fn().mockResolvedValue(undefined),
  });
  mocks.spawn.mockImplementation((_file: string, args: string[]) => {
    const child = new ChildProcess();
    const stdout = new PassThrough(),
      stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    queueMicrotask(() => {
      void (async () => {
        let output = "";
        const install = args.includes("install");
        if (args.includes("inspect")) output = `${imageId} linux arm64\n`;
        else if (args.includes("console.log(JSON.stringify({node:process.version}))"))
          output = '{"node":"v24.11.1"}\n';
        else if (args.at(-1) === "--version") output = "10.33.0\n";
        else if (args.some((arg) => arg.startsWith("const core=")))
          output = '{"platform":"linux","architecture":"arm64","core":true,"sharp":"8.17.2"}\n';
        if (install) await onInstall?.();
        stdout.end(output);
        stderr.end();
        child.emit("close", install && installFails ? 1 : 0, null);
      })().catch((error: unknown) => child.emit("error", error));
    });
    return child;
  });
});

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((accept) => server.close(() => accept()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("private Linux project dependency provisioning", () => {
  it("derives the same candidate source bytes as provisioning without starting a tool and holds actual source leases", async () => {
    const value = await fixture();
    await writeFile(join(value.projectRoot, "pnpm-workspace.yaml"), "packages: []\n");
    await writeFile(join(value.projectRoot, ".env"), "synthetic omitted bytes\n");
    const provisioned = await prepareSiteBuildLinuxProjectV1(value.input);
    roots.push(provisioned.root);
    const calls = mocks.spawn.mock.calls.length;
    const source = await prepareSiteBuildCandidateRenderSourcesV1(value.projectRoot);
    try {
      for (const name of ["package.json", "pnpm-lock.yaml"])
        expect(await readFile(join(source.project, name))).toEqual(
          await readFile(join(provisioned.project, name)),
        );
      for (const name of ["pnpm-workspace.yaml", ".env"])
        await expect(access(join(source.project, name))).rejects.toMatchObject({ code: "ENOENT" });
      const owned = await requirePreparedSiteBuildCandidateRenderSourcesV1(
        value.projectRoot,
        source,
      );
      expect(owned.project).toBe(source.project);
      expect(owned.originInputs).toEqual(
        await observeSiteBuildLinuxProjectInputsV1(value.projectRoot),
      );
      expect(mocks.spawn).toHaveBeenCalledTimes(calls);
      await writeFile(join(value.projectRoot, "src/db/collections.ts"), "changed raw bytes\n");
      await expect(source.assertUnchanged()).rejects.toThrow("conflict");
    } finally {
      await source.close();
    }
    await expect(access(source.project)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(source.assertUnchanged()).rejects.toThrow("conflict");
    expect(await readFile(join(value.projectRoot, ".env"), "utf8")).toBe(
      "synthetic omitted bytes\n",
    );
  });

  it("refuses copied source-owner descriptors, another original and mutated derived package bytes", async () => {
    const value = await fixture();
    const source = await prepareSiteBuildCandidateRenderSourcesV1(value.projectRoot);
    try {
      await expect(
        requirePreparedSiteBuildCandidateRenderSourcesV1(value.projectRoot, { ...source }),
      ).rejects.toThrow("conflict");
      await expect(
        requirePreparedSiteBuildCandidateRenderSourcesV1(value.root, source),
      ).rejects.toThrow("conflict");
      await writeFile(join(source.project, "package.json"), '{"dependencies":{"unowned":"2.0.0"}}');
      await expect(
        requirePreparedSiteBuildCandidateRenderSourcesV1(value.projectRoot, source),
      ).rejects.toThrow("conflict");
    } finally {
      await source.close();
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("observes relocated relative packed dependencies only through byte-identical physical package/lock inputs", async () => {
    const value = await fixture(),
      relative = "file:../t/fixture.tgz";
    const manifest = JSON.stringify(value.manifest).replaceAll(value.reference, relative),
      lock = value.lock.replaceAll(value.reference, relative);
    await writeFile(join(value.projectRoot, "package.json"), manifest);
    await writeFile(join(value.projectRoot, "pnpm-lock.yaml"), lock);
    const relocated = join(value.root, "candidate", "project");
    await cp(value.projectRoot, relocated, { recursive: true });
    await expect(observeSiteBuildLinuxProjectInputsV1(relocated)).rejects.toThrow();
    const baseline = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    const candidate = await observeSiteBuildLinuxProjectInputsV1(relocated, {
      tarballProjectRoot: value.projectRoot,
    });
    expect(candidate).toEqual(baseline);
    await writeFile(join(relocated, "candidate.ts"), "export const candidate=1;\n");
    const changed = await observeSiteBuildLinuxProjectInputsV1(relocated, {
      tarballProjectRoot: value.projectRoot,
    });
    expect(changed.sourceTreeDigest).not.toBe(baseline.sourceTreeDigest);
    expect(changed.sourceManifestSha256).toBe(baseline.sourceManifestSha256);
    expect(changed.sourceLockSha256).toBe(baseline.sourceLockSha256);
    expect(changed.tarballs).toEqual(baseline.tarballs);
    expect(await readFile(join(relocated, "package.json"), "utf8")).toBe(manifest);
    expect(await readFile(join(relocated, "pnpm-lock.yaml"), "utf8")).toBe(lock);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    "candidate-manifest",
    "candidate-lock",
    "baseline-manifest",
    "baseline-lock",
    "tarball",
  ] as const)("rejects packed-origin drift before Docker: %s", async (kind) => {
    const value = await fixture(),
      relocated = join(value.root, "candidate", "project");
    await cp(value.projectRoot, relocated, { recursive: true });
    if (kind === "tarball") await writeFile(value.tarballPath, "changed tarball bytes");
    else {
      const base = kind.startsWith("candidate-") ? relocated : value.projectRoot;
      const path = join(base, kind.endsWith("manifest") ? "package.json" : "pnpm-lock.yaml");
      await writeFile(path, `${await readFile(path, "utf8")}\n`);
    }
    await expect(
      observeSiteBuildLinuxProjectInputsV1(relocated, { tarballProjectRoot: value.projectRoot }),
    ).rejects.toThrow("conflict");
    await expect(
      prepareSiteBuildCandidateRenderSourcesV1(relocated, {
        tarballProjectRoot: value.projectRoot,
      }),
    ).rejects.toThrow("conflict");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("uses canonical builder modes inside owner-only directories without changing source modes", async () => {
    const value = await fixture();
    const config = "src/nexpress.config.ts";
    const executable = "scripts/local-tool.mjs";
    await mkdir(join(value.projectRoot, "scripts"));
    await writeFile(join(value.projectRoot, config), "export default {};\n");
    await writeFile(join(value.projectRoot, executable), "export {};\n");
    await chmod(join(value.projectRoot, config), 0o600);
    await chmod(join(value.projectRoot, executable), 0o700);
    const prepared = await prepareSiteBuildLinuxProjectV1(value.input);
    roots.push(prepared.root);
    expect((await stat(prepared.root)).mode & 0o777).toBe(0o700);
    expect((await stat(prepared.project)).mode & 0o777).toBe(0o700);
    expect((await stat(join(prepared.project, config))).mode & 0o777).toBe(0o644);
    expect((await stat(join(prepared.project, executable))).mode & 0o777).toBe(0o755);
    expect((await stat(join(value.projectRoot, config))).mode & 0o777).toBe(0o600);
    expect((await stat(join(value.projectRoot, executable))).mode & 0o777).toBe(0o700);
    await prepared.assertSourceUnchanged();
  });

  it("observes the exact original receipt inputs without Docker and removes its owned scratch", async () => {
    const value = await fixture();
    const prepared = await prepareSiteBuildLinuxProjectV1(value.input);
    roots.push(prepared.root);
    const spawnCalls = mocks.spawn.mock.calls.length,
      inventoryCalls = mocks.observe.mock.calls.length,
      writeCalls = vi.mocked(writeFile).mock.calls.length;
    const observed = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    const tarballSha256 = createHash("sha256").update(value.tarball).digest("hex");
    expect(observed).toEqual({
      schemaVersion: "np.site-build-linux-project-inputs.v1",
      sourceManifestSha256: prepared.receipt.sourceManifestSha256,
      sourceLockSha256: prepared.receipt.sourceLockSha256,
      sourceTreeDigest: prepared.receipt.sourceTreeDigest,
      renderSourceProfile: "np.site-build-render-input-sources.v1",
      renderSourceTreeDigest: prepared.receipt.sourceTreeDigest,
      tarballs: prepared.receipt.tarballs.map(({ reference, sha256, bytes }) => ({
        reference,
        sha256,
        bytes,
      })),
    });
    expect(observed.sourceManifestSha256).not.toBe(prepared.receipt.preparedManifestSha256);
    expect(observed.sourceTreeDigest).not.toBe(prepared.receipt.preparedSourceTreeDigest);
    expect(observed.sourceManifestSha256).toBe(
      createHash("sha256")
        .update(`${JSON.stringify(value.manifest, null, 2)}\n`)
        .digest("hex"),
    );
    expect(observed.sourceLockSha256).toBe(createHash("sha256").update(value.lock).digest("hex"));
    expect(observed.tarballs).toEqual([
      {
        reference: `file:.nexpress/site/tmp/linux-packages/${tarballSha256}.tgz`,
        sha256: tarballSha256,
        bytes: value.tarball.length,
      },
    ]);
    expect(mocks.spawn).toHaveBeenCalledTimes(spawnCalls);
    expect(mocks.observe).toHaveBeenCalledTimes(inventoryCalls);
    // Source FD copies still run, but observation must not materialize unused
    // normalized manifests, lockfiles or tarball copies.
    expect(vi.mocked(writeFile).mock.calls.slice(writeCalls)).toEqual([]);
    // Only this test worker's actual owned scratch roots; another observation
    // may legitimately exist concurrently in the global temporary directory.
    for (const path of mocks.inputRoots)
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(value.projectRoot, "package.json"), "utf8")).toBe(
      `${JSON.stringify(value.manifest, null, 2)}\n`,
    );
    expect(await readFile(join(value.projectRoot, "pnpm-lock.yaml"), "utf8")).toBe(value.lock);
    expect(await readFile(value.tarballPath)).toEqual(value.tarball);
  });

  it("observes source, exact manifest and lock byte drift while retaining the closed credential omissions", async () => {
    const value = await fixture();
    const original = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    for (const path of [".env.local", ".npmrc", ".pnpmfile.cjs"])
      await writeFile(join(value.projectRoot, path), "synthetic omitted credential/hook");
    await mkdir(join(value.projectRoot, ".nexpress/site"), { recursive: true });
    await writeFile(
      join(value.projectRoot, ".nexpress/site/directions.json"),
      '{"untrusted":"build artifact"}',
    );
    expect(await observeSiteBuildLinuxProjectInputsV1(value.projectRoot)).toEqual(original);
    await writeFile(
      join(value.projectRoot, "src/db/collections.ts"),
      "export const schema = { changed: true };\n",
    );
    const source = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    expect(source.sourceTreeDigest).not.toBe(original.sourceTreeDigest);
    expect(source.renderSourceTreeDigest).not.toBe(original.renderSourceTreeDigest);
    expect(source.sourceManifestSha256).toBe(original.sourceManifestSha256);
    expect(source.sourceLockSha256).toBe(original.sourceLockSha256);
    await writeFile(join(value.projectRoot, "package.json"), `${JSON.stringify(value.manifest)}\n`);
    const manifest = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    expect(manifest.sourceManifestSha256).not.toBe(source.sourceManifestSha256);
    await writeFile(join(value.projectRoot, "pnpm-lock.yaml"), `${value.lock}\n`);
    const lock = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    expect(lock.sourceLockSha256).not.toBe(manifest.sourceLockSha256);
    expect(lock.sourceTreeDigest).not.toBe(manifest.sourceTreeDigest);
    expect(lock.renderSourceTreeDigest).not.toBe(manifest.renderSourceTreeDigest);
    expect(lock.tarballs).toEqual(original.tarballs);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.observe).not.toHaveBeenCalled();
  });

  it("binds override-only artifact bytes and rejects lock-authenticated tarball drift without Docker", async () => {
    const value = await fixture();
    const unused = join(value.root, "t/unused.tgz");
    await writeFile(unused, "version-one-unused-override");
    await writeFile(
      join(value.projectRoot, "package.json"),
      JSON.stringify({
        ...value.manifest,
        pnpm: {
          overrides: { ...value.manifest.pnpm.overrides, "@fixture/unused": `file:${unused}` },
        },
      }),
    );
    const original = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    expect(original.tarballs).toHaveLength(2);
    expect(original.tarballs.map((file) => file.reference)).toEqual(
      original.tarballs
        .map((file) => file.reference)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    );
    expect(JSON.stringify(original)).not.toContain(value.root);
    await writeFile(unused, "version-two-unused-override");
    const changed = await observeSiteBuildLinuxProjectInputsV1(value.projectRoot);
    expect(changed.sourceTreeDigest).toBe(original.sourceTreeDigest);
    expect(changed.sourceManifestSha256).toBe(original.sourceManifestSha256);
    expect(changed.sourceLockSha256).toBe(original.sourceLockSha256);
    expect(changed.tarballs).not.toEqual(original.tarballs);
    await writeFile(value.tarballPath, "tampered locked artifact");
    await expect(observeSiteBuildLinuxProjectInputsV1(value.projectRoot)).rejects.toMatchObject({
      reason: "conflict",
    });
    for (const path of mocks.inputRoots)
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.observe).not.toHaveBeenCalled();
  });

  it("copies only declared exact tarballs, rewrites private references, preserves reviewed source and binds a Linux inventory", async () => {
    const value = await fixture();
    const originalManifest = await readFile(join(value.projectRoot, "package.json"));
    const prepared = await prepareSiteBuildLinuxProjectV1(value.input);
    roots.push(prepared.root);
    const manifest = JSON.parse(
      await readFile(join(prepared.project, "package.json"), "utf8"),
    ) as typeof value.manifest;
    const lock = await readFile(join(prepared.project, "pnpm-lock.yaml"), "utf8");
    const copied = prepared.receipt.tarballs[0];
    expect(manifest.dependencies["@fixture/package"]).toBe(copied.reference);
    expect(manifest.pnpm.overrides["@fixture/package"]).toBe(copied.reference);
    expect(lock).not.toContain(value.reference);
    expect(lock).not.toContain("file:../t/");
    expect(lock.split(copied.reference)).toHaveLength(7);
    expect(await readFile(join(prepared.project, copied.reference.slice(5)))).toEqual(
      value.tarball,
    );
    expect(await readFile(join(value.projectRoot, "package.json"))).toEqual(originalManifest);
    expect(await readFile(join(value.projectRoot, "pnpm-lock.yaml"), "utf8")).toBe(value.lock);
    for (const path of [
      "drizzle/0000_reviewed.sql",
      "drizzle/meta/_journal.json",
      "src/db/collections.ts",
    ])
      expect(await readFile(join(prepared.project, path))).toEqual(
        await readFile(join(value.projectRoot, path)),
      );
    expect(prepared.receipt.packages[0].name).toBe("@img/sharp-linux-arm64");
    expect(prepared.receipt.importProbe).toEqual({
      platform: "linux",
      architecture: "arm64",
      core: true,
      sharp: "8.17.2",
    });
    await prepared.assertSourceUnchanged();
    await prepared.close();
    await expect(access(prepared.root)).rejects.toThrow();
  });

  it("keeps credentials, hooks, Darwin dependencies and old build output outside the private source copy", async () => {
    const value = await fixture();
    for (const path of [".env", ".npmrc", ".pnpmfile.cjs"])
      await writeFile(join(value.projectRoot, path), "credential-or-hook-sentinel");
    for (const directory of ["node_modules", ".next", ".git", ".agents", ".aws"]) {
      await mkdir(join(value.projectRoot, directory));
      await writeFile(join(value.projectRoot, directory, "sentinel"), "must not cross");
    }
    const prepared = await prepareSiteBuildLinuxProjectV1(value.input);
    roots.push(prepared.root);
    for (const path of [
      ".env",
      ".npmrc",
      ".pnpmfile.cjs",
      ".next",
      ".git",
      ".agents",
      ".aws",
      "node_modules/sentinel",
    ])
      await expect(access(join(prepared.project, path))).rejects.toThrow();
    for (const [, args, options] of mocks.spawn.mock.calls) {
      expect(args.slice(0, 2)).toEqual(["--host", value.input.dockerEndpoint]);
      expect(options.env).not.toBe(process.env);
      expect(options.env.HOME).toBe(join(prepared.root, "docker-config"));
      expect(options.env.DOCKER_CONFIG).toBe(options.env.HOME);
      expect(JSON.stringify(args)).not.toContain(value.projectRoot);
      expect(JSON.stringify(args)).not.toContain(join(value.root, "t"));
    }
    const runCalls = mocks.spawn.mock.calls.filter(([, args]) => args.includes("run"));
    expect(runCalls).toHaveLength(4);
    const networked = runCalls.filter(
      ([, args]) => args[args.indexOf("--network") + 1] === "bridge",
    );
    expect(networked).toHaveLength(1);
    const installArgs = networked[0][1] as string[];
    for (const flag of [
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--ignore-workspace",
      "--frozen-lockfile",
      "--read-only",
      "--pull",
      "-i",
    ])
      expect(installArgs).toContain(flag);
    expect(installArgs).toContain("--config.registry=https://registry.npmjs.org/");
  });

  it("resolves relocated relative lock references only through unique explicit manifest artifacts and exact integrity", async () => {
    const value = await fixture();
    const relocated = join(value.root, "frozen", "project");
    await cp(value.projectRoot, relocated, { recursive: true });
    const prepared = await prepareSiteBuildLinuxProjectV1({
      ...value.input,
      projectRoot: relocated,
    });
    roots.push(prepared.root);
    expect(prepared.receipt.tarballs).toHaveLength(1);
    expect(prepared.receipt.tarballs[0].integrity).toMatch(/^sha512-/u);
  });

  it("distinguishes unused override-only copies from lock-authenticated installed tarballs", async () => {
    const value = await fixture();
    const path = join(value.root, "t", "unused.tgz");
    await writeFile(path, "Unused explicit override artifact");
    const manifest = {
      ...value.manifest,
      pnpm: { overrides: { ...value.manifest.pnpm.overrides, "@fixture/unused": `file:${path}` } },
    };
    await writeFile(join(value.projectRoot, "package.json"), JSON.stringify(manifest));
    await writeFile(
      join(value.projectRoot, "pnpm-lock.yaml"),
      value.lock.replace("\n\nimporters:", `\n  '@fixture/unused': file:${path}\n\nimporters:`),
    );
    const prepared = await prepareSiteBuildLinuxProjectV1(value.input);
    roots.push(prepared.root);
    expect(prepared.receipt.tarballs).toHaveLength(2);
    expect(prepared.receipt.tarballs.filter((file) => file.integrity === null)).toHaveLength(1);
    expect(prepared.receipt.packages).toHaveLength(1);
  });

  it("rejects modified tarball bytes against the exact lock integrity before Docker runs", async () => {
    const value = await fixture();
    await writeFile(value.tarballPath, "modified");
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects undeclared local lock references and nonregistry resolution URLs before Docker runs", async () => {
    const value = await fixture();
    await writeFile(
      join(value.projectRoot, "pnpm-lock.yaml"),
      value.lock.replaceAll("file:../t/fixture.tgz", "file:../unknown/fixture.tgz"),
    );
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "input",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
    await writeFile(
      join(value.projectRoot, "pnpm-lock.yaml"),
      value.lock.replace(
        "tarball: file:../t/fixture.tgz",
        "tarball: https://example.invalid/package.tgz",
      ),
    );
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "input",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects Docker credentials, remote endpoints and executable pnpm extension configuration", async () => {
    const value = await fixture();
    await writeFile(
      join(value.dockerConfig, "config.json"),
      '{"auths":{"registry.example":{"auth":"sentinel"}}}',
    );
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "input",
    });
    await expect(
      prepareSiteBuildLinuxProjectV1({ ...value.input, dockerEndpoint: "tcp://127.0.0.1:2375" }),
    ).rejects.toMatchObject({ reason: "input" });
    await rm(join(value.dockerConfig, "config.json"));
    await writeFile(
      join(value.projectRoot, "package.json"),
      JSON.stringify({
        ...value.manifest,
        pnpm: { ...value.manifest.pnpm, configDependencies: { hook: "1.0.0" } },
      }),
    );
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "input",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects alternate resolution spellings and URL dependency ids instead of granting them provisioning network", async () => {
    const value = await fixture();
    await writeFile(
      join(value.projectRoot, "pnpm-lock.yaml"),
      value.lock.replace("resolution:", "'resolution':"),
    );
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "input",
    });
    await writeFile(
      join(value.projectRoot, "pnpm-lock.yaml"),
      value.lock.replace(
        "version: file:../t/fixture.tgz",
        "version: https://example.invalid/package.tgz",
      ),
    );
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "input",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("rejects source and tarball links rather than copying through them", async () => {
    const value = await fixture();
    await symlink(value.tarballPath, join(value.projectRoot, "source-link"));
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "path",
    });
    await rm(join(value.projectRoot, "source-link"));
    const original = join(value.root, "original.tgz");
    await writeFile(original, value.tarball);
    await rm(value.tarballPath);
    await symlink(original, value.tarballPath);
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "path",
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("detects source changes during provisioning and always removes its named containers", async () => {
    const value = await fixture();
    onInstall = async () => {
      await writeFile(join(value.projectRoot, "src", "db", "collections.ts"), "changed\n");
    };
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "conflict",
    });
    const runs = mocks.spawn.mock.calls.filter(([, args]) => args.includes("run"));
    const removed = mocks.spawn.mock.calls.filter(([, args]) => args.includes("rm"));
    expect(removed).toHaveLength(runs.length);
    for (const [, args] of runs) {
      const name = args[args.indexOf("--name") + 1];
      expect(removed.some(([, removal]) => removal.at(-1) === name)).toBe(true);
    }
  });

  it("cleans up its own install container on installer failure without importing application code", async () => {
    const value = await fixture();
    installFails = true;
    await expect(prepareSiteBuildLinuxProjectV1(value.input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(
      mocks.spawn.mock.calls.some(([, args]) =>
        args.some((arg: string) => arg.startsWith("const core=")),
      ),
    ).toBe(false);
    const install = mocks.spawn.mock.calls.find(([, args]) =>
      args.includes("install"),
    )![1] as string[];
    const name = install[install.indexOf("--name") + 1];
    expect(
      mocks.spawn.mock.calls.some(([, args]) => args.includes("rm") && args.at(-1) === name),
    ).toBe(true);
  });
});
