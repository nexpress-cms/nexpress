/**
 * Pluggable structured logger. Defaults to a `console`-backed
 * implementation that pretty-prints level + message + context, but
 * production deployments should swap in their own (pino, winston,
 * Datadog agent, Axiom, etc.) via `setLogger()`.
 *
 * Plugin authors should not call this directly — they get a logger
 * via `ctx.log` which forwards here under the hood with the plugin's
 * id bound as context.
 */
import type * as JobLogModule from "../jobs/job-log.js";

export type NxLogLevel = "debug" | "info" | "warn" | "error";

export interface NxLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /**
   * Returns a new logger that automatically merges `bindings` into every
   * log call's context. Optional — host code falls back to merging
   * inline when `child` is missing.
   */
  child?(bindings: Record<string, unknown>): NxLogger;
}

function emitConsole(level: NxLogLevel, message: string, context?: Record<string, unknown>): void {
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "info"
          ? console.info
          : console.debug;
  if (context && Object.keys(context).length > 0) {
    fn(`[${level}] ${message}`, context);
  } else {
    fn(`[${level}] ${message}`);
  }
  // Phase 20.3 — when emitted from inside a job handler, also
  // tee the line into `nx_job_logs`. Dynamic import is
  // deliberate: the job-log module pulls in the schema (pg),
  // and the logger module is imported by code paths (CLI
  // scaffolds, pure-function tests) that don't have a DB. Lazy
  // import + fire-and-forget keeps `getLogger().info(...)` calls
  // synchronous and free of cost outside worker contexts.
  void teeToJobLog(level, message, context);
}

let teeImportPromise: Promise<typeof JobLogModule> | null = null;
async function teeToJobLog(
  level: NxLogLevel,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!teeImportPromise) {
      teeImportPromise = import("../jobs/job-log.js");
    }
    const mod = await teeImportPromise;
    if (mod.getCurrentJobId() !== null) {
      await mod.recordJobLog(level, message, context);
    }
  } catch {
    // Already wrote to console; swallow secondary failures so
    // the logger never throws. recordJobLog already has internal
    // try/catch around the DB write — this catch is for the
    // dynamic import itself.
  }
}

/** Default logger — emits to `console`. Replaceable via `setLogger`. */
export const consoleLogger: NxLogger = {
  debug: (msg, ctx) => emitConsole("debug", msg, ctx),
  info: (msg, ctx) => emitConsole("info", msg, ctx),
  warn: (msg, ctx) => emitConsole("warn", msg, ctx),
  error: (msg, ctx) => emitConsole("error", msg, ctx),
  child(bindings) {
    return {
      debug: (msg, ctx) => emitConsole("debug", msg, { ...bindings, ...ctx }),
      info: (msg, ctx) => emitConsole("info", msg, { ...bindings, ...ctx }),
      warn: (msg, ctx) => emitConsole("warn", msg, { ...bindings, ...ctx }),
      error: (msg, ctx) => emitConsole("error", msg, { ...bindings, ...ctx }),
    };
  },
};

let currentLogger: NxLogger = consoleLogger;

/** Replace the global logger. Call once at app boot, before any route runs. */
export function setLogger(logger: NxLogger): void {
  currentLogger = logger;
}

/** Returns the currently-installed logger. Defaults to `consoleLogger`. */
export function getLogger(): NxLogger {
  return currentLogger;
}

/**
 * Convenience for code that wants a logger scoped to a subsystem (e.g.
 * a plugin id, a job handler name) regardless of whether the installed
 * logger natively supports `child()`.
 */
export function getScopedLogger(bindings: Record<string, unknown>): NxLogger {
  const logger = getLogger();
  if (typeof logger.child === "function") {
    return logger.child(bindings);
  }
  return {
    debug: (msg, ctx) => logger.debug(msg, { ...bindings, ...ctx }),
    info: (msg, ctx) => logger.info(msg, { ...bindings, ...ctx }),
    warn: (msg, ctx) => logger.warn(msg, { ...bindings, ...ctx }),
    error: (msg, ctx) => logger.error(msg, { ...bindings, ...ctx }),
  };
}

/** Reset to the default console logger. Tests use this to undo `setLogger`. */
export function resetLogger(): void {
  currentLogger = consoleLogger;
}
