export {
  getCommunityRole,
  listCommunityRoles,
  registerCommunityRole,
  resetCommunityRoles,
} from "./roles.js";
export type { CommunityCapability, CommunityRoleDefinition, CommunityScope } from "./roles.js";

export { memberCan, assertNotBanned, withMemberWrite } from "./can.js";

export { setSpamAdapter, getSpamAdapter, resetSpamAdapter } from "./spam-adapter.js";
export type {
  NpSpamAdapter,
  NpSpamCheckContext,
  NpSpamVerdict,
  NpSpamVerdictKind,
} from "./spam-adapter.js";

export {
  setProfanityAdapter,
  getProfanityAdapter,
  resetProfanityAdapter,
} from "./profanity-adapter.js";
export type {
  NpProfanityAdapter,
  NpProfanityCheckContext,
  NpProfanityVerdict,
  NpProfanityVerdictKind,
} from "./profanity-adapter.js";

export {
  setReputationAdapter,
  getReputationAdapter,
  resetReputationAdapter,
} from "./reputation-adapter.js";
export type { NpReputationAdapter, NpReputationEvent } from "./reputation-adapter.js";
export { applyReputation } from "./reputation.js";

export {
  DEFAULT_COMMUNITY_SETTINGS,
  getCommunitySettings,
  npRequireCommunitySettings,
  updateCommunitySettings,
  validateCommunitySettingsPatch,
} from "./settings.js";
export type { NpCommunitySettings, NpMemberUploadQuota } from "./settings.js";

export { getMemberProfile, getMemberProfiles } from "./profiles.js";
export type { NpMemberProfile } from "./profiles.js";

export type { MemberAction, MemberCanTarget } from "./can.js";

export { renderCommentMarkdown } from "./markdown.js";

export {
  createComment,
  listComments,
  updateComment,
  deleteComment,
  hideComment,
  restoreComment,
  staffHideComment,
  staffRestoreComment,
  staffDeleteComment,
} from "./comments.js";
export type {
  CommentStatus,
  NpCommentRow,
  NpCommentCreateInput,
  NpCommentListOptions,
  NpCommentListResult,
  NpCommentSort,
  NpCommentUpdateInput,
  NpCommentDeleteInput,
  NpCommentHideInput,
  NpCommentRestoreInput,
} from "./comments.js";

export {
  DEFAULT_REACTION_KINDS,
  addReaction,
  removeReaction,
  countReactions,
  listMemberReactions,
  assertReactableExists,
} from "./reactions.js";
export type { NpReactionRow, NpReactToInput } from "./reactions.js";

export { follow, unfollow, isFollowing, listFollowing } from "./follows.js";
export type { NpFollowRow, NpFollowInput } from "./follows.js";

export {
  createNotification,
  listNotifications,
  unreadNotificationCount,
  markNotificationsRead,
  markAllNotificationsRead,
  assertOwnsNotification,
} from "./notifications.js";
export type {
  NpNotificationRow,
  CreateNotificationInput,
  ListNotificationsOptions,
  NpNotificationListResult,
  MarkReadInput,
} from "./notifications.js";

export { principalCan } from "./principal.js";
export type { Principal } from "./principal.js";

export { recordAuditEvent, listAuditEvents } from "./audit.js";
export type {
  AuditActor,
  AuditActorKind,
  AuditEventRow,
  RecordAuditEventInput,
  ListAuditOptions,
} from "./audit.js";

export { fileReport, listReports, resolveReport, unresolvedReportCount } from "./reports.js";
export type {
  NpReportRow,
  FileReportInput,
  ListReportsOptions,
  ListReportsResult,
  ResolveReportInput,
} from "./reports.js";

export { issueBan, listBansForMember, revokeBan } from "./bans.js";

export { grantMemberRole, listMemberRoleGrants, revokeMemberRole } from "./grants.js";
export type {
  NpMemberRoleGrantRow,
  GrantMemberRoleInput,
  RevokeMemberRoleInput,
} from "./grants.js";
export type { NpBanRow, BanScope, BanKind, IssueBanInput, RevokeBanInput } from "./bans.js";

export { purgeMemberContent } from "./member-admin.js";
export type { NpMemberPurgeResult } from "./member-admin.js";

export { muteMember, unmuteMember, isMuted, getMutedTargetIds, listMutes } from "./mutes.js";
export type {
  NpMemberMuteRow,
  NpMemberMuteSummary,
  MuteMemberInput,
  ListMutesOptions,
} from "./mutes.js";

export {
  MENTION_HANDLE_RE,
  extractMentionHandles,
  extractMentionHandlesFromRichText,
  extractMentionHandlesFromDocData,
  resolveMentionedMembers,
  fanOutMentionNotifications,
} from "./mentions.js";
export type { NpMentionTarget, FanOutMentionsInput } from "./mentions.js";

export {
  registerNotificationKind,
  listNotificationKinds,
  getMemberNotificationPrefs,
  setMemberNotificationPrefs,
  isNotificationKindEnabled,
  recordDigestSent,
} from "./notification-prefs.js";
export type {
  NpNotificationKindMeta,
  NpNotificationPrefs,
  NpDigestCadence,
  SetMemberNotificationPrefsInput,
} from "./notification-prefs.js";

export { buildDigestEmail, runDigestSweep } from "./digest.js";
export type {
  NpDigestEmailContent,
  NpDigestNotificationSummary,
  BuildDigestEmailInput,
  RunDigestSweepInput,
  RunDigestSweepResult,
} from "./digest.js";

export { getCommunityRuntimeDiagnostics, resetCommunityRuntimeDiagnostics } from "./diagnostics.js";
export * from "../community-contract/index.js";
