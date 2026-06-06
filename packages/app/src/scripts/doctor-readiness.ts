import { deployTargetTitle, type DeployTarget } from "./deploy-targets.js";
import type { MigrationStatus } from "./migration-status.js";

export interface CheckResult {
  id: string;
  state: "ok" | "warn" | "error";
  label: string;
  detail?: string;
  hint?: string;
}

type DoctorEnv = Record<string, string | undefined>;

function jobsEnabled(env: DoctorEnv): boolean {
  return env.NP_ENABLE_JOBS === "1" || env.NP_ENABLE_JOBS === "true";
}

export function checkSecretLengthProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  const value = env.NP_SECRET ?? "";
  if (value.length >= 32) return null;
  return {
    id: "prod.secret_length",
    state: "error",
    label: "NP_SECRET ≥ 32 chars (production)",
    detail: value ? `only ${value.length.toString()} chars` : "not set",
    hint: "Generate a strong secret: `openssl rand -base64 48`. Existing sessions will be invalidated.",
  };
}

export function checkJobsEnabledProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  if (jobsEnabled(env)) {
    return { id: "prod.jobs_enabled", state: "ok", label: "Jobs worker enabled (NP_ENABLE_JOBS)" };
  }
  return {
    id: "prod.jobs_enabled",
    state: "warn",
    label: "Jobs worker enabled (NP_ENABLE_JOBS)",
    detail: "not set",
    hint: "Without NP_ENABLE_JOBS=1, scheduled-publish / email / revalidation jobs are silently dropped. Set it on the runtime that owns the worker.",
  };
}

export function checkStorageProd(
  prodMode: boolean,
  target: DeployTarget | null,
  env: DoctorEnv,
): CheckResult | null {
  if (!prodMode) return null;
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  const multiNode = env.NP_MULTI_NODE === "true" || env.NP_MULTI_NODE === "1";
  // Same heuristic verifyStartupSafety() uses — explicit opt-out wins.
  const explicitSingle = env.NP_MULTI_NODE === "false" || env.NP_MULTI_NODE === "0";
  const containerHint =
    !explicitSingle &&
    Boolean(
      env.KUBERNETES_SERVICE_HOST ||
      env.FLY_REGION ||
      env.RENDER_INSTANCE_ID ||
      env.RAILWAY_ENVIRONMENT_NAME,
    );
  const genericMultiNodeCheck = !target || target === "docker";
  if (adapter === "local" && ((genericMultiNodeCheck && multiNode) || (!target && containerHint))) {
    return {
      id: "prod.storage_adapter",
      state: "error",
      label: "Storage adapter (production)",
      detail: `local + ${multiNode ? "NP_MULTI_NODE=true" : "managed-container env detected"}`,
      hint: "LocalStorageAdapter is per-process. Set NP_STORAGE_ADAPTER=s3 + NP_S3_BUCKET / NP_S3_REGION, or NP_MULTI_NODE=false on a single-node deploy.",
    };
  }
  return {
    id: "prod.storage_adapter",
    state: "ok",
    label: `Storage adapter (production): ${adapter}`,
  };
}

export function checkSiteUrlProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  const url = env.SITE_URL ?? "";
  if (url.startsWith("https://"))
    return { id: "prod.site_url_https", state: "ok", label: "SITE_URL is https" };
  if (url.startsWith("http://")) {
    return {
      id: "prod.site_url_https",
      state: "warn",
      label: "SITE_URL is https",
      detail: "set to http://",
      hint: "Production cookies are Secure-flagged when SITE_URL is https://. Switch once your deploy has TLS.",
    };
  }
  if (url) {
    return {
      id: "prod.site_url_https",
      state: "error",
      label: "SITE_URL is https",
      detail: "not an http(s) URL",
      hint: "Set SITE_URL to the full public origin, for example `https://example.com`.",
    };
  }
  // Already covered by checkRequiredVar; don't double-error.
  return {
    id: "prod.site_url_https",
    state: "ok",
    label: "SITE_URL is https",
    detail: "skipped (unset)",
  };
}

