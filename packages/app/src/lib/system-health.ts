import {
  checkStorageAdapter,
  checkSiteUrl,
  checkObservabilityAdapters,
  checkCacheInvalidation,
  checkCollectionRuntime,
  type Check,
} from "./system-health-checks";
export {
  checkStorageAdapter,
  checkSiteUrl,
  checkObservabilityAdapters,
  checkCacheInvalidation,
  checkCollectionRuntime,
} from "./system-health-checks";
export type { Check } from "./system-health-checks";
import { npCollectAgentQueueBacklogV1 } from "@nexpress/core/jobs";
import type { NpAgentQueueBacklogV1 } from "@nexpress/core/jobs-contract";

import {
  getAllPluginIds,
  getJobsPauseState,
  getOptionalJobQueue,
  listWorkerHealth,
} from "@nexpress/core";
import { getEmailAdapter, npReadEmailRuntimeConfig } from "@nexpress/core/email";
import { getSearchAdapterDiagnostics } from "@nexpress/core/search";
import { getI18nRuntimeDiagnostics } from "@nexpress/core/i18n";
import {
  npCollectAgentHealthSummaryV1,
  npCollectAgentMaintenanceHealthV1,
  npCollectAgentBudgetHealthV1,
  npCollectAgentWorkerHealthV2,
  npCollectAgentRuntimeOutcomeV1,
} from "@nexpress/core/agents";
import type {
  NpAgentHealthSummaryV1,
  NpAgentMaintenanceHealthV1,
  NpAgentBudgetHealthV1,
  NpAgentWorkerHealthV1,
  NpAgentWorkerHealthV2,
  NpAgentRuntimeOutcomeV1,
} from "@nexpress/core/agent-contract";
import {
  getCommunityRuntimeDiagnostics,
  npGetCommunityRealtimeOutboxStats,
} from "@nexpress/core/community";

import { getDb } from "./db";
import { npGetCommunityRealtimeCapacitySnapshot } from "./community-realtime-capacity";
import { evaluateCommunityRealtimeHealth } from "./community-realtime-health";

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

