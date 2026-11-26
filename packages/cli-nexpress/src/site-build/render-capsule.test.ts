import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  freezePreparedSiteBuildRenderProjectV1,
  type NpFrozenPreparedSiteBuildRenderProjectV1,
} from "./render-capsule.js";
import { prepareSiteBuildCandidateRenderSourcesV1 } from "./linux-project.js";

const roots: string[] = [];
const capsules: NpFrozenPreparedSiteBuildRenderProjectV1[] = [];
const owners = [
  "@nexpress/app",
  "@nexpress/blocks",
  "@nexpress/cli",
  "@nexpress/core",
  "@nexpress/theme",
  "react",
  "react-dom",
];
async function create(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-render-capsule-test-")));
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: Object.fromEntries(owners.map((n) => [n, "1.0.0"])),
    }),
  );
  for (const name of owners) {
    const path = join(root, "node_modules", name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    await writeFile(join(path, "index.js"), "throw new Error('Do not execute this package');\n");
  }
  await mkdir(join(root, ".next/server"), { recursive: true });
  await mkdir(join(root, ".next/standalone/.next"), { recursive: true });
  await writeFile(join(root, ".next/BUILD_ID"), "actual-build-id");
  await writeFile(join(root, ".next/server/page.js"), "actual compiled page\n");
  for (const path of [".next/cache", ".next/standalone/.next/cache"])
    await symlink("/np/output/next-cache", join(root, path));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/nexpress.config.ts"), "export default {};\n");
  return root;
}
const freeze = async (
  project: string,
  input: unknown = { mode: "catalog", config: "src/nexpress.config.ts" },
) => {
  const capsule = await freezePreparedSiteBuildRenderProjectV1({ project, input });
  capsules.push(capsule);
  return capsule;
};
afterEach(async () => {
  for (const capsule of capsules.splice(0)) await capsule.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("prepared immutable render capsule", () => {
  it("freezes provisioning-normalized sources with the actual command runtime and keeps both owners live", async () => {
    const project = await create();
    const supplier = await realpath(await mkdtemp(join(tmpdir(), "np-render-source-supplier-")));
    roots.push(supplier);
    const tarball = Buffer.from("Synthetic packed supplier; never installed or executed.\n");
    const packed = join(supplier, "fixture.tgz");
    await writeFile(packed, tarball);
    const reference = `file:${packed}`;
    const manifest = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
    manifest.packageManager = "pnpm@10.33.0";
    manifest.dependencies["@nexpress/app"] = reference;
    const rawManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const lock = `lockfileVersion: '9.0'\npackages:\n  '@nexpress/app@${reference}':\n    resolution: {integrity: ${integrity}, tarball: ${reference}}\n`;
    await writeFile(join(project, "package.json"), rawManifest);
    await writeFile(join(project, "pnpm-lock.yaml"), lock);
    await writeFile(join(project, "pnpm-workspace.yaml"), "packages: []\n");
    await writeFile(join(project, "operator-note.txt"), "operator bytes\n");
    await writeFile(join(project, ".env"), "synthetic omitted bytes\n");
    const sourceInputs = await prepareSiteBuildCandidateRenderSourcesV1(project);
    try {
      const options = { project, input: { mode: "catalog" }, sourceInputs };
      const capsule = await freezePreparedSiteBuildRenderProjectV1(options);
      capsules.push(capsule);
      const normalized = await readFile(join(sourceInputs.project, "package.json"));
      expect(normalized.toString()).not.toBe(rawManifest);
      expect(await readFile(join(capsule.project, "package.json"))).toEqual(normalized);
      expect(await readFile(join(capsule.project, "pnpm-lock.yaml"))).toEqual(
        await readFile(join(sourceInputs.project, "pnpm-lock.yaml")),
      );
      await expect(lstat(join(capsule.project, "pnpm-workspace.yaml"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(lstat(join(capsule.project, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(capsule.project, "operator-note.txt"), "utf8")).toBe(
        "operator bytes\n",
      );
      expect(await readFile(join(capsule.project, ".next/server/page.js"), "utf8")).toBe(
        "actual compiled page\n",
      );
      await capsule.assertOriginalUnchanged();
      await writeFile(join(project, ".next/server/page.js"), "changed compiled page\n");
      await expect(capsule.assertOriginalUnchanged()).rejects.toThrow("conflict");
      expect(await readFile(join(project, "package.json"), "utf8")).toBe(rawManifest);
      expect(await readFile(join(project, "pnpm-lock.yaml"), "utf8")).toBe(lock);
      expect(await readFile(join(project, ".env"), "utf8")).toBe("synthetic omitted bytes\n");
      await capsule.close();
    } finally {
      await sourceInputs.close();
    }
  });

  it("observes actual packages/build bytes, detaches input and makes only the owned copy readonly", async () => {
    const project = await create();
    await mkdir(join(project, ".nexpress/site/tmp"), { recursive: true });
    await mkdir(join(project, ".nexpress/site/audit"), { recursive: true });
    await writeFile(join(project, ".nexpress/site/tmp/untrusted.json"), "old input");
    await writeFile(join(project, ".nexpress/site/audit/private.log"), "old audit");
    await writeFile(join(project, ".nexpress/site/directions.json"), '{"untrusted":"direction"}');
    await mkdir(join(project, ".nexpress/site/fixtures"));
    await writeFile(join(project, ".nexpress/site/fixtures/implicit.json"), '{"untrusted":true}');
    await writeFile(join(project, ".env.local"), "synthetic omitted secret");
    await chmod(join(project, ".next/server/page.js"), 0o755);
    await symlink("page.js", join(project, ".next/server/page-alias.js"));
    const input = { mode: "catalog", config: "src/nexpress.config.ts", facts: { clock: "fixed" } };
    const previousUmask = process.umask(0o077);
    let capsule: NpFrozenPreparedSiteBuildRenderProjectV1;
    try {
      const pending = freeze(project, input);
      input.facts.clock = "changed after call";
      capsule = await pending;
    } finally {
      process.umask(previousUmask);
    }
    const injected = JSON.parse(
      await readFile(join(capsule.project, ".nexpress/site/tmp/render-input.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(injected.facts).toEqual({ clock: "fixed" });
    expect(injected.renderer).toEqual(capsule.renderer);
    expect(capsule.renderer.packages.map((p) => p.name)).toEqual(owners);
    expect(
      capsule.renderer.projectSources.files.some((f) => f.path === ".np-build-runtime.json"),
    ).toBe(true);
    expect(capsule.renderer.projectSources.files.every((f) => !f.path.startsWith(".next/"))).toBe(
      true,
    );
    expect(capsule.runtimeFilesDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readlink(join(capsule.project, ".next/server/page-alias.js"))).toBe("page.js");
    expect(await readlink(join(capsule.project, ".next/cache"))).toBe("/np/output/next-cache");
    for (const path of [
      ".next/cache",
      ".next/standalone/.next/cache",
      ".next/server/page-alias.js",
    ])
      expect((await lstat(join(capsule.project, path))).mode & 0o777).toBe(
        (await lstat(join(project, path))).mode & 0o777,
      );
    for (const path of [
      ".env.local",
      ".nexpress/site/tmp/untrusted.json",
      ".nexpress/site/audit",
      ".nexpress/site/directions.json",
      ".nexpress/site/fixtures/implicit.json",
    ])
      await expect(lstat(join(capsule.project, path))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(capsule.root)).mode & 0o777).toBe(0o700);
    expect((await lstat(capsule.project)).mode & 0o777).toBe(0o555);
    expect((await lstat(join(capsule.project, ".next/server/page.js"))).mode & 0o777).toBe(0o555);
    expect((await lstat(join(capsule.project, "package.json"))).mode & 0o777).toBe(0o444);
    await capsule.assertOriginalUnchanged();
    await writeFile(join(project, ".next/server/page.js"), "changed source build\n");
    await expect(capsule.assertOriginalUnchanged()).rejects.toThrow("conflict");
    expect(await readFile(join(capsule.project, ".next/server/page.js"), "utf8")).toBe(
      "actual compiled page\n",
    );
    await capsule.close();
    await capsule.close();
    await expect(lstat(capsule.root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(project, ".env.local"), "utf8")).toBe("synthetic omitted secret");
  });

  it("binds runtime bytes separately and yields stable renderer identity across fresh physical copies", async () => {
    const project = await create();
    // These files are intentionally outside the manifest-reachable installed-package graph.
    await mkdir(join(project, "node_modules/unreferenced"));
    await writeFile(join(project, "node_modules/unreferenced/a.js"), "module.exports = 1;\n");
    await writeFile(join(project, "node_modules/unreferenced/b.js"), "module.exports = 1;\n");
    await symlink("a.js", join(project, "node_modules/unreferenced/entry.js"));
    await mkdir(join(project, ".nexpress/site"), { recursive: true });
    await writeFile(join(project, ".nexpress/site/directions.json"), '{"seal":"before"}');
    await mkdir(join(project, "dist"));
    await writeFile(join(project, "dist/unreferenced.js"), "module.exports = 1;\n");
    const first = await freeze(project);
    await writeFile(join(project, ".nexpress/site/directions.json"), '{"seal":"after"}');
    const second = await freeze(project, { mode: "fixture", config: "src/nexpress.config.ts" });
    expect(second.renderer).toEqual(first.renderer);
    expect(second.runtimeFilesDigest).toBe(first.runtimeFilesDigest);
    expect(JSON.stringify(first.renderer)).not.toContain(first.root);
    await writeFile(join(project, ".next/server/page.js"), "different compiled page\n");
    const changed = await freeze(project);
    expect(changed.runtimeFilesDigest).not.toBe(first.runtimeFilesDigest);
    expect(changed.renderer.projectSources).not.toEqual(first.renderer.projectSources);
    expect(changed.renderer.packages).toEqual(first.renderer.packages);
    await writeFile(join(project, "node_modules/unreferenced/a.js"), "module.exports = 2;\n");
    const changedUnreferenced = await freeze(project);
    expect(changedUnreferenced.runtimeFilesDigest).not.toBe(changed.runtimeFilesDigest);
    expect(changedUnreferenced.renderer.projectSources).not.toEqual(
      changed.renderer.projectSources,
    );
    expect(changedUnreferenced.renderer.packages).toEqual(first.renderer.packages);
    await rm(join(project, "node_modules/unreferenced/entry.js"));
    await symlink("b.js", join(project, "node_modules/unreferenced/entry.js"));
    const changedLink = await freeze(project);
    expect(changedLink.runtimeFilesDigest).not.toBe(changedUnreferenced.runtimeFilesDigest);
    await chmod(join(project, "node_modules/unreferenced/b.js"), 0o755);
    const changedMode = await freeze(project);
    expect(changedMode.runtimeFilesDigest).not.toBe(changedLink.runtimeFilesDigest);
    expect(changedMode.renderer.packages).toEqual(first.renderer.packages);
    await writeFile(join(project, "dist/unreferenced.js"), "module.exports = 2;\n");
    const changedDist = await freeze(project);
    expect(changedDist.runtimeFilesDigest).not.toBe(changedMode.runtimeFilesDigest);
    expect(changedDist.renderer.projectSources).not.toEqual(changedMode.renderer.projectSources);
    expect(changedDist.renderer.packages).toEqual(first.renderer.packages);
  });

  it("rejects caller renderer assertions, executable getters, cycles and oversized JSON before copying", async () => {
    const project = await create();
    let executed = false;
    const getter = Object.defineProperty({}, "mode", {
      enumerable: true,
      get() {
        executed = true;
        return "catalog";
      },
    });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const input of [
      { renderer: undefined },
      getter,
      cycle,
      { text: "x".repeat(8 * 1024 * 1024) },
    ])
      await expect(freezePreparedSiteBuildRenderProjectV1({ project, input })).rejects.toThrow(
        "input",
      );
    expect(executed).toBe(false);
  });

  it("stages only confined fixture JSON with create-or-identical collision rules", async () => {
    const project = await create(),
      path = ".nexpress/site/fixtures/facts.v1.json",
      bytes = Buffer.from('{"version":1}');
    await mkdir(join(project, ".nexpress/site/fixtures"), { recursive: true });
    await writeFile(join(project, path), bytes);
    const capsule = await freezePreparedSiteBuildRenderProjectV1({
      project,
      input: {},
      fixtures: [
        { path, bytes },
        { path, bytes },
        { path: ".nexpress/site/fixtures/new.json", bytes },
      ],
    });
    capsules.push(capsule);
    expect(await readFile(join(capsule.project, path))).toEqual(bytes);
    const identical = await freezePreparedSiteBuildRenderProjectV1({
      project,
      input: {},
      fixtures: [
        { path, bytes },
        { path: ".nexpress/site/fixtures/new.json", bytes },
      ],
    });
    capsules.push(identical);
    expect(identical.runtimeFilesDigest).toBe(capsule.runtimeFilesDigest);
    const changed = await freezePreparedSiteBuildRenderProjectV1({
      project,
      input: {},
      fixtures: [
        { path, bytes: Buffer.from('{"version":2}') },
        { path: ".nexpress/site/fixtures/new.json", bytes },
      ],
    });
    capsules.push(changed);
    expect(changed.runtimeFilesDigest).not.toBe(capsule.runtimeFilesDigest);
    expect(changed.renderer.projectSources).not.toEqual(capsule.renderer.projectSources);
    expect(changed.renderer.packages).toEqual(capsule.renderer.packages);
    for (const fixture of [
      { path, bytes: Buffer.from('{"version":2}') },
      { path: ".nexpress/site/fixtures/../escape.json", bytes },
    ])
      await expect(
        freezePreparedSiteBuildRenderProjectV1({
          project,
          input: {},
          fixtures: [{ path, bytes }, fixture],
        }),
      ).rejects.toThrow();
    await rm(join(project, ".nexpress/site/fixtures"), { recursive: true });
    await symlink("../../..", join(project, ".nexpress/site/fixtures"));
    const ignoredOriginalLink = await freezePreparedSiteBuildRenderProjectV1({
      project,
      input: {},
      fixtures: [{ path, bytes }],
    });
    capsules.push(ignoredOriginalLink);
    expect(await readFile(join(ignoredOriginalLink.project, path))).toEqual(bytes);
    expect(
      (await lstat(join(ignoredOriginalLink.project, ".nexpress/site/fixtures"))).isSymbolicLink(),
    ).toBe(false);
  });

  it("rejects external links, undeclared absolute cache links, FIFOs and hard-linked source files", async () => {
    const project = await create();
    const rejected = join(project, ".next/rejected");
    for (const target of ["/etc/hosts", "../../outside", "/np/output/next-cache"]) {
      await symlink(target, rejected);
      await expect(
        freezePreparedSiteBuildRenderProjectV1({ project, input: {} }),
      ).rejects.toThrow();
      await rm(rejected);
    }
    await promisify(execFile)("mkfifo", [rejected]);
    await expect(freezePreparedSiteBuildRenderProjectV1({ project, input: {} })).rejects.toThrow();
    await rm(rejected);
    await link(join(project, ".next/BUILD_ID"), rejected);
    await expect(freezePreparedSiteBuildRenderProjectV1({ project, input: {} })).rejects.toThrow();
  });

  it("rejects a sparse oversized build artifact before reading or allocating its payload", async () => {
    const project = await create();
    const handle = await open(join(project, ".next/oversized.bin"), "wx");
    try {
      await handle.truncate(512 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    await expect(freezePreparedSiteBuildRenderProjectV1({ project, input: {} })).rejects.toThrow(
      "input",
    );
  });
});
