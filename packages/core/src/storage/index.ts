import type { NpConfig } from "../config/types.js";
import { LocalStorageAdapter } from "./local.js";
import { S3StorageAdapter } from "./s3.js";
import type { NpStorageAdapter } from "./types.js";

export type { NpFileMetadata, NpStorageAdapter } from "./types.js";
export { LocalStorageAdapter } from "./local.js";
export { S3StorageAdapter } from "./s3.js";

export function createStorageAdapter(config: NpConfig["storage"]): NpStorageAdapter {
  if (!config) {
    throw new Error("Storage configuration is required.");
  }

  if (config.adapter === "local") {
    if (!config.local) {
      throw new Error("Local storage configuration is required.");
    }

    return new LocalStorageAdapter(config.local);
  }

  if (!config.s3) {
    throw new Error("S3 storage configuration is required.");
  }

  return new S3StorageAdapter(config.s3);
}
