import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { npValidatePluginCronExpression } from "@nexpress/core";
import { npReadEmailRuntimeConfig } from "@nexpress/core/email";
import { npReadRateLimitRuntimeConfig } from "@nexpress/core/rate-limit";
import { npReadObservabilityRuntimeConfig } from "@nexpress/core/observability";
import { npReadStorageRuntimeConfig, type NpStorageRuntimeConfig } from "@nexpress/core/storage";
import {
  npAnalyzeCustomRouteDefinitions,
  npGetCustomRouteKind,
  npRequireCustomRouteDefinitions,
} from "@nexpress/core/routes";
import {
  npAnalyzeAuthUser,
  npAnalyzeMemberAuthUser,
  npAnalyzeMemberSessionRecord,
  npAnalyzeStaffSessionRecord,
  npAuthContractLimits,
  npAuthRuntimeDefaults,
  npReadAuthPositiveInteger,
  npRequireAuthSecret,
  type NpAuthContractIssue,
} from "@nexpress/core/auth-contract";
import {
  NP_DEFAULT_SITE_ID,
  npAnalyzeSettingRecord,
  npAnalyzeSiteMembershipRecord,
  npAnalyzeSiteRecord,
} from "@nexpress/core/settings";
import { npAnalyzeRevision } from "@nexpress/core/revisions";
import {
  npAnalyzeJobLogEntry,
  npAnalyzeJobPayload,
  npAnalyzeJobSummary,
  npAnalyzeWorkerHeartbeat,
  npBuiltinJobTypeForQueueName,
  npRequireScheduleSummary,
  type NpJobContractIssue,
} from "@nexpress/core/jobs-contract";

import { inferDeployTargetFromEnv, type DeployTarget } from "./deploy-targets.js";
import { buildDoctorJson, type DoctorJsonOutput } from "./doctor-output.js";
import {
  checkJobsEnabledProd,
  checkMigrationStatusReadiness,
  checkObservabilityProd,
  checkOAuthEnvPairs,
  checkSchedulerTokenProd,
  checkSecretLengthProd,
  checkSiteUrlProd,
  checkStorageProd,
  checkTargetDatabaseProd,
  checkTargetSiteUrlProd,
  checkTargetStorageProd,
  checkTargetWorkerProd,
  type CheckResult,
} from "./doctor-readiness.js";
import {
  buildMigrationStatus,
  readAppliedMigrations,
  readLocalMigrationEntries,
} from "./migration-status.js";
import { messageForConnectionError } from "./setup-server-errors.js";
import { findFreePort } from "./setup-server-ports.js";

type DoctorEnv = Record<string, string | undefined>;

interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: {
      connectionString: string;
      connectionTimeoutMillis?: number;
    }) => PgClientLike;
  };
}

export interface CollectDoctorOptions {
  prodMode?: boolean;
  target?: DeployTarget | null;
  includeFixPlan?: boolean;
  env?: DoctorEnv;
  cwd?: string;
  nodeVersion?: string;
  /** Explicit catalog for embedders/tests; the CLI loads src/lib/custom-routes.ts. */
  customRoutes?: unknown;
}

interface RequiredVarSpec {
  id: string;
  name: "DATABASE_URL" | "NP_SECRET" | "SITE_URL";
  minLength?: number;
  matches?: RegExp;
  hint: string;
}

const REQUIRED_VARS: RequiredVarSpec[] = [
  {
    id: "env.database_url",
    name: "DATABASE_URL",
    matches: /^postgres(?:ql)?:\/\//,
    hint: "Set DATABASE_URL to a postgres:// connection string. `pnpm run setup` writes one for you.",
  },
  {
    id: "env.np_secret",
    name: "NP_SECRET",
    minLength: 32,
    hint: "Set NP_SECRET to >=32 random characters. `pnpm run setup` generates one.",
  },
  {
    id: "env.site_url",
    name: "SITE_URL",
    matches: /^https?:\/\//,
    hint: "Set SITE_URL to your public origin (e.g. http://localhost:3000).",
  },
];

export async function collectDoctorChecks(
  options: CollectDoctorOptions = {},
): Promise<CheckResult[]> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const prodMode = options.prodMode ?? false;
  const target = options.target ?? (prodMode ? inferDeployTargetFromEnv(env) : null);
  const checks: CheckResult[] = [
    checkNodeVersion(options.nodeVersion ?? process.versions.node),
    checkPnpmVersion(env),
    await checkEnvFile(cwd),
  ];

  for (const spec of REQUIRED_VARS) checks.push(checkRequiredVar(spec, prodMode, env));
  checks.push(checkEnvExampleSync(env));
  checks.push(checkEmailRuntimeContract(env));
  checks.push(checkObservabilityRuntimeContract(env));
  checks.push(checkRateLimitRuntimeContract(env, prodMode));
  checks.push(checkStorageRuntimeContract(env));
  checks.push(await checkCustomRoutesContract(options, cwd));
  checks.push(...checkOAuthEnvPairs(env));
  const localStorage = await checkLocalStorage(env, cwd);
  if (localStorage) checks.push(localStorage);
  checks.push(await checkDatabase(env));
  checks.push(await checkAuthContracts(env));
  checks.push(await checkSettingsContracts(env));
  checks.push(await checkRevisionContracts(env));
  checks.push(await checkJobContracts(env));
  checks.push(await checkMigrationsApplied({ prodMode, env, cwd }));

  for (const result of [
    checkSecretLengthProd(prodMode, env),
    checkJobsEnabledProd(prodMode, env),
    checkObservabilityProd(prodMode, env),
    checkStorageProd(prodMode, target, env),
    ...checkTargetDatabaseProd(prodMode, target, env),
    ...checkTargetStorageProd(prodMode, target, env),
    checkSiteUrlProd(prodMode, env),
    ...checkTargetSiteUrlProd(prodMode, target, env),
    checkSchedulerTokenProd(prodMode, env),
    ...checkTargetWorkerProd(prodMode, target, env),
  ]) {
    if (result) checks.push(result);
  }

  return checks;
}

