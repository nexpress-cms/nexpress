export {
  consoleLogger,
  getLogger,
  getScopedLogger,
  resetLogger,
  setLogger,
} from "./logger.js";
export type { NxLogLevel, NxLogger } from "./logger.js";

export {
  getErrorReporter,
  noopErrorReporter,
  reportError,
  resetErrorReporter,
  setErrorReporter,
} from "./error-reporter.js";
export type { NxErrorReporter, NxErrorReportContext } from "./error-reporter.js";