export function checkSchedulerTokenProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  const token = env.NP_SCHEDULER_TOKEN ?? "";
  if (!token) {
    return {
      id: "prod.scheduler_token",
      state: "warn",
      label: "NP_SCHEDULER_TOKEN",
      detail: "not set",
      hint: "If you use _status: 'scheduled' anywhere, set NP_SCHEDULER_TOKEN and have your cron driver send `Authorization: Bearer <token>`. Otherwise ignore this warning.",
    };
  }
  if (token.length < 16) {
    return {
      id: "prod.scheduler_token",
      state: "warn",
      label: "NP_SCHEDULER_TOKEN",
      detail: `only ${token.length.toString()} chars`,
      hint: "Use a 32+ char random token: `openssl rand -hex 32`.",
    };
  }
  return { id: "prod.scheduler_token", state: "ok", label: "NP_SCHEDULER_TOKEN" };
}

export function checkMigrationStatusReadiness(
  prodMode: boolean,
  status: MigrationStatus,
): CheckResult {
  if (status.local.length === 0) {
    return {
      id: "migrations.applied",
      state: prodMode ? "error" : "warn",
      label: "Migrations applied",
      detail: "no local migrations found",
      hint: "Run `pnpm db:generate`, review the generated SQL, then run `pnpm db:migrate`.",
    };
  }

  if (status.drifted.length > 0) {
    return {
      id: "migrations.applied",
      state: "error",
      label: "Migrations applied",
      detail: `${status.drifted.length.toString()} applied migration hash mismatch`,
      hint: "Local migration SQL no longer matches what this database recorded. Restore the migration files from git or reset the database before deploying.",
    };
  }

  if (status.unknownApplied.length > 0) {
    return {
      id: "migrations.applied",
      state: "error",
      label: "Migrations applied",
      detail: `${status.unknownApplied.length.toString()} applied migration row not present locally`,
      hint: "DATABASE_URL may point at a different NexPress codebase or a newer deploy. Check the database target before applying more migrations.",
    };
  }

  if (status.pending.length > 0) {
    return {
      id: "migrations.applied",
      state: prodMode ? "error" : "warn",
      label: "Migrations applied",
      detail: `${status.pending.length.toString()} pending of ${status.local.length.toString()} local`,
      hint: "Run `pnpm db:migrate` before starting the app or deploying.",
    };
  }

  return {
    id: "migrations.applied",
    state: "ok",
    label: "Migrations applied",
    detail: `${status.applied.length.toString()}/${status.local.length.toString()} migrations applied`,
  };
}

export function checkTargetStorageProd(
  prodMode: boolean,
  target: DeployTarget | null,
  env: DoctorEnv,
): CheckResult[] {
  if (!prodMode || !target) return [];
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  const explicitSingle = env.NP_MULTI_NODE === "false" || env.NP_MULTI_NODE === "0";
  const targetTitle = deployTargetTitle(target);

  if (target === "vercel") {
    if (adapter !== "s3") {
      return [
        {
          id: `target.${target}.storage`,
          state: "error",
          label: `${targetTitle} storage`,
          detail: `NP_STORAGE_ADAPTER=${adapter}`,
          hint: "Vercel's filesystem is ephemeral. Set NP_STORAGE_ADAPTER=s3 plus NP_S3_BUCKET / NP_S3_REGION before deploy; add NP_S3_ENDPOINT for R2, MinIO, or another non-AWS S3 provider.",
        },
      ];
    }
    return [
      {
        id: `target.${target}.storage`,
        state: "ok",
        label: `${targetTitle} storage`,
        detail: "S3-compatible",
      },
    ];
  }

  if ((target === "railway" || target === "render" || target === "fly") && adapter === "local") {
    return [
      {
        id: `target.${target}.storage`,
        state: explicitSingle ? "warn" : "error",
        label: `${targetTitle} storage`,
        detail: explicitSingle ? "local + NP_MULTI_NODE=false" : "local storage",
        hint: explicitSingle
          ? "Confirm the service has a persistent disk/volume and regular backups."
          : "Managed container filesystems are not durable across nodes/redeploys. Set NP_STORAGE_ADAPTER=s3, or set NP_MULTI_NODE=false only for a deliberate single-node persistent-volume deploy.",
      },
    ];
  }

  return [
    {
      id: `target.${target}.storage`,
      state: "ok",
      label: `${targetTitle} storage`,
      detail: adapter,
    },
  ];
}

