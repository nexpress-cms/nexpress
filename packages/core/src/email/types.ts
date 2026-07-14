export interface NpEmailMessage {
  /** RFC-822 recipient address. Single recipient per message. */
  to: string;
  /** Plain-text subject line. */
  subject: string;
  /** Plain-text body. Always provided as a fallback. */
  text: string;
  /** Optional HTML body. Adapter may choose to omit if absent. */
  html?: string;
  /** Override the adapter's default From header when set. */
  from?: string;
}

/**
 * Transactional mailer contract. One method: deliver a single message.
 * Adapters throw on failure so the pg-boss worker can retry per its
 * configured policy. Success is a void resolve.
 */
export interface NpEmailAdapter {
  readonly kind: string;
  send(message: NpEmailMessage): Promise<void>;
}

export interface SmtpEmailAdapterOptions {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** Default `From` header when a message doesn't override. */
  from: string;
  /** Implicit TLS. Defaults to `port === 465` when omitted. */
  secure?: boolean;
}

export type NpEmailAdapterMode = "noop" | "smtp" | "custom";

export type NpEmailRuntimeConfig =
  | { adapter: "noop" }
  | { adapter: "custom" }
  | {
      adapter: "smtp";
      options: Required<Pick<SmtpEmailAdapterOptions, "host" | "port" | "from" | "secure">> &
        Pick<SmtpEmailAdapterOptions, "user" | "pass">;
    };
