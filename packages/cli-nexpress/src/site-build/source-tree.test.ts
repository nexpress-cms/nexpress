import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { npBuildFileDigest, npBuildCanonicalDigest } from "@nexpress/core/agent-contract";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const directories: string[] = [];
const project = async () => {
  const path = await mkdtemp(join(tmpdir(), "np-site-tree-"));
  directories.push(path);
  return path;
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("observed Build source manifest", () => {
  it("matches the pure raw-byte profile for binary/CRLF/Unicode files and preserves executable mode", async () => {
    const root = await project();
    const inputs = new Map([
      ["한글.txt", Buffer.from("line\r\n")],
      ["binary.bin", Buffer.from([0, 1, 255])],
      ["empty", Buffer.alloc(0)],
      ["run", Buffer.from("demo")],
    ]);
    for (const [path, bytes] of inputs) await writeFile(join(root, path), bytes);
    await chmod(join(root, "run"), 0o755);
    const observed = await readSiteSourceTreeV1(root);
    expect(observed.manifest.files.map((file) => file.path)).toEqual([
      "binary.bin",
      "empty",
      "run",
      "한글.txt",
    ]);
    for (const file of observed.manifest.files) {
      expect(file.digest).toBe(
        await npBuildFileDigest("np.build-source-file.v1", inputs.get(file.path)!),
      );
      expect(file.mode).toBe(file.path === "run" ? "100755" : "100644");
    }
    expect(observed.digest).toBe(
      await npBuildCanonicalDigest("np.build-source-tree.v1", observed.manifest),
    );
    expect((await readSiteSourceTreeV1(root)).digest).toBe(observed.digest);
    await writeFile(join(root, "empty"), "changed");
    expect((await readSiteSourceTreeV1(root)).digest).not.toBe(observed.digest);
  });

  it("uses the fixed exclusion registry and keeps ordinary Build input artifacts in the source identity", async () => {
    const root = await project();
    await mkdir(join(root, ".nexpress/site"), { recursive: true });
    await writeFile(join(root, ".nexpress/site/brief.json"), "{}");
    const before = await readSiteSourceTreeV1(root);
    for (const directory of [
      ".git",
      "node_modules",
      "nested/dist",
      ".nexpress/site/review",
      ".nexpress/site/tmp",
      ".nexpress/site/audit",
      "coverage",
      ".turbo",
      ".next",
    ]) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(join(root, directory, "ignored"), "ignored output");
    }
    expect((await readSiteSourceTreeV1(root)).digest).toBe(before.digest);
    expect(before.manifest.files.map((file) => file.path)).toEqual([".nexpress/site/brief.json"]);
  });

  it("rejects symlinks, hard-link aliases and portable Unicode/case collisions", async () => {
    const root = await project(),
      outside = await project();
    await writeFile(join(outside, "outside"), "outside source");
    await symlink(outside, join(root, "escape"));
    await expect(readSiteSourceTreeV1(root)).rejects.toThrow();
    await rm(join(root, "escape"));
    await link(join(outside, "outside"), join(root, "alias"));
    await expect(readSiteSourceTreeV1(root)).rejects.toThrow();
    await rm(join(root, "alias"));
    // Some filesystems already collapse this alias. Never overwrite the first file to test it.
    await writeFile(join(root, "straße.txt"), "a");
    let collapsed = false;
    try {
      await writeFile(join(root, "STRASSE.txt"), "b", { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      collapsed = true;
    }
    if (collapsed) {
      const observed = await readSiteSourceTreeV1(root);
      expect(observed.manifest.files).toHaveLength(1);
      expect(observed.manifest.files[0].digest).toBe(
        await npBuildFileDigest("np.build-source-file.v1", Buffer.from("a")),
      );
    } else await expect(readSiteSourceTreeV1(root)).rejects.toThrow();
  });
});