async function checkCustomRoutesContract(
  options: CollectDoctorOptions,
  cwd: string,
): Promise<CheckResult> {
  try {
    const candidate = Object.hasOwn(options, "customRoutes")
      ? options.customRoutes
      : await loadProjectCustomRoutes(cwd);
    const issues = npAnalyzeCustomRouteDefinitions(candidate);
    const first = issues[0];
    if (first) {
      return {
        id: "routes.contract",
        state: "error",
        label: "Custom route catalog",
        detail: `${first.path}: ${first.message}`,
        hint: "Fix src/lib/custom-routes.ts so npCustomRoutes satisfies the exact @nexpress/core/routes contract.",
      };
    }
    const routes = npRequireCustomRouteDefinitions(candidate);
    const dynamic = routes.filter((route) => npGetCustomRouteKind(route.path) === "dynamic").length;
    return {
      id: "routes.contract",
      state: "ok",
      label: "Custom route catalog",
      detail: `${routes.length.toString()} routes · ${(routes.length - dynamic).toString()} static · ${dynamic.toString()} dynamic`,
    };
  } catch (error) {
    return {
      id: "routes.contract",
      state: "error",
      label: "Custom route catalog",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Export npCustomRoutes from src/lib/custom-routes.ts without importing the app runtime or nexpress.config.ts.",
    };
  }
}

async function loadProjectCustomRoutes(cwd: string): Promise<unknown> {
  const modulePath = resolve(cwd, "src/lib/custom-routes.ts");
  try {
    await access(modulePath);
  } catch {
    throw new Error("src/lib/custom-routes.ts is missing.");
  }
  const moduleUrl = pathToFileURL(modulePath).href;
  const loaded = (await import(moduleUrl)) as Record<string, unknown>;
  if (!Object.hasOwn(loaded, "npCustomRoutes")) {
    throw new Error("src/lib/custom-routes.ts must export npCustomRoutes.");
  }
  return loaded.npCustomRoutes;
}

function checkEmailRuntimeContract(env: DoctorEnv): CheckResult {
  try {
    const config = npReadEmailRuntimeConfig(env);
    if (config.adapter === "noop") {
      return {
        id: "email.contract",
        state: "warn",
        label: "Email delivery runtime contract",
        detail: "noop (transactional messages are not delivered)",
        hint: "Set NP_EMAIL_ADAPTER=smtp with the exact NP_SMTP_* contract for delivery.",
      };
    }
    return {
      id: "email.contract",
      state: "ok",
      label: "Email delivery runtime contract",
      detail:
        config.adapter === "custom"
          ? "custom (programmatic adapter expected)"
          : `smtp · ${config.options.host}:${config.options.port.toString()} · ${config.options.secure ? "TLS" : "STARTTLS"}`,
    };
  } catch (error) {
    return {
      id: "email.contract",
      state: "error",
      label: "Email delivery runtime contract",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix NP_EMAIL_ADAPTER and NP_SMTP_* before accepting credential email requests.",
    };
  }
}

function checkObservabilityRuntimeContract(env: DoctorEnv): CheckResult {
  try {
    const config = npReadObservabilityRuntimeConfig(env);
    if (config.errorReporter === "noop") {
      return {
        id: "observability.contract",
        state: "warn",
        label: "Observability runtime contract",
        detail: `${config.logger} logger · noop error reporter`,
        hint: "Set NP_ERROR_REPORTER_ADAPTER=custom and pass a reporter through src/lib/observability.ts for production error export.",
      };
    }
    return {
      id: "observability.contract",
      state: "ok",
      label: "Observability runtime contract",
      detail: `${config.logger} logger · custom error reporter expected`,
    };
  } catch (error) {
    return {
      id: "observability.contract",
      state: "error",
      label: "Observability runtime contract",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Set NP_LOGGER_ADAPTER to exactly console or custom and NP_ERROR_REPORTER_ADAPTER to exactly noop or custom.",
    };
  }
}

function checkRateLimitRuntimeContract(env: DoctorEnv, prodMode: boolean): CheckResult {
  try {
    const config = npReadRateLimitRuntimeConfig(env);
    const replicas = /^\d+$/u.test(env.NP_REPLICAS ?? "") ? Number(env.NP_REPLICAS) : 0;
    const multiNodeFlag = env.NP_MULTI_NODE?.toLowerCase();
    const explicitMultiNode = multiNodeFlag === "true" || multiNodeFlag === "1";
    const explicitSingleNode = replicas === 1 || multiNodeFlag === "false" || multiNodeFlag === "0";
    const managedContainer = Boolean(
      env.KUBERNETES_SERVICE_HOST ||
      env.FLY_REGION ||
      env.RENDER_INSTANCE_ID ||
      env.RAILWAY_ENVIRONMENT_NAME,
    );
    const likelyMultiNode =
      explicitMultiNode || replicas > 1 || (prodMode && managedContainer && !explicitSingleNode);

    if (config.adapter === "memory" && likelyMultiNode) {
      return {
        id: "rate-limit.contract",
        state: prodMode ? "error" : "warn",
        label: "Rate-limit runtime contract",
        detail: "memory (per-process) in a multi-node runtime",
        hint: "Set NP_RATE_LIMIT_ADAPTER=custom and inject a shared adapter with npCreateProxy(), or declare NP_MULTI_NODE=false / NP_REPLICAS=1 for a deliberate single-node deploy.",
      };
    }
    return {
      id: "rate-limit.contract",
      state: "ok",
      label: "Rate-limit runtime contract",
      detail:
        config.adapter === "custom"
          ? "custom (proxy-local adapter expected)"
          : "memory (per-process)",
    };
  } catch (error) {
    return {
      id: "rate-limit.contract",
      state: "error",
      label: "Rate-limit runtime contract",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Set NP_RATE_LIMIT_ADAPTER to exactly memory or custom before serving API requests.",
    };
  }
}

