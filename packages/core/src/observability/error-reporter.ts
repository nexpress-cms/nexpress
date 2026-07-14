/** Fail-safe error reporter registry with validated installation and dispatch. */
import {
  npRequireErrorReporter,
  npRequireErrorReportContext,
  npRequireObservabilityVoidResult,
  npRequireReportedError,
} from "./contract.js";
import { npRecordObservabilityFailure } from "./diagnostics.js";
import type { NpErrorReportContext, NpErrorReporter } from "./types.js";

const noopAdapter: NpErrorReporter = {
  kind: "noop",
  captureException: () => undefined,
};

function createSafeReporter(adapter: NpErrorReporter): NpErrorReporter {
  const adapterKind = adapter.kind;
  return {
    kind: adapterKind,
    async captureException(error, context) {
      await dispatchError(adapter, adapterKind, error, context);
    },
  };
}

let currentAdapter: NpErrorReporter = noopAdapter;
export const noopErrorReporter: NpErrorReporter = createSafeReporter(noopAdapter);
let currentReporter: NpErrorReporter = noopErrorReporter;

export function setErrorReporter(reporter: NpErrorReporter): void {
  const validated = npRequireErrorReporter(reporter);
  const useNoop = validated === noopAdapter || validated === noopErrorReporter;
  const nextAdapter = useNoop ? noopAdapter : validated;
  const nextReporter = useNoop ? noopErrorReporter : createSafeReporter(validated);
  currentAdapter = nextAdapter;
  currentReporter = nextReporter;
}

export function getErrorReporter(): NpErrorReporter {
  return currentReporter;
}

/** Internal raw-adapter access for transactional runtime configuration. */
export function npGetErrorReporterAdapter(): NpErrorReporter {
  return currentAdapter;
}

async function dispatchError(
  adapter: NpErrorReporter,
  adapterKind: string,
  error: Error,
  context?: NpErrorReportContext,
): Promise<void> {
  let validatedError: Error;
  let validatedContext: NpErrorReportContext | undefined;
  try {
    validatedError = npRequireReportedError(error);
    validatedContext = context === undefined ? undefined : npRequireErrorReportContext(context);
  } catch (reporterError) {
    npRecordObservabilityFailure("error-reporter", "contract", adapterKind, reporterError);
    return;
  }

  try {
    const result = await adapter.captureException(validatedError, validatedContext);
    npRequireObservabilityVoidResult(result, "observability.errorReporter.captureException.result");
  } catch (reporterError) {
    npRecordObservabilityFailure("error-reporter", "dispatch", adapterKind, reporterError);
  }
}

export async function reportError(error: Error, context?: NpErrorReportContext): Promise<void> {
  await dispatchError(currentAdapter, currentReporter.kind, error, context);
}

export function resetErrorReporter(): void {
  currentAdapter = noopAdapter;
  currentReporter = noopErrorReporter;
}

export async function npCloseErrorReporterAdapter(
  reporter: NpErrorReporter,
  adapterKind = reporter.kind,
): Promise<void> {
  if (reporter.shutdown === undefined) return;
  try {
    const result = await reporter.shutdown();
    npRequireObservabilityVoidResult(result, "observability.errorReporter.shutdown.result");
  } catch (error) {
    npRecordObservabilityFailure("error-reporter", "shutdown", adapterKind, error);
    throw error;
  }
}

export async function npShutdownErrorReporter(): Promise<void> {
  const adapter = currentAdapter;
  const adapterKind = currentReporter.kind;
  resetErrorReporter();
  await npCloseErrorReporterAdapter(adapter, adapterKind);
}

export type { NpErrorReporter, NpErrorReportContext } from "./types.js";
