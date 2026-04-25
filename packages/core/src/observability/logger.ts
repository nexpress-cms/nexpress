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