function checkStorageRuntimeContract(env: DoctorEnv): CheckResult {
  try {
    const config = npReadStorageRuntimeConfig(env);
    return {
      id: "storage.contract",
      state: "ok",
      label: "Storage runtime contract",
      detail:
        config.adapter === "local"
          ? `local · ${config.local.directory}`
          : config.adapter === "s3"
            ? `s3 · ${config.s3.bucket} (${config.s3.region})`
            : "custom (bootstrap adapter expected)",
    };
  } catch (error) {
    return {
      id: "storage.contract",
      state: "error",
      label: "Storage runtime contract",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Set NP_STORAGE_ADAPTER to exactly local, s3, or custom and satisfy its exact configuration.",
    };
  }
}

export async function collectDoctorReport(
  options: CollectDoctorOptions = {},
): Promise<DoctorJsonOutput> {
  const prodMode = options.prodMode ?? false;
  const env = options.env ?? process.env;
  const target = options.target ?? (prodMode ? inferDeployTargetFromEnv(env) : null);
  return buildDoctorJson({
    prodMode,
    target,
    checks: await collectDoctorChecks({ ...options, prodMode, target, env }),
    includeFixPlan: options.includeFixPlan,
  });
}

function checkNodeVersion(version: string): CheckResult {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major) || major < 20) {
    return {
      id: "node.version",
      state: "error",
      label: "Node.js >= 20",
      detail: `running ${version}`,
      hint: "NexPress requires Node 20+. Use nvm/asdf/fnm to upgrade.",
    };
  }
  return { id: "node.version", state: "ok", label: "Node.js >= 20", detail: version };
}

function checkPnpmVersion(env: DoctorEnv): CheckResult {
  const ua = env.npm_config_user_agent ?? "";
  const match = /pnpm\/([\d.]+)/.exec(ua);
  if (!match) {
    return {
      id: "pnpm.version",
      state: "warn",
      label: "pnpm 10.33+",
      detail: "couldn't read pnpm version from env",
      hint: "Run via `pnpm run doctor` (not `node scripts/doctor.ts`) for a real check.",
    };
  }
  const version = match[1] ?? "";
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  if (major < 10 || (major === 10 && minor < 33)) {
    return {
      id: "pnpm.version",
      state: "error",
      label: "pnpm 10.33+",
      detail: `running ${match[1]}`,
      hint: "Run `npm i -g pnpm@10.33` (or follow https://pnpm.io/installation).",
    };
  }
  return { id: "pnpm.version", state: "ok", label: "pnpm 10.33+", detail: match[1] };
}

async function checkEnvFile(cwd: string): Promise<CheckResult> {
  const envPath = resolve(/* turbopackIgnore: true */ cwd, ".env");
  try {
    await access(/* turbopackIgnore: true */ envPath);
    return { id: "env.file", state: "ok", label: ".env file present" };
  } catch {
    return {
      id: "env.file",
      state: "error",
      label: ".env file present",
      hint: "Run `pnpm run setup` (browser env wizard) or copy .env.example to .env.",
    };
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function checkRequiredVar(spec: RequiredVarSpec, prodMode: boolean, env: DoctorEnv): CheckResult {
  const value = env[spec.name];
  if (!value) {
    return {
      id: spec.id,
      state: "error",
      label: spec.name,
      detail: "not set",
      hint: spec.hint,
    };
  }
  if (spec.matches && !spec.matches.test(value)) {
    return {
      id: spec.id,
      state: "error",
      label: spec.name,
      detail: "set but doesn't match expected shape",
      hint: spec.hint,
    };
  }
  if (spec.minLength && value.length < spec.minLength) {
    return {
      id: spec.id,
      state: prodMode ? "error" : "warn",
      label: spec.name,
      detail: `set but only ${value.length.toString()} chars (recommend >=${spec.minLength.toString()})`,
      hint: spec.hint,
    };
  }
  return { id: spec.id, state: "ok", label: spec.name };
}

async function loadPg(): Promise<unknown> {
  return import("pg");
}

async function checkDatabase(env: DoctorEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "database.reachable",
      state: "error",
      label: "Postgres reachable",
      detail: "DATABASE_URL not set",
      hint: "Set DATABASE_URL first; doctor can't probe a connection without one.",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "database.reachable",
      state: "warn",
      label: "Postgres reachable",
      detail: "`pg` not installed in this workspace yet",
      hint: "Run `pnpm install` first.",
    };
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ version: string }>("select version()");
    await client.end();
    const version = result.rows[0]?.version?.split(" ").slice(0, 2).join(" ") ?? "Postgres";
    return { id: "database.reachable", state: "ok", label: "Postgres reachable", detail: version };
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    const code = (err as { code?: unknown } | null)?.code;
    let suggestedPort: number | null = null;
    if (code === "28P01" || code === "28000") {
      try {
        const parsed = new URL(url);
        const failingPort = parsed.port ? Number(parsed.port) : NaN;
        if (Number.isInteger(failingPort) && failingPort > 0 && failingPort < 65536) {
          suggestedPort = await findFreePort(failingPort + 1);
        }
      } catch {
        /* skip scan */
      }
    }
    return {
      id: "database.reachable",
      state: "error",
      label: "Postgres reachable",
      detail: messageForConnectionError(url, err, { suggestedPort }),
    };
  }
}

