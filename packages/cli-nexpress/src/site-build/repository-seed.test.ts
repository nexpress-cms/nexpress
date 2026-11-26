import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ts } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import { npBuildFileDigest, type NpAgentSiteBlueprintV1 } from "@nexpress/core/agent-contract";
import {
  createSiteBuildRepositorySeedFilesV1,
  requireSiteBuildRepositorySeedFilesV1,
} from "./repository-seed.js";

const roots: string[] = [];
const execute = promisify(execFile);
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes: Uint8Array) => npBuildFileDigest("np.build-source-file.v1", bytes);

it.each(["src/nexpress.config.ts", "nexpress.config.ts"] as const)(
  "keeps the exact fixed continuation stable under the real repository formatter (%s)",
  async (configPath) => {
    const input = await fixture(configPath);
    const root = await mkdtemp(join(tmpdir(), "np-seed-format-test-"));
    roots.push(root);
    const path = join(root, "seed-content.ts"),
      bytes = input.created.files.find((file) => file.path === "scripts/seed-content.ts")!.bytes;
    await writeFile(path, bytes);
    const require = createRequire(new URL("../../../../package.json", import.meta.url));
    const entry = join(dirname(require.resolve("prettier/package.json")), "bin/prettier.cjs");
    await execute(
      process.execPath,
      [
        entry,
        "--config",
        fileURLToPath(new URL("../../../../.prettierrc", import.meta.url)),
        "--check",
        path,
      ],
      { timeout: 15_000, maxBuffer: 256 * 1024 },
    );
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
  },
  20_000,
);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  configPath: "src/nexpress.config.ts" | "nexpress.config.ts" = "src/nexpress.config.ts",
) {
  const vectors = JSON.parse(
    await readFile(
      new URL("../../../core/src/build-contract/__fixtures__/canonical-v1.json", import.meta.url),
      "utf8",
    ),
  ) as { structured: Array<{ purpose: string; canonical: string }> };
  const blueprint = JSON.parse(
    vectors.structured.find((item) => item.purpose === "np.build-site-blueprint.v1")!.canonical,
  ) as NpAgentSiteBlueprintV1;
  const artifact = {
    schemaVersion: "np.site-build-seed.v1",
    theme: { id: "default", ...blueprint.theme },
    seed: structuredClone(blueprint.seed),
    navigation: structuredClone(blueprint.navigation),
  };
  const seedArtifactBytes = encode(artifact);
  const created = await createSiteBuildRepositorySeedFilesV1({ configPath, seedArtifactBytes });
  for (const file of created.files)
    blueprint.filePlan.push({
      path: file.path,
      action: "create",
      owner: "seed",
      source: "staged",
      expectedHash: null,
      contentHash: file.contentHash,
      rationale: "Ordinary reviewed seed continuation",
      generatedByCommandId: null,
      stagedArtifactPath: `.nexpress/site/files/${file.path === "site-build.seed.json" ? "seed.json" : "seed-content.ts"}`,
    });
  return { blueprint, artifact, seedArtifactBytes, configPath, created };
}

interface Scenario {
  admin?: boolean;
  site?: boolean;
  parserFailure?: boolean;
  materializeFailure?: boolean;
  cacheFailure?: boolean;
  cacheStatus?: "partial" | "unavailable";
  shutdownFailure?: boolean;
}