function databaseHost(env: DoctorEnv): string | null {
  const value = env.DATABASE_URL;
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  } catch {
    return null;
  }
}

function ipv4Parts(host: string): [number, number, number, number] | null {
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isLoopbackHost(host: string): boolean {
  const parts = ipv4Parts(host);
  return (
    host === "localhost" ||
    parts?.[0] === 127 ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "host.docker.internal"
  );
}

function isPrivateIpHost(host: string): boolean {
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function siteUrlHost(env: DoctorEnv): string | null {
  const value = env.SITE_URL;
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  } catch {
    return null;
  }
}

export function checkTargetDatabaseProd(
  prodMode: boolean,
  target: DeployTarget | null,
  env: DoctorEnv,
): CheckResult[] {
  if (!prodMode || !target || target === "docker") return [];
  const host = databaseHost(env);
  if (!host) return [];

  const targetTitle = deployTargetTitle(target);
  const label = `${targetTitle} database URL`;
  const detail = `DATABASE_URL host is ${host}`;
  if (isLoopbackHost(host)) {
    return [
      {
        id: `target.${target}.database_url`,
        state: "error",
        label,
        detail,
        hint: `Use a Postgres connection string reachable from ${targetTitle}. Localhost and Docker-only hosts work only on this machine.`,
      },
    ];
  }

  if (target === "vercel" && isPrivateIpHost(host)) {
    return [
      {
        id: "target.vercel.database_url",
        state: "error",
        label,
        detail,
        hint: "Vercel cannot reach private/LAN IP database hosts. Use a hosted Postgres public or pooler connection string.",
      },
    ];
  }

  return [
    {
      id: `target.${target}.database_url`,
      state: "ok",
      label,
      detail: host,
    },
  ];
}

export function checkTargetSiteUrlProd(
  prodMode: boolean,
  target: DeployTarget | null,
  env: DoctorEnv,
): CheckResult[] {
  if (!prodMode || !target || target === "docker") return [];
  const host = siteUrlHost(env);
  if (!host) return [];
  if (!isLoopbackHost(host) && !isPrivateIpHost(host)) return [];

  const targetTitle = deployTargetTitle(target);
  return [
    {
      id: `target.${target}.site_url`,
      state: "error",
      label: `${targetTitle} SITE_URL`,
      detail: `SITE_URL host is ${host}`,
      hint: `Set SITE_URL to the public HTTPS origin that visitors and auth callbacks will use on ${targetTitle}. Localhost and private IPs only work on your machine.`,
    },
  ];
}

export function checkTargetWorkerProd(
  prodMode: boolean,
  target: DeployTarget | null,
  env: DoctorEnv,
): CheckResult[] {
  if (!prodMode || !target) return [];
  if (!jobsEnabled(env)) return [];
  const targetTitle = deployTargetTitle(target);

  if (target === "vercel") {
    return [
      {
        id: `target.${target}.jobs_worker`,
        state: "warn",
        label: `${targetTitle} jobs worker`,
        detail: "NP_ENABLE_JOBS is set",
        hint: "Vercel handles scheduled HTTP cron, but it does not run a long-lived pg-boss worker. Use a separate worker host for background jobs that must drain continuously.",
      },
    ];
  }

  return [
    {
      id: `target.${target}.jobs_worker`,
      state: "ok",
      label: `${targetTitle} jobs worker`,
      detail: "NP_ENABLE_JOBS is set; run a separate `pnpm worker` process/service",
    },
  ];
}
