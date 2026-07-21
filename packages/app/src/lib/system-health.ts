import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  getAllPluginIds,
  getJobsPauseState,
  getOptionalJobQueue,
  listWorkerHealth,
} from "@nexpress/core";
import {
  getCacheInvalidationDiagnostics,
  getOptionalCacheInvalidationAdapter,
} from "@nexpress/core/cache";
import { getEmailAdapter, npReadEmailRuntimeConfig } from "@nexpress/core/email";
import {
  getErrorReporter,
  getLogger,
  getObservabilityDiagnostics,
  getObservabilityRuntimeConfig,
  npObservabilityAdaptersMatchRuntimeConfig,
  npReadObservabilityRuntimeConfig,
} from "@nexpress/core/observability";
import { getSearchAdapterDiagnostics } from "@nexpress/core/search";
import { getI18nRuntimeDiagnostics } from "@nexpress/core/i18n";
import { getCommunityRuntimeDiagnostics } from "@nexpress/core/community";
import { getCollectionRuntimeDiagnostics } from "@nexpress/core/collections";
import {
  getOptionalStorageRuntimeConfig,
  getStorageAdapter,
  npReadStorageRuntimeConfig,
  npStorageAdapterMatchesRuntimeConfig,
} from "@nexpress/core/storage";

import { getDb } from "./db";

/**
 * Read-only system diagnostics for `/admin/health`. Pairs with
 * `pnpm run doctor` (#404, CLI side): doctor inspects pre-boot
 * env on a developer's laptop, this surface inspects the live
 * runtime an operator is logged into.
 *
 * Each `Check` is one row in the UI:
 *   - state "ok"    green ✓
 *   - state "warn"  yellow ⚠ (non-fatal)
 *   - state "error" red ✗ (something to fix)
 *
 * Every probe is wrapped in try/catch — a single failed check must
 * not crash the page. Operators come here precisely when something
 * is already wrong; the surface has to keep rendering.
 */

export interface Check {
  id: string;
  label: string;
  state: "ok" | "warn" | "error";
  detail?: string;
  hint?: string;
}

export interface HealthSummary {
  generatedAt: string;
  checks: Check[];
  errorCount: number;
  warnCount: number;
}

const FRAMEWORK_TABLES = ["np_users", "np_settings", "np_navigation", "np_sites"] as const;

async function checkDatabase(): Promise<Check> {
  try {
    const db = getDb();
    const result = (await db.$client.query<{ version: string }>("select version()")) as {
      rows: Array<{ version: string }>;
    };
    const version = result.rows[0]?.version?.split(" ").slice(0, 2).join(" ") ?? "Postgres";
    return {
      id: "db",
      label: "Postgres",
      state: "ok",
      detail: version,
    };
  } catch (err) {
    return {
      id: "db",
      label: "Postgres",
      state: "error",
      detail: err instanceof Error ? err.message : String(err),
      hint: "DB unreachable. Confirm DATABASE_URL and that the Postgres service is running.",
    };
  }
}

