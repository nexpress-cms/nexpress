import { isIP } from "node:net";

import type {
  NpEmailAdapter,
  NpEmailMessage,
  NpEmailRuntimeConfig,
  SmtpEmailAdapterOptions,
} from "./types.js";

export const npEmailContractLimits = {
  addressLength: 512,
  adapterKindLength: 64,
  hostLength: 253,
  usernameLength: 512,
  passwordLength: 4_096,
  subjectLength: 998,
  textLength: 1_048_576,
  htmlLength: 2_097_152,
  templateNameLength: 200,
  templateUrlLength: 8_192,
} as const;

export type NpEmailContractIssueCode = "shape" | "unknown-field" | "invalid-field" | "invariant";

export interface NpEmailContractIssue {
  readonly code: NpEmailContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export class NpEmailContractError extends Error {
  readonly issues: NpEmailContractIssue[];

  constructor(message: string, issues: NpEmailContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpEmailContractError";
    this.issues = issues;
  }
}

const messageKeys = new Set(["to", "subject", "text", "html", "from"]);
const templateKeys = new Set(["subject", "text", "html"]);
const passwordTemplateKeys = new Set(["siteName", "name", "resetUrl", "expiresAt"]);
const memberVerifyTemplateKeys = new Set(["siteName", "displayName", "verifyUrl", "expiresAt"]);
const runtimeConfigKeys = new Set(["adapter", "options"]);
const adapterKindPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const hostLabelPattern = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/u;
const mailboxPattern = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/u;
const displayAddressPattern = /^([^<>\r\n]+)\s<([^<>\r\n]+)>$/u;
const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function issue(
  code: NpEmailContractIssueCode,
  path: string,
  message: string,
): NpEmailContractIssue {
  return { code, path, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function pushUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: NpEmailContractIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue("unknown-field", `${path}.${key}`, `unsupported email field "${key}".`));
    }
  }
}

function isBoundedString(
  value: unknown,
  maximum: number,
  options: { allowEmpty?: boolean; requireTrimmed?: boolean } = {},
): value is string {
  return (
    typeof value === "string" &&
    (options.allowEmpty || value.length > 0) &&
    value.length <= maximum &&
    (!options.requireTrimmed || value === value.trim())
  );
}

function containsHeaderBreak(value: string): boolean {
  return /[\r\n\0]/u.test(value);
}

function isSmtpHost(value: string): boolean {
  if (isIP(value) !== 0) return true;
  return value.split(".").every((label) => hostLabelPattern.test(label));
}

export function npIsEmailAddress(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npEmailContractLimits.addressLength ||
    value !== value.trim() ||
    containsHeaderBreak(value)
  ) {
    return false;
  }
  if (mailboxPattern.test(value)) return true;
  const display = displayAddressPattern.exec(value);
  return Boolean(display && display[1]?.trim() && mailboxPattern.test(display[2] ?? ""));
}

export function npAnalyzeEmailMessage(
  value: unknown,
  path = "email.message",
): NpEmailContractIssue[] {
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpEmailContractIssue[] = [];
  pushUnknownFields(value, messageKeys, path, issues);
  if (!npIsEmailAddress(value.to)) {
    issues.push(issue("invalid-field", `${path}.to`, "must be one bounded email address."));
  }
  if (
    !isBoundedString(value.subject, npEmailContractLimits.subjectLength, {
      requireTrimmed: true,
    }) ||
    (typeof value.subject === "string" && containsHeaderBreak(value.subject))
  ) {
    issues.push(
      issue("invalid-field", `${path}.subject`, "must be a bounded single-line subject."),
    );
  }
  if (!isBoundedString(value.text, npEmailContractLimits.textLength)) {
    issues.push(issue("invalid-field", `${path}.text`, "must be a bounded plain-text body."));
  }
  if (value.html !== undefined && !isBoundedString(value.html, npEmailContractLimits.htmlLength)) {
    issues.push(issue("invalid-field", `${path}.html`, "must be a bounded HTML body."));
  }
  if (value.from !== undefined && !npIsEmailAddress(value.from)) {
    issues.push(issue("invalid-field", `${path}.from`, "must be one bounded email address."));
  }
  return issues;
}

