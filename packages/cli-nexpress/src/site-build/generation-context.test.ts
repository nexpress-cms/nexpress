import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSiteBuildGenerationPreloadV1,
  fingerprintSiteBuildGenerationContextV1,
  requireSiteBuildGenerationContextV1,
  type NpSiteBuildGenerationContextV1,
} from "./generation-context.js";

const execute = promisify(execFile),
  roots: string[] = [];
const digest = `nb1:sha256:${"A".repeat(43)}`;
const context: NpSiteBuildGenerationContextV1 = {
  schemaVersion: "np.site-build-generation-context.v1",
  implementation: "np.site-build-generation.v1",
  selectedDirectionHash: digest,
  comparisonInputsDigest: digest,
  selectedRenderEnvironmentFingerprint: digest,
  clock: { now: "2026-01-01T00:00:00.000Z", randomSeed: "e".repeat(64) },
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(template: "schema-generate" | "migration-generate") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-generation-unit-")));
  roots.push(root);
  const preload = createSiteBuildGenerationPreloadV1(context, {
    id: template === "schema-generate" ? "schema" : "migration",
    template,
    name: template === "schema-generate" ? null : "reviewed-change",
  });
  const path = join(root, "preload.mjs");
  await writeFile(path, preload.source);
  const run = (script: string, args: string[] = []) =>
    execute(process.execPath, ["--import", path, script, ...args], {
      cwd: root,
      env: { PATH: "/usr/bin:/bin" },
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
  return { root, path, run };
}
// A tiny journal writer exercises the generation transport and actual Node child
// boundaries. It is deliberately not a substitute for real Drizzle/App acceptance.
const writer = `const fs=require('node:fs'),crypto=require('node:crypto');
const p='drizzle/meta/_journal.json';fs.mkdirSync('drizzle/meta',{recursive:true});
const journal=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{version:'7',dialect:'postgresql',entries:[]};
const index=journal.entries.length,tag=String(index).padStart(4,'0')+'_'+(process.argv.at(-1)==='generate'?'normal':process.argv.at(-1));
const id=crypto.randomUUID();journal.entries.push({idx:index,version:'7',when:+new Date(),tag,breakpoints:true});
fs.writeFileSync('drizzle/'+tag+'.sql','-- '+id+' '+Math.random()+'\\n');
fs.writeFileSync('drizzle/meta/'+String(index).padStart(4,'0')+'_snapshot.json',JSON.stringify({id,prevId:index?JSON.parse(fs.readFileSync('drizzle/meta/'+String(index-1).padStart(4,'0')+'_snapshot.json')).id:null}));
fs.writeFileSync(p,JSON.stringify(journal));`;
async function installWriter(root: string) {
  const bin = join(root, "node_modules/drizzle-kit/bin.cjs");
  await mkdir(join(root, "node_modules/drizzle-kit"), { recursive: true });
  await writeFile(bin, writer);
  return bin;
}
async function generated(root: string) {
  const out: Record<string, string> = {};
  for (const name of (await readdir(join(root, "drizzle"))).sort()) {
    if (name === "meta")
      for (const file of (await readdir(join(root, "drizzle/meta"))).sort())
        out[`meta/${file}`] = await readFile(join(root, "drizzle/meta", file), "utf8");
    else out[name] = await readFile(join(root, "drizzle", name), "utf8");
  }
  return out;
}

describe("private deterministic generation context", () => {
  it("detaches strict descriptors without invoking getters or accepting program/environment selectors", () => {
    const copy = requireSiteBuildGenerationContextV1(context);
    expect(copy).toEqual(context);
    expect(copy.clock).not.toBe(context.clock);
    expect(fingerprintSiteBuildGenerationContextV1(copy)).toBe(
      fingerprintSiteBuildGenerationContextV1(context),
    );
    let read = false;
    const unsafe = { ...context };
    Object.defineProperty(unsafe, "clock", {
      enumerable: true,
      get() {
        read = true;
        return context.clock;
      },
    });
    for (const value of [
      unsafe,
      new Proxy(context, {}),
      { ...context, env: {} },
      { ...context, preload: "/tmp/a" },
      { ...context, blueprintHash: digest },
      { ...context, clock: { ...context.clock, now: "2026-02-30T00:00:00.000Z" } },
    ])
      expect(() => requireSiteBuildGenerationContextV1(value)).toThrow();
    expect(read).toBe(false);
    const old = Date.now();
    createSiteBuildGenerationPreloadV1(context, {
      id: "schema",
      template: "schema-generate",
      name: null,
    });
    expect(Date.now()).toBeGreaterThanOrEqual(old);
  });

  it("matches independently computed Python SHA256 UUID/math vectors in actual isolated Node processes", async () => {
    const { root, run } = await fixture("schema-generate");
    const script = join(root, "schema.mjs");
    await writeFile(
      script,
      `import crypto,{randomUUID} from 'node:crypto';console.log(JSON.stringify({now:Date.now(),iso:new Date().toISOString(),explicit:new Date(0).toISOString(),uuids:[crypto.randomUUID(),randomUUID()],math:[Math.random(),Math.random()]}));`,
    );
    const a = JSON.parse((await run(script)).stdout) as unknown;
    const b = JSON.parse((await run(script)).stdout) as unknown;
    expect(a).toEqual(b);
    // Golden calculated with Python hashlib + uuid.UUID, independently of this codec.
    expect(a).toEqual({
      now: 1767225600000,
      iso: "2026-01-01T00:00:00.000Z",
      explicit: "1970-01-01T00:00:00.000Z",
      uuids: ["f7171b64-5849-4196-919b-02d8b9465e93", "863b7d54-16cc-4e23-8e3b-31500f2c5651"],
      math: [0.949180387405508, 0.9320076716859693],
    });
  });

  it("propagates only the fixed child preload while keeping the owner clock real", async () => {
    const { root, path, run } = await fixture("migration-generate"),
      bin = await installWriter(root);
    const script = join(root, "owner.mjs");
    await writeFile(
      script,
      `import {spawnSync} from 'node:child_process';const before=Date.now();const r=spawnSync(process.execPath,[${JSON.stringify(bin)},'generate','--config','drizzle.config.ts','--name','reviewed-change'],{stdio:'inherit',shell:false,env:process.env});if(r.status!==0)process.exit(2);console.log(JSON.stringify({before,after:Date.now(),options:process.env.NODE_OPTIONS}));`,
    );
    const before = Date.now();
    const value = JSON.parse((await run(script)).stdout) as {
      before: number;
      after: number;
      options: string;
    };
    expect(value.before).toBeGreaterThanOrEqual(before);
    expect(value.after).toBeLessThanOrEqual(Date.now());
    expect(value.options).toBe(`--import=file://${path}`);
    const journal = JSON.parse(
      await readFile(join(root, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ when: number }> };
    expect(journal.entries[0].when).toBe(1767225600000);
  });

  it("creates identical fresh histories with strictly increasing times and distinct linked snapshot ids", async () => {
    const copies = await Promise.all([
      fixture("migration-generate"),
      fixture("migration-generate"),
    ]);
    for (const copy of copies) {
      const bin = await installWriter(copy.root);
      await copy.run(bin, [
        "generate",
        "--config",
        "drizzle.config.ts",
        "--name",
        "reviewed-change",
      ]);
      await copy.run(bin, ["generate", "--custom", "--name", "agent-r1-lifecycle-constraints"]);
      await copy.run(bin, ["generate", "--custom", "--name", "agent-source-reference-lifecycle"]);
    }
    const a = await generated(copies[0].root),
      b = await generated(copies[1].root);
    expect(a).toEqual(b);
    const journal = JSON.parse(a["meta/_journal.json"]) as { entries: Array<{ when: number }> };
    expect(journal.entries.map((row) => row.when)).toEqual([
      1767225600000, 1767225600001, 1767225600002,
    ]);
    const snapshots = [0, 1, 2].map(
      (index) =>
        JSON.parse(a[`meta/${String(index).padStart(4, "0")}_snapshot.json`]) as {
          id: string;
          prevId: string | null;
        },
    );
    expect(new Set(snapshots.map((s) => s.id)).size).toBe(3);
    expect(snapshots[1].prevId).toBe(snapshots[0].id);
    expect(snapshots[2].prevId).toBe(snapshots[1].id);
  });

  it("appends after an existing future timestamp and rejects malformed histories, aliases and unsupported arguments before writes", async () => {
    const { root, run } = await fixture("migration-generate"),
      bin = await installWriter(root);
    await run(bin, ["generate", "--config", "drizzle.config.ts", "--name", "reviewed-change"]);
    const path = join(root, "drizzle/meta/_journal.json");
    const journal = JSON.parse(await readFile(path, "utf8")) as {
      entries: Array<{ when: number }>;
    };
    journal.entries[0].when = 1800000000000;
    await writeFile(path, JSON.stringify(journal));
    await run(bin, ["generate", "--custom", "--name", "next"]);
    const next = JSON.parse(await readFile(path, "utf8")) as { entries: Array<{ when: number }> };
    expect(next.entries[1].when).toBe(1800000000001);
    next.entries[1].when = next.entries[0].when;
    await writeFile(path, JSON.stringify(next));
    const raw = await readFile(path);
    await expect(run(bin, ["generate", "--custom", "--name", "later"])).rejects.toThrow();
    expect(await readFile(path)).toEqual(raw);
    await rm(path);
    await writeFile(join(root, "aliased.json"), raw);
    await symlink(join(root, "aliased.json"), path);
    await expect(run(bin, ["generate"])).rejects.toThrow();
    expect(
      createHash("sha256")
        .update(await readFile(join(root, "aliased.json")))
        .digest("hex"),
    ).toBe(createHash("sha256").update(raw).digest("hex"));
    await expect(run(bin, ["push"])).rejects.toThrow();
  });
});
