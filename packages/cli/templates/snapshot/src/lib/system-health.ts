import { stat } from "node:fs/promises";
import { join } from "node:path";

import {
  getAllPluginIds,
  getJobsPauseState,
  getOptionalJobQueue,
  getStorageAdapter,
  listWorkerHealth,
} from "@nexpress/core";

import { getDb } from "@/lib/db";

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

const FRAMEWORK_TABLES = [
  "np_users",
  "np_settings",
  "np_navigation",
  "np_sites",
] as const;

async function checkDatabase(): Promise<Check> {
  try {
    const db = getDb();
    const result = (await db.$client.query<{ version: string }>(
      "select version()",
    )) as { rows: Array<{ version: string }> };
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
      [FRAMEWORK_TABLES as unknown as string[]],
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

async function checkStorage(): Promise<Check> {
  try {
    const adapter = getStorageAdapter();
    if (!adapter) {
      return {
        id: "storage",
        label: "Storage adapter",
        state: "warn",
        detail: "no adapter wired (uploads will fail)",
        hint: "Call `setStorageAdapter()` from your bootstrap.",
      };
    }
    // The adapter interface doesn't expose its kind, so we infer
    // from env: that's the same source `init-core` uses to pick
    // local vs s3, so the answers stay aligned.
    const kind = (process.env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
    if (kind === "local") {
      const dir = process.env.NP_STORAGE_DIR ?? "./public/media";
      if (dir !== "./public/media" && dir !== "public/media") {
        return {
          id: "storage",
          label: "Storage adapter",
          state: "ok",
          detail: `local · ${dir} (custom path)`,
        };
      }
      const path = join(process.cwd(), "public", "media");
      try {
        const s = await stat(path);
        if (!s.isDirectory()) {
          return {
            id: "storage",
            label: "Storage adapter",
            state: "error",
            detail: `${dir} exists but is not a directory`,
            hint: "Move the file aside or pick a different NP_STORAGE_DIR.",
          };
        }
        return { id: "storage", label: "Storage adapter", state: "ok", detail: `local · ${dir}` };
      } catch {
        return {
          id: "storage",
          label: "Storage adapter",
          state: "warn",
          detail: `local · ${dir} (will be created on first upload)`,
        };
      }
    }
    if (kind === "s3") {
      // We don't HEAD the bucket here — that would hit AWS on every
      // /admin/health load. Just assert the env vars are set.
      const missing: string[] = [];
      if (!process.env.NP_S3_BUCKET) missing.push("NP_S3_BUCKET");
      if (!process.env.NP_S3_REGION) missing.push("NP_S3_REGION");
      if (missing.length > 0) {
        return {
          id: "storage",
          label: "Storage adapter",
          state: "error",
          detail: `s3 · missing ${missing.join(", ")}`,
          hint: "Re-run `pnpm run setup` and pick S3 to fill these in.",
        };
      }
      return {
        id: "storage",
        label: "Storage adapter",
        state: "ok",
        detail: `s3 · ${process.env.NP_S3_BUCKET ?? ""} (${process.env.NP_S3_REGION ?? ""})`,
      };
    }
    return {
      id: "storage",
      label: "Storage adapter",
      state: "warn",
      detail: `unknown adapter kind \`${kind}\``,
    };
  } catch (err) {
    return {
      id: "storage",
      label: "Storage adapter",
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
      detail:
        ids.length === 0 ? "0 plugins" : `${ids.length.toString()} · ${ids.join(", ")}`,
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
      hint:
        "SITE_URL must be a parseable absolute URL (e.g. https://example.com).",
    };
  }
}

/**
 * Email adapter — runtime parallel of the boot-time check in
 * #597. Reads the env var (operator's intent) rather than the
 * live adapter because programmatic `setEmailAdapter()` callers
 * skip the env path. Catches the operator who deployed without
 * SMTP and is wondering why password-reset emails never arrive.
 */
export function checkEmailAdapter(): Check {
  const raw = (process.env.NP_EMAIL_ADAPTER ?? "").toLowerCase();
  if (!raw || raw === "noop") {
    return {
      id: "email",
      label: "Email adapter",
      state: "warn",
      detail: raw ? "noop" : "unset (defaults to noop)",
      hint:
        "Transactional mail (password reset, email verify, member " +
        "digests) is silently dropped. Set NP_EMAIL_ADAPTER=smtp + the " +
        "NP_SMTP_* vars, or install a custom adapter via " +
        "setEmailAdapter() in your bootstrap.",
    };
  }
  if (raw === "smtp") {
    const missing: string[] = [];
    if (!process.env.NP_SMTP_HOST) missing.push("NP_SMTP_HOST");
    if (!process.env.NP_SMTP_FROM) missing.push("NP_SMTP_FROM");
    if (missing.length > 0) {
      return {
        id: "email",
        label: "Email adapter",
        state: "error",
        detail: `smtp · missing ${missing.join(", ")}`,
        hint: "Re-run `pnpm run setup` to fill in the SMTP fields.",
      };
    }
    return {
      id: "email",
      label: "Email adapter",
      state: "ok",
      detail: `smtp · ${process.env.NP_SMTP_HOST ?? ""}`,
    };
  }
  return {
    id: "email",
    label: "Email adapter",
    state: "ok",
    detail: `custom (${raw})`,
  };
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
  return { id: "secret", label: "NP_SECRET", state: "ok", detail: `${secret.length.toString()} chars` };
}

export async function gatherSystemHealth(): Promise<HealthSummary> {
  const checks: Check[] = [];
  checks.push(await checkDatabase());
  checks.push(await checkMigrations());
  checks.push(await checkStorage());
  checks.push(await checkQueue());
  checks.push(checkPlugins());
  checks.push(checkSiteUrl());
  checks.push(checkEmailAdapter());
  checks.push(checkSecret());
  return {
    generatedAt: new Date().toISOString(),
    checks,
    errorCount: checks.filter((c) => c.state === "error").length,
    warnCount: checks.filter((c) => c.state === "warn").length,
  };
}