export function npRequireEmailMessage(value: unknown, path = "email.message"): NpEmailMessage {
  const issues = npAnalyzeEmailMessage(value, path);
  if (issues.length > 0) throw new NpEmailContractError("Invalid email message", issues);
  return value as NpEmailMessage;
}

export function npRequireEmailAdapter(value: unknown): NpEmailAdapter {
  const issues: NpEmailContractIssue[] = [];
  if (typeof value !== "object" || value === null) {
    issues.push(issue("shape", "email.adapter", "must be an object."));
  } else {
    const candidate = value as { kind?: unknown; send?: unknown };
    if (
      typeof candidate.kind !== "string" ||
      candidate.kind.length > npEmailContractLimits.adapterKindLength ||
      !adapterKindPattern.test(candidate.kind)
    ) {
      issues.push(
        issue("invalid-field", "email.adapter.kind", "must be a canonical lowercase adapter kind."),
      );
    }
    if (typeof candidate.send !== "function") {
      issues.push(issue("invalid-field", "email.adapter.send", "must be a function."));
    }
  }
  if (issues.length > 0) throw new NpEmailContractError("Invalid email adapter", issues);
  return value as NpEmailAdapter;
}

function requireSmtpHost(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npEmailContractLimits.hostLength ||
    value !== value.trim() ||
    !isSmtpHost(value)
  ) {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("invalid-field", path, "must be a bounded SMTP hostname or IP address."),
    ]);
  }
  return value;
}

function requireSmtpPort(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("invalid-field", path, "must be an integer from 1 through 65535."),
    ]);
  }
  return value;
}

function requireCredential(value: unknown, path: string, maximum: number, trim: boolean): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    containsHeaderBreak(value) ||
    (trim && value !== value.trim())
  ) {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("invalid-field", path, "must be a bounded non-empty string."),
    ]);
  }
  return value;
}

export function npRequireSmtpEmailAdapterOptions(
  value: unknown,
): Required<Pick<SmtpEmailAdapterOptions, "host" | "port" | "from" | "secure">> &
  Pick<SmtpEmailAdapterOptions, "user" | "pass"> {
  if (!isPlainRecord(value)) {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("shape", "email.smtp", "must be a plain object."),
    ]);
  }
  const allowed = new Set(["host", "port", "user", "pass", "from", "secure"]);
  const issues: NpEmailContractIssue[] = [];
  pushUnknownFields(value, allowed, "email.smtp", issues);
  if (issues.length > 0) throw new NpEmailContractError("Invalid SMTP configuration", issues);
  const host = requireSmtpHost(value.host, "email.smtp.host");
  const port = requireSmtpPort(value.port, "email.smtp.port");
  if (!npIsEmailAddress(value.from)) {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("invalid-field", "email.smtp.from", "must be one bounded email address."),
    ]);
  }
  if (value.secure !== undefined && typeof value.secure !== "boolean") {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("invalid-field", "email.smtp.secure", "must be a boolean when provided."),
    ]);
  }
  const hasUser = value.user !== undefined;
  const hasPass = value.pass !== undefined;
  if (hasUser !== hasPass) {
    throw new NpEmailContractError("Invalid SMTP configuration", [
      issue("invariant", "email.smtp.auth", "user and pass must be provided together."),
    ]);
  }
  const user = hasUser
    ? requireCredential(value.user, "email.smtp.user", npEmailContractLimits.usernameLength, true)
    : undefined;
  const pass = hasPass
    ? requireCredential(value.pass, "email.smtp.pass", npEmailContractLimits.passwordLength, false)
    : undefined;
  return {
    host,
    port,
    from: value.from,
    secure: value.secure ?? port === 465,
    ...(user === undefined ? {} : { user, pass }),
  };
}

