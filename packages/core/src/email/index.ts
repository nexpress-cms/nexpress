export type {
  NpEmailAdapter,
  NpEmailAdapterMode,
  NpEmailMessage,
  NpEmailRuntimeConfig,
  SmtpEmailAdapterOptions,
} from "./types.js";
export {
  NpEmailContractError,
  npAnalyzeEmailMessage,
  npEmailContractLimits,
  npIsCanonicalEmailDate,
  npIsEmailAddress,
  npReadEmailRuntimeConfig,
  npRequireEmailAdapter,
  npRequireEmailMessage,
  npRequireEmailRuntimeConfig,
  npRequireEmailTemplate,
  npRequireMemberVerifyEmailTemplateData,
  npRequirePasswordEmailTemplateData,
  npRequireSmtpEmailAdapterOptions,
  type NpEmailContractIssue,
  type NpEmailContractIssueCode,
} from "./contract.js";
export { NoopEmailAdapter } from "./noop.js";
export { SmtpEmailAdapter } from "./smtp.js";
export { getEmailAdapter, resetEmailAdapter, sendEmail, setEmailAdapter } from "./service.js";
export { configureEmailRuntime, configureEmailRuntimeFromEnv } from "./runtime.js";
export {
  buildInviteEmail,
  buildMemberVerifyEmail,
  buildResetEmail,
  type NpEmailTemplate,
  type NpMemberVerifyTemplateData,
  type NpPasswordResetTemplateData,
} from "./templates.js";
