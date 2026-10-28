import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  lstat,
  readlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteBuildError } from "./artifact-io.js";
import type * as DockerHost from "./docker-host.js";
import {
  withSiteBuildLinuxWorkspaceV1,
  type NpSiteBuildLinuxWorkspaceInputV1,
  type NpSiteBuildLinuxWorkspaceV1,
} from "./linux-workspace.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const docker = vi.hoisted(() => vi.fn());
vi.mock("./docker-host.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DockerHost>()),
  runSiteBuildDockerV1: docker,
  withSiteBuildDockerV1: async (run: (host: object) => Promise<unknown>) =>
    run({
      endpoint: "unix:///fixture.sock",
      config: "/fixture-empty-config",
      readOnlyData: "/fixture-empty-image-data",
    }),
}));
const roots: string[] = [];
const execute = promisify(execFile);
const original = "export const value=1;\n";
const formatted = "export const value = 1;\n";
afterEach(async () => {
  docker.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(mutation: "format" | "unlisted" | "mode" | "delete" = "format") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-workspace-unit-")));
  roots.push(root);
  const project = join(root, "candidate"),
    dependencies = join(root, "linux-dependencies");
  const directory = ".nexpress/site/tmp/fixed-owner",
    auditPath = ".nexpress/site/audit/fixed-owner";
  const driver = `${directory}/format.mjs`;
  await Promise.all([
    mkdir(join(project, directory, "home"), { recursive: true }),
    mkdir(join(project, directory, "tmp"), { recursive: true }),
    mkdir(join(project, auditPath), { recursive: true }),
    mkdir(join(project, "src"), { recursive: true }),
    mkdir(dependencies),
  ]);
  await writeFile(
    join(project, "package.json"),
    '{"devDependencies":{"tool":"file:reviewed.tgz"}}\n',
  );
  await writeFile(join(project, "pnpm-lock.yaml"), "original raw lock\n");
  await writeFile(join(dependencies, "owner.txt"), "separate installed Linux closure\n");
  await writeFile(join(project, "src/entry.ts"), original);
  const operation =
    mutation === "unlisted"
      ? 'await fs.writeFile("/np/project/src/undeclared.ts","unexpected");'
      : mutation === "mode"
        ? 'await fs.chmod("/np/project/src/entry.ts",493);'
        : mutation === "delete"
          ? 'await fs.rm("/np/project/src/entry.ts");'
          : `await fs.writeFile("/np/project/src/entry.ts",${JSON.stringify(formatted)});`;
  await writeFile(
    join(project, driver),
    `import * as fs from "node:fs/promises";\n${operation}\nconsole.log("fixed owner ran");\n`,
    { mode: 0o400 },
  );
  const input: NpSiteBuildLinuxWorkspaceInputV1 = {
    project,
    dependencies,
    source: await readSiteSourceTreeV1(project),
    baseImageId: `sha256:${"a".repeat(64)}`,
    controls: { directory, files: [driver] },
    auditPath,
  };
  return { input, driver };
}

function observerDirectory(args: string[]): string {
  const mount = args.find(
    (argument) =>
      argument.startsWith("type=bind,source=") && argument.endsWith(",target=/np/control,readonly"),
  );
  if (!mount) throw new Error("missing readonly observer mount");
  return mount.slice("type=bind,source=".length, -",target=/np/control,readonly".length);
}

/** Docker is a transport fixture; fixed observer and owner scripts execute in real Node.
 * APFS statfs is replaced with the declared tmpfs facts, so this is not Linux quota proof. */
function transport(
  input: NpSiteBuildLinuxWorkspaceInputV1,
  failCreate?: "volume" | "holder" | "builder",
  linuxSymlinkModes = false,
) {
  const containers = new Map<string, string[]>();
  let volume = "";
  docker.mockImplementation(async (_host: unknown, args: string[]) => {
    const ok = (stdout = Buffer.alloc(0)) => ({ code: 0, stdout, stderr: Buffer.alloc(0) });
    if (args[0] === "volume") {
      if (args[1] === "create") {
        volume = await realpath(await mkdtemp(join(tmpdir(), "np-workspace-volume-unit-")));
        roots.push(volume);
        if (failCreate === "volume") throw new SiteBuildError("unavailable");
      }
      return ok();
    }
    if (args[0] === "rm") {
      containers.delete(args.at(-1) ?? "");
      return ok();
    }
    if (args[0] === "create") {
      const name = args[args.indexOf("--name") + 1];
      containers.set(name, args);
      if (
        (failCreate === "holder" && name.endsWith("-holder")) ||
        (failCreate === "builder" && name.includes("-builder-"))
      )
        throw new SiteBuildError("unavailable");
      return ok();
    }
    if (args[0] !== "start") throw new Error("unexpected transport fixture");
    const name = args.at(-1) ?? "",
      command = containers.get(name);
    if (!command) throw new Error("unknown container");
    if (name.endsWith("-holder")) return ok();
    const observer = name.includes("-observer-");
    if (observer)
      expect([...containers.keys()].some((key) => key.includes("-builder-"))).toBe(false);
    const control = observer
      ? observerDirectory(command)
      : join(input.project, input.controls.directory);
    const driver = observer
      ? join(control, "observer.mjs")
      : join(input.project, input.controls.files[0]);
    let source = await readFile(driver, "utf8");
    source = source
      .replace(
        "const quota=await fs.statfs(root,{bigint:true});",
        "const quota={type:16914836n,bsize:4096n,blocks:1048576n,files:131072n};",
      )
      .replaceAll("'/np/project'", JSON.stringify(volume))
      .replaceAll('"/np/project/', `"${volume}/`)
      .replaceAll("'/np/input'", JSON.stringify(input.project))
      .replaceAll("'/np/control'", JSON.stringify(control));
    if (linuxSymlinkModes)
      source = source.replace("kind:'symlink',mode:Number(s.mode&511n)", "kind:'symlink',mode:511");
    const executable = join(control, observer ? "observer-unit.mjs" : "owner-unit.mjs");
    await writeFile(executable, source);
    const result = await execute(
      process.execPath,
      [executable, ...(observer ? [command.at(-1) ?? ""] : [])],
      {
        encoding: "buffer",
        maxBuffer: 17 * 1024 * 1024,
        timeout: 10_000,
      },
    );
    return ok(Buffer.from(result.stdout));
  });
  return containers;
}

const runOwner = (workspace: NpSiteBuildLinuxWorkspaceV1, driver: string) =>
  workspace.run({
    id: "format",
    argv: ["/usr/local/bin/node", `/np/project/${driver}`],
    permitted: (path) => path === "src/entry.ts",
    timeoutMs: 10_000,
  });

describe("trusted bounded Linux workspace", () => {
  it("isolates sequential workspace observers while preserving pinned drivers and caller files", async () => {
    const { input, driver } = await fixture();
    await chmod(join(input.project, driver), 0o600);
    await writeFile(join(input.project, driver), 'console.log("fixed harmless owner");\n');
    await chmod(join(input.project, driver), 0o400);
    const directory = join(input.project, input.controls.directory);
    await writeFile(join(directory, "observer.mjs"), "caller-owned observer bytes\n", {
      flag: "wx",
      mode: 0o400,
    });
    await writeFile(join(directory, "request.json"), "caller-owned request bytes\n", {
      flag: "wx",
      mode: 0o600,
    });
    const containers = transport(input);
    for (const id of ["first", "second"]) {
      const result = await withSiteBuildLinuxWorkspaceV1(input, (workspace) =>
        workspace.run({
          id,
          argv: ["/usr/local/bin/node", `/np/project/${driver}`],
          permitted: () => false,
          timeoutMs: 10_000,
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(await readFile(join(input.project, result.stdout.path), "utf8")).toBe(
        "fixed harmless owner\n",
      );
    }
    const observerDirectories = new Set(
      docker.mock.calls
        .map((call) => call[1] as string[])
        .filter(
          (args) => args[0] === "create" && args[args.indexOf("--name") + 1].includes("-observer-"),
        )
        .map(observerDirectory),
    );
    expect(observerDirectories.size).toBe(2);
    for (const path of observerDirectories) {
      expect(path.startsWith(directory + "/")).toBe(true);
      expect((await lstat(path)).mode & 0o777).toBe(0o700);
      expect((await lstat(join(path, "observer.mjs"))).mode & 0o777).toBe(0o400);
      expect((await lstat(join(path, "request.json"))).mode & 0o777).toBe(0o600);
    }
    expect(await readFile(join(directory, "observer.mjs"), "utf8")).toBe(
      "caller-owned observer bytes\n",
    );
    expect(await readFile(join(directory, "request.json"), "utf8")).toBe(
      "caller-owned request bytes\n",
    );
    expect((await readSiteSourceTreeV1(input.project)).digest).toBe(input.source.digest);
    expect(containers.size).toBe(0);
  });

  it("preserves Linux symlink modes across host export without following cache targets", async () => {
    const { input, driver } = await fixture();
    await mkdir(join(input.project, "public"));
    await writeFile(join(input.project, "public/icon.svg"), "synthetic public asset\n");
    await chmod(join(input.project, driver), 0o600);
    await writeFile(
      join(input.project, driver),
      `import * as fs from "node:fs/promises";\n` +
        `await fs.mkdir("/np/project/.next/standalone/.next",{recursive:true});\n` +
        `await fs.mkdir("/np/project/.next/static",{recursive:true});\n` +
        `await fs.writeFile("/np/project/.next/standalone/server.js","synthetic server entry\\n");\n` +
        `await fs.writeFile("/np/project/.next/static/app.css","synthetic static asset\\n");\n`,
    );
    await chmod(join(input.project, driver), 0o400);
    input.source = await readSiteSourceTreeV1(input.project);
    const containers = transport(input, undefined, true);
    const exported = await withSiteBuildLinuxWorkspaceV1(input, async (workspace) => {
      await workspace.run({
        id: "build",
        argv: ["/usr/local/bin/node", `/np/project/${driver}`],
        permitted: () => false,
        timeoutMs: 10000,
      });
      return workspace.finalizeNextAndExport();
    });
    const links = exported.filter((row) => row.kind === "symlink");
    expect(links.map((row) => row.path)).toEqual([".next/cache", ".next/standalone/.next/cache"]);
    for (const row of links) {
      const path = join(input.project, row.path);
      expect((await lstat(path)).mode & 0o777).toBe(0o777);
      expect(await readlink(path)).toBe("/np/output/next-cache");
    }
    expect(
      JSON.parse(
        await readFile(join(input.project, input.auditPath, "next-artifacts.json"), "utf8"),
      ),
    ).toEqual(exported);
    expect((await readSiteSourceTreeV1(input.project)).digest).toBe(input.source.digest);
    expect(await readFile(join(input.dependencies, "owner.txt"), "utf8")).toBe(
      "separate installed Linux closure\n",
    );
    expect(containers.size).toBe(0);
  });

  it("keeps raw source distinct from the readonly Linux dependency closure and recovers only exact allowed bytes", async () => {
    const { input, driver } = await fixture();
    const manifest = await readFile(join(input.project, "package.json"));
    const lock = await readFile(join(input.project, "pnpm-lock.yaml"));
    const containers = transport(input);
    let retained: NpSiteBuildLinuxWorkspaceV1 | undefined;
    const result = await withSiteBuildLinuxWorkspaceV1(input, async (workspace) => {
      retained = workspace;
      const command = await runOwner(workspace, driver);
      expect(workspace.changedSources).toEqual(["src/entry.ts"]);
      expect(workspace.source.digest).not.toBe(input.source.digest);
      return command;
    });
    expect(await readFile(join(input.project, "src/entry.ts"), "utf8")).toBe(formatted);
    expect(await readFile(join(input.project, "package.json"))).toEqual(manifest);
    expect(await readFile(join(input.project, "pnpm-lock.yaml"))).toEqual(lock);
    expect(await readFile(join(input.dependencies, "owner.txt"), "utf8")).toBe(
      "separate installed Linux closure\n",
    );
    expect(await readFile(join(input.project, result.stdout.path), "utf8")).toBe(
      "fixed owner ran\n",
    );
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const isolated = docker.mock.calls.filter(
      ([, args]) => args[0] === "create" && !args[args.indexOf("--name") + 1].endsWith("-holder"),
    );
    for (const [, args] of isolated) {
      expect(args).toContain(`type=bind,source=${input.project},target=/np/input,readonly`);
      expect(args).toContain(
        `type=bind,source=${input.dependencies},target=/np/project/node_modules,readonly`,
      );
      expect(args).toContain("--network=none");
      expect(args).toContain("-i");
    }
    expect(containers.size).toBe(0);
    for (const [, args] of docker.mock.calls.filter(([, args]) => args[0] === "create"))
      expect(args).toContain(
        "type=bind,src=/fixture-empty-image-data,dst=/var/lib/postgresql/data,readonly",
      );
    for (const [, args] of docker.mock.calls.filter(([, args]) => args[0] === "rm"))
      expect(args).toContain("--volumes");
    if (!retained) throw new Error("missing owned workspace");
    await expect(runOwner(retained, driver)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it.each(["unlisted", "mode", "delete"] as const)(
    "rejects %s source changes before host recovery even if the callback catches failure",
    async (mutation) => {
      const { input, driver } = await fixture(mutation);
      const containers = transport(input);
      await expect(
        withSiteBuildLinuxWorkspaceV1(input, async (workspace) => {
          await expect(runOwner(workspace, driver)).rejects.toMatchObject({ reason: "conflict" });
          await expect(runOwner(workspace, driver)).rejects.toMatchObject({
            reason: "unavailable",
          });
        }),
      ).rejects.toMatchObject({ reason: "conflict" });
      expect((await readSiteSourceTreeV1(input.project)).digest).toBe(input.source.digest);
      expect(await readFile(join(input.project, "src/entry.ts"), "utf8")).toBe(original);
      expect(containers.size).toBe(0);
      expect(docker.mock.calls.some(([, args]) => args[0] === "volume" && args[1] === "rm")).toBe(
        true,
      );
    },
  );

  it.each(["volume", "holder", "builder"] as const)(
    "cleans uncertain %s create failures",
    async (failure) => {
      const { input, driver } = await fixture();
      const containers = transport(input, failure);
      await expect(
        withSiteBuildLinuxWorkspaceV1(input, (workspace) => runOwner(workspace, driver)),
      ).rejects.toMatchObject({ reason: "unavailable" });
      expect(containers.size).toBe(0);
      expect(docker.mock.calls.some(([, args]) => args[0] === "volume" && args[1] === "rm")).toBe(
        true,
      );
    },
  );

  it.each(["credentials", "control-link"] as const)(
    "rejects %s before any Docker mount",
    async (kind) => {
      const { input, driver } = await fixture();
      if (kind === "credentials")
        await writeFile(join(input.project, ".env"), "SYNTHETIC_ONLY=fixture\n");
      else {
        await rm(join(input.project, driver));
        await symlink(join(input.dependencies, "owner.txt"), join(input.project, driver));
      }
      await expect(
        withSiteBuildLinuxWorkspaceV1(input, (workspace) => runOwner(workspace, driver)),
      ).rejects.toMatchObject({ reason: kind === "credentials" ? "input" : "path" });
      expect(docker).not.toHaveBeenCalled();
    },
  );

  it("runs the trusted exact-output validator before recovering allowed changes", async () => {
    const { input, driver } = await fixture();
    const containers = transport(input);
    await expect(
      withSiteBuildLinuxWorkspaceV1(input, (workspace) =>
        workspace.run({
          id: "format",
          argv: ["/usr/local/bin/node", `/np/project/${driver}`],
          permitted: (path) => path === "src/entry.ts",
          timeoutMs: 10_000,
          validateSource: (source, exitCode) => {
            expect(exitCode).toBe(0);
            expect(source.digest).not.toBe(input.source.digest);
            throw new SiteBuildError("conflict");
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(input.project, "src/entry.ts"), "utf8")).toBe(original);
    expect((await readSiteSourceTreeV1(input.project)).digest).toBe(input.source.digest);
    expect(containers.size).toBe(0);
  });

  it("uses the existing Core ephemeral directory profile while preserving a source file named dist", async () => {
    const { input, driver } = await fixture();
    await writeFile(join(input.project, "src/dist"), "ordinary tracked file\n");
    input.source = await readSiteSourceTreeV1(input.project);
    await chmod(join(input.project, driver), 0o600);
    await writeFile(
      join(input.project, driver),
      `${await readFile(join(input.project, driver), "utf8")}\nfor(const p of ["coverage","dist",".turbo","src/coverage"]){await fs.mkdir("/np/project/"+p,{recursive:true});await fs.writeFile("/np/project/"+p+"/result.txt","ephemeral");}\n`,
    );
    transport(input);
    await withSiteBuildLinuxWorkspaceV1(input, async (workspace) => {
      await runOwner(workspace, driver);
      expect(workspace.source.manifest.files.map((file) => file.path)).toContain("src/dist");
      expect(workspace.source.manifest.files.some((file) => file.path.endsWith("result.txt"))).toBe(
        false,
      );
    });
    expect(await readFile(join(input.project, "src/dist"), "utf8")).toBe("ordinary tracked file\n");
  });

  it("detects source drift outside the owned command recovery before returning a result", async () => {
    const { input } = await fixture();
    const containers = transport(input);
    await expect(
      withSiteBuildLinuxWorkspaceV1(input, async () => {
        await writeFile(
          join(input.project, "src/entry.ts"),
          "unexpected concurrent source change\n",
        );
      }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(containers.size).toBe(0);
  });

  it("rejects stale source inventory before creating a Docker resource", async () => {
    const { input, driver } = await fixture();
    await writeFile(join(input.project, "src/entry.ts"), "changed after inventory\n");
    await expect(
      withSiteBuildLinuxWorkspaceV1(input, (workspace) => runOwner(workspace, driver)),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(docker).not.toHaveBeenCalled();
  });
});
