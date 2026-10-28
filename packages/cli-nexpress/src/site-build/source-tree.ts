import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  npBuildCanonicalDigest,
  npIsBuildSourcePathExcludedV1,
  npRequireAgentBuildSourceTreeV1,
  type NpAgentBuildSourceTreeV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";

type FileIdentity = BigIntStats;
const zero = `nb1:file-sha256:${"A".repeat(43)}`;
const sameFile = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mode === right.mode &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs &&
  left.nlink === right.nlink;

/** Stream the existing raw-file profile; never put source contents in the manifest or diagnostics. */
async function readFileDigest(path: string, expected: FileIdentity): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER) ||
      before.size < 0n ||
      !sameFile(before, expected)
    )
      throw new SiteBuildError("input");
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(before.size);
    const hash = createHash("sha256")
      .update("np.build-file.v1\0np.build-source-file.v1\0", "utf8")
      .update(size);
    const buffer = Buffer.alloc(64 * 1024);
    let count = 0;
    while (count < Number(before.size)) {
      const result = await file.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - count),
        count,
      );
      if (!result.bytesRead) throw new SiteBuildError("input");
      count += result.bytesRead;
      hash.update(buffer.subarray(0, result.bytesRead));
    }
    if (
      !sameFile(before, await file.stat({ bigint: true })) ||
      !sameFile(before, await lstat(path, { bigint: true }))
    )
      throw new SiteBuildError("input");
    return `nb1:file-sha256:${hash.digest("base64url")}`;
  } finally {
    await file.close();
  }
}

/** Observed manifest only; reading source never executes config, scripts, plugins or provider code. */
export async function readSiteSourceTreeV1(
  cwd: string,
): Promise<{ manifest: NpAgentBuildSourceTreeV1; digest: string }> {
  if (!constants.O_NOFOLLOW) throw new SiteBuildError("unavailable");
  const root = await realpath(cwd);
  const files: NpAgentBuildSourceTreeV1["files"] = [];
  const identities: Array<{ path: string; identity: FileIdentity }> = [];
  let entries = 0;
  async function walk(relative: string): Promise<void> {
    const path = relative ? join(root, relative) : root;
    const before = await lstat(path, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) throw new SiteBuildError("path");
    identities.push({ path, identity: before });
    const directory = await opendir(path);
    for await (const entry of directory) {
      if (++entries > 20_000) throw new SiteBuildError("input");
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (
        npIsBuildSourcePathExcludedV1(child) ||
        (entry.isDirectory() && npIsBuildSourcePathExcludedV1(`${child}/`))
      )
        continue;
      // The canonical contract conservatively rejects case aliases of reserved roots.
      if (
        npIsBuildSourcePathExcludedV1(child.toLowerCase()) ||
        (entry.isDirectory() && npIsBuildSourcePathExcludedV1(`${child.toLowerCase()}/`))
      )
        throw new SiteBuildError("path");
      if (child.length > 512) throw new SiteBuildError("path");
      const childPath = join(root, child);
      const info = await lstat(childPath, { bigint: true });
      if (info.isSymbolicLink()) throw new SiteBuildError("path");
      if (info.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1n || files.length >= 10_000)
        throw new SiteBuildError("input");
      const mode = (info.mode & 0o111n) !== 0n ? "100755" : "100644";
      // Validate the path before opening bytes, using the same owning portable-path contract.
      npRequireAgentBuildSourceTreeV1({
        schemaVersion: "np.agent-build-source-tree.v1",
        files: [{ path: child, kind: "file", mode, digest: zero }],
      });
      files.push({
        path: child,
        kind: "file",
        mode,
        digest: await readFileDigest(childPath, info),
      });
      identities.push({ path: childPath, identity: info });
    }
    if (!sameFile(before, await lstat(path, { bigint: true }))) throw new SiteBuildError("input");
  }
  await walk("");
  for (const observed of identities) {
    if (!sameFile(observed.identity, await lstat(observed.path, { bigint: true })))
      throw new SiteBuildError("input");
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const manifest = npRequireAgentBuildSourceTreeV1({
    schemaVersion: "np.agent-build-source-tree.v1",
    files,
  });
  return { manifest, digest: await npBuildCanonicalDigest("np.build-source-tree.v1", manifest) };
}
