import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  cp,
  copyFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npRequireAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type * as DockerHost from "./docker-host.js";
import { finalizeSiteBuildLinuxBuildV1, prepareSiteBuildLinuxBuildV1 } from "./linux-build.js";
import type { NpSiteBuildPreviewConfigBuildV1 } from "./preview-config-build.js";

const runDocker = vi.hoisted(() => vi.fn());
vi.mock("./docker-host.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DockerHost>()),
  runSiteBuildDockerV1: runDocker,
  withSiteBuildDockerV1: async (
    run: (host: { endpoint: string; config: string; readOnlyData: string }) => Promise<unknown>,
  ) =>
    run({
      endpoint: "unix:///fixture.sock",
      config: "/fixture-empty-config",
      readOnlyData: "/fixture-empty-image-data",
    }),
}));
const image = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];
async function project(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-linux-project-")));
  roots.push(root);
  const path = join(root, "project");
  const files: Record<string, string> = {
    "package.json": '{"name":"fixture","version":"0.1.0","type":"module"}\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src/nexpress.config.ts": "export default {collections:[]};\n",
    "drizzle.config.ts": "export default {};\n",
    "next.config.ts": "export default {};\n",
    "tsconfig.json": '{"compilerOptions":{"jsx":"preserve"}}\n',
    "public/fixture.txt": "public bytes\n",
    "node_modules/.pnpm/cli/node_modules/@nexpress/cli/dist/site-build-loader.js": "export {};\n",
    "node_modules/next/dist/bin/next": "fixture next owner\n",
    "node_modules/drizzle-kit/bin.cjs": "fixture drizzle owner\n",
    "node_modules/.pnpm/core/node_modules/@nexpress/core/package.json":
      '{"name":"@nexpress/core"}\n',
  };
  for (const [relative, contents] of Object.entries(files)) {
    await mkdir(join(path, relative, ".."), { recursive: true });
    await writeFile(join(path, relative), contents);
  }
  await mkdir(join(path, "node_modules/@nexpress"), { recursive: true });
  await symlink(
    "../.pnpm/cli/node_modules/@nexpress/cli",
    join(path, "node_modules/@nexpress/cli"),
  );
  return path;
}
afterEach(async () => {
  runDocker.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const executeNode = promisify(execFile);
const nextFixtureOwner = dirname(
  createRequire(new URL("../../../app/package.json", import.meta.url)).resolve("next/package.json"),
);
async function nextRuntimeEntry(): Promise<string> {
  const owner = await readFile(join(nextFixtureOwner, "dist/build/utils.js"), "utf8");
  const marker = "await _fs.promises.writeFile(serverOutputPath, `${moduleType ? `";
  const start = owner.indexOf(marker);
  if (start < 0) throw new Error("missing-next-generator-fixture");
  const tail = owner.slice(start + marker.length),
    esmEnd = tail.indexOf("` : `"),
    cjsEnd = tail.indexOf("`}", esmEnd + 5);
  const common = tail
    .slice(cjsEnd + 2)
    .split("`);", 1)[0]
    .split("${JSON.stringify(nextConfig)}");
  if (common.length !== 2) throw new Error("ambiguous-next-generator-fixture");
  return (
    tail.slice(esmEnd + 5, cjsEnd) +
    common[0] +
    JSON.stringify({
      distDir: "./.next",
      experimental: { isrFlushToDisk: true },
      output: "standalone",
    }) +
    common[1]
  );
}
async function installedPreviewPackages(path: string) {
  const names = [
    "@nexpress/app",
    "@nexpress/blocks",
    "@nexpress/cli",
    "@nexpress/core",
    "@nexpress/theme",
    "react",
    "react-dom",
    "next",
  ];
  await writeFile(
    join(path, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "0.1.0", type: "module", dependencies: Object.fromEntries(names.map((name) => [name, "0.4.6"])) })}\n`,
  );
  for (const name of names) {
    const root = join(path, "node_modules", name);
    await mkdir(join(root, "dist"), { recursive: true });
    const version =
      name === "next"
        ? (
            JSON.parse(await readFile(join(nextFixtureOwner, "package.json"), "utf8")) as {
              version: string;
            }
          ).version
        : "0.4.6";
    await writeFile(join(root, "package.json"), `${JSON.stringify({ name, version })}\n`);
    await writeFile(join(root, "dist/index.js"), `// private prepared package fixture ${name}\n`);
    if (name === "next")
      for (const file of [
        "dist/build/utils.js",
        "dist/server/config-schema.js",
        "dist/server/next-server.js",
        "dist/server/lib/incremental-cache/file-system-cache.js",
      ]) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await copyFile(join(nextFixtureOwner, file), join(root, file));
      }
  }
}

