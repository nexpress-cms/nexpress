/** Worker-safe diagnostics shared by the health page and explicit Operator owners.
 * Reading these checks never imports application DB/bootstrap wiring. */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getCacheInvalidationDiagnostics,
  getOptionalCacheInvalidationAdapter,
} from "@nexpress/core/cache";
import {
  getErrorReporter,
  getLogger,
  getObservabilityDiagnostics,
  getObservabilityRuntimeConfig,
  npObservabilityAdaptersMatchRuntimeConfig,
  npReadObservabilityRuntimeConfig,
} from "@nexpress/core/observability";
import { getCollectionRuntimeDiagnostics } from "@nexpress/core/collections";
import {
  getOptionalStorageRuntimeConfig,
  getStorageAdapter,
  npReadStorageRuntimeConfig,
  npStorageAdapterMatchesRuntimeConfig,
} from "@nexpress/core/storage";

export interface Check {
  id: string;
  label: string;
  state: "ok" | "warn" | "error";
  detail?: string;
  hint?: string;
}

export async function checkStorageAdapter(): Promise<Check> {
  try {
    const adapter = getStorageAdapter();
    const config = getOptionalStorageRuntimeConfig() ?? npReadStorageRuntimeConfig(process.env);
    if (!npStorageAdapterMatchesRuntimeConfig(config, adapter)) {
      return {
        id: "storage",
        label: "Storage adapter",
        state: "error",
        detail: `${config.adapter} requested, ${adapter.kind} registered`,
        hint: "Align the configured storage intent with the adapter installed by createBootstrap().",
      };
    }
    if (config.adapter === "local") {
      const dir = config.local.directory;
      const suffix = dir !== "./public/media" && dir !== "public/media" ? " (custom path)" : "";
      const path = resolve(/* turbopackIgnore: true */ process.cwd(), dir);
      try {
        const s = await stat(/* turbopackIgnore: true */ path);
        if (!s.isDirectory()) {
          return {
            id: "storage",
            label: "Storage adapter",
            state: "error",
            detail: `${dir} exists but is not a directory`,
            hint: "Move the file aside or pick a different NP_STORAGE_DIR.",
          };
        }
        return {
          id: "storage",
          label: "Storage adapter",
          state: "ok",
          detail: `local · ${dir}${suffix}`,
        };
      } catch (error) {
        if (!isMissingPathError(error)) {
          return {
            id: "storage",
            label: "Storage adapter",
            state: "error",
            detail: error instanceof Error ? error.message : String(error),
            hint: "Ensure the process can inspect NP_STORAGE_DIR.",
          };
        }
        return {
          id: "storage",
          label: "Storage adapter",
          state: "warn",
          detail: `local · ${dir} (will be created on first upload)`,
        };
      }
    }
    if (config.adapter === "s3") {
      return {
        id: "storage",
        label: "Storage adapter",
        state: "ok",
        detail: `s3 · ${config.s3.bucket} (${config.s3.region})`,
      };
    }
    return {
      id: "storage",
      label: "Storage adapter",
      state: "ok",
      detail: `custom (${adapter.kind})`,
    };
  } catch (err) {
    return {
      id: "storage",
      label: "Storage adapter",
      state: "error",
      detail: err instanceof Error ? err.message : String(err),
      hint: "Fix the storage runtime contract before accepting media traffic.",
    };
  }
}

/**
 * SITE_URL is the runtime parallel of the boot-time check in
 * `verifyStartupSafety` (#597). Mirroring it on the health page
 * means an operator who's debugging "why did password reset stop
 * sending the right link" sees the answer here instead of having
 * to grep boot logs.
 *
 * Exported so the unit suite can drive each branch directly by
 * mutating `process.env` — no need to spin up the full health
 * gather + integration DB.
 */
export function checkSiteUrl(): Check {
  const raw = process.env.SITE_URL ?? "";
  if (!raw) {
    return {
      id: "site_url",
      label: "SITE_URL",
      state: "error",
      detail: "unset",
      hint:
        "Set SITE_URL in `.env` to your public origin. Sitemap URLs, " +
        "OAuth callbacks, and outbound email links all anchor on it. " +
        "Password-reset / email-verify flows refuse to run without it (#598).",
    };
  }
  try {
    const url = new URL(raw);
    const host = url.hostname;
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"];
    if (loopback.includes(host)) {
      return {
        id: "site_url",
        label: "SITE_URL",
        state: "warn",
        detail: `loopback origin (${host})`,
        hint:
          "Loopback in production breaks share links, OAuth round-trips, " +
          "and outbound email links. Set to your public origin once you " +
          "deploy.",
      };
    }
    return { id: "site_url", label: "SITE_URL", state: "ok", detail: url.origin };
  } catch (err) {
    return {
      id: "site_url",
      label: "SITE_URL",
      state: "error",
      detail: err instanceof Error ? err.message : "unparseable",
      hint: "SITE_URL must be a parseable absolute URL (e.g. https://example.com).",
    };
  }
}

