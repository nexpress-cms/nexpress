import {
  npSerializeCollectionDocument,
  type NpCollectionDocumentWire,
} from "../collection-contract/index.js";
import type { NpCollectionRuntimeDiagnostic } from "../collection-contract/types.js";
import type { NpCollectionConfig } from "../config/types.js";

const MAX_DIAGNOSTICS = 100;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 1_000;
const diagnostics: NpCollectionRuntimeDiagnostic[] = [];

export function npRecordCollectionRuntimeDiagnostic(
  collection: string,
  operation: NpCollectionRuntimeDiagnostic["operation"],
  message: string,
): void {
  diagnostics.push({
    collection,
    operation,
    message: message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    occurredAt: new Date().toISOString(),
  });
  if (diagnostics.length > MAX_DIAGNOSTICS)
    diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
}

export function getCollectionRuntimeDiagnostics(): NpCollectionRuntimeDiagnostic[] {
  return diagnostics.map((entry) => ({ ...entry }));
}

export function resetCollectionRuntimeDiagnostics(): void {
  diagnostics.length = 0;
}

/** Server boundary wrapper that also exposes failed serialization in live health. */
export function npSerializeCollectionDocumentWithDiagnostics<
  T extends object = Record<string, unknown>,
>(value: unknown, config: NpCollectionConfig): NpCollectionDocumentWire<T> {
  try {
    return npSerializeCollectionDocument<T>(value, config);
  } catch (error) {
    npRecordCollectionRuntimeDiagnostic(
      config.slug,
      "serialize",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
