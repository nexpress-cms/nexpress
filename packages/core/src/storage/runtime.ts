import {
  NpStorageContractError,
  npRequireStorageAdapter,
  npRequireStorageRuntimeConfig,
} from "./contract.js";
import { createStorageAdapter } from "./factory.js";
import {
  getOptionalStorageAdapter,
  setStorageAdapter,
  setStorageRuntimeConfig,
} from "./registry.js";
import type { NpStorageAdapter, NpStorageRuntimeConfig } from "./types.js";

/** Install one validated runtime intent and return the live adapter. */
export function configureStorageRuntime(
  config: NpStorageRuntimeConfig,
  customAdapter?: NpStorageAdapter,
): NpStorageAdapter {
  const validated = npRequireStorageRuntimeConfig(config);
  if (validated.adapter !== "custom") {
    if (customAdapter !== undefined) {
      throw new NpStorageContractError("Invalid storage runtime configuration", [
        {
          code: "invariant",
          path: "storage.runtime.adapter",
          message: "a custom adapter may only be injected when adapter is custom.",
        },
      ]);
    }
    const adapter = createStorageAdapter(validated);
    setStorageAdapter(adapter);
    setStorageRuntimeConfig(validated);
    return adapter;
  }

  const candidate =
    customAdapter === undefined
      ? getOptionalStorageAdapter()
      : npRequireStorageAdapter(customAdapter);
  if (!candidate) {
    throw new NpStorageContractError("Invalid storage runtime configuration", [
      {
        code: "invariant",
        path: "storage.runtime.adapter",
        message: "custom mode requires setStorageAdapter() or bootstrap storageAdapter injection.",
      },
    ]);
  }
  if (!npStorageAdapterMatchesRuntimeConfig(validated, candidate)) {
    throw new NpStorageContractError("Invalid storage runtime configuration", [
      {
        code: "invariant",
        path: "storage.adapter.kind",
        message: "custom mode requires a non-built-in adapter kind.",
      },
    ]);
  }
  if (customAdapter !== undefined) setStorageAdapter(candidate);
  setStorageRuntimeConfig(validated);
  return candidate;
}

export function npStorageAdapterMatchesRuntimeConfig(
  config: NpStorageRuntimeConfig,
  adapter: NpStorageAdapter,
): boolean {
  const validatedConfig = npRequireStorageRuntimeConfig(config);
  const validatedAdapter = npRequireStorageAdapter(adapter);
  return validatedConfig.adapter === "custom"
    ? validatedAdapter.kind !== "local" && validatedAdapter.kind !== "s3"
    : validatedAdapter.kind === validatedConfig.adapter;
}
