import type { ReadableStream } from "node:stream/web";

import type { NpConfig } from "../config/types.js";

export interface NpFileMetadata {
  readonly contentType: string;
  readonly contentLength: number;
  readonly originalFilename: string;
}

export interface NpStorageAdapter {
  /** Canonical lowercase identifier surfaced by health and operator diagnostics. */
  readonly kind: string;
  upload(key: string, data: Buffer | ReadableStream, metadata: NpFileMetadata): Promise<void>;
  getStream(key: string): Promise<ReadableStream>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Optional teardown for clients, sockets, timers, or other owned resources. */
  shutdown?(): Promise<void>;
}

export interface LocalStorageAdapterConfig {
  readonly directory: string;
  readonly baseUrl: string;
}

export interface S3StorageAdapterCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface S3StorageAdapterConfig {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly credentials?: S3StorageAdapterCredentials;
}

export type NpStorageRuntimeConfig = NonNullable<NpConfig["storage"]>;
export type NpBuiltinStorageRuntimeConfig = Exclude<
  NpStorageRuntimeConfig,
  { readonly adapter: "custom" }
>;
