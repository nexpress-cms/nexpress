import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { npBuildFileDigest } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  createSiteBuildPreviewConfigWrapperV1,
  prepareSiteBuildPreviewConfigBuildV1,
  type NpSiteBuildPreviewConfigBuildV1,
} from "./preview-config-build.js";

const directory = `.nexpress/site/tmp/preview-config-build-${"a".repeat(8)}-aaaa-4aaa-8aaa-${"a".repeat(12)}`;
const source =
  'import {defineConfig} from "./relative-owner.js";\n// preserved source\nexport const label = "합성";\nexport default defineConfig({collections:[]});\n// preserved tail\n';
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
  ].map((name) => ({ name, version: "0.4.6", contentDigest: `npkg1:sha256:${"A".repeat(43)}` })),
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(
  configPath: "nexpress.config.ts" | "src/nexpress.config.ts" = "src/nexpress.config.ts",
  rootPrefix = "np-linux-project-",
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), rootPrefix)));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(dirname(join(project, configPath)), { recursive: true });
  await writeFile(join(project, configPath), source, { mode: 0o640 });
  await mkdir(join(project, "node_modules/next/dist/bin"), { recursive: true });
  await writeFile(join(project, "node_modules/next/package.json"), '{"type":"commonjs"}\n');
  const input = { scope: "private-build-copy" as const, project, configPath, renderer };
  return { root, project, input };
}
async function absent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => false,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return true;
    },
  );
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const execute = promisify(execFile);
async function derivedFixtureDriver(project: string, plan: NpSiteBuildPreviewConfigBuildV1) {
  const path = join(project, plan.evidence.driver.path);
  const original = await readFile(path, "utf8");
  // Namespace/executable derivation for helper lifecycle semantics ONLY. These
  // changed bytes do not prove the production driver, real Next or Linux ran.
  expect(original.match(/const project = "\/np\/project";/gu)).toHaveLength(1);
  expect(original.match(/const executable = "\/usr\/local\/bin\/node";/gu)).toHaveLength(1);
  const script = original
    .replace('const project = "/np/project";', `const project = ${JSON.stringify(project)};`)
    .replace(
      'const executable = "/usr/local/bin/node";',
      `const executable = ${JSON.stringify(process.execPath)};`,
    );
  await chmod(path, 0o600);
  await writeFile(path, script);
  return { path, bytes: Buffer.from(script) };
}
async function fakeNext(project: string, extra = "") {
  await writeFile(
    join(project, "node_modules/next/dist/bin/next"),
    `const fs=require('node:fs'),path=require('node:path');
const project=process.cwd(),control=path.dirname(process.env.HOME),config=path.join(project,'src/nexpress.config.ts');
const wrapped=fs.readFileSync(config,'utf8').includes('__npBuildPreviewDerived');
fs.writeFileSync(path.join(control,'observed.json'),JSON.stringify({wrapped,argv:process.argv.slice(2),safe:process.env.UNTRUSTED_PREVIEW_TEST===undefined&&process.env.NODE_OPTIONS===undefined&&process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY===undefined&&process.env.TRACE_ID===undefined&&process.env.NEXT_TELEMETRY_DISABLED==='1'}));
if(!wrapped)process.exit(21);
${extra}\n`,
  );
}
async function runDriver(path: string): Promise<number> {
  try {
    await execute(process.execPath, [path], {
      env: {
        UNTRUSTED_PREVIEW_TEST: "synthetic-do-not-forward",
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "ambient-do-not-forward",
        TRACE_ID: "ambient-do-not-forward",
      },
      timeout: 10_000,
      maxBuffer: 32 * 1024,
      encoding: "utf8",
    });
    return 0;
  } catch (error) {
    if (!(error instanceof Error) || typeof Reflect.get(error, "code") !== "number") throw error;
    return Reflect.get(error, "code") as number;
  }
}

