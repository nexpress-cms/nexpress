import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

import type { NxFileMetadata, NxStorageAdapter } from "./types.js";

export interface LocalStorageAdapterConfig {
  directory: string;
  baseUrl: string;
}

export class LocalStorageAdapter implements NxStorageAdapter {
  constructor(private readonly config: LocalStorageAdapterConfig) {}

  async upload(
    key: string,
    data: Buffer | ReadableStream,
    _: NxFileMetadata,
  ): Promise<void> {
    const filePath = this.resolvePath(key);

    await mkdir(dirname(filePath), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await writeFile(filePath, data);
      return;
    }

    await pipeline(Readable.fromWeb(data), createWriteStream(filePath));
  }

  async getStream(key: string): Promise<ReadableStream> {
    return Readable.toWeb(createReadStream(this.resolvePath(key))) as ReadableStream;
  }

  async getUrl(key: string): Promise<string> {
    return new URL(key, `${this.normalizeBaseUrl(this.config.baseUrl)}/`).toString();
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