async function fixturePreviewCarrier(
  path: string,
  volume: string,
  command: string[],
  relative: string,
  corruption?: "result" | "driver" | "manifest" | "extra" | "config",
) {
  // Command/output double only. Actual readonly observer/export code still runs;
  // these generated bytes are never evidence that Next, Linux or this carrier ran.
  const program = await readFile(join(path, relative));
  const first = program.toString("utf8").split("\n")[0];
  const input = JSON.parse(first.slice("const input=".length, -1)) as {
    prefix: {
      preparation: NpSiteBuildPreviewConfigBuildV1["evidence"];
      helperArgv: string[];
      carrierPath: string;
    };
    expectedResult: Record<string, unknown>;
    resultPath: string;
  };
  const evidence = input.prefix.preparation;
  for (const file of [
    evidence.original.path,
    evidence.wrapper.path,
    evidence.renderer.path,
    evidence.driver.path,
    relative,
  ])
    expect(command).toContain(
      `type=bind,source=${join(path, file)},target=/np/project/${file},readonly`,
    );
  expect(input.prefix.helperArgv).toEqual([
    "/usr/local/bin/node",
    `/np/project/${evidence.driver.path}`,
  ]);
  const files = new Map<string, Buffer>();
  for (const [name, record] of [
    ["original.ts", evidence.original],
    ["wrapper.ts", evidence.wrapper],
    ["renderer.json", evidence.renderer],
    ["driver.mjs", evidence.driver],
  ] as const)
    files.set(name, await readFile(join(path, record.path)));
  files.set("carrier.mjs", program);
  files.set(
    "result.json",
    Buffer.from(
      `${JSON.stringify({ ...input.expectedResult, ...(corruption === "result" ? { originalRestored: false } : {}) })}\n`,
    ),
  );
  if (corruption === "driver") files.set("driver.mjs", Buffer.from("tampered driver\n"));
  const runtime = ".next/np-build-preview-config";
  await mkdir(join(volume, runtime), { mode: 0o700 });
  const rows = [...files].map(([name, bytes]) => ({
    path: `${runtime}/${name}`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  files.set(
    "manifest.json",
    Buffer.from(
      `${JSON.stringify({ ...input.prefix, files: rows, ...(corruption === "manifest" ? { unsupportedClaim: true } : {}) })}\n`,
    ),
  );
  for (const [name, bytes] of files)
    await writeFile(join(volume, runtime, name), bytes, { flag: "wx", mode: 0o400 });
  if (corruption === "extra")
    await writeFile(join(volume, runtime, "undeclared.txt"), "extra private file\n");
  if (corruption === "config")
    await writeFile(join(volume, evidence.configPath), "leftover wrapper\n");
}
function fakeBuild(
  path: string,
  options: {
    extraWrite?: boolean;
    schemaFailure?: boolean;
    unsafeArtifact?: boolean;
    oversizedArtifact?: boolean;
    largeArtifact?: boolean;
    badQuota?: "bytes" | "inodes";
    exportCorruption?: boolean;
    timeout?: boolean;
    previewCorruption?: "result" | "driver" | "manifest" | "extra" | "config";
    packageChange?: boolean;
    runtimeCorruption?: "entry" | "required";
  } = {},
): { exportSizes: number[] } {
  const containers = new Map<string, string[]>();
  const exportSizes: number[] = [];
  let volume: string;
  let dependenciesMirrored = false;
  runDocker.mockImplementation(async (_host: unknown, argv: string[]) => {
    const ok = (stdout = Buffer.alloc(0)) => ({ code: 0, stdout, stderr: Buffer.alloc(0) });
    if (argv[0] === "volume" && argv[1] === "create") {
      volume = await realpath(await mkdtemp(join(tmpdir(), "np-build-volume-fixture-")));
      roots.push(volume);
      return ok();
    }
    if (argv[0] === "volume" && argv[1] === "rm") return ok();
    if (argv[0] === "create") {
      containers.set(argv[argv.indexOf("--name") + 1], argv);
      return ok();
    }
    if (argv[0] === "rm") {
      containers.delete(argv.at(-1) ?? "");
      return ok();
    }
    if (argv[0] !== "start") throw new Error("unexpected transport fixture");
    const name = argv.at(-1) ?? "";
    const command = containers.get(name);
    if (!command) throw new Error("unowned fixture container");
    if (name.endsWith("-holder")) return ok();
    if (name.includes("-observer-")) {
      expect([...containers.keys()].some((key) => key.includes("-builder-"))).toBe(false);
      if (
        command.includes(
          `type=bind,source=${join(path, "node_modules")},target=/np/project/node_modules,readonly`,
        ) &&
        !dependenciesMirrored
      ) {
        // Simulate the readonly dependency bind at its logical volume path. A
        // symlink to the host directory would change realpath semantics.
        await cp(join(path, "node_modules"), join(volume, "node_modules"), {
          recursive: true,
          verbatimSymlinks: true,
        });
        dependenciesMirrored = true;
      }
      const mount = command.find((value) => value.endsWith("target=/np/control,readonly"));
      if (!mount) throw new Error("missing trusted observer control");
      const control = mount.slice(
        "type=bind,source=".length,
        -",target=/np/control,readonly".length,
      );
      const original = await readFile(join(control, "observer.mjs"), "utf8");
      // APFS is not tmpfs: only the kernel statfs observation is simulated. The
      // actual fixed builtin-only observer, binary exporter and bounds run in Node.
      const quota = `const quota={type:16914836n,bsize:4096n,blocks:${options.badQuota === "bytes" ? "1048577" : "1048576"}n,files:${options.badQuota === "inodes" ? "131073" : "131072"}n};`;
      if (command.at(-1) === "export") {
        const request = JSON.parse(await readFile(join(control, "request.json"), "utf8")) as {
          parts: Array<{ bytes: number }>;
        };
        exportSizes.push(request.parts.reduce((sum, part) => sum + part.bytes, 0));
      }
      const script = original
        .replace("const quota=await fs.statfs(root,{bigint:true});", quota)
        .replaceAll("'/np/project'", JSON.stringify(volume))
        .replaceAll("'/np/input'", JSON.stringify(path))
        .replaceAll("'/np/control'", JSON.stringify(control));
      const executable = join(control, "observer-test.mjs");
      await writeFile(executable, script);
      try {
        const result = await executeNode(process.execPath, [executable, command.at(-1) ?? ""], {
          encoding: "buffer",
          maxBuffer: 17 * 1024 * 1024,
          timeout: 10_000,
        });
        const bytes = Buffer.from(result.stdout);
        if (options.exportCorruption && command.at(-1) === "export" && bytes.length) bytes[0] ^= 1;
        return ok(bytes);
      } catch {
        return {
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("bounded observer rejected fixture"),
        };
      }
    }
    if (options.timeout) throw new SiteBuildError("unavailable");
    if (command.some((value) => value.endsWith("/schema.mjs"))) {
      if (options.schemaFailure)
        return {
          code: 1,
          stdout: Buffer.from("synthetic command failure"),
          stderr: Buffer.from("synthetic detail"),
        };
      await mkdir(join(volume, "src/db/generated"), { recursive: true });
      for (const name of ["collections", "documents"])
        await writeFile(join(volume, `src/db/generated/${name}.ts`), `// generated ${name}\n`);
    } else if (command.some((value) => value.endsWith("/migrations.mjs"))) {
      await mkdir(join(volume, "drizzle/meta"), { recursive: true });
      await writeFile(
        join(volume, "drizzle/0000_fixture.sql"),
        "CREATE TABLE fixture(id integer);\n",
      );
      await writeFile(
        join(volume, "drizzle/meta/_journal.json"),
        '{"entries":[{"tag":"0000_fixture"}]}\n',
      );
      await writeFile(join(volume, "drizzle/meta/0000_snapshot.json"), "{}\n");
    } else if (
      (command.includes("/np/project/node_modules/next/dist/bin/next") &&
        command.includes("build")) ||
      command.some((value) => value.endsWith("/preview-build.mjs"))
    ) {
      await mkdir(join(volume, ".next/standalone/.next"), { recursive: true });
      await mkdir(join(volume, ".next/static"), { recursive: true });
      await mkdir(join(volume, ".next/node_modules/@nexpress"), { recursive: true });
      await symlink(
        "../../../node_modules/.pnpm/core/node_modules/@nexpress/core",
        join(volume, ".next/node_modules/@nexpress/core-fixture"),
      );
      await writeFile(
        join(volume, ".next/standalone/server.js"),
        (await nextRuntimeEntry()) +
          (options.runtimeCorruption === "entry" ? "\n// unsupported custom startup\n" : ""),
      );
      await writeFile(
        join(volume, ".next/required-server-files.json"),
        JSON.stringify({
          version: 1,
          config: {
            distDir: ".next",
            experimental: { isrFlushToDisk: true },
            output: options.runtimeCorruption === "required" ? "other" : "standalone",
          },
          files: [],
        }),
      );
      await writeFile(join(volume, ".next/static/fixture.js"), "// static bytes\n");
      await writeFile(join(volume, ".next/BUILD_ID"), "fixture-build\n");
      await writeFile(join(volume, "next-env.d.ts"), "// generated next owner\n");
      await writeFile(join(volume, "tsconfig.json"), '{"compilerOptions":{"jsx":"react-jsx"}}\n');
      if (options.extraWrite) await writeFile(join(volume, "src/unplanned.ts"), "unplanned\n");
      if (options.unsafeArtifact) await symlink("/etc/passwd", join(volume, ".next/escape"));
      if (options.oversizedArtifact) {
        const file = await open(join(volume, ".next/oversized"), "wx");
        await file.truncate(256 * 1024 * 1024 + 1);
        await file.close();
      }
      if (options.largeArtifact)
        await writeFile(join(volume, ".next/large"), Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
      const carrier = command.find((value) => value.endsWith("/preview-build.mjs"));
      if (carrier)
        await fixturePreviewCarrier(
          path,
          volume,
          command,
          carrier.slice("/np/project/".length),
          options.previewCorruption,
        );
      if (options.packageChange)
        await writeFile(
          join(path, "node_modules/@nexpress/core/dist/index.js"),
          "operator changed package\n",
        );
    } else throw new Error("unexpected command fixture");
    return { code: 0, stdout: Buffer.from("actual fixture stdout\n"), stderr: Buffer.alloc(0) };
  });
  return { exportSizes };
}

describe("private Linux build preparation boundaries", () => {
  it.each(["entry", "required"] as const)(
    "rejects an unsupported Next runtime %s before private derivation publication",
    async (runtimeCorruption) => {
      const path = await project();
      await installedPreviewPackages(path);
      const original = await readFile(join(path, "src/nexpress.config.ts"));
      fakeBuild(path, { runtimeCorruption });
      await expect(
        prepareSiteBuildLinuxBuildV1({
          project: path,
          baseImageId: image,
          previewConfig: "forum-build-preview-analytics-only",
        }),
      ).rejects.toMatchObject({ reason: "unavailable" });
      expect(await readFile(join(path, "src/nexpress.config.ts"))).toEqual(original);
      expect(await readFile(join(path, "next.config.ts"), "utf8")).toBe("export default {};\n");
      expect(await readdir(join(path, ".next"))).not.toContain("np-build-next-preview-runtime");
      for (const directory of await readdir(join(path, ".nexpress/site/audit")))
        expect(await readdir(join(path, ".nexpress/site/audit", directory))).not.toContain(
          "receipt.json",
        );
    },
    15_000,
  );

  it("binds a private preview derivation to pre-command source, actual package bytes and restored final source", async () => {
    const path = await project();
    await installedPreviewPackages(path);
    await mkdir(join(path, ".nexpress/site"), { recursive: true });
    await writeFile(
      join(path, ".nexpress/site/blueprint.json"),
      '{"futurePreviewHash":"proposal"}\n',
    );
    const original = await readFile(join(path, "src/nexpress.config.ts"));
    fakeBuild(path);
    const receipt = await prepareSiteBuildLinuxBuildV1({
      project: path,
      baseImageId: image,
      previewConfig: "forum-build-preview-analytics-only",
    });
    const preview = receipt.previewConfig;
    expect(preview).toMatchObject({
      scope: "forum-build-preview-analytics-only",
      rendererStage: "pre-command-source-and-prepared-linux-packages",
      compiledConfig: "explicit-private-harness-derivation",
      rawPreCommandSourceDigest: receipt.sourceBefore.digest,
      finalSourceDigest: receipt.sourceAfter.digest,
      originalConfigRestored: true,
      observation: "after-builder-removal",
    });
    if (!preview) throw new Error("Missing preview fixture receipt");
    expect(preview.preCommandSourceDigest).not.toBe(preview.finalSourceDigest);
    const renderer = npRequireAgentBuildDirectionRendererV1(
      JSON.parse(await readFile(join(path, ".next/np-build-preview-config/renderer.json"), "utf8")),
    );
    expect(renderer.projectSources).toEqual({
      ...receipt.sourceBefore.manifest,
      files: receipt.sourceBefore.manifest.files.filter(
        (file) => !file.path.startsWith(".nexpress/site/"),
      ),
    });
    expect(preview.preCommandSourceDigest).toBe(
      await npBuildCanonicalDigest("np.build-source-tree.v1", renderer.projectSources),
    );
    expect(preview.preCommandSourceDigest).not.toBe(preview.rawPreCommandSourceDigest);
    expect(
      JSON.parse(await readFile(join(path, ".next/np-build-preview-config/manifest.json"), "utf8"))
        .preCommandSourceDigest,
    ).toBe(preview.preCommandSourceDigest);
    expect(renderer.projectSources).not.toEqual(receipt.sourceAfter.manifest);
    expect(preview.preCommandRendererDigest).toBe(
      await npBuildCanonicalDigest("np.build-direction-renderer.v1", renderer),
    );
    expect(renderer.packages.map((entry) => entry.name)).toContain("@nexpress/core");
    const controls = preview.carrier.path.slice(0, -"/preview-build.mjs".length);
    expect(preview.preparation.renderer.path.startsWith(`${controls}/preview-config-build-`)).toBe(
      true,
    );
    expect(preview.runtimeArtifacts).toHaveLength(7);
    expect(receipt.nextPreviewRuntime).toMatchObject({
      scope: "private-preview-next-isr-flush-to-disk-false",
      status: "written",
      setting: { original: true, derived: false },
      nativeVerification: "required-separately",
      originalSource: "unchanged-required-by-caller",
    });
    expect(receipt.nextPreviewRuntime?.evidence).toHaveLength(4);
    for (const file of receipt.nextPreviewRuntime?.evidence ?? [])
      expect(receipt.artifacts.find((item) => item.path === file.path)).toMatchObject({
        kind: "file",
        bytes: file.bytes,
        sha256: file.sha256,
      });
    expect(await readFile(join(path, "next.config.ts"), "utf8")).toBe("export default {};\n");
    expect(await readFile(join(path, ".next/standalone/server.js"), "utf8")).toContain(
      '"isrFlushToDisk":false',
    );
    expect(
      preview.runtimeArtifacts.every(
        (file) => file.kind === "file" && file.path.startsWith(".next/np-build-preview-config/"),
      ),
    ).toBe(true);
    expect(preview.runtimeManifestSha256).toBe(
      createHash("sha256")
        .update(await readFile(join(path, ".next/np-build-preview-config/manifest.json")))
        .digest("hex"),
    );
    expect(await readFile(join(path, "src/nexpress.config.ts"))).toEqual(original);
    expect(receipt.commands[2].argv.at(-1)).toBe(`/np/project/${preview.carrier.path}`);
    // Run a namespace-derived carrier + helper with a fake fixed Next child.
    // This checks real helper filesystem/restore behavior, never Next/Linux proof.
    const fixtureRoot = await realpath(
      await mkdtemp(join(tmpdir(), "np-preview-carrier-fixture-")),
    );
    roots.push(fixtureRoot);
    const fixtureProject = join(fixtureRoot, "project");
    await cp(path, fixtureProject, { recursive: true, verbatimSymlinks: true });
    await rm(join(fixtureProject, ".next"), { recursive: true });
    const helperPath = join(fixtureProject, preview.preparation.driver.path);
    const helperProgram = (await readFile(helperPath, "utf8"))
      .replace(
        'const project = "/np/project";',
        `const project = ${JSON.stringify(fixtureProject)};`,
      )
      .replace(
        'const executable = "/usr/local/bin/node";',
        `const executable = ${JSON.stringify(process.execPath)};`,
      );
    await chmod(helperPath, 0o600);
    await writeFile(helperPath, helperProgram);
    const carrierPath = join(fixtureProject, preview.carrier.path);
    const carrierProgram = await readFile(carrierPath, "utf8"),
      firstLine = carrierProgram.split("\n")[0];
    const input = JSON.parse(firstLine.slice("const input=".length, -1)) as {
      prefix: { preparation: NpSiteBuildPreviewConfigBuildV1["evidence"]; helperArgv: string[] };
      expectedResult: { driver: { path: string; bytes: number; sha256: string } };
    };
    input.prefix.preparation.driver.bytes = Buffer.byteLength(helperProgram);
    input.prefix.preparation.driver.sha256 = createHash("sha256")
      .update(helperProgram)
      .digest("hex");
    input.prefix.preparation.driver.fileDigest = await npBuildFileDigest(
      "np.build-verification-artifact.v1",
      Buffer.from(helperProgram),
    );
    input.prefix.helperArgv = [process.execPath, helperPath];
    input.expectedResult.driver = {
      path: preview.preparation.driver.path,
      bytes: Buffer.byteLength(helperProgram),
      sha256: input.prefix.preparation.driver.sha256,
    };
    const derivedCarrier = `const input=${JSON.stringify(input)};\n${carrierProgram.slice(firstLine.length + 1).replace("const project='/np/project',root=", `const project=${JSON.stringify(fixtureProject)},root=`)}`;
    await chmod(carrierPath, 0o600);
    await writeFile(carrierPath, derivedCarrier);
    await writeFile(
      join(fixtureProject, "node_modules/next/package.json"),
      '{"type":"commonjs"}\n',
    );
    await writeFile(
      join(fixtureProject, "node_modules/next/dist/bin/next"),
      "const fs=require('node:fs');if(!fs.readFileSync('src/nexpress.config.ts','utf8').includes('__npBuildPreviewDerived')||process.argv.slice(2).join(',')!=='build')process.exit(23);fs.mkdirSync('.next');\n",
    );
    await executeNode(process.execPath, [carrierPath], {
      env: {},
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    expect(await readFile(join(fixtureProject, "src/nexpress.config.ts"))).toEqual(original);
    expect(
      await readFile(join(fixtureProject, ".next/np-build-preview-config/carrier.mjs"), "utf8"),
    ).toBe(derivedCarrier);
    expect(
      await readFile(join(fixtureProject, ".next/np-build-preview-config/driver.mjs"), "utf8"),
    ).toBe(helperProgram);
    expect(await readdir(join(fixtureProject, ".next/np-build-preview-config"))).toHaveLength(7);
    const calls = runDocker.mock.calls.length;
    await expect(finalizeSiteBuildLinuxBuildV1(receipt)).rejects.toMatchObject({ reason: "input" });
    expect(runDocker.mock.calls).toHaveLength(calls);
  }, 15_000);

  it.each(["result", "driver", "manifest", "extra", "config"] as const)(
    "rejects %s carrier corruption without publishing a receipt or rewriting source",
    async (previewCorruption) => {
      const path = await project();
      await installedPreviewPackages(path);
      const original = await readFile(join(path, "src/nexpress.config.ts"));
      fakeBuild(path, { previewCorruption });
      await expect(
        prepareSiteBuildLinuxBuildV1({
          project: path,
          baseImageId: image,
          previewConfig: "forum-build-preview-analytics-only",
        }),
      ).rejects.toBeInstanceOf(SiteBuildError);
      expect(await readFile(join(path, "src/nexpress.config.ts"))).toEqual(original);
      const [audit] = await readdir(join(path, ".nexpress/site/audit"));
      expect(await readdir(join(path, ".nexpress/site/audit", audit))).not.toContain(
        "receipt.json",
      );
    },
    15_000,
  );

  it("fails closed on a changed installed package lease or noncanonical config mode", async () => {
    const path = await project();
    await installedPreviewPackages(path);
    fakeBuild(path, { packageChange: true });
    await expect(
      prepareSiteBuildLinuxBuildV1({
        project: path,
        baseImageId: image,
        previewConfig: "forum-build-preview-analytics-only",
      }),
    ).rejects.toBeInstanceOf(SiteBuildError);
    runDocker.mockReset();
    const other = await project();
    await installedPreviewPackages(other);
    await chmod(join(other, "src/nexpress.config.ts"), 0o600);
    await expect(
      prepareSiteBuildLinuxBuildV1({
        project: other,
        baseImageId: image,
        previewConfig: "forum-build-preview-analytics-only",
      }),
    ).rejects.toMatchObject({ reason: "input" });
    expect(runDocker).not.toHaveBeenCalled();
    expect((await lstat(join(other, "src/nexpress.config.ts"))).mode & 0o777).toBe(0o600);
  }, 15_000);

  it("runs exact owners without shell/package scripts, preserves inputs and binds copied standalone artifacts", async () => {
    const path = await project();
    const lock = await readFile(join(path, "pnpm-lock.yaml"));
    const manifest = await readFile(join(path, "package.json"));
    fakeBuild(path);
    const receipt = await prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image });
    expect(receipt.commands.map((command) => command.id)).toEqual([
      "schema-generate",
      "migration-generate",
      "next-build",
    ]);
    expect(receipt.migrations).toBe("generated-private-baseline");
    expect(receipt.buildId).toBe("fixture-build");
    expect(receipt.migrationOwner).toBe(
      "@nexpress/app/scripts/generate-migrations-core.generateMigrations",
    );
    expect(receipt.boundedPreparation).toMatchObject({
      profile: "np.site-build-linux-build-tmpfs.v1",
      volumeBytes: 4 * 1024 * 1024 * 1024,
      volumeInodes: 131072,
      observation: "after-builder-removal",
    });
    const volumeCreate = runDocker.mock.calls.find(
      ([, args]) => args[0] === "volume" && args[1] === "create",
    );
    expect(volumeCreate?.[1]).toContain("o=size=4294967296,nr_inodes=131072,mode=0700");
    expect(receipt.runtimeCache.mappings).toEqual([
      { path: ".next/cache", target: "/np/output/next-cache" },
      { path: ".next/standalone/.next/cache", target: "/np/output/next-cache" },
    ]);
    expect(receipt.artifacts.map((file) => file.path)).toContain(
      ".next/standalone/public/fixture.txt",
    );
    expect(receipt.artifacts.map((file) => file.path)).toContain(
      ".next/standalone/.next/static/fixture.js",
    );
    expect(
      receipt.artifacts.find((file) => file.path === ".next/node_modules/@nexpress/core-fixture"),
    ).toMatchObject({
      kind: "symlink",
      target: "../../../node_modules/.pnpm/core/node_modules/@nexpress/core",
    });
    expect(await readFile(join(path, "pnpm-lock.yaml"))).toEqual(lock);
    expect(await readFile(join(path, "package.json"))).toEqual(manifest);
    const runs = runDocker.mock.calls.filter(
      ([, args]) => args[0] === "create" && args[args.indexOf("--name") + 1].includes("-builder-"),
    );
    expect(runs).toHaveLength(3);
    for (const [, args] of runDocker.mock.calls.filter(([, args]) => args[0] === "create")) {
      expect(args).toContain(
        "type=bind,src=/fixture-empty-image-data,dst=/var/lib/postgresql/data,readonly",
      );
    }
    for (const [, args] of runs) {
      expect(args).toEqual(
        expect.arrayContaining([
          "--network=none",
          "--pull=never",
          "--read-only",
          "--cpus=2",
          "--memory=4g",
          "-i",
        ]),
      );
      expect(args).not.toContain("sh");
      expect(args).not.toContain("pnpm");
      expect(args).not.toContain("npm");
      expect(args.some((value: string) => value.includes("/node_modules,readonly"))).toBe(true);
      expect(args).toContain(`type=bind,source=${path},target=/np/input,readonly`);
      expect(args).not.toContain(`type=bind,source=${path},target=/np/project`);
    }
    for (const command of receipt.commands) {
      expect(command.durationMs).toBeGreaterThanOrEqual(0);
      expect(new Date(command.finishedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(command.startedAt).getTime(),
      );
      expect(await readFile(join(path, command.stdout.path), "utf8")).toBe(
        "actual fixture stdout\n",
      );
      expect(command.stdout.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("preserves existing migration evidence and rejects any other source write", async () => {
    const path = await project();
    await mkdir(join(path, "drizzle/meta"), { recursive: true });
    await writeFile(join(path, "drizzle/0000_existing.sql"), "existing reviewed SQL\n");
    await writeFile(join(path, "drizzle/meta/_journal.json"), "{}\n");
    fakeBuild(path, { extraWrite: true });
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(
      runDocker.mock.calls.filter(([, args]) =>
        args.some((value: string) => value.endsWith("/migrations.mjs")),
      ),
    ).toHaveLength(1);
    expect(await readFile(join(path, "drizzle/0000_existing.sql"), "utf8")).toBe(
      "existing reviewed SQL\n",
    );
  });

  it("rejects credentials, existing build output and mutable image tags before Docker", async () => {
    const path = await project();
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: "node:latest" }),
    ).rejects.toBeInstanceOf(SiteBuildError);
    await writeFile(join(path, ".env"), "SYNTHETIC_ONLY=fixture\n");
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "input" });
    await rm(join(path, ".env"));
    await mkdir(join(path, ".next"));
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(runDocker).not.toHaveBeenCalled();
  });

  it("retains real bounded failed-command logs while returning a fixed safe error", async () => {
    const path = await project();
    fakeBuild(path, { schemaFailure: true });
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "input", message: "input" });
    const [audit] = await readdir(join(path, ".nexpress/site/audit"));
    expect(
      await readFile(
        join(path, ".nexpress/site/audit", audit, "schema-generate.stderr.log"),
        "utf8",
      ),
    ).toBe("synthetic detail");
    expect(
      runDocker.mock.calls.filter(
        ([, args]) => args[0] === "rm" && args.at(-1)?.includes("-builder-"),
      ),
    ).toHaveLength(1);
  });

  it("finalizes only matching source/artifact/log receipts without repeating Next", async () => {
    const path = await project();
    fakeBuild(path);
    const before = await prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image });
    const after = await finalizeSiteBuildLinuxBuildV1(before);
    expect(after.boundedPreparation).toBeUndefined();
    expect(after.buildId).toBe(before.buildId);
    expect(after.artifactManifestSha256).toBe(before.artifactManifestSha256);
    expect(after.commands).toHaveLength(4);
    expect(
      runDocker.mock.calls.filter(([, args]) => args[0] === "create" && args.includes("build")),
    ).toHaveLength(1);
    const calls = runDocker.mock.calls.length;
    await writeFile(join(path, ".next/static/fixture.js"), "artifact was changed\n");
    await expect(finalizeSiteBuildLinuxBuildV1(after)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(runDocker.mock.calls).toHaveLength(calls);
    await writeFile(join(path, ".next/static/fixture.js"), "// static bytes\n");
    await writeFile(join(path, after.commands[0].stdout.path), "log was changed\n");
    await expect(finalizeSiteBuildLinuxBuildV1(after)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(runDocker.mock.calls).toHaveLength(calls);
  });

  it.each(["bytes", "inodes"] as const)(
    "rejects an observed tmpfs %s quota mismatch and removes all resources",
    async (badQuota) => {
      const path = await project();
      fakeBuild(path, { badQuota });
      await expect(
        prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
      ).rejects.toMatchObject({ reason: "input" });
      expect(
        runDocker.mock.calls.some(([, args]) => args[0] === "create" && args.includes("build")),
      ).toBe(false);
      expect(
        runDocker.mock.calls.some(
          ([, args]) => args[0] === "rm" && args.at(-1)?.endsWith("-holder"),
        ),
      ).toBe(true);
      expect(
        runDocker.mock.calls.some(([, args]) => args[0] === "volume" && args[1] === "rm"),
      ).toBe(true);
    },
  );

  it.each(["unsafeArtifact", "oversizedArtifact"] as const)(
    "rejects %s before exporting Next output to the host",
    async (option) => {
      const path = await project();
      fakeBuild(path, { [option]: true });
      await expect(
        prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
      ).rejects.toMatchObject({ reason: "input" });
      expect(await readdir(path)).not.toContain(".next");
      expect(
        runDocker.mock.calls.some(([, args]) => args[0] === "volume" && args[1] === "rm"),
      ).toBe(true);
    },
  );

  it("rejects oversized initial source without Docker and detects corrupted fixed binary exports", async () => {
    const path = await project();
    const file = await open(join(path, "source-too-large.bin"), "wx");
    await file.truncate(64 * 1024 * 1024 + 1);
    await file.close();
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "input" });
    expect(runDocker).not.toHaveBeenCalled();
    await rm(join(path, "source-too-large.bin"));
    fakeBuild(path, { exportCorruption: true });
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "conflict" });
    expect(runDocker.mock.calls.some(([, args]) => args[0] === "volume" && args[1] === "rm")).toBe(
      true,
    );
  });

  it("exports a larger artifact in bounded 4MiB binary batches and removes timed-out builders", async () => {
    const path = await project();
    const transport = fakeBuild(path, { largeArtifact: true });
    const receipt = await prepareSiteBuildLinuxBuildV1({ project: path, baseImageId: image });
    expect(transport.exportSizes).toContain(4 * 1024 * 1024);
    expect(transport.exportSizes.every((bytes) => bytes <= 4 * 1024 * 1024)).toBe(true);
    expect(receipt.artifacts.find((row) => row.path === ".next/large")?.bytes).toBe(
      4 * 1024 * 1024 + 1,
    );
    const timeoutPath = await project();
    runDocker.mockReset();
    fakeBuild(timeoutPath, { timeout: true });
    await expect(
      prepareSiteBuildLinuxBuildV1({ project: timeoutPath, baseImageId: image }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(
      runDocker.mock.calls.some(
        ([, args]) => args[0] === "rm" && args.at(-1)?.includes("-builder-"),
      ),
    ).toBe(true);
    expect(runDocker.mock.calls.some(([, args]) => args[0] === "volume" && args[1] === "rm")).toBe(
      true,
    );
  });
});
