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

  setEmailAdapter(
    new SmtpEmailAdapter({
      host,
      port,
      user: process.env.NX_SMTP_USER,
      pass: process.env.NX_SMTP_PASS,
      from,
      secure: process.env.NX_SMTP_SECURE === "true",
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
 */
export async function ensureWriteReady(): Promise<void> {
  ensureCoreServices();
  configureEmailOnce();
  await ensurePluginsLoaded();
  await ensureJobProducer();
}
