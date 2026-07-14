import { npObservabilityContractLimits } from "./contract.js";
import type {
  NpObservabilityDiagnostics,
  NpObservabilityFailure,
  NpObservabilityFailureComponent,
  NpObservabilityFailureOperation,
} from "./types.js";

let loggerFailures = 0;
let errorReporterFailures = 0;
let lastFailure: NpObservabilityFailure | null = null;

function failureMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, npObservabilityContractLimits.failureMessageLength);
  } catch {
    return "Observability adapter failed with an unprintable value.";
  }
}

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

/** Framework-internal failure sink. It must never call a configured adapter. */
export function npRecordObservabilityFailure(
  component: NpObservabilityFailureComponent,
  operation: NpObservabilityFailureOperation,
  adapterKind: string,
  error: unknown,
): void {
  if (component === "logger") loggerFailures = increment(loggerFailures);
  else errorReporterFailures = increment(errorReporterFailures);

  lastFailure = {
    component,
    operation,
    adapterKind,
    message: failureMessage(error),
    occurredAt: new Date().toISOString(),
  };

  try {
    console.error(`[nexpress] ${component} adapter ${operation} failure (${adapterKind}):`, error);
  } catch {
    // A patched or unavailable console must not turn diagnostics into a failure path.
  }
}

export function getObservabilityDiagnostics(): NpObservabilityDiagnostics {
  return { loggerFailures, errorReporterFailures, lastFailure };
}

export function resetObservabilityDiagnostics(component?: NpObservabilityFailureComponent): void {
  if (component === undefined || component === "logger") loggerFailures = 0;
  if (component === undefined || component === "error-reporter") errorReporterFailures = 0;
  if (component === undefined || lastFailure?.component === component) lastFailure = null;
}
