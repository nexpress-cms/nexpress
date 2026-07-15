import { npRequireSearchAdapter } from "../search/contract.js";
import type {
  NpSearchAdapter,
  NpSearchAdapterDiagnostics,
  NpSearchAdapterFailure,
} from "../search/types.js";

let currentAdapter: NpSearchAdapter | null = null;
let dispatchFailures = 0;
let resultContractFailures = 0;
let shutdownFailures = 0;
let lastFailure: NpSearchAdapterFailure | null = null;

function resetDiagnostics(): void {
  dispatchFailures = 0;
  resultContractFailures = 0;
  shutdownFailures = 0;
  lastFailure = null;
}

function failureMessage(error: unknown): string {
  let message = "Unknown search adapter failure.";
  try {
    const candidate = error instanceof Error ? error.message : String(error);
    if (candidate.length > 0) message = candidate;
  } catch {
    // A thrown value can itself be a hostile Proxy or reject string coercion.
  }
  let sanitized = "";
  for (const character of message) {
    const code = character.codePointAt(0) ?? 0;
    sanitized += code < 0x20 || code === 0x7f ? " " : character;
    if (sanitized.length >= 1_024) break;
  }
  return sanitized.slice(0, 1_024);
}

/** Install one exact adapter descriptor. The built-in Postgres path remains the null default. */
export function setSearchAdapter(adapter: NpSearchAdapter): NpSearchAdapter {
  currentAdapter = npRequireSearchAdapter(adapter);
  resetDiagnostics();
  return currentAdapter;
}

export function getSearchAdapter(): NpSearchAdapter | null {
  return currentAdapter;
}

/** Reset one owned adapter and its process-local diagnostics. */
export function resetSearchAdapter(expected?: NpSearchAdapter): void {
  if (expected !== undefined && currentAdapter !== expected) return;
  currentAdapter = null;
  resetDiagnostics();
}

export function getSearchAdapterDiagnostics(): NpSearchAdapterDiagnostics {
  return Object.freeze({
    adapterKind: currentAdapter?.kind ?? null,
    dispatchFailures,
    resultContractFailures,
    shutdownFailures,
    lastFailure,
  });
}

export function npRecordSearchAdapterFailure(
  adapterKind: string,
  operation: NpSearchAdapterFailure["operation"],
  error: unknown,
): string {
  if (operation === "dispatch") dispatchFailures += 1;
  else if (operation === "result-contract") resultContractFailures += 1;
  else shutdownFailures += 1;
  const message = failureMessage(error);
  lastFailure = Object.freeze({
    adapterKind,
    operation,
    message,
    occurredAt: new Date().toISOString(),
  });
  return message;
}

/** Detach one owned adapter before awaiting its optional terminal cleanup. */
export async function shutdownSearchAdapter(expected?: NpSearchAdapter): Promise<void> {
  const owned = expected ?? currentAdapter;
  if (owned && (expected === undefined || currentAdapter === expected)) currentAdapter = null;
  if (!owned?.shutdown) return;
  try {
    const result: unknown = await owned.shutdown();
    if (result !== undefined) {
      throw new TypeError("Search adapter shutdown() must resolve to void.");
    }
  } catch (error) {
    npRecordSearchAdapterFailure(owned.kind, "shutdown", error);
    throw error;
  }
}
