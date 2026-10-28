import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NpObservedBuildPackageV1 } from "./installed-packages.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { prepareSiteBuildPreviewConfigBuildV1 } from "./preview-config-build.js";
import {
  createSiteBuildDeterministicNextContextV1,
  createSiteBuildDeterministicNextConfigV1,
  prepareSiteBuildDeterministicNextBuildV1,
  requirePreparedSiteBuildDeterministicNextV1,
  type NpSiteBuildDeterministicNextBuildV1,
} from "./deterministic-next-build.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const execute = promisify(execFile),
  roots: string[] = [];
const realNext = fileURLToPath(new URL("../../../app/node_modules/next/", import.meta.url));
const ownerPaths = [
  "dist/build/preview-key-utils.js",
  "dist/build/generate-build-id.js",
  "dist/server/app-render/encryption-utils-server.js",
  "dist/trace/trace.js",
  "dist/trace/shared.js",
];
const source =
  'import { createNextConfig } from "@nexpress/app/config/next-config";\n\nexport default createNextConfig();\n';
const clock = { now: "2026-01-01T00:00:00.000Z", randomSeed: "e".repeat(64) };
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
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-linux-project-")));
  roots.push(root);
  const project = join(root, "project"),
    next = join(project, "node_modules/.pnpm/next@16.3.4/node_modules/next");
  await mkdir(next, { recursive: true });
  await symlink(".pnpm/next@16.3.4/node_modules/next", join(project, "node_modules/next"));
  await writeFile(join(project, "next.config.ts"), source, { mode: 0o640 });
  await writeFile(join(project, "package.json"), '{"name":"synthetic-private-next"}\n');
  await mkdir(join(project, "src"));
  await writeFile(join(project, "src/nexpress.config.ts"), "export default {collections:[]};\n");
  const files: NpObservedBuildPackageV1["files"] = [];
  for (const path of ownerPaths) {
    await mkdir(dirname(join(next, path)), { recursive: true });
    await cp(join(realNext, path), join(next, path));
    files.push({ path, mode: "100644", sha256: sha(await readFile(join(next, path))) });
  }
  await writeFile(join(next, "package.json"), '{"name":"next","version":"16.3.4"}\n');
  await mkdir(join(next, "dist/bin"), { recursive: true });
  // Same real shipped generatePreviewKeys function, with a tiny cache-dir fixture
  // selecting the Docker ephemeral branch. No compiler/native bindings/Next build.
  await writeFile(
    join(next, "dist/server/cache-dir.js"),
    "exports.getStorageDirectory=()=>undefined;\n",
  );
  await writeFile(
    join(next, "dist/bin/next"),
    `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.cwd(),control=path.dirname(process.env.HOME),config=path.join(root,'next.config.ts');
const original=fs.readFileSync(config,'utf8');
if(!original.includes('generateBuildId: () => "np-')||process.env.UNTRUSTED_NEXT_TEST||process.env.NODE_OPTIONS||process.env.NEXT_TRACE_SPAN_THRESHOLD_MS!=='900001'||Buffer.from(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,'base64').length!==32)process.exit(21);
(async()=>{const keys=await require('../build/preview-key-utils').generatePreviewKeys({distDir:path.join(root,'.next'),isBuild:true});
fs.mkdirSync(path.join(root,'.next'),{recursive:true});fs.writeFileSync(path.join(control,'observed.json'),JSON.stringify({keys,realNow:Date.now(),unrelatedCrypto:crypto.randomBytes(16).toString('hex'),argv:process.argv.slice(2),actionKey:process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}));
if(process.env.NEXT_PRIVATE_TEST_FAILURE)process.exit(17);
})().catch(()=>process.exit(22));\n`,
  );
  const observed: NpObservedBuildPackageV1 = {
    root: next,
    name: "next",
    version: "16.3.4",
    contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
    files,
    manifest: { name: "next", version: "16.3.4" },
    dependencies: new Map(),
  };
  const packages = {
    packages: [
      { name: observed.name, version: observed.version, contentDigest: observed.contentDigest },
    ],
    instances: [observed],
    rootImports: new Map([["next", observed]]),
    assertUnchanged: vi.fn(() => Promise.resolve()),
  };
  return {
    root,
    project,
    next,
    input: {
      scope: "private-build-copy" as const,
      project,
      source: await readSiteSourceTreeV1(project),
      packages,
      baseImageId: `sha256:${"a".repeat(64)}`,
      clock: { ...clock },
    },
  };
}
async function derivedFixtureDriver(project: string, plan: NpSiteBuildDeterministicNextBuildV1) {
  const preloadPath = join(project, plan.evidence.preload.path),
    driverPath = join(project, plan.evidence.driver.path);
  const preload = await readFile(preloadPath, "utf8"),
    newline = preload.indexOf("\n");
  const adapter = JSON.parse(preload.slice("const adapter=".length, newline - 1));
  adapter.path = adapter.path.replaceAll("/np/project", project);
  adapter.entry = adapter.entry.replaceAll("/np/project", project);
  adapter.derived = adapter.derived.replaceAll("/np/project", project);
  adapter.derivedSha256 = sha(adapter.derived);
  const newPreload = `const adapter=${JSON.stringify(adapter)};\n${preload.slice(newline + 1)}`;
  await chmod(preloadPath, 0o600);
  await writeFile(preloadPath, newPreload);
  await chmod(preloadPath, 0o400);
  const driver = await readFile(driverPath, "utf8"),
    line = driver.indexOf("\n");
  const input = JSON.parse(
    driver.slice("const plan=".length, line - 1).replaceAll("/np/project", project),
  );
  input.preload.bytes = Buffer.byteLength(newPreload);
  input.preload.sha256 = sha(newPreload);
  input.previewAdapter.derivedSha256 = adapter.derivedSha256;
  // Explicit namespace/executable derivation solely for native filesystem/child
  // lifecycle tests. These bytes do not attest the production Linux driver.
  const newDriver = `const plan=${JSON.stringify(input)};\n${driver.slice(line + 1).replace("const project='/np/project',executable='/usr/local/bin/node';", `const project=${JSON.stringify(project)},executable=${JSON.stringify(process.execPath)};`)}`;
  await chmod(driverPath, 0o600);
  await writeFile(driverPath, newDriver);
  await chmod(driverPath, 0o400);
  return driverPath;
}
async function run(path: string) {
  try {
    await execute(process.execPath, [path], {
      env: { UNTRUSTED_NEXT_TEST: "not-forwarded" },
      timeout: 10000,
      maxBuffer: 64 * 1024,
    });
    return 0;
  } catch (error) {
    if (error instanceof Error && typeof Reflect.get(error, "code") === "number")
      return Reflect.get(error, "code") as number;
    throw error;
  }
}

