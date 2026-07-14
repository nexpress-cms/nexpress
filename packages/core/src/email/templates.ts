import {
  npRequireEmailTemplate,
  npRequireMemberVerifyEmailTemplateData,
  npRequirePasswordEmailTemplateData,
} from "./contract.js";

export interface NpPasswordResetTemplateData {
  siteName: string;
  name: string;
  resetUrl: string;
  /** Canonical UTC ISO timestamp from the issued credential. */
  expiresAt: string;
}

export interface NpEmailTemplate {
  subject: string;
  text: string;
  html: string;
}

function formatExpiry(expiresAt: string): string {
  return `${expiresAt.slice(0, 10)} ${expiresAt.slice(11, 23)} UTC`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrap(siteName: string, contentHtml: string): string {
  // Table-based layout is the safest cross-client default. Keeps styles
  // inline so most webmail clients don't rewrite them away.
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5;">
    <tr>
      <td>
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${escapeHtml(siteName)}</h1>
        ${contentHtml}
        <p style="margin-top:32px;font-size:12px;color:#777;">If you didn't expect this email you can ignore it.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildInviteEmail(data: NpPasswordResetTemplateData): NpEmailTemplate {
  npRequirePasswordEmailTemplateData(data);
  const expiry = formatExpiry(data.expiresAt);
  const subject = `You're invited to ${data.siteName}`;
  const text =
    `Hi ${data.name},\n\n` +
    `You've been invited to ${data.siteName}. Set your password to activate your account:\n\n` +
    `${data.resetUrl}\n\n` +
    `This link expires at ${expiry}.`;

  const html = wrap(
    data.siteName,
    `
    <p style="margin:0 0 16px;">Hi ${escapeHtml(data.name)},</p>
    <p style="margin:0 0 24px;">You've been invited to ${escapeHtml(data.siteName)}. Set your password to activate your account:</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(data.resetUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:500;">Set my password</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy the link:</p>
    <p style="margin:0;font-size:13px;color:#555;word-break:break-all;">${escapeHtml(data.resetUrl)}</p>
    <p style="margin-top:24px;font-size:13px;color:#555;">This link expires at ${escapeHtml(expiry)}.</p>
    `,
  );

  return npRequireEmailTemplate({ subject, text, html });
}

export interface NpMemberVerifyTemplateData {
  siteName: string;
  displayName: string;
  verifyUrl: string;
  expiresAt: string;
}

/**
 * Email a brand-new member to confirm their address. Different copy
 * from the staff invite (members self-register, no admin invited them)
 * but reuses the same wrapper styling.
 */
export function buildMemberVerifyEmail(data: NpMemberVerifyTemplateData): NpEmailTemplate {
  npRequireMemberVerifyEmailTemplateData(data);
  const expiry = formatExpiry(data.expiresAt);
  const subject = `Confirm your ${data.siteName} account`;
  const text =
    `Hi ${data.displayName},\n\n` +
    `Welcome to ${data.siteName}. Confirm your email so we can activate your account:\n\n` +
    `${data.verifyUrl}\n\n` +
    `This link expires at ${expiry}. If you didn't sign up, you can ignore this email.`;

  const html = wrap(
    data.siteName,
    `
    <p style="margin:0 0 16px;">Hi ${escapeHtml(data.displayName)},</p>
    <p style="margin:0 0 24px;">Welcome to ${escapeHtml(data.siteName)}. Confirm your email so we can activate your account:</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(data.verifyUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:500;">Confirm my email</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy the link:</p>
    <p style="margin:0;font-size:13px;color:#555;word-break:break-all;">${escapeHtml(data.verifyUrl)}</p>
    <p style="margin-top:24px;font-size:13px;color:#555;">This link expires at ${escapeHtml(expiry)}. If you didn't sign up, you can ignore this email.</p>
    `,
  );

  return npRequireEmailTemplate({ subject, text, html });
}

export function buildResetEmail(data: NpPasswordResetTemplateData): NpEmailTemplate {
  npRequirePasswordEmailTemplateData(data);
  const expiry = formatExpiry(data.expiresAt);
  const subject = `Reset your ${data.siteName} password`;
  const text =
    `Hi ${data.name},\n\n` +
    `Someone requested a password reset for your ${data.siteName} account. ` +
    `If that was you, use this link to set a new one:\n\n` +
    `${data.resetUrl}\n\n` +
    `This link expires at ${expiry}. If you didn't request it, you can ignore this email.`;

  const html = wrap(
    data.siteName,
    `
    <p style="margin:0 0 16px;">Hi ${escapeHtml(data.name)},</p>
    <p style="margin:0 0 24px;">Someone requested a password reset for your ${escapeHtml(data.siteName)} account. If that was you, use this link to set a new one:</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(data.resetUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:500;">Reset password</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Or copy the link:</p>
    <p style="margin:0;font-size:13px;color:#555;word-break:break-all;">${escapeHtml(data.resetUrl)}</p>
    <p style="margin-top:24px;font-size:13px;color:#555;">This link expires at ${escapeHtml(expiry)}. If you didn't request it you can ignore this email.</p>
    `,
  );

  return npRequireEmailTemplate({ subject, text, html });
}
