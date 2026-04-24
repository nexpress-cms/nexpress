import { NxError } from "../errors.js";
import type { NxEmailAdapter, NxEmailMessage } from "./types.js";

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
  verify?: () => Promise<boolean | unknown>;
}

/**
 * Nodemailer-backed SMTP adapter. Works with any SMTP-speaking provider
 * (Resend, SES, Mailgun, Postmark, Gmail, Zoho, custom relays).
 *
 * `nodemailer` is loaded dynamically on first send so that apps that don't
 * use the SMTP adapter (noop or custom adapter) never pay its import cost.
 */
export class SmtpEmailAdapter implements NxEmailAdapter {
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
      // `new Function` keeps TypeScript from rewriting to a static require
      // on consumers that bundle core (e.g. Next.js). Deferred import lets
      // the package opt out of loading nodemailer entirely.
      const importer = new Function("id", "return import(id);") as (
        id: string,
      ) => Promise<unknown>;
      nodemailer = (await importer("nodemailer")) as typeof nodemailer;
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new NxError(
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

  async send(message: NxEmailMessage): Promise<void> {
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
      throw new NxError(
        `Failed to deliver email via SMTP: ${cause}`,
        "EMAIL_DELIVERY_FAILED",
        502,
      );
    }
  }
}
