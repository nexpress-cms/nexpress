import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSiteInstalledPackagesV1 } from "./installed-packages.js";
import {
  deriveSiteBuildNextPreviewRuntimeEntryV1,
  deriveSiteBuildNextPreviewRuntimeV1,
} from "./next-preview-runtime.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const require = createRequire(new URL("../../../app/package.json", import.meta.url));
const installedNext = dirname(require.resolve("next/package.json"));
const ownerFiles = [
  "dist/build/utils.js",
  "dist/server/config-schema.js",
  "dist/server/next-server.js",
  "dist/server/lib/incremental-cache/file-system-cache.js",
];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
// Read the normal installed generator's fixed template. No generator/config JS runs.
async function server(
  config: Record<string, unknown>,
  esm = true,
  owner = installedNext,
): Promise<string> {
  const utils = await readFile(join(owner, "dist/build/utils.js"), "utf8");
  const marker = "await _fs.promises.writeFile(serverOutputPath, `${moduleType ? `";
  const start = utils.indexOf(marker);
  if (start < 0) throw new Error("missing-generator-fixture");
  const tail = utils.slice(start + marker.length);
  const esmEnd = tail.indexOf("` : `"),
    cjsEnd = tail.indexOf("`}", esmEnd + 5);
  const prefix = esm ? tail.slice(0, esmEnd) : tail.slice(esmEnd + 5, cjsEnd);
  const common = tail.slice(cjsEnd + 2).split("`);", 1)[0];
  const pieces = common.split("${JSON.stringify(nextConfig)}");
  if (pieces.length !== 2) throw new Error("ambiguous-generator-fixture");
  return prefix + pieces[0] + JSON.stringify(config) + pieces[1];
}
const config = (flag: boolean | null = true) => ({
  distDir: "./.next",
  experimental: { ...(flag === null ? {} : { isrFlushToDisk: flag }), ppr: false },
  output: "standalone",
  env: { fixture: "unchanged" },
  images: { qualities: [75] },
});
const required = (value: Record<string, unknown>) =>
  JSON.stringify({
    version: 1,
    config: { ...value, distDir: ".next" },
    appDir: "/np/project",
    relativeAppDir: "",
    files: [],
  });

async function fixture(owner = installedNext, rootPrefix = "np-linux-project-") {
  const root = await realpath(await mkdtemp(join(tmpdir(), rootPrefix)));
  roots.push(root);
  const project = join(root, "project"),
    next = join(project, "node_modules/next");
  const manifest = JSON.parse(await readFile(join(owner, "package.json"), "utf8")) as {
    version: string;
  };
  await mkdir(join(project, ".next/standalone"), { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: { next: manifest.version } }),
  );
  await writeFile(join(project, "next.config.ts"), "export default { output: 'standalone' };\n");
  for (const path of ownerFiles) {
    await mkdir(dirname(join(next, path)), { recursive: true });
    await copyFile(join(owner, path), join(next, path));
  }
  await writeFile(
    join(next, "package.json"),
    JSON.stringify({ name: "next", version: manifest.version }),
  );
  await writeFile(join(project, ".next/standalone/server.js"), await server(config(), true, owner));
  await writeFile(join(project, ".next/required-server-files.json"), required(config()));
  return { project, next, packages: await inspectSiteInstalledPackagesV1(project) };
}

