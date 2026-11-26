import { link, mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSiteInstalledPackagesV1 } from "./installed-packages.js";

const roots: string[] = [];
const create = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-installed-packages-")));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function pkg(
  root: string,
  location: string,
  name: string,
  extras: Record<string, unknown> = {},
) {
  const directory = join(root, "node_modules", location);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...extras }),
  );
  await writeFile(
    join(directory, "index.js"),
    "throw new Error('Package inspection must never execute this entry');\n",
  );
  return directory;
}

describe("observed installed package graph", () => {
  it("bounds payload bytes before streaming an oversized installed file", async () => {
    const root = await create();
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { a: "1.0.0" } }));
    const a = await pkg(root, "a", "a");
    const file = await open(join(a, "oversized.bin"), "wx");
    try {
      await file.truncate(256 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }
    await expect(inspectSiteInstalledPackagesV1(root)).rejects.toThrow();
  });
  it("hashes actual payloads across cycles and aliases without executing scripts or entries", async () => {
    const root = await create();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, dependencies: { "alias-a": "npm:actual-a@1.0.0" } }),
    );
    const a = await pkg(root, "alias-a", "actual-a", {
      dependencies: { b: "1.0.0" },
      scripts: { postinstall: "not-executed" },
    });
    await pkg(root, "b", "b", {
      dependencies: { "alias-a": "npm:actual-a@1.0.0" },
      optionalDependencies: { absent: "1.0.0" },
    });
    // pnpm's content-addressed store can use ordinary read-only hard-linked payloads.
    await link(join(a, "package.json"), join(root, "stored-manifest.json"));
    const observed = await inspectSiteInstalledPackagesV1(root);
    expect(observed.packages.map((item) => item.name)).toEqual(["actual-a", "b"]);
    expect(observed.rootImports.get("alias-a")?.name).toBe("actual-a");
    expect(observed.instances.find((item) => item.name === "actual-a")?.dependencies.get("b")).toBe(
      join(root, "node_modules/b"),
    );
    await observed.assertUnchanged();
    const old = observed.packages[0].contentDigest;
    await writeFile(join(a, "index.js"), "Changed bytes, same package version\r\n");
    await expect(observed.assertUnchanged()).rejects.toThrow();
    expect((await inspectSiteInstalledPackagesV1(root)).packages[0].contentDigest).not.toBe(old);
  });

  it("rejects external workspace links, missing required packages and symlinked payload files", async () => {
    const root = await create(),
      external = await create();
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { a: "1.0.0" } }));
    await mkdir(join(root, "node_modules"));
    await expect(inspectSiteInstalledPackagesV1(root)).rejects.toThrow();
    await symlink(external, join(root, "node_modules/a"));
    await expect(inspectSiteInstalledPackagesV1(root)).rejects.toThrow();
    await rm(join(root, "node_modules/a"));
    const a = await pkg(root, "a", "a");
    await writeFile(join(external, "private"), "synthetic external data");
    await symlink(join(external, "private"), join(a, "escape.txt"));
    await expect(inspectSiteInstalledPackagesV1(root)).rejects.toThrow();
  });

  it("detects dependency-link changes even when both old and new package payloads are unchanged", async () => {
    const root = await create();
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { a: "1.0.0" } }));
    const a = await pkg(root, ".store/a", "a"),
      b = await pkg(root, ".store/b", "a");
    await symlink(a, join(root, "node_modules/a"));
    const observed = await inspectSiteInstalledPackagesV1(root);
    await rm(join(root, "node_modules/a"));
    await symlink(b, join(root, "node_modules/a"));
    await expect(observed.assertUnchanged()).rejects.toThrow();
  });
});