export interface HealthSummary {
  generatedAt: string;
  checks: Check[];
  errorCount: number;
  warnCount: number;
  agents: NpAgentHealthSummaryV1;
  agentMaintenance: NpAgentMaintenanceHealthV1;
  agentBudget: NpAgentBudgetHealthV1;
  agentWorkers: NpAgentWorkerHealthV1 | NpAgentWorkerHealthV2;
  agentQueueBacklog?: NpAgentQueueBacklogV1;
  agentRuntimeOutcomes?: NpAgentRuntimeOutcomeV1;
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

/** Built-in/external search dispatch posture and recently contained failures. */
export function checkSearchAdapter(): Check {
  try {
    const diagnostics = getSearchAdapterDiagnostics();
    const failures =
      diagnostics.dispatchFailures +
      diagnostics.resultContractFailures +
      diagnostics.indexWriteFailures +
      diagnostics.indexReplaceFailures +
      diagnostics.shutdownFailures;
    const kind = diagnostics.adapterKind ?? "postgres-tsvector";
    if (failures > 0) {
      const last = [diagnostics.lastFailure, diagnostics.lastIndexFailure]
        .filter((entry) => entry !== null)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
        .at(-1);
      return {
        id: "search",
        label: "Search adapter",
        state: "warn",
        detail: `${kind} · ${diagnostics.audienceContract ?? "no audience contract"} · ${diagnostics.indexingContract ? `indexing ${diagnostics.indexingContract}` : "query-only"} · ${failures.toString()} runtime failure${failures === 1 ? "" : "s"}`,
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
        ? `external (${kind}) · ${diagnostics.audienceContract ?? "no audience contract"} · ${diagnostics.indexingContract ? `indexing ${diagnostics.indexingContract}` : "query-only"}`
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

/** Persisted six-hour invalidation outbox backlog and oldest retained row. */
export async function checkCommunityRealtimeOutbox(): Promise<Check> {
  try {
    const queue = getOptionalJobQueue();
    const recentFailureSince = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const recentCleanupFailures =
      queue && typeof queue.listJobs === "function"
        ? (
            await Promise.all(
              (["failed", "expired", "retry"] as const).map((state) =>
                queue.listJobs!({
                  name: "system.communityRealtimePrune",
                  state,
                  since: recentFailureSince,
                  limit: 1,
                }),
              ),
            )
          ).reduce((total, result) => total + result.total, 0)
        : 0;
    return evaluateCommunityRealtimeHealth(
      await npGetCommunityRealtimeOutboxStats(),
      recentCleanupFailures,
    );
  } catch (error) {
    return {
      id: "community.realtime_retention",
      label: "Community realtime retention",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Verify the community migration and hourly cleanup job before relying on realtime invalidation.",
    };
  }
}

/** Process-local SSE admission, queue pressure, and polling diagnostics. */
export function checkCommunityRealtimeCapacity(): Check {
  try {
    const snapshot = npGetCommunityRealtimeCapacitySnapshot();
    const state =
      snapshot.rejectedStreams > 0 || snapshot.backpressureCloses > 0 || snapshot.pollFailures > 0
        ? "warn"
        : "ok";
    const detail =
      `${snapshot.activeStreams.toString()}/${snapshot.maxStreams.toString()} active process streams` +
      ` · ${snapshot.activeSites.toString()} active site(s)` +
      ` · ${snapshot.maxSiteStreams.toString()} per-site limit` +
      ` · peak ${snapshot.peakActiveStreams.toString()}` +
      ` · ${snapshot.admittedStreams.toString()} admitted` +
      ` · ${snapshot.rejectedStreams.toString()} rejected` +
      ` · ${snapshot.backpressureCloses.toString()} pressure close(s)` +
      ` · ${snapshot.pollFailures.toString()} poll failure(s)` +
      ` · since ${snapshot.startedAt}`;
    if (state === "ok") {
      return {
        id: "community.realtime_capacity",
        label: "Community realtime capacity",
        state,
        detail,
      };
    }
    const hint =
      snapshot.pollFailures > 0
        ? "Inspect Postgres and community runtime diagnostics; clients are polling while failed SSE reads reconnect."
        : snapshot.backpressureCloses > 0
          ? "Inspect slow clients and reverse-proxy buffering. Pressure closes resume from the last delivered SSE event id."
          : "Inspect connection-start traffic, then tune NP_COMMUNITY_REALTIME_MAX_STREAMS and NP_COMMUNITY_REALTIME_MAX_SITE_STREAMS if this process has spare capacity.";
    return {
      id: "community.realtime_capacity",
      label: "Community realtime capacity",
      state,
      detail,
      hint,
    };
  } catch (error) {
    return {
      id: "community.realtime_capacity",
      label: "Community realtime capacity",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Set canonical positive stream limits with the per-site limit no greater than the process limit.",
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
  const [
    agents,
    agentMaintenance,
    agentBudget,
    agentWorkers,
    agentQueueBacklog,
    agentRuntimeOutcomes,
  ] = await Promise.all([
    npCollectAgentHealthSummaryV1(),
    npCollectAgentMaintenanceHealthV1(),
    npCollectAgentBudgetHealthV1(),
    npCollectAgentWorkerHealthV2(),
    npCollectAgentQueueBacklogV1(),
    npCollectAgentRuntimeOutcomeV1(),
  ]);
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
  checks.push(await checkCommunityRealtimeOutbox());
  checks.push(checkCommunityRealtimeCapacity());
  checks.push(checkCommunityRuntime());
  checks.push(checkCollectionRuntime());
  checks.push(checkAgentContract(agents));
  checks.push(checkSecret());
  return {
    generatedAt: new Date().toISOString(),
    checks,
    errorCount: checks.filter((c) => c.state === "error").length,
    warnCount: checks.filter((c) => c.state === "warn").length,
    agents,
    agentMaintenance,
    agentBudget,
    agentWorkers,
    agentQueueBacklog,
    agentRuntimeOutcomes,
  };
}

export function checkAgentContract(summary: NpAgentHealthSummaryV1): Check {
  const connectionCount = summary.states
    .filter((row) => row.entity === "connection")
    .reduce((total, row) => total + row.count, 0);
  const detail =
    summary.issueCount > 0
      ? `${summary.issueCount.toString()} blocking issue(s) · ${summary.issues
          .map((current) => `${current.code}:${current.count.toString()}`)
          .join(", ")}`
      : `${connectionCount.toString()} connection(s) · providers ${summary.readiness.providers.state} · vault ${summary.readiness.vault.state}`;
  return {
    id: "agents.contract",
    label: "Agent contracts",
    state: summary.state,
    detail,
    ...(summary.state === "error"
      ? {
          hint: "Agent persisted state is malformed or stale. Run `pnpm run doctor` and resolve the reported stable issue codes before enabling Agent access.",
        }
      : summary.state === "warn"
        ? {
            hint: "Persisted Agent state is valid, but one or more frozen provider or Vault adapters cannot be confirmed in this runtime.",
          }
        : {}),
  };
}
