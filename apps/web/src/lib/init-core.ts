import { SmtpEmailAdapter, setEmailAdapter } from "@nexpress/core";

import { ensureCoreServices, ensureJobProducer, ensurePluginsLoaded, nexpressConfig } from "@/lib/bootstrap";

export { ensureCoreServices, ensureJobProducer, ensurePluginsLoaded, nexpressConfig };

/**
 * Install the SMTP email adapter when `NX_EMAIL_ADAPTER=smtp`. Any other
 * value (unset, "noop", "custom") leaves the default `NoopEmailAdapter` in
 * place — apps that want Resend/SendGrid/etc. SDKs can call
 * `setEmailAdapter(customAdapter)` themselves after this runs.
 */
function configureEmailAdapter(): void {
  if (process.env.NX_EMAIL_ADAPTER !== "smtp") return;

  const host = process.env.NX_SMTP_HOST;
  const port = Number(process.env.NX_SMTP_PORT ?? "587");
  const from = process.env.NX_SMTP_FROM;

  if (!host || !from) {
    console.warn(
      "[nexpress] NX_EMAIL_ADAPTER=smtp but NX_SMTP_HOST / NX_SMTP_FROM are unset — email adapter not installed.",
    );
    return;
  }

  // Only forward `secure` when the operator explicitly set it. Passing
  // `false` for an unset env var disabled the adapter's `port === 465
  // → secure` default, so SMTPS configurations failed in the field
  // (#63). With `undefined` the SMTP adapter applies its documented
  // default.
  const secureRaw = process.env.NX_SMTP_SECURE;
  const secure = secureRaw === undefined ? undefined : secureRaw === "true";

  setEmailAdapter(
    new SmtpEmailAdapter({
      host,
      port,
      user: process.env.NX_SMTP_USER,
      pass: process.env.NX_SMTP_PASS,
      from,
      ...(secure !== undefined ? { secure } : {}),
    }),
  );
}

let emailConfigured = false;
function configureEmailOnce(): void {
  if (emailConfigured) return;
  configureEmailAdapter();
  emailConfigured = true;
}

/**
 * One-call setup for any write entrypoint (API route, server action, import).
 * Wires core services, loads plugins so hooks fire, starts the pg-boss
 * producer so `enqueueJob` actually sends work to the worker when
 * `NX_ENABLE_JOBS=1`, and installs the email adapter so invite / reset
 * emails go out. Without this, writes that go through the pipeline or
 * `uploadMedia` silently drop their follow-up jobs.
 *
 * Equivalent to `ensureFor("write")`; new code should prefer the
 * intent-based form.
 */
export async function ensureWriteReady(): Promise<void> {
  ensureCoreServices();
  configureEmailOnce();
  await ensurePluginsLoaded();
  await ensureJobProducer();
}

/**
 * Single typed entry point for bootstrap initialization (#266). One
 * function with three explicit intents replaces the ad-hoc set of
 * idempotent `ensure*` functions whose required combination each
 * route had to memorize.
 *
 *   - `"read"`    — DB + storage + collections registered. Use for
 *                   read-only RSC pages and GET API routes that
 *                   don't need plugin hooks.
 *   - `"plugins"` — read + plugin loading. Use when render or
 *                   response generation needs `runHook` to fire
 *                   (e.g. block/site pages with plugin-augmented
 *                   rendering, OAuth callbacks).
 *   - `"write"`   — plugins + email adapter + pg-boss producer.
 *                   Use for any mutating API route, server action,
 *                   or import script. Without this, writes that go
 *                   through the pipeline or `uploadMedia` silently
 *                   drop their follow-up jobs and emails.
 *
 * The legacy `ensureCoreServices` / `ensurePluginsLoaded` /
 * `ensureJobProducer` / `ensureWriteReady` exports remain for now;
 * new code should use `ensureFor`. A future PR will migrate the
 * existing callsites and remove the legacy exports.
 */
export type NxBootstrapIntent = "read" | "plugins" | "write";

export async function ensureFor(intent: NxBootstrapIntent): Promise<void> {
  ensureCoreServices();
  if (intent === "read") return;

  await ensurePluginsLoaded();
  if (intent === "plugins") return;

  configureEmailOnce();
  await ensureJobProducer();
}