async function checkAuthContracts(env: DoctorEnv): Promise<CheckResult> {
  const runtimeError = inspectAuthRuntimeEnvironment(env);
  if (runtimeError) {
    return {
      id: "auth.contract",
      state: "error",
      label: "Authentication and session contracts",
      detail: runtimeError,
      hint: "Use canonical positive integers within the bounds documented in .env.example.",
    };
  }
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "auth.contract",
      state: "warn",
      label: "Authentication and session contracts",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "auth.contract",
      state: "warn",
      label: "Authentication and session contracts",
      detail: "skipped (no `pg`)",
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const columns = await client.query<{ tableName: string; columnName: string }>(
      `select table_name as "tableName", column_name as "columnName"
         from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [["np_users", "np_members", "np_sessions", "np_member_sessions"]],
    );
    const columnSets = new Map<string, Set<string>>();
    for (const row of columns.rows) {
      const set = columnSets.get(row.tableName) ?? new Set<string>();
      set.add(row.columnName);
      columnSets.set(row.tableName, set);
    }
    const requiredTables = ["np_users", "np_members", "np_sessions", "np_member_sessions"];
    if (!columnSets.has("np_users") && !columnSets.has("np_members")) {
      await client.end();
      return {
        id: "auth.contract",
        state: "warn",
        label: "Authentication and session contracts",
        detail: "skipped (authentication tables have not been migrated)",
      };
    }
    const missingTables = requiredTables.filter((table) => !columnSets.has(table));
    if (missingTables.length > 0) {
      await client.end();
      return {
        id: "auth.contract",
        state: "warn",
        label: "Authentication and session contracts",
        detail: `authentication schema is incomplete; missing ${missingTables.join(", ")}`,
        hint: "Run `pnpm db:migrate` before accepting authenticated requests.",
      };
    }

    const users = columnSets.has("np_users")
      ? await client.query<Record<string, unknown>>(
          `select id, email, name, role, token_version as "tokenVersion" from np_users`,
        )
      : { rows: [] };
    const members = columnSets.has("np_members")
      ? await client.query<Record<string, unknown>>(
          `select id, email, handle, display_name as "displayName", status,
                  token_version as "tokenVersion"
             from np_members`,
        )
      : { rows: [] };

    const sessionColumns = [
      "id",
      "access_token_hash",
      "refresh_token_hash",
      "access_expires_at",
      "refresh_expires_at",
      "user_agent",
      "ip",
      "created_at",
      "updated_at",
    ];
    const staffColumns = columnSets.get("np_sessions");
    const memberColumns = columnSets.get("np_member_sessions");
    const staffSessionsCurrent =
      staffColumns?.has("user_id") === true &&
      sessionColumns.every((column) => staffColumns.has(column));
    const memberSessionsCurrent =
      memberColumns?.has("member_id") === true &&
      sessionColumns.every((column) => memberColumns.has(column));
    const staffSessions = staffSessionsCurrent
      ? await client.query<Record<string, unknown>>(
          `select id, user_id as "userId", access_token_hash as "accessTokenHash",
                  refresh_token_hash as "refreshTokenHash",
                  access_expires_at as "accessExpiresAt",
                  refresh_expires_at as "refreshExpiresAt", user_agent as "userAgent", ip,
                  created_at as "createdAt", updated_at as "updatedAt"
             from np_sessions`,
        )
      : { rows: [] };
    const memberSessions = memberSessionsCurrent
      ? await client.query<Record<string, unknown>>(
          `select id, member_id as "memberId", access_token_hash as "accessTokenHash",
                  refresh_token_hash as "refreshTokenHash",
                  access_expires_at as "accessExpiresAt",
                  refresh_expires_at as "refreshExpiresAt", user_agent as "userAgent", ip,
                  created_at as "createdAt", updated_at as "updatedAt"
             from np_member_sessions`,
        )
      : { rows: [] };
    await client.end();

    const issues: NpAuthContractIssue[] = [
      ...users.rows.flatMap((row, index) => npAnalyzeAuthUser(row, `users[${index.toString()}]`)),
      ...members.rows.flatMap((row, index) =>
        npAnalyzeMemberAuthUser(row, `members[${index.toString()}]`),
      ),
      ...staffSessions.rows.flatMap((row, index) =>
        npAnalyzeStaffSessionRecord(row, `staffSessions[${index.toString()}]`),
      ),
      ...memberSessions.rows.flatMap((row, index) =>
        npAnalyzeMemberSessionRecord(row, `memberSessions[${index.toString()}]`),
      ),
    ];
    const activeMemberIds = new Set(
      members.rows.flatMap((member) =>
        member.status === "active" && typeof member.id === "string" ? [member.id] : [],
      ),
    );
    const validStaffIds = new Set(
      users.rows.flatMap((user) =>
        npAnalyzeAuthUser(user).length === 0 && typeof user.id === "string" ? [user.id] : [],
      ),
    );
    staffSessions.rows.forEach((session, index) => {
      if (typeof session.userId === "string" && !validStaffIds.has(session.userId)) {
        issues.push({
          code: "invariant",
          path: `staffSessions[${index.toString()}].userId`,
          message: "session belongs to a missing or malformed staff user.",
        });
      }
    });
    memberSessions.rows.forEach((session, index) => {
      if (typeof session.memberId === "string" && !activeMemberIds.has(session.memberId)) {
        issues.push({
          code: "invariant",
          path: `memberSessions[${index.toString()}].memberId`,
          message: "session belongs to a non-active or malformed member.",
        });
      }
    });

    const currentSessionSchema =
      (staffColumns === undefined || staffSessionsCurrent) &&
      (memberColumns === undefined || memberSessionsCurrent);
    const checked =
      users.rows.length +
      members.rows.length +
      staffSessions.rows.length +
      memberSessions.rows.length;
    if (issues.length > 0) {
      return {
        id: "auth.contract",
        state: "error",
        label: "Authentication and session contracts",
        detail: `${issues.length.toString()} contract issue(s); first: ${issues[0]?.path ?? "auth"} ${issues[0]?.message ?? "invalid"}`,
        hint: "Repair malformed auth rows and revoke invalid session families before accepting requests.",
      };
    }
    if (!currentSessionSchema) {
      return {
        id: "auth.contract",
        state: "warn",
        label: "Authentication and session contracts",
        detail: "session tables still use the legacy unpaired-token schema",
        hint: "Run `pnpm db:migrate`; the session-contract migration requires one fresh login.",
      };
    }
    return {
      id: "auth.contract",
      state: "ok",
      label: "Authentication and session contracts",
      detail: `${checked.toString()} persisted auth/session row(s) checked`,
    };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "auth.contract",
      state: "warn",
      label: "Authentication and session contracts",
      detail: `could not inspect authentication rows: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function inspectAuthRuntimeEnvironment(env: DoctorEnv): string | null {
  try {
    if (env.NP_SECRET) npRequireAuthSecret(env.NP_SECRET);
    const access = npReadAuthPositiveInteger(
      "NP_TOKEN_EXPIRATION",
      env.NP_TOKEN_EXPIRATION,
      npAuthRuntimeDefaults.accessTokenTtlSeconds,
      npAuthContractLimits.accessTokenTtlSeconds,
    );
    const refresh = npReadAuthPositiveInteger(
      "NP_REFRESH_TOKEN_EXPIRATION",
      env.NP_REFRESH_TOKEN_EXPIRATION,
      npAuthRuntimeDefaults.refreshTokenTtlSeconds,
      npAuthContractLimits.refreshTokenTtlSeconds,
    );
    if (refresh < access) {
      return "NP_REFRESH_TOKEN_EXPIRATION must not be shorter than NP_TOKEN_EXPIRATION.";
    }
    for (const [name, fallback, maximum] of [
      [
        "NP_MAX_LOGIN_ATTEMPTS",
        npAuthRuntimeDefaults.maxLoginAttempts,
        npAuthContractLimits.loginAttempts,
      ],
      [
        "NP_LOCKOUT_DURATION",
        npAuthRuntimeDefaults.lockoutTtlSeconds,
        npAuthContractLimits.lockoutTtlSeconds,
      ],
      [
        "NP_INVITE_TTL_HOURS",
        npAuthRuntimeDefaults.inviteTtlHours,
        npAuthContractLimits.inviteTtlHours,
      ],
      [
        "NP_RESET_TTL_MINUTES",
        npAuthRuntimeDefaults.resetTtlMinutes,
        npAuthContractLimits.resetTtlMinutes,
      ],
      [
        "NP_VERIFY_TTL_HOURS",
        npAuthRuntimeDefaults.verifyTtlHours,
        npAuthContractLimits.verifyTtlHours,
      ],
      [
        "NP_OAUTH_STATE_TTL_SECONDS",
        npAuthRuntimeDefaults.oauthStateTtlSeconds,
        npAuthContractLimits.oauthStateTtlSeconds,
      ],
    ] as const) {
      npReadAuthPositiveInteger(name, env[name], fallback, maximum);
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function checkSettingsContracts(env: DoctorEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "settings.contract",
      state: "warn",
      label: "Site registry and settings contracts",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "settings.contract",
      state: "warn",
      label: "Site registry and settings contracts",
      detail: "skipped (no `pg`)",
    };
  }
  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const sites = await client.query<Record<string, unknown>>(
      `select id, name, hostname, description, settings, is_default as "isDefault",
                created_at as "createdAt", updated_at as "updatedAt"
           from np_sites`,
    );
    const settings = await client.query<{ siteId: string; key: string; value: unknown }>(
      `select site_id as "siteId", key, value from np_settings`,
    );
    const memberships = await client.query<Record<string, unknown>>(
      `select site_id as "siteId", user_id as "userId", role,
                created_at as "createdAt", updated_at as "updatedAt"
           from np_site_memberships`,
    );
    const users = await client.query<{ id: string }>(`select id from np_users`);
    await client.end();
    const siteIds = new Set(sites.rows.map((site) => site.id));
    const userIds = new Set(users.rows.map((user) => user.id));
    const issues = [
      ...(!siteIds.has(NP_DEFAULT_SITE_ID)
        ? [
            {
              code: "invalid-field" as const,
              path: "sites.default",
              message: `reserved site '${NP_DEFAULT_SITE_ID}' is missing.`,
            },
          ]
        : []),
      ...sites.rows.flatMap((site) => npAnalyzeSiteRecord(site)),
      ...settings.rows.flatMap((row) => [
        ...npAnalyzeSettingRecord(row.siteId, row.key, row.value),
        ...(row.key !== "jobs.paused" && !siteIds.has(row.siteId)
          ? [
              {
                code: "invalid-field" as const,
                path: "settings.siteId",
                message: `setting row references missing site '${row.siteId}'.`,
              },
            ]
          : []),
      ]),
      ...memberships.rows.flatMap((row) => [
        ...npAnalyzeSiteMembershipRecord(row),
        ...(!(typeof row.siteId === "string" && siteIds.has(row.siteId))
          ? [
              {
                code: "invalid-field" as const,
                path: "membership.siteId",
                message: `membership references missing site '${String(row.siteId)}'.`,
              },
            ]
          : []),
        ...(!(typeof row.userId === "string" && userIds.has(row.userId))
          ? [
              {
                code: "invalid-field" as const,
                path: "membership.userId",
                message: `membership references missing user '${String(row.userId)}'.`,
              },
            ]
          : []),
      ]),
    ];
    return issues.length === 0
      ? {
          id: "settings.contract",
          state: "ok",
          label: "Site registry and settings contracts",
          detail: `${sites.rows.length.toString()} site(s), ${memberships.rows.length.toString()} membership(s), ${settings.rows.length.toString()} setting row(s)`,
        }
      : {
          id: "settings.contract",
          state: "error",
          label: "Site registry and settings contracts",
          detail: `${issues.length.toString()} contract issue(s); first: ${issues[0]?.path ?? "settings"} ${issues[0]?.message ?? "invalid"}`,
          hint: "Repair malformed site, membership, or setting rows and remove orphan references before starting the app.",
        };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "settings.contract",
      state: "warn",
      label: "Site registry and settings contracts",
      detail: `could not inspect settings: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkRevisionContracts(env: DoctorEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "revisions.contract",
      state: "warn",
      label: "Revision snapshot contracts",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "revisions.contract",
      state: "warn",
      label: "Revision snapshot contracts",
      detail: "skipped (no `pg`)",
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const revisionsTable = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'np_revisions'
       ) as exists`,
    );
    if (!revisionsTable.rows[0]?.exists) {
      await client.end();
      return {
        id: "revisions.contract",
        state: "warn",
        label: "Revision snapshot contracts",
        detail: "skipped (np_revisions has not been migrated)",
      };
    }

    const revisions = await client.query<Record<string, unknown>>(
      `select id, collection, document_id as "documentId", version, status, snapshot,
              changed_fields as "changedFields", author_id as "authorId", created_at as "createdAt"
         from np_revisions`,
    );
    const contractIssues = revisions.rows.flatMap((row) => {
      const result = npAnalyzeRevision(row);
      return result.ok ? [] : result.issues;
    });
    const validCollections = [
      ...new Set(
        revisions.rows.flatMap((row) => {
          const result = npAnalyzeRevision(row);
          return result.ok ? [result.value.collection] : [];
        }),
      ),
    ];
    const tableNames = validCollections.map((collection) => `np_c_${collection}`);
    const presentTables =
      tableNames.length === 0
        ? new Set<string>()
        : new Set(
            (
              await client.query<{ table_name: string }>(
                `select table_name from information_schema.tables
                   where table_schema = 'public' and table_name = any($1::text[])`,
                [tableNames],
              )
            ).rows.map((row) => row.table_name),
          );
    const missingCollections = validCollections.filter(
      (collection) => !presentTables.has(`np_c_${collection}`),
    );
    let orphanCount = 0;
    for (const collection of validCollections) {
      const tableName = `np_c_${collection}`;
      if (!presentTables.has(tableName)) continue;
      // collection passed the canonical slug contract above, so the derived
      // identifier contains only lowercase letters, numbers, and hyphens.
      const orphaned = await client.query<{ total: string }>(
        `select count(*)::text as total
           from np_revisions r
           left join "${tableName}" d on d.id::text = r.document_id
          where r.collection = $1 and d.id is null`,
        [collection],
      );
      orphanCount += Number.parseInt(orphaned.rows[0]?.total ?? "0", 10) || 0;
    }
    await client.end();

    const issueCount = contractIssues.length + missingCollections.length + orphanCount;
    if (issueCount === 0) {
      return {
        id: "revisions.contract",
        state: "ok",
        label: "Revision snapshot contracts",
        detail: `${revisions.rows.length.toString()} revision row(s)`,
      };
    }
    const firstContractIssue = contractIssues[0];
    const firstDetail = firstContractIssue
      ? `${firstContractIssue.path} ${firstContractIssue.message}`
      : missingCollections[0]
        ? `missing collection table np_c_${missingCollections[0]}`
        : `${orphanCount.toString()} orphan revision row(s)`;
    return {
      id: "revisions.contract",
      state: "error",
      label: "Revision snapshot contracts",
      detail: `${issueCount.toString()} contract/orphan issue(s); first: ${firstDetail}`,
      hint: "Repair or remove malformed revision snapshots and orphan rows before restoring content.",
    };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "revisions.contract",
      state: "warn",
      label: "Revision snapshot contracts",
      detail: `could not inspect revisions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkJobContracts(env: DoctorEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "jobs.contract",
      state: "warn",
      label: "Background job runtime contracts",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "jobs.contract",
      state: "warn",
      label: "Background job runtime contracts",
      detail: "skipped (no `pg`)",
    };
  }

  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const tables = await client.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name
         from information_schema.tables
        where (table_schema = 'public' and table_name in ('np_worker_heartbeats', 'np_job_logs'))
           or (table_schema = 'pgboss' and table_name in ('job', 'archive', 'schedule'))`,
    );
    const present = new Set(tables.rows.map((row) => `${row.table_schema}.${row.table_name}`));
    if (present.size === 0) {
      await client.end();
      return {
        id: "jobs.contract",
        state: "warn",
        label: "Background job runtime contracts",
        detail: "skipped (job runtime tables have not been migrated)",
      };
    }

    const issues: NpJobContractIssue[] = [];
    let checked = 0;
    if (present.has("public.np_worker_heartbeats")) {
      const workers = await client.query<{
        id: string;
        status: string;
        startedAt: Date | string;
        lastSeenAt: Date | string;
        meta: unknown;
      }>(
        `select id, status, started_at as "startedAt", last_seen_at as "lastSeenAt", meta
           from np_worker_heartbeats`,
      );
      checked += workers.rows.length;
      for (const [index, row] of workers.rows.entries()) {
        inspectJobContract(issues, `workers[${index.toString()}]`, () => {
          const result = npAnalyzeWorkerHeartbeat({
            ...row,
            startedAt: doctorDate(row.startedAt, `workers[${index.toString()}].startedAt`),
            lastSeenAt: doctorDate(row.lastSeenAt, `workers[${index.toString()}].lastSeenAt`),
          });
          if (!result.ok) issues.push(...result.issues);
        });
      }
    }
    if (present.has("public.np_job_logs")) {
      const logs = await client.query<{
        id: string;
        jobId: string;
        level: string;
        message: string;
        context: unknown;
        createdAt: Date | string;
      }>(
        `select id::text as id, job_id as "jobId", level, message, context,
                created_at as "createdAt"
           from np_job_logs
          order by created_at desc
          limit 5000`,
      );
      checked += logs.rows.length;
      for (const [index, row] of logs.rows.entries()) {
        inspectJobContract(issues, `logs[${index.toString()}]`, () => {
          const result = npAnalyzeJobLogEntry({
            ...row,
            createdAt: doctorDate(row.createdAt, `logs[${index.toString()}].createdAt`),
          });
          if (!result.ok) issues.push(...result.issues);
        });
      }
    }
    for (const source of ["live", "archive"] as const) {
      const table = source === "live" ? "job" : "archive";
      if (!present.has(`pgboss.${table}`)) continue;
      const jobs = await client.query<{
        id: string;
        name: string;
        state: string;
        data: unknown;
        retryCount: number;
        output: string | null;
        createdOn: Date | string;
        startedOn: Date | string | null;
        completedOn: Date | string | null;
      }>(
        `select id::text as id, name, state::text as state, data,
                retry_count as "retryCount", output::text as output,
                created_on as "createdOn", started_on as "startedOn",
                completed_on as "completedOn"
           from pgboss.${table}
          order by created_on desc
          limit 1000`,
      );
      checked += jobs.rows.length;
      for (const [index, row] of jobs.rows.entries()) {
        inspectJobContract(issues, `jobs.${source}[${index.toString()}]`, () => {
          const result = npAnalyzeJobSummary({
            ...row,
            createdOn: doctorIso(row.createdOn, `jobs.${source}[${index.toString()}].createdOn`),
            startedOn: doctorNullableIso(
              row.startedOn,
              `jobs.${source}[${index.toString()}].startedOn`,
            ),
            completedOn: doctorNullableIso(
              row.completedOn,
              `jobs.${source}[${index.toString()}].completedOn`,
            ),
            source,
          });
          if (!result.ok) issues.push(...result.issues);
        });
        const builtinType = npBuiltinJobTypeForQueueName(row.name);
        if (builtinType) {
          const payload = npAnalyzeJobPayload(builtinType, row.data);
          if (!payload.ok) issues.push(...payload.issues);
        }
      }
    }
    if (present.has("pgboss.schedule")) {
      const schedules = await client.query<{
        name: string;
        key: string | null;
        cron: string;
        timezone: string | null;
        data: unknown;
        createdOn: Date | string;
        updatedOn: Date | string | null;
      }>(
        `select name, coalesce(key, '') as key, cron, timezone, data,
                created_on as "createdOn", updated_on as "updatedOn"
           from pgboss.schedule`,
      );
      checked += schedules.rows.length;
      for (const [index, row] of schedules.rows.entries()) {
        const cron = npValidatePluginCronExpression(row.cron);
        if (!cron.ok) {
          issues.push({
            path: `jobs.schedules[${index.toString()}].cron`,
            message: cron.message,
          });
        }
        inspectJobContract(issues, `jobs.schedules[${index.toString()}]`, () => {
          npRequireScheduleSummary({
            ...row,
            createdOn: doctorIso(row.createdOn, `jobs.schedules[${index.toString()}].createdOn`),
            updatedOn: doctorNullableIso(
              row.updatedOn,
              `jobs.schedules[${index.toString()}].updatedOn`,
            ),
          });
        });
      }
    }
    await client.end();

    return issues.length === 0
      ? {
          id: "jobs.contract",
          state: "ok",
          label: "Background job runtime contracts",
          detail: `${checked.toString()} persisted row(s) checked`,
        }
      : {
          id: "jobs.contract",
          state: "error",
          label: "Background job runtime contracts",
          detail: `${issues.length.toString()} contract issue(s); first: ${issues[0]?.path ?? "jobs"} ${issues[0]?.message ?? "invalid"}`,
          hint: "Repair or remove malformed job, schedule, heartbeat, and log rows before starting workers.",
        };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "jobs.contract",
      state: "warn",
      label: "Background job runtime contracts",
      detail: `could not inspect jobs: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function doctorDate(value: Date | string, path: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${path} must be a valid timestamp`);
  return date;
}