describe("finite deterministic Next preparation (no Next/Docker build)", () => {
  it("binds stable inputs without blueprint/runtime hashes and keeps authoring artifacts outside its named source profile", async () => {
    const { project, input } = await fixture();
    const first = await createSiteBuildDeterministicNextContextV1({
      ...input,
      packages: input.packages.packages,
      nextVersion: "16.3.4",
    });
    await mkdir(join(project, ".nexpress/site"), { recursive: true });
    await writeFile(join(project, ".nexpress/site/directions.json"), '{"authoring":"changed"}');
    const second = await createSiteBuildDeterministicNextContextV1({
      ...input,
      source: await readSiteSourceTreeV1(project),
      packages: input.packages.packages,
      nextVersion: "16.3.4",
    });
    expect(second).toEqual(first);
    await writeFile(join(project, "src/page.ts"), "changed source\n");
    expect(
      await createSiteBuildDeterministicNextContextV1({
        ...input,
        source: await readSiteSourceTreeV1(project),
        packages: input.packages.packages,
        nextVersion: "16.3.4",
      }),
    ).not.toEqual(first);
    expect(Object.keys(first)).toEqual([
      "schemaVersion",
      "implementation",
      "sourceProfile",
      "sourceTreeDigest",
      "packages",
      "baseImageId",
      "nextVersion",
      "clock",
    ]);
    await expect(
      createSiteBuildDeterministicNextContextV1({
        ...input,
        packages: input.packages.packages,
        nextVersion: "16.3.4",
        clock: { ...clock, randomSeed: "x" },
      }),
    ).rejects.toThrow();
  });
  it("supports only the ordinary scaffold config and rejects custom hooks/imports/exports before source evaluation", () => {
    const id = `np-${"a".repeat(40)}`;
    expect(createSiteBuildDeterministicNextConfigV1(source, id)).toContain(
      `generateBuildId: () => "${id}"`,
    );
    for (const value of [
      "export default {};",
      "export default ()=>({});",
      'import {createNextConfig} from "@nexpress/app/config/next-config";export default createNextConfig({generateBuildId:()=>"custom"});',
      source + '\nconsole.log("side effect");',
      source.replace("createNextConfig();", 'createNextConfig({deploymentId:"custom"});'),
    ])
      expect(() => createSiteBuildDeterministicNextConfigV1(value, id)).toThrow();
  });
  it("prepares identical closed control bytes in two clean roots and rejects serialized handles", async () => {
    const first = await fixture(),
      second = await fixture();
    const a = await prepareSiteBuildDeterministicNextBuildV1(first.input),
      b = await prepareSiteBuildDeterministicNextBuildV1(second.input);
    expect(a.evidence).toEqual(b.evidence);
    expect(a.parentDirectory).toBe(b.parentDirectory);
    for (const path of a.files)
      expect(await readFile(join(first.project, path))).toEqual(
        await readFile(join(second.project, path)),
      );
    expect(await readFile(join(first.project, "next.config.ts"), "utf8")).toBe(source);
    await expect(
      requirePreparedSiteBuildDeterministicNextV1(first.project, { ...a }),
    ).rejects.toThrow();
    const previewA = await prepareSiteBuildPreviewConfigBuildV1({
      scope: "private-build-copy",
      project: first.project,
      configPath: "src/nexpress.config.ts",
      renderer,
      parentDirectory: a.parentDirectory,
      deterministicNext: a,
    });
    const previewB = await prepareSiteBuildPreviewConfigBuildV1({
      scope: "private-build-copy",
      project: second.project,
      configPath: "src/nexpress.config.ts",
      renderer,
      parentDirectory: b.parentDirectory,
      deterministicNext: b,
    });
    expect(previewA.evidence).toEqual(previewB.evidence);
    expect(previewA.files).toContain(a.evidence.driver.path);
    for (const path of previewA.files)
      expect(await readFile(join(first.project, path))).toEqual(
        await readFile(join(second.project, path)),
      );
  });
  it("runs the actual pinned preview-key function twice with deterministic keys while preserving wall time, unrelated crypto and exact config", async () => {
    const observations: Array<{
      keys: unknown;
      realNow: number;
      unrelatedCrypto: string;
      argv: string[];
      actionKey: string;
    }> = [];
    for (let i = 0; i < 2; i++) {
      const value = await fixture(),
        plan = await prepareSiteBuildDeterministicNextBuildV1(value.input);
      expect(await run(await derivedFixtureDriver(value.project, plan))).toBe(0);
      expect(await readFile(join(value.project, "next.config.ts"), "utf8")).toBe(source);
      expect((await lstat(join(value.project, "next.config.ts"))).mode & 0o777).toBe(0o640);
      expect(await readFile(join(value.next, ownerPaths[0]))).toEqual(
        await readFile(join(realNext, ownerPaths[0])),
      );
      const result = JSON.parse(await readFile(join(value.project, plan.resultPath), "utf8"));
      expect(result).toMatchObject({
        status: "built",
        originalRestored: true,
        previewCalls: 1,
        actualCleanBuildComparison: "required-separately",
      });
      observations.push(
        JSON.parse(await readFile(join(value.project, plan.directory, "observed.json"), "utf8")),
      );
      const manifest = JSON.parse(
        await readFile(join(value.project, plan.runtimeDirectory, "manifest.json"), "utf8"),
      );
      for (const file of manifest.files) {
        const bytes = await readFile(join(value.project, file.path));
        expect(sha(bytes)).toBe(file.sha256);
        expect(bytes.length).toBe(file.bytes);
      }
    }
    expect(observations[0].keys).toEqual(observations[1].keys);
    expect(observations[0].actionKey).toBe(observations[1].actionKey);
    expect(observations[0].unrelatedCrypto).not.toBe(observations[1].unrelatedCrypto);
    expect(
      observations.every(
        (row) => row.realNow > Date.parse(clock.now) + 86400000 && row.argv.join(",") === "build",
      ),
    ).toBe(true);
  });
  it("rejects changed installed owners/source and config aliases without writing source", async () => {
    const value = await fixture();
    const original = await readFile(join(value.project, "next.config.ts"));
    await writeFile(join(value.next, ownerPaths[0]), "changed owner\n");
    await expect(prepareSiteBuildDeterministicNextBuildV1(value.input)).rejects.toThrow();
    expect(await readFile(join(value.project, "next.config.ts"))).toEqual(original);
    const aliased = await fixture();
    await rm(join(aliased.project, "next.config.ts"));
    await symlink("src/nexpress.config.ts", join(aliased.project, "next.config.ts"));
    await expect(prepareSiteBuildDeterministicNextBuildV1(aliased.input)).rejects.toThrow();
    const stale = await fixture();
    await writeFile(join(stale.project, "next.config.ts"), source + "\n");
    await expect(prepareSiteBuildDeterministicNextBuildV1(stale.input)).rejects.toThrow();
  });
  it("does not restore over changed source or a replaced Next config leaf", async () => {
    for (const action of [
      "fs.writeFileSync(config,'operator change\\n');",
      "fs.renameSync(config,config+'.held');fs.symlinkSync(path.join(root,'outside.txt'),config);",
    ]) {
      const value = await fixture(),
        plan = await prepareSiteBuildDeterministicNextBuildV1(value.input);
      await writeFile(join(value.project, "outside.txt"), "untouched\n");
      const bin = join(value.next, "dist/bin/next"),
        bytes = await readFile(bin, "utf8");
      await writeFile(
        bin,
        bytes.replace("if(process.env.NEXT_PRIVATE_TEST_FAILURE)process.exit(17);", action),
      );
      expect(await run(await derivedFixtureDriver(value.project, plan))).toBe(1);
      expect(await readFile(join(value.project, "next.config.ts"), "utf8")).not.toBe(source);
      expect(await readFile(join(value.project, "outside.txt"), "utf8")).toBe("untouched\n");
    }
  });
});