describe("private analytics-only preview build preparation", () => {
  it("changes only the ordinary default export while preserving relative imports and source tail", () => {
    for (const configPath of ["nexpress.config.ts", "src/nexpress.config.ts"] as const) {
      const wrapper = createSiteBuildPreviewConfigWrapperV1({ source, directory, configPath });
      expect(wrapper).toContain('import {defineConfig} from "./relative-owner.js";');
      expect(wrapper).toContain('export const label = "합성";');
      expect(wrapper).toContain(
        "const __npBuildPreviewOriginalConfig = (defineConfig({collections:[]}));",
      );
      expect(wrapper).toContain("// preserved tail\n");
      expect(wrapper).toContain(
        `from "${configPath.startsWith("src/") ? "../" : "./"}${directory}/renderer.json";`,
      );
      expect(wrapper).toContain("await __npBuildPreviewDerive(");
      expect(wrapper).toContain("__npBuildPreviewBindings()");
    }
    expect(
      createSiteBuildPreviewConfigWrapperV1({
        source: 'export default (()=>{throw Error("never execute source on host");})();',
        directory,
        configPath: "nexpress.config.ts",
      }),
    ).toContain('throw Error("never execute source on host")');
  });

  it("rejects unsupported exports, malformed syntax, reserved bindings and unbounded source", () => {
    for (const invalid of [
      "export = {};",
      'export {default} from "./other.js";',
      "const config={};export {config as default};",
      'export * from "./other.js";export default {};',
      "export default function config(){}",
      "export default class Config{}",
      "export default {};export default {};",
      "const __npBuildPreviewOriginalConfig={};export default {};",
      "const \\u005f_npBuildPreviewDerived={};export default {};",
      "export default { broken: ;",
      `export default "${"x".repeat(1024 * 1024)}";`,
    ])
      expect(() =>
        createSiteBuildPreviewConfigWrapperV1({
          source: invalid,
          directory,
          configPath: "src/nexpress.config.ts",
        }),
      ).toThrow(SiteBuildError);
  });

  it.each(["np-linux-project-", "np-private-edit-plan-"])(
    "prepares exact byte/digest evidence without evaluating or writing the original config (%s)",
    async (rootPrefix) => {
      const { project, input } = await fixture("src/nexpress.config.ts", rootPrefix);
      const original = await readFile(join(project, input.configPath));
      const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
      expect(plan.scope).toBe("private-build-preview-config");
      expect(plan.argv).toEqual([
        "/usr/local/bin/node",
        `/np/project/${plan.evidence.driver.path}`,
      ]);
      expect(plan.files).toHaveLength(4);
      expect(plan.evidence.requiresPostBuilderSourceObservation).toBe(true);
      for (const [key, artifact] of Object.entries({
        original: plan.evidence.original,
        wrapper: plan.evidence.wrapper,
        renderer: plan.evidence.renderer,
        driver: plan.evidence.driver,
      })) {
        const bytes = await readFile(join(project, artifact.path));
        expect(artifact.bytes).toBe(bytes.length);
        expect(artifact.sha256).toBe(sha256(bytes));
        expect(artifact.fileDigest).toBe(
          await npBuildFileDigest(
            key === "original" ? "np.build-source-file.v1" : "np.build-verification-artifact.v1",
            bytes,
          ),
        );
        expect((await lstat(join(project, artifact.path))).mode & 0o777).toBe(0o400);
      }
      expect(await readFile(join(project, input.configPath))).toEqual(original);
      expect(await absent(join(project, plan.resultPath))).toBe(true);
      await expect(
        prepareSiteBuildPreviewConfigBuildV1({ ...input, project: process.cwd() }),
      ).rejects.toThrow(SiteBuildError);
    },
  );

  it("rejects an unowned temporary root without changing the config or creating controls", async () => {
    const { project, input } = await fixture("src/nexpress.config.ts", "np-other-private-");
    const original = await readFile(join(project, input.configPath));
    await expect(prepareSiteBuildPreviewConfigBuildV1(input)).rejects.toMatchObject({
      reason: "path",
    });
    expect(await readFile(join(project, input.configPath))).toEqual(original);
    expect(await absent(join(project, ".nexpress"))).toBe(true);
  });

  it("fits one existing closed workspace controls root and rejects arbitrary or missing parents", async () => {
    for (const kind of ["linux-build", "command-executor"]) {
      const { project, input } = await fixture();
      const parentDirectory = `.nexpress/site/tmp/${kind}-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      await mkdir(join(project, parentDirectory), { recursive: true, mode: 0o700 });
      const plan = await prepareSiteBuildPreviewConfigBuildV1({ ...input, parentDirectory });
      expect(plan.directory.startsWith(`${parentDirectory}/preview-config-build-`)).toBe(true);
      expect(plan.files.every((path) => path.startsWith(`${parentDirectory}/`))).toBe(true);
      await fakeNext(project);
      const driver = await derivedFixtureDriver(project, plan);
      expect(await runDriver(driver.path)).toBe(0);
      expect(await readFile(join(project, input.configPath), "utf8")).toBe(source);
      for (const invalid of [
        `${parentDirectory}/../elsewhere`,
        `${parentDirectory}/nested`,
        ".nexpress/site/tmp/arbitrary-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ".nexpress/site/tmp/linux-build-not-a-uuid",
        ".nexpress/site/tmp/linux-build-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
      ])
        await expect(
          prepareSiteBuildPreviewConfigBuildV1({ ...input, parentDirectory: invalid }),
        ).rejects.toThrow(SiteBuildError);
    }
  });

  it("runs only the fixed fake child, restores exact bytes/mode and reports required later source observation", async () => {
    const { project, input } = await fixture();
    const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
    await fakeNext(project);
    const driver = await derivedFixtureDriver(project, plan);
    expect(await runDriver(driver.path)).toBe(0);
    expect(await readFile(join(project, input.configPath), "utf8")).toBe(source);
    expect((await lstat(join(project, input.configPath))).mode & 0o777).toBe(0o640);
    expect(
      JSON.parse(await readFile(join(project, plan.directory, "observed.json"), "utf8")),
    ).toEqual({ wrapped: true, argv: ["build"], safe: true });
    const result = JSON.parse(await readFile(join(project, plan.resultPath), "utf8")) as Record<
      string,
      unknown
    >;
    expect(result).toMatchObject({
      status: "built",
      originalRestored: true,
      requiresPostBuilderSourceObservation: true,
      driver: { sha256: sha256(driver.bytes) },
    });
    expect(sha256(driver.bytes)).not.toBe(plan.evidence.driver.sha256);
  });

  it("restores byte-exact source after child failure without reporting build success", async () => {
    const { project, input } = await fixture();
    const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
    await fakeNext(project, "process.exit(17);");
    const driver = await derivedFixtureDriver(project, plan);
    expect(await runDriver(driver.path)).toBe(1);
    expect(await readFile(join(project, input.configPath), "utf8")).toBe(source);
    expect(JSON.parse(await readFile(join(project, plan.resultPath), "utf8"))).toMatchObject({
      status: "failed",
      originalRestored: true,
    });
  });

  it("preserves a changed original or wrapper and leaves no successful restoration receipt", async () => {
    for (const phase of ["before", "during"] as const) {
      const { project, input } = await fixture();
      const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
      await fakeNext(
        project,
        phase === "during" ? "fs.writeFileSync(config,'operator change\\n');" : "",
      );
      const driver = await derivedFixtureDriver(project, plan);
      if (phase === "before") await writeFile(join(project, input.configPath), "operator change\n");
      expect(await runDriver(driver.path)).toBe(1);
      expect(await readFile(join(project, input.configPath), "utf8")).toBe("operator change\n");
      expect(await absent(join(project, plan.resultPath))).toBe(true);
    }
  });

  it("refuses symlinks/hardlinks at preparation and preserves a child leaf replacement", async () => {
    const linked = await fixture();
    await link(join(linked.project, linked.input.configPath), join(linked.project, "linked.ts"));
    await expect(prepareSiteBuildPreviewConfigBuildV1(linked.input)).rejects.toThrow(
      SiteBuildError,
    );
    const aliased = await fixture("nexpress.config.ts");
    await rm(join(aliased.project, aliased.input.configPath));
    await symlink(
      join(linked.project, linked.input.configPath),
      join(aliased.project, aliased.input.configPath),
    );
    await expect(prepareSiteBuildPreviewConfigBuildV1(aliased.input)).rejects.toThrow(
      SiteBuildError,
    );
    const { project, input } = await fixture();
    await writeFile(join(project, "outside.txt"), "operator target\n");
    const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
    await fakeNext(
      project,
      "fs.renameSync(config,config+'.held');fs.symlinkSync(path.join(project,'outside.txt'),config);",
    );
    const driver = await derivedFixtureDriver(project, plan);
    expect(await runDriver(driver.path)).toBe(1);
    expect((await lstat(join(project, input.configPath))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(project, "outside.txt"), "utf8")).toBe("operator target\n");
    expect(await absent(join(project, plan.resultPath))).toBe(true);
  });

  it("does not restore through a replaced parent or newly hardlinked wrapper", async () => {
    for (const action of [
      "fs.renameSync(path.join(project,'src'),path.join(project,'src-held'));fs.mkdirSync(path.join(project,'src'));fs.writeFileSync(config,'replacement parent\\n');",
      "fs.linkSync(config,path.join(project,'linked-wrapper.ts'));",
    ]) {
      const { project, input } = await fixture();
      const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
      await fakeNext(project, action);
      const driver = await derivedFixtureDriver(project, plan);
      expect(await runDriver(driver.path)).toBe(1);
      expect(await readFile(join(project, input.configPath), "utf8")).not.toBe(source);
      expect(await absent(join(project, plan.resultPath))).toBe(true);
    }
  });

  it("requires missing restoration proof to invalidate a killed private build", async () => {
    const { project, input } = await fixture();
    const plan = await prepareSiteBuildPreviewConfigBuildV1(input);
    await fakeNext(
      project,
      "fs.writeFileSync(path.join(control,'child.pid'),String(process.pid));setInterval(()=>{},1000);setTimeout(()=>process.exit(0),3000);",
    );
    const driver = await derivedFixtureDriver(project, plan);
    const child = spawn(process.execPath, [driver.path], { stdio: "ignore", env: {} });
    const ended = new Promise<void>((resolve) => child.once("close", () => resolve()));
    let workerPid: number | undefined;
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        const marker = join(project, plan.directory, "child.pid");
        if (!(await absent(marker))) {
          workerPid = Number(await readFile(marker, "utf8"));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(workerPid).toBeGreaterThan(1);
      child.kill("SIGKILL");
      await ended;
      expect(await readFile(join(project, input.configPath), "utf8")).not.toBe(source);
      expect(await absent(join(project, plan.resultPath))).toBe(true);
    } finally {
      child.kill("SIGKILL");
      if (workerPid) {
        try {
          process.kill(-workerPid, "SIGKILL");
        } catch {
          /* The fixed fixture child may already be gone. */
        }
      }
      await ended;
    }
  });
});
