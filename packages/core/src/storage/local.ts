import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

import type { NpFileMetadata, NpStorageAdapter } from "./types.js";

export interface LocalStorageAdapterConfig {
  directory: string;
  baseUrl: string;
}

export class LocalStorageAdapter implements NpStorageAdapter {
  constructor(private readonly config: LocalStorageAdapterConfig) {}

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    _: NpFileMetadata,
  ): Promise<void> {
    const filePath = this.resolvePath(key);

    await mkdir(dirname(filePath), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await writeFile(filePath, data);
      return;
    }

    await pipeline(Readable.fromWeb(data), createWriteStream(filePath));
  }

  getStream(key: string): Promise<ReadableStream> {
    return Promise.resolve(
      Readable.toWeb(createReadStream(this.resolvePath(key))),
    );
  }

  getUrl(key: string): Promise<string> {
    // `baseUrl` is commonly a relative path (the default is
    // `"/uploads"`) — `new URL(key, "/uploads/")` throws because
    // the URL constructor requires an absolute base. Concatenate
    // for relative baseUrls and let the URL constructor handle
    // absolute ones (full origin, S3-style, etc.).
    const base = this.normalizeBaseUrl(this.config.baseUrl);
    if (base.startsWith("/")) {
      return Promise.resolve(`${base}/${key}`);
    }
    return Promise.resolve(new URL(key, `${base}/`).toString());
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolvePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  private resolvePath(key: string): string {
    return join(this.config.directory, key);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }
}