async function checkMigrations(): Promise<Check> {
  try {
    const db = getDb();
    const result = (await db.$client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = ANY($1::text[])`,
      [FRAMEWORK_TABLES],
    )) as { rows: Array<{ table_name: string }> };
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = FRAMEWORK_TABLES.filter((t) => !present.has(t));
    if (missing.length === 0) {
      return {
        id: "migrations",
        label: "Migrations applied",
        state: "ok",
        detail: `${FRAMEWORK_TABLES.length} framework tables present`,
      };
    }
    // Stale-tracking footgun: a partial \`DROP TABLE\` / \`DROP SCHEMA
    // public\` clears framework tables but leaves
    // \`drizzle.__drizzle_migrations\` behind, so subsequent
    // \`pnpm db:migrate\` thinks everything is applied and silently
    // no-ops. Detect that case so we can hand back the specific
    // recovery (drop both schemas, re-migrate).
    const trackingTable = (await db.$client.query<{ exists: boolean }>(
      `select exists(
         select 1 from information_schema.tables
         where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
       ) as exists`,
    )) as { rows: Array<{ exists: boolean }> };
    let trackedCount = 0;
    if (trackingTable.rows[0]?.exists) {
      const tracked = (await db.$client.query<{ count: string }>(
        "select count(*)::text as count from drizzle.__drizzle_migrations",
      )) as { rows: Array<{ count: string }> };
      trackedCount = Number.parseInt(tracked.rows[0]?.count ?? "0", 10) || 0;
    }
    if (trackedCount > 0) {
      return {
        id: "migrations",
        label: "Migrations applied",
        state: "error",
        detail: `drizzle tracks ${trackedCount.toString()} applied, but framework tables are missing`,
        hint:
          "Stale tracking from a partial drop. Reset both schemas, then re-migrate:\n" +
          'docker compose exec db psql -U nexpress -d nexpress -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" && pnpm db:migrate',
      };
    }
    return {
      id: "migrations",
      label: "Migrations applied",
      state: "error",
      detail: `missing ${missing.join(", ")}`,
      hint: "Run `pnpm db:generate && pnpm db:migrate`.",
    };
  } catch (err) {
    return {
      id: "migrations",
      label: "Migrations applied",
      state: "warn",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
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

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function checkQueue(): Promise<Check> {
  try {
    const queue = getOptionalJobQueue();
    if (!queue) {
      return {
        id: "queue",
        label: "Job queue",
        state: "warn",
        detail: "not configured (background jobs disabled)",
        hint: "Set NP_ENABLE_JOBS=1 if you want background work to run.",
      };
    }
    const [workers, pause] = await Promise.all([listWorkerHealth(), getJobsPauseState()]);
    if (pause.paused) {
      return {
        id: "queue",
        label: "Job queue",
        state: "warn",
        detail: "paused",
        hint: "Resume from /admin/jobs once whatever caused the pause is resolved.",
      };
    }
    if (workers.aliveCount === 0 && workers.totalCount > 0) {
      return {
        id: "queue",
        label: "Job queue",
        state: "error",
        detail: `${workers.totalCount.toString()} workers registered, none alive`,
        hint: "Restart the worker process(es). See /admin/jobs.",
      };
    }
    if (workers.totalCount === 0) {
      return {
        id: "queue",
        label: "Job queue",
        state: "warn",
        detail: "no workers have started yet",
        hint: "If a worker should be running, check the process / its logs.",
      };
    }
    return {
      id: "queue",
      label: "Job queue",
      state: "ok",
      detail: `${workers.aliveCount.toString()}/${workers.totalCount.toString()} workers alive`,
    };
  } catch (err) {
    return {
      id: "queue",
      label: "Job queue",
      state: "warn",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkPlugins(): Check {
  try {
    const ids = getAllPluginIds();
    return {
      id: "plugins",
      label: "Plugins loaded",
      state: "ok",
      detail: ids.length === 0 ? "0 plugins" : `${ids.length.toString()} · ${ids.join(", ")}`,
    };
  } catch (err) {
    return {
      id: "plugins",
      label: "Plugins loaded",
      state: "warn",
      detail: err instanceof Error ? err.message : String(err),
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

/**
 * Email adapter — runtime parallel of the boot-time check in
 * #597. Parses the exact environment contract, then checks the live
 * adapter when the operator selected programmatic `custom` mode.
 * Catches both malformed SMTP settings and a custom mode with no
 * registered delivery implementation.
 */
export function checkEmailAdapter(): Check {
  try {
    const config = npReadEmailRuntimeConfig(process.env);
    if (config.adapter === "noop") {
      const explicit = process.env.NP_EMAIL_ADAPTER === "noop";
      return {
        id: "email",
        label: "Email adapter",
        state: "warn",
        detail: explicit ? "noop" : "unset (defaults to noop)",
        hint:
          "Transactional mail (password reset, email verify, member " +
          "digests) is intentionally dropped. Set NP_EMAIL_ADAPTER=smtp + " +
          "the exact NP_SMTP_* contract, or use custom with setEmailAdapter().",
      };
    }
    if (config.adapter === "custom") {
      const liveKind = getEmailAdapter().kind;
      if (liveKind === "noop") {
        return {
          id: "email",
          label: "Email adapter",
          state: "error",
          detail: "custom requested but no adapter is registered",
          hint: "Call setEmailAdapter() before the worker or first write bootstrap.",
        };
      }
      return {
        id: "email",
        label: "Email adapter",
        state: "ok",
        detail: `custom (${liveKind})`,
      };
    }
    return {
      id: "email",
      label: "Email adapter",
      state: "ok",
      detail: `smtp · ${config.options.host}:${config.options.port.toString()} · ${config.options.secure ? "TLS" : "STARTTLS"}`,
    };
  } catch (error) {
    return {
      id: "email",
      label: "Email adapter",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix NP_EMAIL_ADAPTER and NP_SMTP_* before sending transactional mail.",
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

/** Built-in/external search dispatch posture and recently contained failures. */
export function checkSearchAdapter(): Check {
  try {
    const diagnostics = getSearchAdapterDiagnostics();
    const failures =
      diagnostics.dispatchFailures +
      diagnostics.resultContractFailures +
      diagnostics.shutdownFailures;
    const kind = diagnostics.adapterKind ?? "postgres-tsvector";
    if (failures > 0) {
      const last = diagnostics.lastFailure;
      return {
        id: "search",
        label: "Search adapter",
        state: "warn",
        detail: `${kind} · ${diagnostics.audienceContract ?? "no audience contract"} · ${failures.toString()} failure${failures === 1 ? "" : "s"} contained`,
        hint: last
          ? `Last ${last.operation} failure from ${last.adapterKind} at ${last.occurredAt}: ${last.message}`
          : "Inspect process logs and the external search service.",
      };
    }
    return {
      id: "search",
      label: "Search adapter",
      state: "ok",
      detail: diagnostics.adapterKind
        ? `external (${kind}) · ${diagnostics.audienceContract ?? "no audience contract"}`
        : "built-in Postgres tsvector",
    };
  } catch (error) {
    return {
      id: "search",
      label: "Search adapter",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix the search adapter registration contract before serving search traffic.",
    };
  }
}

/** Validated locale/catalog posture and contained ICU execution failures. */
export function checkI18nRuntime(): Check {
  try {
    const diagnostics = getI18nRuntimeDiagnostics();
    const failures = diagnostics.compileFailures + diagnostics.formatFailures;
    if (failures > 0) {
      const last = diagnostics.lastFailure;
      return {
        id: "i18n",
        label: "Internationalization",
        state: "warn",
        detail: `${diagnostics.locales.toString()} locale(s) · ${failures.toString()} ICU failure${failures === 1 ? "" : "s"} contained`,
        hint: last
          ? `Last ${last.operation} failure for ${last.locale}:${last.key} at ${last.occurredAt}: ${last.message}`
          : "Inspect translation parameters and registered catalogs.",
      };
    }
    return {
      id: "i18n",
      label: "Internationalization",
      state: "ok",
      detail: diagnostics.configured
        ? `${diagnostics.locales.toString()} locale(s) · ${(diagnostics.baseStrings + diagnostics.pluginStrings).toString()} registered string(s)`
        : "disabled (monolingual)",
    };
  } catch (error) {
    return {
      id: "i18n",
      label: "Internationalization",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix the exact i18n config and translation registry contracts before rendering localized traffic.",
    };
  }
}

/** Validated community registries and recently contained adapter contract failures. */
export function checkCommunityRuntime(): Check {
  try {
    const diagnostics = getCommunityRuntimeDiagnostics();
    const last = diagnostics.at(-1);
    if (last) {
      return {
        id: "community",
        label: "Community contracts",
        state: "warn",
        detail: `${diagnostics.length.toString()} contained runtime contract failure${diagnostics.length === 1 ? "" : "s"}`,
        hint: `Last ${last.source} failure at ${last.occurredAt}: ${last.message}`,
      };
    }
    return {
      id: "community",
      label: "Community contracts",
      state: "ok",
      detail: "registries and adapters valid",
    };
  } catch (error) {
    return {
      id: "community",
      label: "Community contracts",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix community registry or adapter contracts before accepting member writes.",
    };
  }
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

/**
 * NP_SECRET — runtime parallel of #597's boot-time check, plus
 * the entropy floor introduced in the setup wizard (#618). Most
 * deployments set this once via `pnpm run setup` and forget it;
 * surfacing the runtime view catches the operator who hand-edited
 * `.env` to a low-entropy string after the fact.
 */
export function checkSecret(): Check {
  const secret = process.env.NP_SECRET ?? "";
  if (!secret) {
    return {
      id: "secret",
      label: "NP_SECRET",
      state: "error",
      detail: "unset",
      hint:
        "JWT sessions are signed with an empty key — every token is " +
        "forgeable. Set NP_SECRET in `.env` (≥32 random chars).",
    };
  }
  if (secret.length < 32) {
    return {
      id: "secret",
      label: "NP_SECRET",
      state: "error",
      detail: `${secret.length.toString()} chars (need ≥32)`,
      hint: "Re-run `pnpm run setup` and use the form's `generate` button.",
    };
  }
  const distinct = new Set(secret).size;
  if (distinct < 8) {
    return {
      id: "secret",
      label: "NP_SECRET",
      state: "warn",
      detail: `${secret.length.toString()} chars · only ${distinct.toString()} distinct`,
      hint:
        "Low-entropy secret — trivially brute-forceable. Use the setup " +
        "wizard's `generate` button.",
    };
  }
  return {
    id: "secret",
    label: "NP_SECRET",
    state: "ok",
    detail: `${secret.length.toString()} chars`,
  };
}

export async function gatherSystemHealth(): Promise<HealthSummary> {
  const checks: Check[] = [];
  checks.push(await checkDatabase());
  checks.push(await checkMigrations());
  checks.push(await checkStorageAdapter());
  checks.push(await checkQueue());
  checks.push(checkPlugins());
  checks.push(checkSiteUrl());
  checks.push(checkEmailAdapter());
  checks.push(checkObservabilityAdapters());
  checks.push(checkCacheInvalidation());
  checks.push(checkSearchAdapter());
  checks.push(checkI18nRuntime());
  checks.push(checkCommunityRuntime());
  checks.push(checkCollectionRuntime());
  checks.push(checkSecret());
  return {
    generatedAt: new Date().toISOString(),
    checks,
    errorCount: checks.filter((c) => c.state === "error").length,
    warnCount: checks.filter((c) => c.state === "warn").length,
  };
}
