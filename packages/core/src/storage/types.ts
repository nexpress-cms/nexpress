import type { ReadableStream } from "node:stream/web";

export interface NxFileMetadata {
  contentType: string;
  contentLength: number;
  originalFilename: string;
}

export interface NxStorageAdapter {
  upload(
    key: string,
    data: Buffer | ReadableStream,
    metadata: NxFileMetadata,
  ): Promise<void>;
  getStream(key: string): Promise<ReadableStream>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
