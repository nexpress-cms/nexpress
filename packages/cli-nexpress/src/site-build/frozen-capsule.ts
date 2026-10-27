import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildSourceTreeV1,
  type NpAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  inspectSiteInstalledPackagesV1,
  type NpObservedBuildPackageV1,
} from "./installed-packages.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

// Application module/assets roots, not arbitrary workspace/home data. This is a render capsule,
// distinct from the generator's complete original-worktree snapshot and its closed exclusions.
const sourceRoots = new Set([
  "src",
  "public",
  "scripts",
  "app",
  "pages",
  "components",
  "lib",
  "collections",
  "themes",
  "plugins",
  "config",
  "i18n",
  "locales",
  "messages",
  "styles",
  "assets",
  "db",
]);
const credential = (name: string) =>
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.codex|\.claude|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
    name,
  );
const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "coverage",
  ".nexpress",
]);
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.nlink === b.nlink &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

export interface NpFrozenSiteBuildCapsuleV1 {
  root: string;
  project: string;
  dependencies: string;
  output: string;
  configFile: string;
  renderer: NpAgentBuildDirectionRendererV1;
  imports: Array<{ specifier: string; package: string; version: string }>;
  cliRoot: string;
  assertOriginalUnchanged(): Promise<void>;
  close(): Promise<void>;
}