function doctorIso(value: Date | string, path: string): string {
  return doctorDate(value, path).toISOString();
}

function doctorNullableIso(value: Date | string | null, path: string): string | null {
  return value === null ? null : doctorIso(value, path);
}

function hasContractIssues(error: unknown): error is { issues: NpJobContractIssue[] } {
  return (
    typeof error === "object" && error !== null && "issues" in error && Array.isArray(error.issues)
  );
}

function inspectJobContract(issues: NpJobContractIssue[], path: string, inspect: () => void): void {
  try {
    inspect();
  } catch (error) {
    if (hasContractIssues(error)) {
      issues.push(...error.issues);
      return;
    }
    issues.push({ path, message: error instanceof Error ? error.message : String(error) });
  }
}

async function checkLocalStorage(env: DoctorEnv, cwd: string): Promise<CheckResult | null> {
  let config: NpStorageRuntimeConfig;
  try {
    config = npReadStorageRuntimeConfig(env);
  } catch {
    return null;
  }
  if (config.adapter !== "local") return null;
  const dir = config.local.directory;
  const path = resolve(/* turbopackIgnore: true */ cwd, dir);
  try {
    const stats = await stat(/* turbopackIgnore: true */ path);
    if (!stats.isDirectory()) {
      return {
        id: "storage.local_directory",
        state: "error",
        label: "Local storage directory",
        detail: `${dir} exists but is not a directory`,
        hint: "Move the file aside or pick a different NP_STORAGE_DIR.",
      };
    }
    return {
      id: "storage.local_directory",
      state: "ok",
      label: "Local storage directory",
      detail: dir,
    };
  } catch (error) {
    if (!isMissingPathError(error)) {
      return {
        id: "storage.local_directory",
        state: "error",
        label: "Local storage directory",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Ensure the process can inspect NP_STORAGE_DIR.",
      };
    }
    return {
      id: "storage.local_directory",
      state: "warn",
      label: "Local storage directory",
      detail: `${dir} doesn't exist yet`,
      hint: "Will be created on first upload; create it manually if your env is read-only.",
    };
  }
}