/** Actual generated program, fake module lifecycle only: no App/PG/Next/Linux execution proof. */
async function runtimeFixture(
  scenario: Scenario = {},
  configPath: "src/nexpress.config.ts" | "nexpress.config.ts" = "src/nexpress.config.ts",
) {
  const input = await fixture(configPath);
  const root = await mkdtemp(join(tmpdir(), "np-seed-script-semantics-"));
  roots.push(root);
  const put = async (path: string, body: string | Uint8Array) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  };
  const stateUrl = pathToFileURL(join(root, "state.mjs")).href;
  const state = `import {event, scenario, state} from ${JSON.stringify(stateUrl)};\n`;
  await put("package.json", '{"type":"module"}');
  await put("scenario.json", JSON.stringify(scenario));
  await put("events.jsonl", "");
  await put(
    "state.mjs",
    `import {appendFileSync,readFileSync} from "node:fs";
export const scenario=JSON.parse(readFileSync(new URL("./scenario.json",import.meta.url),"utf8"));
export const state={site:null};
export const event=(name)=>appendFileSync(new URL("./events.jsonl",import.meta.url),JSON.stringify(name)+"\\n");
`,
  );
  const contract = pathToFileURL(
    createRequire(import.meta.url).resolve("@nexpress/core/agent-contract"),
  ).href;
  await put(
    "node_modules/@nexpress/core/package.json",
    JSON.stringify({
      type: "module",
      exports: { ".": "./index.js", "./agent-contract": "./contract.js", "./cache": "./cache.js" },
    }),
  );
  await put(
    "node_modules/@nexpress/core/contract.js",
    `export {npBuildFileDigest,npParseBuildJsonV1} from ${JSON.stringify(contract)};`,
  );
  await put(
    "node_modules/@nexpress/core/index.js",
    `${state}
export const npUsers={id:"id",email:"email",name:"name",role:"role",tokenVersion:"tokenVersion"};
export const getSiteById=async(id)=>{event("site:"+id);return scenario.site===false?null:{id};};
export const withCurrentSite=async(id,fn)=>{state.site=id;event("scope:"+id);try{return await fn();}finally{state.site=null;event("scope:end");}};
export const withDeferredPostCommit=async(fn)=>{event("deferred:start");const result=await fn();event("deferred:after-commit");return result;};
`,
  );
  await put(
    "node_modules/@nexpress/core/cache.js",
    `${state}
export const npInvalidateCache=async(request)=>{if(state.site!==request.siteId)throw Error("Wrong current site");event("cache:after-commit");return {status:scenario.cacheStatus??(scenario.cacheFailure?"unavailable":"applied")};};
`,
  );
  await put(
    "node_modules/@nexpress/app/package.json",
    JSON.stringify({
      type: "module",
      exports: {
        "./lib/site-build-seed": "./seed.js",
        "./scripts/_load-env": "./env.js",
        "./config-defaults": "./defaults.js",
      },
    }),
  );
  await put(
    "node_modules/@nexpress/app/seed.js",
    `${state}
export const npRequireSiteBuildSeedArtifactV1=(value)=>{event("parser");if(scenario.parserFailure)throw Error("secret-parser-token");return value;};
export const npMaterializeSiteBuildSeedV1=async(value,actor,options)=>{
 if(actor.id!=="existing-admin"||actor.role!=="admin"||!options.tx?.owned||options.status!=="published"||options.ownerBindings[0].value!==state.owner||!state.site)throw Error("Wrong materialization boundary");
 event("materialize");if(scenario.materializeFailure)throw Error("secret-database-password");
 return {pendingCacheInvalidations:[{source:"theme",siteId:state.site}]};
};
`,
  );
  await put("node_modules/@nexpress/app/env.js", `${state}event("environment");`);
  await put(
    "node_modules/@nexpress/app/defaults.js",
    `${state}state.owner={};export const npGetDefaultBuildOwnerBindingsV1=()=>[{package:"@nexpress/theme-default",value:state.owner}];`,
  );
  await put("node_modules/@nexpress/next/package.json", '{"type":"module","exports":"./index.js"}');
  await put(
    "node_modules/@nexpress/next/index.js",
    `${state}
export const createBootstrap=()=>{event("bootstrap");return {
 ensureFor:async(intent)=>event("ensure:"+intent),
 shutdown:async()=>{event("shutdown");if(scenario.shutdownFailure)throw Error("secret-shutdown-token");},
 getDb:()=>({
  select:()=>({from:()=>({where:(filter)=>({orderBy:()=>({limit:async(count)=>{
   if(filter[0]!=="role"||filter[1]!=="admin"||count!==1)throw Error("Wrong actor query");
   event("admin:existing");return scenario.admin===false?[]:[{id:"existing-admin",email:"private@example.invalid",name:"Existing",role:"admin",tokenVersion:1}];
  }})})})}),
  transaction:async(fn)=>{event("transaction:start");try{const result=await fn({owned:true});event("transaction:commit");return result;}catch(error){event("transaction:rollback");throw error;}}
 }),
};};
`,
  );
  await put("node_modules/drizzle-orm/package.json", '{"type":"module","exports":"./index.js"}');
  await put("node_modules/drizzle-orm/index.js", "export const eq=(a,b)=>[a,b];");
  await put(configPath.replace(/\.ts$/u, ".js"), `${state}event("config");export default {};`);
  await put("src/db/generated/collections.js", "export const fixtureSchema={};");
  await put("src/lib/observability.js", "export const observabilityAdapters={};");
  const program = new TextDecoder().decode(input.created.files[1].bytes);
  const transpiled = ts.transpileModule(program, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  expect(
    transpiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error),
  ).toEqual([]);
  await put("scripts/seed-content.mjs", transpiled.outputText);
  await put("site-build.seed.json", input.seedArtifactBytes);
  const run = async (args: string[] = []) => {
    let code = 0,
      stdout: string,
      stderr: string;
    try {
      const result = await execute(
        process.execPath,
        [join(root, "scripts/seed-content.mjs"), ...args],
        { cwd: root, env: {}, timeout: 10000, maxBuffer: 65536 },
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      code = failure.code;
      stdout = failure.stdout;
      stderr = failure.stderr;
    }
    const log = await readFile(join(root, "events.jsonl"), "utf8");
    return {
      code,
      stdout,
      stderr,
      events: log.trim()
        ? log
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as string)
        : [],
    };
  };
  return { ...input, root, put, run };
}

