export {
  getCommunityRole,
  listCommunityRoles,
  registerCommunityRole,
  resetCommunityRoles,
} from "./roles.js";
export type { CommunityCapability, CommunityRoleDefinition, CommunityScope } from "./roles.js";

export { memberCan, assertNotBanned } from "./can.js";

export { setSpamAdapter, getSpamAdapter, resetSpamAdapter } from "./spam-adapter.js";
export type {
  NxSpamAdapter,
  NxSpamCheckContext,
  NxSpamVerdict,
  NxSpamVerdictKind,
} from "./spam-adapter.js";

export {
  setProfanityAdapter,
  getProfanityAdapter,
  resetProfanityAdapter,
} from "./profanity-adapter.js";
export type {
  NxProfanityAdapter,
  NxProfanityCheckContext,
  NxProfanityVerdict,
  NxProfanityVerdictKind,
} from "./profanity-adapter.js";

export {
  setReputationAdapter,
  getReputationAdapter,
  resetReputationAdapter,
} from "./reputation-adapter.js";
export type { NxReputationAdapter, NxReputationEvent } from "./reputation-adapter.js";
export { applyReputation } from "./reputation.js";

export {
  DEFAULT_COMMUNITY_SETTINGS,
  getCommunitySettings,
  updateCommunitySettings,
  validateCommunitySettingsPatch,
} from "./settings.js";
export type { NxCommunitySettings, NxMemberUploadQuota } from "./settings.js";

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
  NxCommentRow,
  NxCommentCreateInput,
  NxCommentListOptions,
  NxCommentListResult,
  NxCommentSort,
  NxCommentUpdateInput,
  NxCommentDeleteInput,
  NxCommentHideInput,
  NxCommentRestoreInput,
} from "./comments.js";

export {
  DEFAULT_REACTION_KINDS,
  addReaction,
  removeReaction,
  countReactions,
  listMemberReactions,
  assertReactableExists,
} from "./reactions.js";
export type { NxReactionRow, NxReactToInput } from "./reactions.js";

export { follow, unfollow, isFollowing, listFollowing } from "./follows.js";
export type { NxFollowRow, NxFollowInput } from "./follows.js";

export {
  createNotification,
  listNotifications,
  unreadNotificationCount,
  markNotificationsRead,
  markAllNotificationsRead,
  assertOwnsNotification,
} from "./notifications.js";
export type {
  NxNotificationRow,
  CreateNotificationInput,
  ListNotificationsOptions,
  NxNotificationListResult,
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
  NxReportRow,
  FileReportInput,
  ListReportsOptions,
  ListReportsResult,
  ResolveReportInput,
} from "./reports.js";

export { issueBan, listBansForMember, revokeBan } from "./bans.js";

export { grantMemberRole, listMemberRoleGrants, revokeMemberRole } from "./grants.js";
export type {
  NxMemberRoleGrantRow,
  GrantMemberRoleInput,
  RevokeMemberRoleInput,
} from "./grants.js";
export type { NxBanRow, BanScope, BanKind, IssueBanInput, RevokeBanInput } from "./bans.js";

export { purgeMemberContent } from "./member-admin.js";
export type { NxMemberPurgeResult } from "./member-admin.js";

export { muteMember, unmuteMember, isMuted, getMutedTargetIds, listMutes } from "./mutes.js";
export type {
  NxMemberMuteRow,
  NxMemberMuteSummary,
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
export type { NxMentionTarget, FanOutMentionsInput } from "./mentions.js";

export {
  registerNotificationKind,
  listNotificationKinds,
  getMemberNotificationPrefs,
  setMemberNotificationPrefs,
  isNotificationKindEnabled,
} from "./notification-prefs.js";
export type {
  NxNotificationKindMeta,
  NxNotificationPrefs,
  SetMemberNotificationPrefsInput,
} from "./notification-prefs.js";
