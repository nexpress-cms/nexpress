import { deployTargetTitle, type DeployTarget } from "./deploy-targets.js";

export interface CheckResult {
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
    state: "error",
    label: "NP_SECRET ≥ 32 chars (production)",
    detail: value ? `only ${value.length.toString()} chars` : "not set",
    hint: "Generate a strong secret: `openssl rand -base64 48`. Existing sessions will be invalidated.",
  };
}

export function checkJobsEnabledProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  if (jobsEnabled(env)) {
    return { state: "ok", label: "Jobs worker enabled (NP_ENABLE_JOBS)" };
  }
  return {
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
      state: "error",
      label: "Storage adapter (production)",
      detail: `local + ${multiNode ? "NP_MULTI_NODE=true" : "managed-container env detected"}`,
      hint: "LocalStorageAdapter is per-process. Set NP_STORAGE_ADAPTER=s3 + NP_S3_BUCKET / NP_S3_REGION, or NP_MULTI_NODE=false on a single-node deploy.",
    };
  }
  return { state: "ok", label: `Storage adapter (production): ${adapter}` };
}

export function checkSiteUrlProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  const url = env.SITE_URL ?? "";
  if (url.startsWith("https://")) return { state: "ok", label: "SITE_URL is https" };
  if (url.startsWith("http://")) {
    return {
      state: "warn",
      label: "SITE_URL is https",
      detail: "set to http://",
      hint: "Production cookies are Secure-flagged when SITE_URL is https://. Switch once your deploy has TLS.",
    };
  }
  // Already covered by checkRequiredVar; don't double-error.
  return { state: "ok", label: "SITE_URL is https", detail: "skipped (unset)" };
}

export function checkSchedulerTokenProd(prodMode: boolean, env: DoctorEnv): CheckResult | null {
  if (!prodMode) return null;
  const token = env.NP_SCHEDULER_TOKEN ?? "";
  if (!token) {
    return {
      state: "warn",
      label: "NP_SCHEDULER_TOKEN",
      detail: "not set",
      hint: "If you use _status: 'scheduled' anywhere, set NP_SCHEDULER_TOKEN and have your cron driver send `Authorization: Bearer <token>`. Otherwise ignore this warning.",
    };
  }
  if (token.length < 16) {
    return {
      state: "warn",
      label: "NP_SCHEDULER_TOKEN",
      detail: `only ${token.length.toString()} chars`,
      hint: "Use a 32+ char random token: `openssl rand -hex 32`.",
    };
  }
  return { state: "ok", label: "NP_SCHEDULER_TOKEN" };
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
          state: "error",
          label: `${targetTitle} storage`,
          detail: `NP_STORAGE_ADAPTER=${adapter}`,
          hint: "Vercel's filesystem is ephemeral. Set NP_STORAGE_ADAPTER=s3 plus NP_S3_BUCKET / NP_S3_REGION before deploy; add NP_S3_ENDPOINT for R2, MinIO, or another non-AWS S3 provider.",
        },
      ];
    }
    return [{ state: "ok", label: `${targetTitle} storage`, detail: "S3-compatible" }];
  }

  if ((target === "railway" || target === "render" || target === "fly") && adapter === "local") {
    return [
      {
        state: explicitSingle ? "warn" : "error",
        label: `${targetTitle} storage`,
        detail: explicitSingle ? "local + NP_MULTI_NODE=false" : "local storage",
        hint: explicitSingle
          ? "Confirm the service has a persistent disk/volume and regular backups."
          : "Managed container filesystems are not durable across nodes/redeploys. Set NP_STORAGE_ADAPTER=s3, or set NP_MULTI_NODE=false only for a deliberate single-node persistent-volume deploy.",
      },
    ];
  }

  return [{ state: "ok", label: `${targetTitle} storage`, detail: adapter }];
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
        state: "warn",
        label: `${targetTitle} jobs worker`,
        detail: "NP_ENABLE_JOBS is set",
        hint: "Vercel handles scheduled HTTP cron, but it does not run a long-lived pg-boss worker. Use a separate worker host for background jobs that must drain continuously.",
      },
    ];
  }

  return [
    {
      state: "ok",
      label: `${targetTitle} jobs worker`,
      detail: "NP_ENABLE_JOBS is set; run a separate `pnpm worker` process/service",
    },
  ];
}
