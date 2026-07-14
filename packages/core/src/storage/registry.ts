import { npRequireStorageAdapter } from "./contract.js";
import { npCloseStorageAdapter } from "./operations.js";
import type { NpStorageAdapter, NpStorageRuntimeConfig } from "./types.js";

let storageAdapter: NpStorageAdapter | null = null;
let storageRuntimeConfig: NpStorageRuntimeConfig | null = null;

export function setStorageAdapter(adapter: NpStorageAdapter): void {
  storageAdapter = npRequireStorageAdapter(adapter);
}

export function getStorageAdapter(): NpStorageAdapter {
  if (!storageAdapter) {
    throw new Error("Storage adapter not initialized. Call setStorageAdapter() first.");
  }
  return storageAdapter;
}

export function getOptionalStorageAdapter(): NpStorageAdapter | null {
  return storageAdapter;
}

export function getOptionalStorageRuntimeConfig(): NpStorageRuntimeConfig | null {
  return storageRuntimeConfig;
}

export function setStorageRuntimeConfig(config: NpStorageRuntimeConfig): void {
  storageRuntimeConfig = config;
}

/** Detach first so a failed close cannot leave a half-closed adapter installed. */
export async function npShutdownStorageAdapter(): Promise<void> {
  const current = storageAdapter;
  storageAdapter = null;
  storageRuntimeConfig = null;
  if (current) await npCloseStorageAdapter(current);
}
