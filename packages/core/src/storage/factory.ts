import { npRequireStorageRuntimeConfig } from "./contract.js";
import { LocalStorageAdapter } from "./local.js";
import { S3StorageAdapter } from "./s3.js";
import type { NpBuiltinStorageRuntimeConfig, NpStorageAdapter } from "./types.js";

export function createStorageAdapter(config: NpBuiltinStorageRuntimeConfig): NpStorageAdapter {
  const validated = npRequireStorageRuntimeConfig(config);
  if (validated.adapter === "custom") {
    throw new TypeError("createStorageAdapter cannot construct a custom storage adapter.");
  }
  return validated.adapter === "local"
    ? new LocalStorageAdapter(validated.local)
    : new S3StorageAdapter(validated.s3);
}