describe("ordinary repository seed source expectations", () => {
  it("binds exact native-produced bytes and fixed source hashes without mutating inputs or applying files", async () => {
    const input = await fixture();
    const before = JSON.stringify(input.blueprint);
    const result = await requireSiteBuildRepositorySeedFilesV1(input);
    expect(result.scope).toBe("ordinary-repository-seed-source-only");
    expect(result.files.map((item) => item.path)).toEqual([
      "site-build.seed.json",
      "scripts/seed-content.ts",
    ]);
    for (const file of result.files) expect(file.contentHash).toBe(await hash(file.bytes));
    expect(result.files[0].bytes).toEqual(new Uint8Array(input.seedArtifactBytes));
    expect(JSON.stringify(input.blueprint)).toBe(before);
    result.files[0].bytes[0] = 0;
    expect(input.seedArtifactBytes[0]).toBe(123);
    expect(await requireSiteBuildRepositorySeedFilesV1(input)).toEqual(input.created);
  });

  it.each(["site-build.seed.json", "scripts/seed-content.ts"])(
    "requires exact seed/staged ownership and reviewed new hash for %s",
    async (path) => {
      const input = await fixture();
      for (const mutation of [
        "missing",
        "owner",
        "source",
        "hash",
        "hash-purpose",
        "duplicate",
      ] as const) {
        const blueprint = structuredClone(input.blueprint);
        const index = blueprint.filePlan.findIndex((item) => item.path === path);
        const row = blueprint.filePlan[index];
        if (mutation === "missing") blueprint.filePlan.splice(index, 1);
        if (mutation === "owner") row.owner = "page";
        if (mutation === "source")
          blueprint.filePlan[index] = {
            ...row,
            source: "command",
            stagedArtifactPath: null,
            generatedByCommandId: "format",
          };
        if (mutation === "hash") row.contentHash = await hash(Buffer.from("different source"));
        if (mutation === "hash-purpose")
          row.contentHash = await npBuildFileDigest(
            "np.build-staged-artifact.v1",
            input.created.files.find((file) => file.path === path)!.bytes,
          );
        if (mutation === "duplicate") blueprint.filePlan.push(structuredClone(row));
        await expect(
          requireSiteBuildRepositorySeedFilesV1({ ...input, blueprint }),
        ).rejects.toMatchObject({ reason: "input" });
      }
    },
  );

  it("leaves valid create/update/expectedHash CAS decisions to the existing controller", async () => {
    const input = await fixture();
    for (const row of input.blueprint.filePlan.filter((item) => item.owner === "seed")) {
      row.action = "update";
      row.expectedHash = await hash(Buffer.from("controller observes old bytes"));
    }
    await expect(requireSiteBuildRepositorySeedFilesV1(input)).resolves.toEqual(input.created);
  });

  it("rejects artifact projection mismatches even when the filePlan hashes match its bytes", async () => {
    for (const mismatch of ["theme", "tokens", "seed", "navigation"] as const) {
      const input = await fixture();
      if (mismatch === "theme") input.artifact.theme.package = "@nexpress/theme-magazine";
      if (mismatch === "tokens") input.artifact.theme.tokens = { colors: { primary: "#000000" } };
      if (mismatch === "seed") input.artifact.seed.mode = "demo-fixtures";
      if (mismatch === "navigation")
        input.artifact.navigation = [{ location: "header", items: [] }];
      const seedArtifactBytes = encode(input.artifact);
      const expected = await createSiteBuildRepositorySeedFilesV1({
        configPath: input.configPath,
        seedArtifactBytes,
      });
      for (const file of expected.files)
        input.blueprint.filePlan.find((item) => item.path === file.path)!.contentHash =
          file.contentHash;
      await expect(
        requireSiteBuildRepositorySeedFilesV1({ ...input, seedArtifactBytes }),
      ).rejects.toMatchObject({ reason: "input" });
    }
  });

  it("preserves original artifact serialization and has no blueprint/file-plan hash cycle", async () => {
    const input = await fixture();
    const bytes = Buffer.from(JSON.stringify(input.artifact));
    const alternate = await createSiteBuildRepositorySeedFilesV1({
      ...input,
      seedArtifactBytes: bytes,
    });
    expect(alternate.files[0].bytes).toEqual(new Uint8Array(bytes));
    expect(alternate.files[1].contentHash).not.toBe(input.created.files[1].contentHash);
    const source = new TextDecoder().decode(input.created.files[1].bytes);
    expect(source).toContain(input.created.files[0].contentHash);
    expect(source).not.toContain(input.blueprint.briefHash);
    expect(source).not.toMatch(
      /blueprintHash|filePlan|new Pool|createUser|uploadMedia|process\.env|console\.error\(error/u,
    );
    input.blueprint.risks.push({
      id: "unrelated-risk",
      category: "content",
      severity: "low",
      summary: "Unrelated reviewed risk",
      mitigation: "Review separately",
      blocking: false,
    });
    await expect(requireSiteBuildRepositorySeedFilesV1(input)).resolves.toEqual(input.created);
  });

  it("rejects unsupported config paths, malformed/duplicate JSON, UTF-8, extra authority fields and overlarge bytes", async () => {
    const input = await fixture();
    const bad: Uint8Array[] = [
      Buffer.from(""),
      Buffer.from('{"seed":{},"seed":{}}'),
      new Uint8Array([255]),
      encode({ ...input.artifact, blueprintHash: input.blueprint.briefHash }),
      new Uint8Array(4 * 1024 * 1024 + 1),
    ];
    for (const seedArtifactBytes of bad)
      await expect(
        createSiteBuildRepositorySeedFilesV1({ ...input, seedArtifactBytes }),
      ).rejects.toMatchObject({ reason: "input" });
    await expect(
      createSiteBuildRepositorySeedFilesV1({
        ...input,
        configPath: "../nexpress.config.ts" as "nexpress.config.ts",
      }),
    ).rejects.toMatchObject({ reason: "input" });
  });
});

describe("generated ordinary continuation lifecycle (fake modules; no database proof)", () => {
  it.each(["src/nexpress.config.ts", "nexpress.config.ts"] as const)(
    "uses %s, existing actor/site and commit-before-cache order",
    async (configPath) => {
      const input = await runtimeFixture({}, configPath);
      const result = await input.run(["--site=existing-site"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Site build seed data committed.\n");
      expect(result.events).toEqual([
        "parser",
        "environment",
        "config",
        "bootstrap",
        "ensure:write",
        "site:existing-site",
        "admin:existing",
        "scope:existing-site",
        "deferred:start",
        "transaction:start",
        "materialize",
        "transaction:commit",
        "deferred:after-commit",
        "cache:after-commit",
        "scope:end",
        "shutdown",
      ]);
    },
  );

  it("defaults to the existing default site", async () => {
    const input = await runtimeFixture();
    const result = await input.run();
    expect(result.code).toBe(0);
    expect(result.events).toContain("site:default");
  });

  it.each(["tampered", "symlink", "hardlink", "directory"])(
    "rejects %s artifact before parser, environment/config and bootstrap",
    async (kind) => {
      const input = await runtimeFixture();
      const target = join(input.root, "site-build.seed.json");
      if (kind === "tampered")
        await writeFile(target, Buffer.concat([input.seedArtifactBytes, Buffer.from("\n")]));
      else {
        await rm(target);
        if (kind === "directory") await mkdir(target);
        else {
          await input.put("different.json", input.seedArtifactBytes);
          if (kind === "symlink") await symlink("different.json", target);
          else await link(join(input.root, "different.json"), target);
        }
      }
      const result = await input.run();
      expect(result.code).toBe(1);
      expect(result.events).toEqual([]);
      expect(result.stderr).toContain("Site build seed failed.");
      expect(result.stderr).not.toContain(input.root);
    },
  );

  it("honors the App parser before loading environment/config or opening a pool", async () => {
    const input = await runtimeFixture({ parserFailure: true });
    const result = await input.run();
    expect(result.code).toBe(1);
    expect(result.events).toEqual(["parser"]);
    expect(result.stderr).not.toContain("secret-parser-token");
  });

  it.each([
    ["--site="],
    ["--site=UPPER"],
    ["--site=default", "--site=other"],
    ["--site", "default"],
    ["--apply"],
  ])("rejects undeclared argv %j before configuration", async (...args) => {
    const input = await runtimeFixture();
    const result = await input.run(args);
    expect(result.code).toBe(1);
    expect(result.events).toEqual([]);
  });

  it.each([{ admin: false }, { site: false }])(
    "requires existing persisted site and admin, never materializes when absent: %j",
    async (scenario) => {
      const input = await runtimeFixture(scenario);
      const result = await input.run();
      expect(result.code).toBe(1);
      expect(result.events).not.toContain("transaction:start");
      expect(result.events).not.toContain("materialize");
      expect(result.events.at(-1)).toBe("shutdown");
    },
  );

  it("does not dispatch pending cache intents after a failed transaction and never logs raw errors", async () => {
    const input = await runtimeFixture({ materializeFailure: true });
    const result = await input.run();
    expect(result.code).toBe(1);
    expect(result.events).toContain("transaction:rollback");
    expect(result.events).not.toContain("transaction:commit");
    expect(result.events).not.toContain("cache:after-commit");
    expect(result.events.at(-1)).toBe("shutdown");
    expect(result.stderr).not.toMatch(/secret|private@example| at /u);
  });

  it.each(["partial", "unavailable"] as const)(
    "reports committed data and pending host cache refresh for %s invalidation",
    async (cacheStatus) => {
      const input = await runtimeFixture({ cacheStatus });
      const result = await input.run();
      expect(result.code).toBe(0);
      expect(result.events.indexOf("transaction:commit")).toBeLessThan(
        result.events.indexOf("cache:after-commit"),
      );
      expect(result.events).not.toContain("transaction:rollback");
      expect(result.events.at(-1)).toBe("shutdown");
      expect(result.stdout).toBe("Site build seed data committed.\n");
      expect(result.stderr).toBe(
        "Site build seed cache refresh is pending. Refresh caches through the serving host before using an already-running site.\n",
      );
      expect(result.stderr).not.toMatch(/secret|private@example| at /u);
    },
  );

  it("reports pending cache refresh and shutdown failure safely without claiming success", async () => {
    const input = await runtimeFixture({ cacheFailure: true, shutdownFailure: true });
    const result = await input.run();
    expect(result.code).toBe(1);
    expect(result.events.indexOf("transaction:commit")).toBeLessThan(
      result.events.indexOf("cache:after-commit"),
    );
    expect(result.events.at(-1)).toBe("shutdown");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("shutdown failed");
    expect(result.stderr).not.toMatch(/secret|private@example| at /u);
  });
});
