import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { observeSiteBuildDirtyPathsV1 } from "./repository-status.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
it("observes real staged renames, unstaged changes and untracked files without ambient fsmonitor", async () => {
  const root = await mkdtemp(join(tmpdir(), "np-build-status-test-"));
  roots.push(root);
  const git = (args: string[]) =>
    run("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  await git(["init", "-q"]);
  await writeFile(join(root, "original.txt"), "tracked rename source\n");
  await writeFile(join(root, "dirty.txt"), "tracked original\n");
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Build fixture",
    "-c",
    "user.email=build@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);
  await git(["config", "core.fsmonitor", join(root, "forbidden-fsmonitor")]);
  await writeFile(join(root, "forbidden-fsmonitor"), "#!/bin/sh\ntouch fsmonitor-ran\n", {
    mode: 0o755,
  });
  await rename(join(root, "original.txt"), join(root, "renamed.txt"));
  await git(["-c", "core.fsmonitor=false", "add", "original.txt", "renamed.txt"]);
  await writeFile(join(root, "dirty.txt"), "operator edits\n");
  await writeFile(join(root, "새 파일.txt"), "untracked operator work\n");
  for (const path of [
    ".nexpress/site/review",
    ".nexpress/site/audit",
    ".next",
    ".nexpress/site/files",
  ]) {
    await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, path, "fixture.json"), "{}\n");
  }
  expect(await observeSiteBuildDirtyPathsV1(root)).toEqual([
    ".nexpress/site/files/fixture.json",
    "dirty.txt",
    "forbidden-fsmonitor",
    "original.txt",
    "renamed.txt",
    "새 파일.txt",
  ]);
  await writeFile(join(root, "line\nbreak.txt"), "cannot represent safely\n");
  await expect(observeSiteBuildDirtyPathsV1(root)).rejects.toThrow("path");
});