function parseEnvPort(value: string | undefined): number {
  if (value === undefined || value === "") return 587;
  if (!/^\d+$/u.test(value)) {
    throw new NpEmailContractError("Invalid email runtime configuration", [
      issue("invalid-field", "env.NP_SMTP_PORT", "must be a positive base-10 integer."),
    ]);
  }
  return requireSmtpPort(Number(value), "env.NP_SMTP_PORT");
}

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new NpEmailContractError("Invalid email runtime configuration", [
    issue("invalid-field", "env.NP_SMTP_SECURE", 'must be exactly "true" or "false".'),
  ]);
}

export function npReadEmailRuntimeConfig(
  env: Record<string, string | undefined>,
): NpEmailRuntimeConfig {
  const adapter = env.NP_EMAIL_ADAPTER;
  const mode = adapter === undefined || adapter === "" ? "noop" : adapter;
  if (mode !== "noop" && mode !== "smtp" && mode !== "custom") {
    throw new NpEmailContractError("Invalid email runtime configuration", [
      issue(
        "invalid-field",
        "env.NP_EMAIL_ADAPTER",
        'must be exactly "noop", "smtp", or "custom".',
      ),
    ]);
  }
  if (mode === "noop" || mode === "custom") return { adapter: mode };

  const requiredIssues: NpEmailContractIssue[] = [];
  if (!env.NP_SMTP_HOST) {
    requiredIssues.push(
      issue("invalid-field", "env.NP_SMTP_HOST", "is required when NP_EMAIL_ADAPTER=smtp."),
    );
  }
  if (!env.NP_SMTP_FROM) {
    requiredIssues.push(
      issue("invalid-field", "env.NP_SMTP_FROM", "is required when NP_EMAIL_ADAPTER=smtp."),
    );
  }
  if (requiredIssues.length > 0) {
    throw new NpEmailContractError("Invalid email runtime configuration", requiredIssues);
  }

  const port = parseEnvPort(env.NP_SMTP_PORT);
  const options = npRequireSmtpEmailAdapterOptions({
    host: env.NP_SMTP_HOST,
    port,
    from: env.NP_SMTP_FROM,
    secure: parseEnvBoolean(env.NP_SMTP_SECURE, port === 465),
    ...(env.NP_SMTP_USER === undefined ? {} : { user: env.NP_SMTP_USER }),
    ...(env.NP_SMTP_PASS === undefined ? {} : { pass: env.NP_SMTP_PASS }),
  });
  return { adapter: "smtp", options };
}

export function npRequireEmailRuntimeConfig(value: unknown): NpEmailRuntimeConfig {
  const path = "email.runtime";
  if (!isPlainRecord(value)) {
    throw new NpEmailContractError("Invalid email runtime configuration", [
      issue("shape", path, "must be a plain object."),
    ]);
  }
  const issues: NpEmailContractIssue[] = [];
  pushUnknownFields(value, runtimeConfigKeys, path, issues);
  if (value.adapter !== "noop" && value.adapter !== "smtp" && value.adapter !== "custom") {
    issues.push(
      issue("invalid-field", `${path}.adapter`, 'must be exactly "noop", "smtp", or "custom".'),
    );
  }
  if (value.adapter === "noop" || value.adapter === "custom") {
    if (value.options !== undefined) {
      issues.push(
        issue("unknown-field", `${path}.options`, `is not supported in ${value.adapter} mode.`),
      );
    }
    if (issues.length > 0) {
      throw new NpEmailContractError("Invalid email runtime configuration", issues);
    }
    return { adapter: value.adapter };
  }
  if (issues.length > 0) {
    throw new NpEmailContractError("Invalid email runtime configuration", issues);
  }
  return {
    adapter: "smtp",
    options: npRequireSmtpEmailAdapterOptions(value.options),
  };
}

