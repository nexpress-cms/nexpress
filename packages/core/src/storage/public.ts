/**
 * Root-compatible storage surface without the raw singleton setter.
 *
 * Normal consumers should import `@nexpress/core/storage`. Framework hosts
 * that wire singleton state import `@nexpress/core/bootstrap` instead.
 */
export * from "./contract.js";
export * from "./factory.js";
export * from "./key-contract.js";
export { LocalStorageAdapter } from "./local.js";
export * from "./operations.js";
export {
  getOptionalStorageAdapter,
  getOptionalStorageRuntimeConfig,
  getStorageAdapter,
} from "./registry.js";
export { npStorageAdapterMatchesRuntimeConfig } from "./runtime.js";
export { S3StorageAdapter } from "./s3.js";
export type * from "./types.js";
