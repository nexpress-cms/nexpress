import type { ReadableStream } from "node:stream/web";

export interface NpFileMetadata {
  contentType: string;
  contentLength: number;
  originalFilename: string;
}

export interface NpStorageAdapter {
  upload(
    key: string,
    data: Buffer | ReadableStream,
    metadata: NpFileMetadata,
  ): Promise<void>;
  getStream(key: string): Promise<ReadableStream>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
