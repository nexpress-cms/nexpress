import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export class SiteBuildError extends Error {
  constructor(readonly reason: "arguments" | "path" | "input" | "conflict" | "unavailable") {
    super(reason);
  }
}

const sameFile = (left: BigIntStats, right: BigIntStats) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.size === right.size &&
  left.nlink === right.nlink &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

/** Artifact I/O only. This is not the repository generator's sandbox or write authority. */
export class SiteArtifactFiles {
  private constructor(private readonly root: string) {}

  static async at(cwd: string): Promise<SiteArtifactFiles> {
    if (!constants.O_NOFOLLOW) throw new SiteBuildError("unavailable");
    return new SiteArtifactFiles(await realpath(resolve(cwd)));
  }

  private async path(relative: string, createParents = false): Promise<string> {
    const segments = relative.split("/");
    if (
      relative.length > 240 ||
      segments.some(
        (segment) =>
          !/^[A-Za-z0-9_.-]+$/u.test(segment) ||
          segment === "." ||
          segment === ".." ||
          segment.endsWith(".") ||
          /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(segment),
      )
    )
      throw new SiteBuildError("path");
    let current = this.root;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      if (createParents) {
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new SiteBuildError("path");
    }
    return join(this.root, relative);
  }

  async read(relative: string, maxBytes: number): Promise<Uint8Array> {
    if (!relative.endsWith(".json")) throw new SiteBuildError("path");
    return this.readPath(await this.path(relative), maxBytes);
  }

  async readReviewPng(relative: string): Promise<Uint8Array> {
    if (!relative.startsWith(".nexpress/site/review/directions/") || !relative.endsWith(".png"))
      throw new SiteBuildError("path");
    return this.readPath(await this.path(relative), 10 * 1024 * 1024);
  }

  /** Final preview bytes only; this readonly transport does not authenticate a render. */
  async readFinalPreviewImage(relative: string, maxBytes = 64 * 1024 * 1024): Promise<Uint8Array> {
    if (
      !relative.startsWith(".nexpress/site/review/final/") ||
      !/\.(?:png|webp)$/u.test(relative) ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 64 * 1024 * 1024
    )
      throw new SiteBuildError("path");
    return this.readPath(await this.path(relative), maxBytes);
  }

  private async readPath(path: string, maxBytes: number): Promise<Uint8Array> {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.nlink !== 1n ||
        before.size < 0n ||
        before.size > BigInt(maxBytes)
      )
        throw new SiteBuildError("input");
      const bytes = new Uint8Array(maxBytes + 1);
      let length = 0;
      while (length <= maxBytes) {
        const read = await handle.read(bytes, length, bytes.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (
        length > maxBytes ||
        BigInt(length) !== before.size ||
        !sameFile(before, after) ||
        !sameFile(before, await lstat(path, { bigint: true }))
      )
        throw new SiteBuildError("input");
      return bytes.slice(0, length);
    } finally {
      await handle.close();
    }
  }

  async write(
    relative: string,
    bytes: Uint8Array,
    skill = false,
  ): Promise<"written" | "unchanged"> {
    const allowed = skill
      ? relative === ".agents/skills/nexpress-site-build/SKILL.md" ||
        relative === ".claude/skills/nexpress-site-build/SKILL.md"
      : relative.startsWith(".nexpress/site/") &&
        relative.endsWith(".json") &&
        !/^\.nexpress\/site\/(?:review|tmp|audit)(?:\/|$)/u.test(relative);
    if (!allowed) throw new SiteBuildError("path");
    const path = await this.path(relative, true);
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let existing;
      try {
        existing = await this.readPath(path, bytes.length);
      } catch {
        throw new SiteBuildError("conflict");
      }
      if (existing.length !== bytes.length || existing.some((byte, i) => byte !== bytes[i]))
        throw new SiteBuildError("conflict");
      return "unchanged";
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await unlink(path);
      throw error;
    } finally {
      await handle.close();
    }
    // The parent directory belongs to the same local artifact write, not a source-file plan.
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return "written";
  }
}
