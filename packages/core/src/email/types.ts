export interface NxEmailMessage {
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
export interface NxEmailAdapter {
  readonly kind: string;
  send(message: NxEmailMessage): Promise<void>;
}
