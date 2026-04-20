import type { NxConfig } from "../config/types.js";
import { LocalStorageAdapter } from "./local.js";
import { S3StorageAdapter } from "./s3.js";

export type { NxFileMetadata, NxStorageAdapter } from "./types.js";
export { LocalStorageAdapter } from "./local.js";
export { S3StorageAdapter } from "./s3.js";

type NxStorageConfig = NonNullable<NxConfig["storage"]>;

export function createStorageAdapter(config: NxConfig["storage"]): import("./types.js").NxStorageAdapter {
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

  const s3Config = config.s3 as NxStorageConfig["s3"] & {
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
  };

  return new S3StorageAdapter(s3Config);
}
