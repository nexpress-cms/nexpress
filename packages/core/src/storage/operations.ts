import type { ReadableStream } from "node:stream/web";

import {
  NpStorageContractError,
  npRequireFileMetadata,
  npRequireStorageAdapter,
  npRequireStorageKey,
  npRequireStorageStream,
  npRequireStorageUploadData,
  npRequireStorageUrl,
} from "./contract.js";
import type { NpFileMetadata, NpStorageAdapter } from "./types.js";

export async function npUploadStorageObject(
  adapter: NpStorageAdapter,
  key: string,
  data: Buffer | ReadableStream,
  metadata: NpFileMetadata,
): Promise<void> {
  const validatedAdapter = npRequireStorageAdapter(adapter);
  const validatedKey = npRequireStorageKey(key);
  const validatedMetadata = npRequireFileMetadata(metadata);
  const validatedData = npRequireStorageUploadData(data, validatedMetadata);
  const result: unknown = await validatedAdapter.upload(
    validatedKey,
    validatedData,
    validatedMetadata,
  );
  requireVoid(result, "storage.adapter.upload.result");
}

export async function npGetStorageObjectStream(
  adapter: NpStorageAdapter,
  key: string,
): Promise<ReadableStream> {
  const validatedAdapter = npRequireStorageAdapter(adapter);
  const result: unknown = await validatedAdapter.getStream(npRequireStorageKey(key));
  return npRequireStorageStream(result);
}

export async function npGetStorageObjectUrl(
  adapter: NpStorageAdapter,
  key: string,
): Promise<string> {
  const validatedAdapter = npRequireStorageAdapter(adapter);
  const result: unknown = await validatedAdapter.getUrl(npRequireStorageKey(key));
  return npRequireStorageUrl(result);
}

export async function npDeleteStorageObject(adapter: NpStorageAdapter, key: string): Promise<void> {
  const validatedAdapter = npRequireStorageAdapter(adapter);
  const result: unknown = await validatedAdapter.delete(npRequireStorageKey(key));
  requireVoid(result, "storage.adapter.delete.result");
}

export async function npStorageObjectExists(
  adapter: NpStorageAdapter,
  key: string,
): Promise<boolean> {
  const validatedAdapter = npRequireStorageAdapter(adapter);
  const result: unknown = await validatedAdapter.exists(npRequireStorageKey(key));
  if (typeof result !== "boolean") {
    throw new NpStorageContractError("Invalid storage adapter result", [
      {
        code: "invalid-field",
        path: "storage.adapter.exists.result",
        message: "must be a boolean.",
      },
    ]);
  }
  return result;
}

export async function npCloseStorageAdapter(adapter: NpStorageAdapter): Promise<void> {
  const validatedAdapter = npRequireStorageAdapter(adapter);
  if (!validatedAdapter.shutdown) return;
  const result: unknown = await validatedAdapter.shutdown();
  requireVoid(result, "storage.adapter.shutdown.result");
}

function requireVoid(value: unknown, path: string): void {
  if (value !== undefined) {
    throw new NpStorageContractError("Invalid storage adapter result", [
      { code: "invariant", path, message: "must resolve to void." },
    ]);
  }
}