/** Fresh owned copies only. The child never mounts the original repository, dependencies or env files. */
export async function freezeSiteBuildCapsuleV1(
  cwd: string,
  configRelative: string,
): Promise<NpFrozenSiteBuildCapsuleV1> {
  npRequireAgentBuildSourceTreeV1({
    schemaVersion: "np.agent-build-source-tree.v1",
    files: [
      {
        path: configRelative,
        kind: "file",
        mode: "100644",
        digest: `nb1:file-sha256:${"A".repeat(43)}`,
      },
    ],
  });
  if (
    !/^nexpress\.config\.[cm]?[jt]s$/u.test(configRelative) &&
    !/^src\/nexpress\.config\.[cm]?[jt]s$/u.test(configRelative)
  )
    throw new SiteBuildError("unavailable");
  const original = await realpath(cwd);
  const observed = await inspectSiteInstalledPackagesV1(original);
  const cli = observed.rootImports.get("@nexpress/cli");
  if (!cli) throw new SiteBuildError("unavailable");
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-site-build-capsule-")));
  const project = join(root, "project"),
    dependencies = join(root, "dependencies"),
    output = join(root, "output");
  const sourceLeases: Array<{ path: string; identity: BigIntStats }> = [];
  const copied = new Map<string, string>();
  let sourceCount = 0,
    sourceEntries = 0,
    sourceBytes = 0n;
  try {
    await mkdir(project);
    await mkdir(dependencies);
    await mkdir(output);
    async function copyFile(
      source: string,
      destination: string,
      expectedHash?: string,
      sourceFile = false,
    ): Promise<void> {
      const handle = await open(
        source,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat({ bigint: true });
        if (
          !before.isFile() ||
          before.size < 0n ||
          before.size > BigInt(Number.MAX_SAFE_INTEGER) ||
          (sourceFile && before.nlink !== 1n)
        )
          throw new SiteBuildError("input");
        if (
          sourceFile &&
          (before.size > 64n * 1024n * 1024n || (sourceBytes += before.size) > 512n * 1024n * 1024n)
        )
          throw new SiteBuildError("input");
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const target = await open(destination, "wx", (before.mode & 0o111n) === 0n ? 0o444 : 0o555);
        const hash = createHash("sha256"),
          bytes = Buffer.alloc(64 * 1024);
        try {
          let offset = 0;
          while (offset < Number(before.size)) {
            const read = await handle.read(
              bytes,
              0,
              Math.min(bytes.length, Number(before.size) - offset),
              offset,
            );
            if (!read.bytesRead) throw new SiteBuildError("input");
            const chunk = bytes.subarray(0, read.bytesRead);
            hash.update(chunk);
            await target.writeFile(chunk);
            offset += read.bytesRead;
          }
        } finally {
          await target.close();
        }
        if (
          (expectedHash && expectedHash !== hash.digest("hex")) ||
          !same(before, await handle.stat({ bigint: true })) ||
          !same(before, await lstat(source, { bigint: true }))
        )
          throw new SiteBuildError("input");
        if (sourceFile) sourceLeases.push({ path: source, identity: before });
      } finally {
        await handle.close();
      }
    }
    async function copySource(subpath: string): Promise<void> {
      if (++sourceEntries > 20_000 || subpath.length > 512 || subpath.split("/").length > 32)
        throw new SiteBuildError("input");
      const source = join(original, subpath),
        destination = join(project, subpath);
      const before = await lstat(source, { bigint: true });
      if (before.isSymbolicLink()) throw new SiteBuildError("path");
      if (before.isDirectory()) {
        sourceLeases.push({ path: source, identity: before });
        await mkdir(destination, { recursive: true, mode: 0o700 });
        const directory = await opendir(source);
        for await (const entry of directory) {
          if (ignored.has(entry.name) || credential(entry.name)) continue;
          await copySource(`${subpath}/${entry.name}`);
        }
      } else {
        if (!before.isFile() || ++sourceCount > 10_000) throw new SiteBuildError("input");
        npRequireAgentBuildSourceTreeV1({
          schemaVersion: "np.agent-build-source-tree.v1",
          files: [
            {
              path: subpath,
              kind: "file",
              mode: "100644",
              digest: `nb1:file-sha256:${"A".repeat(43)}`,
            },
          ],
        });
        await copyFile(source, destination, undefined, true);
      }
      if (!same(before, await lstat(source, { bigint: true }))) throw new SiteBuildError("input");
    }
    const rootIdentity = await lstat(original, { bigint: true });
    sourceLeases.push({ path: original, identity: rootIdentity });
    const directory = await opendir(original);
    let rootEntries = 0;
    for await (const entry of directory) {
      if (++rootEntries > 20_000) throw new SiteBuildError("input");
      if (ignored.has(entry.name) || credential(entry.name)) continue;
      if (
        entry.isDirectory()
          ? sourceRoots.has(entry.name)
          : /\.(?:[cm]?[jt]sx?|json)$/u.test(entry.name) || entry.name === "pnpm-lock.yaml"
      )
        await copySource(entry.name);
    }
    await lstat(join(project, configRelative));
    // Bind dependency wiring as well as the unique payload list. IDs follow the deterministic
    // root/import traversal; physical temporary locators never enter the renderer identity.
    const instanceIds = new Map(
      observed.instances.map((instance, index) => [instance.root, index]),
    );
    const graph = {
      schemaVersion: "np.build-capsule-module-graph.v1",
      roots: [...observed.rootImports].map(([specifier, instance]) => ({
        specifier,
        instance: instanceIds.get(instance.root)!,
      })),
      instances: observed.instances.map((instance) => ({
        contentDigest: instance.contentDigest,
        dependencies: [...instance.dependencies]
          .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
          .map(([specifier, target]) => ({ specifier, instance: instanceIds.get(target)! })),
      })),
    };
    await writeFile(join(project, ".np-build-modules.json"), JSON.stringify(graph), {
      flag: "wx",
      mode: 0o400,
    });
    // Snapshot before adding our dependency link. No Build output participates in its own hash.
    const projectSources = (await readSiteSourceTreeV1(project)).manifest;
    let ordinal = 0;
    for (const instance of observed.instances) {
      const target = join(dependencies, `p${String(ordinal++).padStart(4, "0")}`, "package");
      await mkdir(target, { recursive: true });
      copied.set(instance.root, target);
      for (const file of instance.files)
        await copyFile(join(instance.root, file.path), join(target, file.path), file.sha256);
    }
    async function dependencyLink(
      directory: string,
      specifier: string,
      instance: NpObservedBuildPackageV1 | string,
    ): Promise<void> {
      const originalRoot = typeof instance === "string" ? instance : instance.root;
      const target = copied.get(originalRoot);
      if (!target) throw new SiteBuildError("input");
      const link = join(directory, specifier);
      await mkdir(dirname(link), { recursive: true });
      await symlink(relative(dirname(link), target), link);
    }
    for (const instance of observed.instances) {
      const target = copied.get(instance.root)!;
      for (const [specifier, dependency] of instance.dependencies)
        await dependencyLink(join(dirname(target), "node_modules"), specifier, dependency);
    }
    for (const [specifier, instance] of observed.rootImports)
      await dependencyLink(join(project, "node_modules"), specifier, instance);
    const renderer = npRequireAgentBuildDirectionRendererV1({
      schemaVersion: "np.agent-build-direction-renderer.v1",
      implementation: "np.site-build.v1",
      projectSources,
      packages: observed.packages,
    });
    const assertOriginalUnchanged = async () => {
      await observed.assertUnchanged();
      for (const lease of sourceLeases)
        if (!same(lease.identity, await lstat(lease.path, { bigint: true })))
          throw new SiteBuildError("input");
    };
    await assertOriginalUnchanged();
    return {
      root,
      project,
      dependencies,
      output,
      configFile: join(project, configRelative),
      renderer,
      cliRoot: copied.get(cli.root)!,
      imports: [...observed.rootImports].map(([specifier, instance]) => ({
        specifier,
        package: instance.name,
        version: instance.version,
      })),
      assertOriginalUnchanged,
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
