import type { NpEmailAdapter, NpEmailMessage } from "./types.js";
import { npRequireEmailMessage } from "./contract.js";

/**
 * Default adapter used when no mailer is wired. Logs the message shape so a
 * developer running the app locally can see that delivery was requested and
 * follow the reset link from the logs without setting up SMTP.
 *
 * Swap via `setEmailAdapter(new SmtpEmailAdapter(...))` or a custom
 * implementation in production.
 */
export class NoopEmailAdapter implements NpEmailAdapter {
  readonly kind = "noop";

  send(message: NpEmailMessage): Promise<void> {
    const validated = npRequireEmailMessage(message);
    console.warn(
      `[nexpress] email (noop adapter) — not actually delivered.\n` +
        `  to:      ${validated.to}\n` +
        `  subject: ${validated.subject}\n` +
        `  text:\n${validated.text.replace(/^/gm, "    ")}`,
    );
    return Promise.resolve();
  }
}
