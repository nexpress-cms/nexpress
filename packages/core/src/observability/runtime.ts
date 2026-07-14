import {
  NpObservabilityContractError,
  npObservabilityAdaptersMatchRuntimeConfig,
  npReadObservabilityRuntimeConfig,
  npRequireObservabilityAdapters,
  npRequireObservabilityRuntimeConfig,
  type NpObservabilityContractIssue,
} from "./contract.js";
import { resetObservabilityDiagnostics } from "./diagnostics.js";
import {
  getErrorReporter,
  noopErrorReporter,
  npCloseErrorReporterAdapter,
  npGetErrorReporterAdapter,
  resetErrorReporter,
  setErrorReporter,
} from "./error-reporter.js";
import {
  consoleLogger,
  getLogger,
  npCloseLoggerAdapter,
  npGetLoggerAdapter,
  resetLogger,
  setLogger,
} from "./logger.js";
import type { NpObservabilityAdapters, NpObservabilityRuntimeConfig } from "./types.js";

let runtimeConfig: NpObservabilityRuntimeConfig | null = null;

function mismatchMessage(config: NpObservabilityRuntimeConfig): string {
  return `Observability adapters do not match runtime intent (logger=${config.logger}, errorReporter=${config.errorReporter}).`;
}

/**
 * Configure both adapters as one transaction. Omitted custom adapters reuse a
 * previously registered non-default adapter, which supports app composition.
 */
export function configureObservability(
  config: NpObservabilityRuntimeConfig,
  adapters: NpObservabilityAdapters = {},
): NpObservabilityRuntimeConfig {
  const validatedConfig = npRequireObservabilityRuntimeConfig(config);
  const validatedAdapters = npRequireObservabilityAdapters(adapters);
  const injectionIssues: NpObservabilityContractIssue[] = [];
  if (validatedConfig.logger !== "custom" && validatedAdapters.logger !== undefined) {
    injectionIssues.push({
      code: "invariant",
      path: "observability.adapters.logger",
      message: "a logger adapter may only be injected when logger intent is custom.",
    });
  }
  if (validatedConfig.errorReporter !== "custom" && validatedAdapters.errorReporter !== undefined) {
    injectionIssues.push({
      code: "invariant",
      path: "observability.adapters.errorReporter",
      message: "an error reporter may only be injected when reporter intent is custom.",
    });
  }
  if (injectionIssues.length > 0) {
    throw new NpObservabilityContractError(
      "Invalid observability runtime configuration",
      injectionIssues,
    );
  }
  const logger =
    validatedAdapters.logger ??
    (validatedConfig.logger === "console" ? consoleLogger : npGetLoggerAdapter());
  const errorReporter =
    validatedAdapters.errorReporter ??
    (validatedConfig.errorReporter === "noop" ? noopErrorReporter : npGetErrorReporterAdapter());

  if (!npObservabilityAdaptersMatchRuntimeConfig(validatedConfig, logger, errorReporter)) {
    throw new NpObservabilityContractError("Invalid observability runtime configuration", [
      {
        code: "invariant",
        path: "observability.runtime",
        message: mismatchMessage(validatedConfig),
      },
    ]);
  }

  setLogger(logger);
  setErrorReporter(errorReporter);
  runtimeConfig = validatedConfig;
  return validatedConfig;
}

export function configureObservabilityFromEnv(
  env: Record<string, string | undefined>,
  adapters: NpObservabilityAdapters = {},
): NpObservabilityRuntimeConfig {
  return configureObservability(npReadObservabilityRuntimeConfig(env), adapters);
}

export function getObservabilityRuntimeConfig(): NpObservabilityRuntimeConfig | null {
  return runtimeConfig;
}

export function resetObservability(): void {
  runtimeConfig = null;
  resetLogger();
  resetErrorReporter();
  resetObservabilityDiagnostics();
}

export async function shutdownObservability(): Promise<void> {
  const logger = npGetLoggerAdapter();
  const errorReporter = npGetErrorReporterAdapter();
  const loggerKind = getLogger().kind;
  const errorReporterKind = getErrorReporter().kind;
  runtimeConfig = null;
  resetLogger();
  resetErrorReporter();

  const failures: unknown[] = [];
  try {
    await npCloseErrorReporterAdapter(errorReporter, errorReporterKind);
  } catch (error) {
    failures.push(error);
  }
  try {
    await npCloseLoggerAdapter(logger, loggerKind);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "One or more observability adapters failed to shut down.");
  }
}