describe("private Next runtime configuration derivation", () => {
  it.each([true, false])(
    "changes only the explicit ISR flag in an actual generated template (ESM %s)",
    async (esm) => {
      const original = await server(config(), esm);
      const result = deriveSiteBuildNextPreviewRuntimeEntryV1({
        serverSource: original,
        requiredServerFilesSource: required(config()),
      });
      expect(result.originalFlushToDisk).toBe(true);
      expect(result.source).toBe(
        original.replace('"isrFlushToDisk":true', '"isrFlushToDisk":false'),
      );
    },
  );
  it("accepts byte-identical false and inserts a missing optional flag without changing other data", async () => {
    for (const flag of [false, null]) {
      const value = config(flag),
        original = await server(value);
      const result = deriveSiteBuildNextPreviewRuntimeEntryV1({
        serverSource: original,
        requiredServerFilesSource: required(value),
      });
      expect(result.source).toBe(
        await server({ ...value, experimental: { ...value.experimental, isrFlushToDisk: false } }),
      );
      expect(result.originalFlushToDisk).toBe(flag ?? null);
    }
  });
  it("rejects unsupported startup code, getter/call JSON, duplicate keys and mismatched owner config", async () => {
    const value = config(),
      original = await server(value),
      json = JSON.stringify(value);
    for (const source of [
      original + "\n",
      original.replace(json, "getConfig()"),
      original.replace(
        json,
        '{"distDir":"./.next","experimental":{get isrFlushToDisk(){throw 1}}}',
      ),
      original.replace('"isrFlushToDisk":true', '"isrFlushToDisk":true,"isrFlushToDisk":false'),
      original.replace("config: nextConfig", "config: otherConfig"),
      original.replace('"isrFlushToDisk":true', '"isrFlushToDisk":"false"'),
    ])
      expect(() =>
        deriveSiteBuildNextPreviewRuntimeEntryV1({
          serverSource: source,
          requiredServerFilesSource: required(value),
        }),
      ).toThrow();
    expect(() =>
      deriveSiteBuildNextPreviewRuntimeEntryV1({
        serverSource: original,
        requiredServerFilesSource: required({ ...value, output: "other" }),
      }),
    ).toThrow();
  });
  it.each(["np-linux-project-", "np-private-edit-plan-"])(
    "observes real installed owner files, retains original/derived bytes and preserves the raw source tree (%s)",
    async (rootPrefix) => {
      const f = await fixture(installedNext, rootPrefix),
        before = await readSiteSourceTreeV1(f.project);
      const original = await readFile(join(f.project, ".next/standalone/server.js"));
      const manifest = await readFile(join(f.project, ".next/required-server-files.json"));
      const receipt = await deriveSiteBuildNextPreviewRuntimeV1({
        scope: "private-build-copy",
        ...f,
      });
      expect(receipt).toMatchObject({
        status: "written",
        scope: "private-preview-next-isr-flush-to-disk-false",
        setting: { original: true, derived: false },
        nativeVerification: "required-separately",
        concurrency: "private-copy-exclusive-lease-required",
      });
      expect(receipt.owner.contentDigest).toBe(f.packages.rootImports.get("next")?.contentDigest);
      expect(receipt.owner.files).toHaveLength(5);
      expect(receipt.evidence).toHaveLength(4);
      expect(
        await readFile(join(f.project, ".next/np-build-next-preview-runtime/original-server.js")),
      ).toEqual(original);
      expect(await readFile(join(f.project, ".next/required-server-files.json"))).toEqual(manifest);
      expect(await readFile(join(f.project, ".next/standalone/server.js"), "utf8")).toBe(
        original.toString("utf8").replace('"isrFlushToDisk":true', '"isrFlushToDisk":false'),
      );
      for (const file of receipt.evidence) {
        const bytes = await readFile(join(f.project, file.path));
        expect(file.bytes).toBe(bytes.length);
        expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      }
      expect((await readSiteSourceTreeV1(f.project)).digest).toBe(before.digest);
      await expect(
        deriveSiteBuildNextPreviewRuntimeV1({ scope: "private-build-copy", ...f }),
      ).rejects.toMatchObject({ reason: "unavailable" });
      expect(
        await readFile(join(f.project, ".next/np-build-next-preview-runtime/original-server.js")),
      ).toEqual(original);
    },
  );
  it("rejects an unowned temporary root without editing the runtime entry or creating evidence", async () => {
    const f = await fixture(installedNext, "np-other-private-");
    const original = await readFile(join(f.project, ".next/standalone/server.js"));
    await expect(
      deriveSiteBuildNextPreviewRuntimeV1({ scope: "private-build-copy", ...f }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readFile(join(f.project, ".next/standalone/server.js"))).toEqual(original);
    expect(await readdir(join(f.project, ".next"))).not.toContain("np-build-next-preview-runtime");
  });
  it("records unchanged bytes for an already-false generated entry", async () => {
    const f = await fixture(),
      value = config(false),
      original = await server(value);
    await writeFile(join(f.project, ".next/standalone/server.js"), original);
    await writeFile(join(f.project, ".next/required-server-files.json"), required(value));
    const receipt = await deriveSiteBuildNextPreviewRuntimeV1({
      scope: "private-build-copy",
      ...f,
    });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.entry.original).toEqual(receipt.entry.derived);
    expect(await readFile(join(f.project, ".next/standalone/server.js"), "utf8")).toBe(original);
  });
  it.each([
    "entry-symlink",
    "entry-hardlink",
    "parent-symlink",
    "required-symlink",
    "mode",
    "owner-bytes",
    "owner-version",
    "outside-profile",
    "occupied-evidence",
  ])("fails closed for %s without editing original inputs", async (kind) => {
    const f = await fixture(),
      entry = join(f.project, ".next/standalone/server.js"),
      original = await readFile(entry);
    const other = join(f.project, "other.js");
    await writeFile(other, "operator bytes\n");
    if (kind === "entry-symlink") {
      await rm(entry);
      await symlink("../../other.js", entry);
    }
    if (kind === "entry-hardlink") {
      await rm(entry);
      await link(other, entry);
    }
    if (kind === "parent-symlink") {
      await rename(join(f.project, ".next/standalone"), join(f.project, "saved"));
      await symlink("../saved", join(f.project, ".next/standalone"));
    }
    if (kind === "required-symlink") {
      await rm(join(f.project, ".next/required-server-files.json"));
      await symlink("../other.js", join(f.project, ".next/required-server-files.json"));
    }
    if (kind === "mode") await chmod(entry, 0o600);
    if (kind === "owner-bytes") await writeFile(join(f.next, ownerFiles[1]), "changed owner\n");
    if (kind === "owner-version") f.packages.rootImports.get("next")!.version = "99.0.0";
    if (kind === "occupied-evidence")
      await mkdir(join(f.project, ".next/np-build-next-preview-runtime"));
    await expect(
      deriveSiteBuildNextPreviewRuntimeV1({
        scope: "private-build-copy",
        ...f,
        ...(kind === "outside-profile" ? { project: dirname(f.project) } : {}),
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readFile(other, "utf8")).toBe("operator bytes\n");
    if (!["entry-symlink", "entry-hardlink"].includes(kind))
      expect(await readFile(entry)).toEqual(original);
  });
  it.each(["leaf", "parent", "mode"])(
    "rejects concurrent %s replacement and never restores over operator changes",
    async (kind) => {
      const f = await fixture(),
        entry = join(f.project, ".next/standalone/server.js"),
        original = await readFile(entry),
        assert = f.packages.assertUnchanged.bind(f.packages);
      let calls = 0;
      f.packages.assertUnchanged = async () => {
        await assert();
        if (++calls !== 2) return;
        if (kind === "parent") {
          await rename(join(f.project, ".next/standalone"), join(f.project, "saved"));
          await mkdir(join(f.project, ".next/standalone"));
          await writeFile(entry, "operator entry\n");
        } else if (kind === "leaf") {
          await rename(entry, join(f.project, "saved-entry.js"));
          await writeFile(entry, "operator entry\n");
        } else await chmod(entry, 0o600);
      };
      await expect(
        deriveSiteBuildNextPreviewRuntimeV1({ scope: "private-build-copy", ...f }),
      ).rejects.toMatchObject({ reason: "unavailable" });
      expect(await readFile(entry)).toEqual(
        kind === "mode" ? original : Buffer.from("operator entry\n"),
      );
      expect(await readdir(join(f.project, ".next/np-build-next-preview-runtime"))).not.toContain(
        "manifest.json",
      );
    },
  );
  const linuxNext = process.env.NP_TEST_SITE_BUILD_NEXT_PREVIEW_OWNER_ROOT;
  it("retains partial private evidence and a late operator replacement without restoring over it", async () => {
    const f = await fixture(),
      entry = join(f.project, ".next/standalone/server.js"),
      original = await readFile(entry);
    const assert = f.packages.assertUnchanged.bind(f.packages);
    let calls = 0;
    f.packages.assertUnchanged = async () => {
      await assert();
      if (++calls === 3) {
        await rename(entry, join(f.project, ".next/standalone/saved-derived.js"));
        await writeFile(entry, "operator replacement after derivation\n");
      }
    };
    await expect(
      deriveSiteBuildNextPreviewRuntimeV1({ scope: "private-build-copy", ...f }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readFile(entry, "utf8")).toBe("operator replacement after derivation\n");
    expect(
      await readFile(join(f.project, ".next/np-build-next-preview-runtime/original-server.js")),
    ).toEqual(original);
    expect(await readdir(join(f.project, ".next/np-build-next-preview-runtime"))).not.toContain(
      "manifest.json",
    );
  });
  it.runIf(linuxNext !== undefined)(
    "observes the exact prepared Linux Next owner without evaluating or changing it",
    async () => {
      if (!linuxNext) throw new Error("missing-owner-root");
      const f = await fixture(linuxNext);
      const receipt = await deriveSiteBuildNextPreviewRuntimeV1({
        scope: "private-build-copy",
        ...f,
      });
      expect(receipt.owner.version).toBe("16.4.2");
      expect(receipt.owner.files.find((file) => file.path === ownerFiles[0])?.sha256).toBe(
        "5fd190db661ac661673b75839156a52657b9ae64b790ad253ee8197a209683c2",
      );
    },
  );
});
