import type { NxEmailAdapter, NxEmailMessage } from "./types.js";

/**
 * Default adapter used when no mailer is wired. Logs the message shape so a
 * developer running the app locally can see that delivery was requested and
 * follow the reset link from the logs without setting up SMTP.
 *
 * Swap via `setEmailAdapter(new SmtpEmailAdapter(...))` or a custom
 * implementation in production.
 */
export class NoopEmailAdapter implements NxEmailAdapter {
  readonly kind = "noop";

  async send(message: NxEmailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn(
      `[nexpress] email (noop adapter) — not actually delivered.\n` +
        `  to:      ${message.to}\n` +
        `  subject: ${message.subject}\n` +
        `  text:\n${message.text.replace(/^/gm, "    ")}`,
    );
  }
}
