import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

import {
  npRequireFileMetadata,
  npRequireLocalStorageAdapterConfig,
  npRequireStorageKey,
  npRequireStorageUploadData,
  npRequireStorageUrl,
} from "./contract.js";
import type { LocalStorageAdapterConfig, NpFileMetadata, NpStorageAdapter } from "./types.js";

export type { LocalStorageAdapterConfig } from "./types.js";

export class LocalStorageAdapter implements NpStorageAdapter {
  readonly kind = "local";
  private readonly config: LocalStorageAdapterConfig;
  private readonly root: string;

  constructor(config: LocalStorageAdapterConfig) {
    this.config = npRequireLocalStorageAdapterConfig(config);
    this.root = resolve(this.config.directory);
  }

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    metadata: NpFileMetadata,
  ): Promise<void> {
    const validatedMetadata = npRequireFileMetadata(metadata);
    const validatedData = npRequireStorageUploadData(data, validatedMetadata);
    const filePath = await this.resolvePath(key, true);
    const temporaryPath = `${filePath}.np-${randomUUID()}.tmp`;
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );

    try {
      if (Buffer.isBuffer(validatedData)) {
        await handle.writeFile(validatedData);
      } else {
        await pipeline(
          Readable.fromWeb(validatedData),
          handle.createWriteStream({ autoClose: false }),
        );
      }
      await handle.close();
      await rename(temporaryPath, filePath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async getStream(key: string): Promise<ReadableStream> {
    const filePath = await this.resolvePath(key, false);
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    return Readable.toWeb(handle.createReadStream({ autoClose: true }));
  }

  getUrl(key: string): Promise<string> {
    // `baseUrl` is commonly a relative path (the default is
    // `"/media"`) — the URL constructor requires an absolute
    // base, so concatenate root-relative paths and use URL for
    // absolute HTTP(S) bases.
    const validatedKey = npRequireStorageKey(key);
    if (this.config.baseUrl.startsWith("/")) {
      const base = this.config.baseUrl.replace(/\/+$/u, "");
      return Promise.resolve(npRequireStorageUrl(`${base}/${validatedKey}`));
    }

    const base = new URL(this.config.baseUrl);
    base.pathname = `${base.pathname.replace(/\/+$/u, "")}/`;
    base.search = "";
    base.hash = "";
    return Promise.resolve(npRequireStorageUrl(new URL(validatedKey, base).toString()));
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = await this.resolvePath(key, false);
      const fileStat = await lstat(filePath);
      if (fileStat.isSymbolicLink()) throw symbolicLinkError(filePath);
      if (!fileStat.isDirectory()) await unlink(filePath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = await this.resolvePath(key, false);
      const fileStat = await lstat(filePath);
      if (fileStat.isSymbolicLink()) throw symbolicLinkError(filePath);
      return fileStat.isFile();
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  private async resolvePath(key: string, createParents: boolean): Promise<string> {
    const validatedKey = npRequireStorageKey(key);
    if (createParents) await mkdir(this.root, { recursive: true });

    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(this.root);
    } catch (error) {
      if (!createParents && isMissingFileError(error)) {
        return resolve(this.root, validatedKey);
      }
      throw error;
    }

    const target = resolve(canonicalRoot, validatedKey);
    const rel = relative(canonicalRoot, target);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Storage key resolves outside the configured local storage root.");
    }

    let current = canonicalRoot;
    for (const segment of validatedKey.split("/").slice(0, -1)) {
      current = resolve(current, segment);
      try {
        const currentStat = await lstat(current);
        if (currentStat.isSymbolicLink()) throw symbolicLinkError(current);
        if (!currentStat.isDirectory()) {
          throw new Error(`Storage key parent is not a directory: ${current}`);
        }
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        if (!createParents) break;
        await mkdir(current);
      }
    }
    return target;
  }
}

function symbolicLinkError(path: string): Error {
  return new Error(`Storage key path must not traverse a symbolic link: ${path}`);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
