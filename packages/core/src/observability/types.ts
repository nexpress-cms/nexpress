export type NpLogLevel = "debug" | "info" | "warn" | "error";

/** Opaque structured data carried to the installed logger. */
export type NpLogContext = Record<string, unknown>;

export interface NpLogEvent {
  readonly level: NpLogLevel;
  readonly message: string;
  readonly context?: NpLogContext;
}

export interface NpLogger {
  readonly kind: string;
  debug(message: string, context?: NpLogContext): void;
  info(message: string, context?: NpLogContext): void;
  warn(message: string, context?: NpLogContext): void;
  error(message: string, context?: NpLogContext): void;
  child?(bindings: NpLogContext): NpLogger;
}

/** Async-capable adapter wrapped by the synchronous, fail-safe NpLogger. */
export interface NpLoggerAdapter {
  readonly kind: string;
  debug(message: string, context?: NpLogContext): void | Promise<void>;
  info(message: string, context?: NpLogContext): void | Promise<void>;
  warn(message: string, context?: NpLogContext): void | Promise<void>;
  error(message: string, context?: NpLogContext): void | Promise<void>;
  /** A child must expose the same canonical adapter kind as its parent. */
  child?(bindings: NpLogContext): NpLoggerAdapter;
  /** Flush and release resources owned by this adapter. */
  shutdown?(): void | Promise<void>;
}

export interface NpErrorReportContext {
  readonly tags?: Record<string, string>;
  readonly user?: { readonly id?: string; readonly email?: string; readonly role?: string };
  readonly extra?: Record<string, unknown>;
}

export interface NpErrorReporter {
  readonly kind: string;
  captureException(error: Error, context?: NpErrorReportContext): void | Promise<void>;
  /** Flush and release resources owned by this adapter. */
  shutdown?(): void | Promise<void>;
}

export type NpLoggerRuntimeMode = "console" | "custom";
export type NpErrorReporterRuntimeMode = "noop" | "custom";

export interface NpObservabilityRuntimeConfig {
  readonly logger: NpLoggerRuntimeMode;
  readonly errorReporter: NpErrorReporterRuntimeMode;
}

export interface NpObservabilityAdapters {
  readonly logger?: NpLoggerAdapter;
  readonly errorReporter?: NpErrorReporter;
}

export type NpObservabilityFailureComponent = "logger" | "error-reporter";
export type NpObservabilityFailureOperation = "contract" | "dispatch" | "child" | "shutdown";

export interface NpObservabilityFailure {
  readonly component: NpObservabilityFailureComponent;
  readonly operation: NpObservabilityFailureOperation;
  readonly adapterKind: string;
  readonly message: string;
  readonly occurredAt: string;
}

export interface NpObservabilityDiagnostics {
  readonly loggerFailures: number;
  readonly errorReporterFailures: number;
  readonly lastFailure: NpObservabilityFailure | null;
}
