export { consoleLogger, getLogger, getScopedLogger, resetLogger, setLogger } from "./logger.js";

export {
  getErrorReporter,
  noopErrorReporter,
  reportError,
  resetErrorReporter,
  setErrorReporter,
} from "./error-reporter.js";

export { getObservabilityDiagnostics, resetObservabilityDiagnostics } from "./diagnostics.js";

export {
  configureObservability,
  configureObservabilityFromEnv,
  getObservabilityRuntimeConfig,
  resetObservability,
  shutdownObservability,
} from "./runtime.js";

export {
  NpObservabilityContractError,
  npAnalyzeErrorReportContext,
  npAnalyzeErrorReporter,
  npAnalyzeLogEvent,
  npAnalyzeLogger,
  npObservabilityAdaptersMatchRuntimeConfig,
  npObservabilityContractLimits,
  npReadObservabilityRuntimeConfig,
  npRequireErrorReportContext,
  npRequireErrorReporter,
  npRequireLogContext,
  npRequireLogEvent,
  npRequireLogger,
  npRequireObservabilityAdapters,
  npRequireObservabilityRuntimeConfig,
} from "./contract.js";
export type { NpObservabilityContractIssue, NpObservabilityContractIssueCode } from "./contract.js";

export type {
  NpErrorReportContext,
  NpErrorReporter,
  NpErrorReporterRuntimeMode,
  NpLogContext,
  NpLogEvent,
  NpLogger,
  NpLoggerAdapter,
  NpLoggerRuntimeMode,
  NpLogLevel,
  NpObservabilityAdapters,
  NpObservabilityDiagnostics,
  NpObservabilityFailure,
  NpObservabilityFailureComponent,
  NpObservabilityFailureOperation,
  NpObservabilityRuntimeConfig,
} from "./types.js";

export { verifyStartupSafety } from "./safety-check.js";
export type { NpStartupSafetyInput } from "./safety-check.js";