export function npIsCanonicalEmailDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    canonicalDatePattern.test(value) &&
    Number.isFinite(new Date(value).valueOf()) &&
    new Date(value).toISOString() === value
  );
}

function analyzeTemplateInput(
  value: unknown,
  kind: "password" | "memberVerify",
): NpEmailContractIssue[] {
  const path = "email.template.data";
  if (!isPlainRecord(value)) return [issue("shape", path, "must be a plain object.")];
  const issues: NpEmailContractIssue[] = [];
  pushUnknownFields(
    value,
    kind === "password" ? passwordTemplateKeys : memberVerifyTemplateKeys,
    path,
    issues,
  );
  if (
    !isBoundedString(value.siteName, npEmailContractLimits.templateNameLength, {
      requireTrimmed: true,
    })
  ) {
    issues.push(issue("invalid-field", `${path}.siteName`, "must be a bounded site name."));
  }
  const recipientKey = kind === "password" ? "name" : "displayName";
  if (
    !isBoundedString(value[recipientKey], npEmailContractLimits.templateNameLength, {
      requireTrimmed: true,
    })
  ) {
    issues.push(
      issue("invalid-field", `${path}.${recipientKey}`, "must be a bounded recipient name."),
    );
  }
  const urlKey = kind === "password" ? "resetUrl" : "verifyUrl";
  const urlValue = value[urlKey];
  let validUrl = false;
  if (
    typeof urlValue === "string" &&
    urlValue.length <= npEmailContractLimits.templateUrlLength &&
    urlValue === urlValue.trim()
  ) {
    try {
      const parsed = new URL(urlValue);
      validUrl =
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.username.length === 0 &&
        parsed.password.length === 0;
    } catch {
      validUrl = false;
    }
  }
  if (!validUrl) {
    issues.push(issue("invalid-field", `${path}.${urlKey}`, "must be an absolute HTTP(S) URL."));
  }
  if (!npIsCanonicalEmailDate(value.expiresAt)) {
    issues.push(
      issue("invalid-field", `${path}.expiresAt`, "must be a canonical UTC ISO timestamp."),
    );
  }
  return issues;
}

export function npRequirePasswordEmailTemplateData<T>(value: T): T {
  const issues = analyzeTemplateInput(value, "password");
  if (issues.length > 0)
    throw new NpEmailContractError("Invalid password email template data", issues);
  return value;
}

export function npRequireMemberVerifyEmailTemplateData<T>(value: T): T {
  const issues = analyzeTemplateInput(value, "memberVerify");
  if (issues.length > 0)
    throw new NpEmailContractError("Invalid member verification email template data", issues);
  return value;
}

export function npRequireEmailTemplate<T>(value: T): T {
  const path = "email.template";
  if (!isPlainRecord(value)) {
    throw new NpEmailContractError("Invalid email template", [
      issue("shape", path, "must be a plain object."),
    ]);
  }
  const issues: NpEmailContractIssue[] = [];
  pushUnknownFields(value, templateKeys, path, issues);
  if (
    !isBoundedString(value.subject, npEmailContractLimits.subjectLength, {
      requireTrimmed: true,
    }) ||
    (typeof value.subject === "string" && containsHeaderBreak(value.subject))
  ) {
    issues.push(
      issue("invalid-field", `${path}.subject`, "must be a bounded single-line subject."),
    );
  }
  if (!isBoundedString(value.text, npEmailContractLimits.textLength)) {
    issues.push(issue("invalid-field", `${path}.text`, "must be a bounded plain-text body."));
  }
  if (!isBoundedString(value.html, npEmailContractLimits.htmlLength)) {
    issues.push(issue("invalid-field", `${path}.html`, "must be a bounded HTML body."));
  }
  if (issues.length > 0) throw new NpEmailContractError("Invalid email template", issues);
  return value;
}