/** Live logger/reporter intent, implementation, and recent dispatch health. */
export function checkObservabilityAdapters(): Check {
  try {
    const config = getObservabilityRuntimeConfig() ?? npReadObservabilityRuntimeConfig(process.env);
    const logger = getLogger();
    const reporter = getErrorReporter();
    const diagnostics = getObservabilityDiagnostics();
    if (!npObservabilityAdaptersMatchRuntimeConfig(config, logger, reporter)) {
      return {
        id: "observability",
        label: "Observability adapters",
        state: "error",
        detail: `${config.logger}/${config.errorReporter} requested, ${logger.kind}/${reporter.kind} registered`,
        hint: "Align NP_LOGGER_ADAPTER and NP_ERROR_REPORTER_ADAPTER with the adapters passed to createBootstrap().",
      };
    }

    const failures = diagnostics.loggerFailures + diagnostics.errorReporterFailures;
    if (failures > 0) {
      const last = diagnostics.lastFailure;
      return {
        id: "observability",
        label: "Observability adapters",
        state: "warn",
        detail: `${logger.kind} logger · ${reporter.kind} reporter · ${failures.toString()} process failure${failures === 1 ? "" : "s"} contained`,
        hint: last
          ? `Last ${last.component} ${last.operation} failure from ${last.adapterKind} at ${last.occurredAt}: ${last.message}`
          : "Inspect process stderr for the contained adapter failure.",
      };
    }

    if (config.errorReporter === "noop") {
      return {
        id: "observability",
        label: "Observability adapters",
        state: "warn",
        detail: `${logger.kind} logger · noop error reporter`,
        hint: "Production exceptions are not exported. Set NP_ERROR_REPORTER_ADAPTER=custom and pass an adapter to createBootstrap().",
      };
    }

    return {
      id: "observability",
      label: "Observability adapters",
      state: "ok",
      detail: `${logger.kind} logger · ${reporter.kind} reporter`,
    };
  } catch (error) {
    return {
      id: "observability",
      label: "Observability adapters",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix the exact observability runtime contract before accepting production traffic.",
    };
  }
}

/** Live invalidation host and contained dispatch/CDN failures. */
export function checkCacheInvalidation(): Check {
  const adapter = getOptionalCacheInvalidationAdapter();
  const diagnostics = getCacheInvalidationDiagnostics();
  if (!adapter) {
    return {
      id: "cache-invalidation",
      label: "Cache invalidation",
      state: "error",
      detail: "no host adapter registered",
      hint: "Initialize requests through createBootstrap().ensureFor() before serving traffic.",
    };
  }
  if (diagnostics.partial > 0 || diagnostics.unavailable > 0) {
    const last = diagnostics.lastFailure;
    return {
      id: "cache-invalidation",
      label: "Cache invalidation",
      state: "warn",
      detail: `${adapter.kind} · ${diagnostics.partial.toString()} partial · ${diagnostics.unavailable.toString()} unavailable`,
      hint: last
        ? `Last ${last.operation} failure from ${last.adapterKind} at ${last.occurredAt}: ${last.message}`
        : "Inspect process logs and the configured CDN purge provider.",
    };
  }
  return {
    id: "cache-invalidation",
    label: "Cache invalidation",
    state: "ok",
    detail: `${adapter.kind} · ${diagnostics.applied.toString()}/${diagnostics.attempts.toString()} attempts applied`,
  };
}

/** Fail-closed collection hydration, hook-result, and API serialization boundaries. */
export function checkCollectionRuntime(): Check {
  try {
    const diagnostics = getCollectionRuntimeDiagnostics();
    const last = diagnostics.at(-1);
    if (last) {
      return {
        id: "collections",
        label: "Collection document contracts",
        state: "error",
        detail: `${diagnostics.length.toString()} runtime contract failure${diagnostics.length === 1 ? "" : "s"}`,
        hint: `Last ${last.operation} failure for ${last.collection} at ${last.occurredAt}: ${last.message}`,
      };
    }
    return {
      id: "collections",
      label: "Collection document contracts",
      state: "ok",
      detail: "storage, runtime, and wire boundaries valid",
    };
  } catch (error) {
    return {
      id: "collections",
      label: "Collection document contracts",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix collection registration and persisted document contracts before serving collection traffic.",
    };
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
