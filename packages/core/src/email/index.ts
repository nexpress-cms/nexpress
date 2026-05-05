export type { NpEmailAdapter, NpEmailMessage } from "./types.js";
export { NoopEmailAdapter } from "./noop.js";
export { SmtpEmailAdapter, type SmtpEmailAdapterOptions } from "./smtp.js";
export { getEmailAdapter, setEmailAdapter, resetEmailAdapter } from "./service.js";
export {
  buildInviteEmail,
  buildMemberVerifyEmail,
  buildResetEmail,
  type NpEmailTemplate,
  type NpMemberVerifyTemplateData,
  type NpPasswordResetTemplateData,
} from "./templates.js";
