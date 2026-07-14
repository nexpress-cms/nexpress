import { npUsers } from "@nexpress/core";
import {
  configureEmailRuntime,
  npReadEmailRuntimeConfig,
  type NpEmailRuntimeConfig,
} from "@nexpress/core/email";
import { count, eq } from "drizzle-orm";

import {
  ensureCoreServices as bootstrapEnsureCoreServices,
  ensureJobProducer as bootstrapEnsureJobProducer,
  ensurePluginsLoaded as bootstrapEnsurePluginsLoaded,
  getDb,
  nexpressConfig,
} from "@/lib/bootstrap";
import { registerCustomRoutes } from "./custom-routes";
import { registerWordPressImportJobs } from "./wp-import-admin";

export { nexpressConfig };

let emailRuntimeConfig: NpEmailRuntimeConfig | null = null;
function resolveEmailRuntimeConfigOnce(): NpEmailRuntimeConfig {
  emailRuntimeConfig ??= npReadEmailRuntimeConfig(process.env);
  return emailRuntimeConfig;
}

let emailConfigured = false;
function configureEmailOnce(): void {
  if (emailConfigured) return;
  configureEmailRuntime(resolveEmailRuntimeConfigOnce());
  emailConfigured = true;
}

let customRoutesRegistered = false;
function registerCustomRoutesOnce(): void {
  if (customRoutesRegistered) return;
  registerCustomRoutes();
  registerWordPressImportJobs();
  customRoutesRegistered = true;
}

/**
 * First-run nudge. On the first `ensureFor("read")` of each
 * process, if the `users` table has zero admin rows we print a
 * console banner pointing the operator at the in-app setup
 * wizard. Closes the discoverability gap where `pnpm dev` boots
 * cleanly but the operator doesn't know that visiting `/admin`
 * triggers the in-app first-admin flow.
 *
 * Fire-and-forget: the DB query runs `void`-ed so the request
 * that triggered bootstrap doesn't wait. If the query fails (DB
 * not actually up yet, migrations pending, etc.) we silently
 * roll back the latch so the next request can retry.
 *
 * Opt-out via `NP_FIRST_RUN_NUDGE=off` for operators who don't
 * want the banner in their own deployments.
 */
let firstRunNudgeAttempted = false;
function nudgeFirstRunOnce(): void {
  if (firstRunNudgeAttempted) return;
  if (process.env.NP_FIRST_RUN_NUDGE === "off") return;
  firstRunNudgeAttempted = true;
  void (async () => {
    try {
      const db = getDb();
      const rows = await db
        .select({ value: count() })
        .from(npUsers)
        .where(eq(npUsers.role, "admin"));
      const adminCount = rows[0]?.value ?? 0;
      if (adminCount > 0) return;

      const RESET = "\x1b[0m";
      const BOLD = "\x1b[1m";
      const DIM = "\x1b[2m";
      const CYAN = "\x1b[36m";
      const YELLOW = "\x1b[33m";

      // The banner uses port 3000 because that's the apps/web
      // default and where most first-run operators land. If the
      // host is on a different port the operator will figure it
      // out from the URL bar.
      const portRaw = process.env.PORT;
      const port = portRaw && /^\d+$/.test(portRaw) ? portRaw : "3000";

      const lines = [
        "",
        `  ${YELLOW}NexPress${RESET} — ${BOLD}first run detected${RESET}, no admin user yet.`,
        "",
        `    ${CYAN}→ http://localhost:${port}/admin${RESET}  ${DIM}# in-app wizard creates your first admin${RESET}`,
        `    ${CYAN}→ pnpm seed:admin${RESET}              ${DIM}# headless script (CI / scripts)${RESET}`,
        "",
        `  ${DIM}Silence this banner with NP_FIRST_RUN_NUDGE=off${RESET}`,
        "",
      ];
      for (const line of lines) process.stderr.write(`${line}\n`);
    } catch {
      // DB not up yet, table missing, etc. Reset the latch so
      // the next ensureFor retries — the banner is best-effort.
      firstRunNudgeAttempted = false;
    }
  })();
}

/**
 * Single typed entry point for bootstrap initialization (#266). One
 * function with four explicit intents replaced the four ad-hoc
 * `ensure*` functions whose required combination each route had to
 * memorize.
 *
 *   - `"read"`    — DB + storage + collections registered. Use for
 *                   read-only RSC pages and GET API routes that don't
 *                   need plugin hooks.
 *   - `"plugins"` — read + plugin loading. Use when render or
 *                   response generation needs `runHook` to fire (e.g.
 *                   block/site pages with plugin-augmented rendering,
 *                   OAuth callbacks).
 *   - `"worker"`  — plugins + email adapter, without a competing producer.
 *                   Used by the dedicated pg-boss worker process.
 *   - `"write"`   — plugins + email adapter + pg-boss producer. Use
 *                   for any mutating API route, server action, or
 *                   import script. Without this, writes that go
 *                   through the pipeline or `uploadMedia` silently
 *                   drop their follow-up jobs and emails.
 */
export type NpBootstrapIntent = "read" | "plugins" | "worker" | "write";

export async function ensureFor(intent: NpBootstrapIntent): Promise<void> {
  // Parse the environment contract on the first bootstrap intent, including
  // reads. Adapter installation stays on worker/write paths, but malformed
  // email configuration cannot hide until the first delivery attempt.
  resolveEmailRuntimeConfigOnce();
  bootstrapEnsureCoreServices();
  registerCustomRoutesOnce();
  nudgeFirstRunOnce();
  if (intent === "read") return;

  await bootstrapEnsurePluginsLoaded();
  if (intent === "plugins") return;

  configureEmailOnce();
  if (intent === "worker") return;
  await bootstrapEnsureJobProducer();
}
