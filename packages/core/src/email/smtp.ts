import { NpError } from "../errors.js";
import { npRequireEmailMessage, npRequireSmtpEmailAdapterOptions } from "./contract.js";
import type { NpEmailAdapter, NpEmailMessage, SmtpEmailAdapterOptions } from "./types.js";

// Narrow structural type for the nodemailer transporter we use. Declared
// locally so core doesn't import @types/nodemailer just for one method.
interface NodemailerTransporterLike {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<unknown>;
  verify?: () => Promise<unknown>;
}

/**
 * Nodemailer-backed SMTP adapter. Works with any SMTP-speaking provider
 * (Resend, SES, Mailgun, Postmark, Gmail, Zoho, custom relays).
 *
 * `nodemailer` is loaded dynamically on first send so that apps that don't
 * use the SMTP adapter (noop or custom adapter) never pay its import cost.
 */
export class SmtpEmailAdapter implements NpEmailAdapter {
  readonly kind = "smtp";
  private readonly options: SmtpEmailAdapterOptions;
  private transporter: NodemailerTransporterLike | null = null;

  constructor(options: SmtpEmailAdapterOptions) {
    this.options = npRequireSmtpEmailAdapterOptions(options);
  }

  private async ensureTransporter(): Promise<NodemailerTransporterLike> {
    if (this.transporter) return this.transporter;

    let nodemailer: {
      createTransport: (cfg: unknown) => NodemailerTransporterLike;
    };
    try {
      // Indirect specifier so TypeScript doesn't try to
      // resolve `nodemailer` at compile time —
      // `@nexpress/core` doesn't depend on it. Apps using the
      // noop or a custom adapter never pay the import cost.
      const moduleId: string = "nodemailer";
      nodemailer = (await import(moduleId)) as typeof nodemailer;
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new NpError(
        `Could not load \`nodemailer\` — add it to the app's dependencies to use the SMTP adapter. Cause: ${cause}`,
        "EMAIL_ADAPTER_MISSING_DEPENDENCY",
        500,
      );
    }

    const { host, port, user, pass } = this.options;
    const secure = this.options.secure ?? port === 465;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  async send(message: NpEmailMessage): Promise<void> {
    const validated = npRequireEmailMessage(message);
    const transporter = await this.ensureTransporter();
    try {
      await transporter.sendMail({
        from: validated.from ?? this.options.from,
        to: validated.to,
        subject: validated.subject,
        text: validated.text,
        html: validated.html,
      });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new NpError(`Failed to deliver email via SMTP: ${cause}`, "EMAIL_DELIVERY_FAILED", 502);
    }
  }
}
