import { NpError } from "../errors.js";
import type { NpEmailAdapter, NpEmailMessage } from "./types.js";

export interface SmtpEmailAdapterOptions {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** Default `From` header when a message doesn't override. */
  from: string;
  /**
   * Use implicit TLS (port 465) when `true`. When `false`, STARTTLS is
   * negotiated (port 587 / 25). Defaults to `port === 465`.
   */
  secure?: boolean;
}

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
    this.options = options;
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
    const transporter = await this.ensureTransporter();
    try {
      await transporter.sendMail({
        from: message.from ?? this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new NpError(
        `Failed to deliver email via SMTP: ${cause}`,
        "EMAIL_DELIVERY_FAILED",
        502,
      );
    }
  }
}
