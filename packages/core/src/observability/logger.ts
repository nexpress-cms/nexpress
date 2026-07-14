/**
 * Fail-safe structured logger registry. Adapter shape is validated at install
 * time; event shape, child adapters, async results, and shutdown are validated
 * at their respective boundaries without letting telemetry break the host.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type * as JobLogModule from "../jobs/job-log.js";
import {
  npRequireLogContext,
  npRequireLogEvent,
  npRequireLogger,
  npRequireObservabilityVoidResult,
} from "./contract.js";
import { npRecordObservabilityFailure } from "./diagnostics.js";
import type { NpLogContext, NpLogEvent, NpLogger, NpLoggerAdapter } from "./types.js";

const jobLogTeeScope = new AsyncLocalStorage<boolean>();
let teeImportPromise: Promise<typeof JobLogModule> | null = null;

function emitConsole(level: NpLogEvent["level"], message: string, context?: NpLogContext): void {
  const write =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "info"
          ? console.info
          : console.debug;
  if (context && Object.keys(context).length > 0) write(`[${level}] ${message}`, context);
  else write(`[${level}] ${message}`);
}

const consoleAdapter: NpLoggerAdapter = {
  kind: "console",
  debug: (message, context) => emitConsole("debug", message, context),
  info: (message, context) => emitConsole("info", message, context),
  warn: (message, context) => emitConsole("warn", message, context),
  error: (message, context) => emitConsole("error", message, context),
};

async function teeToJobLog(event: NpLogEvent): Promise<void> {
  if (jobLogTeeScope.getStore() === true) return;
  await jobLogTeeScope.run(true, async () => {
    try {
      teeImportPromise ??= import("../jobs/job-log.js");
      const module = await teeImportPromise;
      if (module.getCurrentJobId() !== null) {
        await module.recordJobLog(event.level, event.message, event.context);
      }
    } catch {
      // recordJobLog owns its diagnostics. The guard prevents its logger call
      // from recursively teeing the same failure back into the job log.
    }
  });
}

function observeResult(
  result: void | Promise<void>,
  adapterKind: string,
  operation: "dispatch" | "shutdown",
  path: string,
): void {
  if (
    result instanceof Promise ||
    (typeof result === "object" && result !== null && "then" in result)
  ) {
    void Promise.resolve(result)
      .then((value) => npRequireObservabilityVoidResult(value, path))
      .catch((error: unknown) =>
        npRecordObservabilityFailure("logger", operation, adapterKind, error),
      );
    return;
  }
  npRequireObservabilityVoidResult(result, path);
}

function mergeContext(bindings: NpLogContext, context?: NpLogContext): NpLogContext {
  return context === undefined ? { ...bindings } : { ...bindings, ...context };
}

function createSafeLogger(adapter: NpLoggerAdapter, bindings?: NpLogContext): NpLogger {
  const adapterKind = adapter.kind;
  const dispatch = (level: NpLogEvent["level"], message: string, context?: NpLogContext): void => {
    let event: NpLogEvent;
    try {
      event = npRequireLogEvent({
        level,
        message,
        context: bindings === undefined ? context : mergeContext(bindings, context),
      });
    } catch (error) {
      npRecordObservabilityFailure("logger", "contract", adapterKind, error);
      return;
    }

    try {
      const result = adapter[level](event.message, event.context);
      observeResult(result, adapterKind, "dispatch", `observability.logger.${level}.result`);
    } catch (error) {
      npRecordObservabilityFailure("logger", "dispatch", adapterKind, error);
    }
    void teeToJobLog(event);
  };

  return {
    kind: adapterKind,
    debug: (message, context) => dispatch("debug", message, context),
    info: (message, context) => dispatch("info", message, context),
    warn: (message, context) => dispatch("warn", message, context),
    error: (message, context) => dispatch("error", message, context),
    child(childBindings) {
      let validatedBindings: NpLogContext;
      try {
        validatedBindings = npRequireLogContext(
          childBindings,
          "observability.logger.child.bindings",
        );
      } catch (error) {
        npRecordObservabilityFailure("logger", "contract", adapterKind, error);
        return createSafeLogger(adapter, bindings);
      }

      const combined =
        bindings === undefined ? validatedBindings : mergeContext(bindings, validatedBindings);
      if (bindings === undefined && typeof adapter.child === "function") {
        try {
          const child = npRequireLogger(
            adapter.child(validatedBindings),
            "observability.logger.child.result",
          );
          if (child.kind !== adapterKind) {
            throw new Error(
              `Logger child kind ${JSON.stringify(child.kind)} does not match parent kind ${JSON.stringify(adapterKind)}.`,
            );
          }
          return createSafeLogger(child);
        } catch (error) {
          npRecordObservabilityFailure("logger", "child", adapterKind, error);
        }
      }
      return createSafeLogger(adapter, combined);
    },
  };
}

let currentAdapter: NpLoggerAdapter = consoleAdapter;

/** Default fail-safe logger backed by the process console. */
export const consoleLogger: NpLogger = createSafeLogger(consoleAdapter);
let currentLogger: NpLogger = consoleLogger;

/** Install a logger after validating its definition-level contract. */
export function setLogger(logger: NpLoggerAdapter): void {
  const validated = npRequireLogger(logger);
  const useConsole = validated === consoleLogger || validated === consoleAdapter;
  const nextAdapter = useConsole ? consoleAdapter : validated;
  const nextLogger = useConsole ? consoleLogger : createSafeLogger(validated);
  currentAdapter = nextAdapter;
  currentLogger = nextLogger;
}

export function getLogger(): NpLogger {
  return currentLogger;
}

/** Internal raw-adapter access for transactional runtime configuration. */
export function npGetLoggerAdapter(): NpLoggerAdapter {
  return currentAdapter;
}

export function getScopedLogger(bindings: NpLogContext): NpLogger {
  return currentLogger.child?.(bindings) ?? currentLogger;
}

export function resetLogger(): void {
  currentAdapter = consoleAdapter;
  currentLogger = consoleLogger;
}

export async function npCloseLoggerAdapter(
  logger: NpLoggerAdapter,
  adapterKind = logger.kind,
): Promise<void> {
  if (logger.shutdown === undefined) return;
  try {
    const result = await logger.shutdown();
    npRequireObservabilityVoidResult(result, "observability.logger.shutdown.result");
  } catch (error) {
    npRecordObservabilityFailure("logger", "shutdown", adapterKind, error);
    throw error;
  }
}

export async function npShutdownLogger(): Promise<void> {
  const adapter = currentAdapter;
  const adapterKind = currentLogger.kind;
  resetLogger();
  await npCloseLoggerAdapter(adapter, adapterKind);
}

export type { NpLogContext, NpLogEvent, NpLogLevel, NpLogger, NpLoggerAdapter } from "./types.js";