async function checkMigrationsApplied(args: {
  prodMode: boolean;
  env: DoctorEnv;
  cwd: string;
}): Promise<CheckResult> {
  const url = args.env.DATABASE_URL;
  if (!url) {
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "skipped (no `pg`)",
    };
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('np_users', 'np_settings', 'np_navigation', 'np_sites')`,
    );
    const expected = ["np_users", "np_settings", "np_navigation", "np_sites"];
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = expected.filter((t) => !present.has(t));
    if (missing.length === 0) {
      let statusCheck: CheckResult;
      try {
        const local = readLocalMigrationEntries(
          resolve(/* turbopackIgnore: true */ args.cwd, "drizzle"),
        );
        const applied = await readAppliedMigrations(client);
        statusCheck = checkMigrationStatusReadiness(
          args.prodMode,
          buildMigrationStatus(local, applied),
        );
      } catch (err) {
        statusCheck = {
          id: "migrations.applied",
          state: args.prodMode ? "error" : "warn",
          label: "Migrations applied",
          detail: `framework tables found; status unavailable: ${
            err instanceof Error ? err.message : String(err)
          }`,
          hint: "Run `pnpm db:migrate -- --status` for a dedicated migration status report.",
        };
      }
      await client.end();
      return statusCheck;
    }
    const trackingTable = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from information_schema.tables
         where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
       ) as exists`,
    );
    let trackedCount = 0;
    if (trackingTable.rows[0]?.exists) {
      const tracked = await client.query<{ count: string }>(
        "select count(*)::text as count from drizzle.__drizzle_migrations",
      );
      trackedCount = Number.parseInt(tracked.rows[0]?.count ?? "0", 10) || 0;
    }
    await client.end();
    if (trackedCount > 0) {
      return {
        id: "migrations.applied",
        state: "error",
        label: "Migrations applied",
        detail: `drizzle tracks ${trackedCount.toString()} applied, but framework tables are missing`,
        hint:
          "Stale tracking from a partial drop. Reset both schemas, then re-migrate:\n" +
          "      docker compose exec db psql -U nexpress -d nexpress -c \\\n" +
          '        "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"\n' +
          "      pnpm db:migrate",
      };
    }
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: `missing ${missing.join(", ")}`,
      hint: "Run `pnpm db:generate && pnpm db:migrate` (or finish `pnpm run setup` with the auto-migrate option).",
    };
  } catch {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "could not query schema",
    };
  }
}

function checkEnvExampleSync(env: DoctorEnv): CheckResult {
  const value = env.NP_SECRET ?? "";
  if (value === "change-me-in-production" || value === "change-me-to-a-random-string") {
    return {
      id: "env.np_secret_placeholder",
      state: "error",
      label: "NP_SECRET not the placeholder",
      detail: "still the .env.example placeholder",
      hint: "Replace with a real secret. `pnpm run setup` generates one.",
    };
  }
  return { id: "env.np_secret_placeholder", state: "ok", label: "NP_SECRET not the placeholder" };
}
