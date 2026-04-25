export type { NxEmailAdapter, NxEmailMessage } from "./types.js";
export { NoopEmailAdapter } from "./noop.js";
export { SmtpEmailAdapter, type SmtpEmailAdapterOptions } from "./smtp.js";
export { getEmailAdapter, setEmailAdapter, resetEmailAdapter } from "./service.js";
export {
  buildInviteEmail,
  buildMemberVerifyEmail,
  buildResetEmail,
  type NxEmailTemplate,
  type NxMemberVerifyTemplateData,
  type NxPasswordResetTemplateData,
} from "./templates.js";
