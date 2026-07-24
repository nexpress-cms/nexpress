export const npCommunityCommentStatuses = ["visible", "pending", "hidden", "deleted"] as const;
export const npCommunityCommentSorts = ["newest", "oldest", "top"] as const;
export const npCommunityDocumentAudiences = ["public", "members", "private"] as const;
/** Reserved follow targets. Canonical collection slugs are also valid targets. */
export const npCommunityFollowTargets = ["member"] as const;
export const npCommunityFollowActivityKinds = ["comment.created", "document.published"] as const;
/** Reserved report targets. Canonical collection slugs are also valid targets. */
export const npCommunityReportTargets = ["comment", "member"] as const;
export const npCommunityReportStatuses = ["unresolved", "resolved", "all"] as const;
export const npCommunityReportResolutionActions = [
  "dismiss",
  "hide-comment",
  "unpublish-document",
] as const;
export const npCommunityBanScopes = ["site", "category", "collection"] as const;
export const npCommunityBanKinds = ["temporary", "permanent"] as const;
export const npCommunityScopes = ["site", "category", "collection", "thread"] as const;
export const npCommunityDigestCadences = ["off", "daily", "weekly"] as const;
export const npCommunityRealtimeChannels = ["comments", "reactions", "notifications"] as const;
export const npCommunityModerationVerdictKinds = ["pass", "flag", "reject"] as const;
export const npCommunityAuditActorKinds = ["staff", "member", "system"] as const;
export const npCommunityCapabilities = [
  "hide-comment",
  "restore-comment",
  "edit-any-comment",
  "delete-any-comment",
  "hide-thread",
  "restore-thread",
  "lock-thread",
  "unlock-thread",
  "pin-thread",
  "unpin-thread",
  "edit-any-thread",
  "delete-any-thread",
  "edit-own-thread",
  "lock-own-thread",
  "ban-member",
  "unban-member",
  "resolve-report",
  "manage-category",
  "view-staff-tools",
] as const;
export const npCommunityThreadModerationActions = [
  "hide",
  "restore",
  "lock",
  "unlock",
  "pin",
  "unpin",
] as const;

export type CommentStatus = (typeof npCommunityCommentStatuses)[number];
export type NpCommentSort = (typeof npCommunityCommentSorts)[number];
export type NpCommunityDocumentAudience = (typeof npCommunityDocumentAudiences)[number];
/** `member` or a canonical collection slug that enabled document follows. */
export type NpFollowTarget = string;
export type NpFollowActivityKind = (typeof npCommunityFollowActivityKinds)[number];
/** `comment`, `member`, or a canonical collection slug. */
export type NpReportTarget = string;
export type NpReportStatus = (typeof npCommunityReportStatuses)[number];
export type NpReportResolutionAction = (typeof npCommunityReportResolutionActions)[number];
export type BanScope = (typeof npCommunityBanScopes)[number];
export type BanKind = (typeof npCommunityBanKinds)[number];
export type CommunityScope = (typeof npCommunityScopes)[number];
export type NpDigestCadence = (typeof npCommunityDigestCadences)[number];
export type NpCommunityRealtimeChannel = (typeof npCommunityRealtimeChannels)[number];
export type NpModerationVerdictKind = (typeof npCommunityModerationVerdictKinds)[number];
export type AuditActorKind = (typeof npCommunityAuditActorKinds)[number];
export type CommunityCapability = (typeof npCommunityCapabilities)[number];
export type NpThreadModerationAction = (typeof npCommunityThreadModerationActions)[number];

export interface NpThreadModerationRequest {
  action: NpThreadModerationAction;
  reason?: string | null;
}

export const npMemberProfileActivityKinds = ["documents", "comments"] as const;
export type NpMemberProfileActivityKind = (typeof npMemberProfileActivityKinds)[number];

export type NpCommunityJsonPrimitive = string | number | boolean | null;
export type NpCommunityJsonValue =
  NpCommunityJsonPrimitive | NpCommunityJsonValue[] | { [key: string]: NpCommunityJsonValue };
export type NpCommunityJsonObject = Record<string, NpCommunityJsonValue>;

export interface NpMemberUploadQuota {
  perDay: number | null;
  total: number | null;
}

export interface NpCommunitySettings {
  reactionKinds: string[];
  registrationEnabled: boolean;
  memberUploadQuota: NpMemberUploadQuota;
}

export interface NpCommunitySettingsPatch {
  reactionKinds?: string[];
  registrationEnabled?: boolean;
  memberUploadQuota?: Partial<NpMemberUploadQuota>;
}

export interface NpNotificationKindMeta {
  kind: string;
  label: string;
  description: string;
}

export interface NpNotificationPrefs {
  disabled: string[];
  digest: NpDigestCadence;
  lastDigestAt: string | null;
  lastDigestAtBySite: Record<string, Partial<Record<NpDigestCadence, string>>>;
}

export interface NpModerationVerdict {
  kind: NpModerationVerdictKind;
  reason?: string;
  metadata?: NpCommunityJsonObject;
}

export type NpSpamVerdictKind = NpModerationVerdictKind;
export type NpProfanityVerdictKind = NpModerationVerdictKind;
export type NpSpamVerdict = NpModerationVerdict;
export type NpProfanityVerdict = NpModerationVerdict;

export interface NpModerationCheckContext {
  memberId: string;
  targetType: string;
  targetId: string;
  parentId?: string | null;
}

export type NpSpamCheckContext = NpModerationCheckContext;
export type NpProfanityCheckContext = NpModerationCheckContext;

export interface NpSpamAdapter {
  check(text: string, ctx: NpSpamCheckContext): NpSpamVerdict | Promise<NpSpamVerdict>;
}

export interface NpProfanityAdapter {
  check(
    text: string,
    ctx: NpProfanityCheckContext,
  ): NpProfanityVerdict | Promise<NpProfanityVerdict>;
}

export type NpReputationEvent =
  | {
      kind: "comment.created";
      commentId: string;
      memberId: string;
      targetType: string;
      targetId: string;
    }
  | {
      kind: "comment.hidden";
      commentId: string;
      memberId: string;
      byStaff: boolean;
      reason?: string | null;
    }
  | {
      kind: "comment.deleted";
      commentId: string;
      memberId: string;
      byStaff: boolean;
    }
  | {
      kind: "reaction.received";
      reactionKind: string;
      recipientId: string;
      reactorId: string;
      targetType: string;
      targetId: string;
    }
  | {
      kind: "reaction.removed";
      reactionKind: string;
      recipientId: string;
      reactorId: string;
      targetType: string;
      targetId: string;
    }
  | {
      kind: "document.created";
      collectionSlug: string;
      documentId: string;
      memberId: string;
    }
  | {
      kind: "document.deleted";
      collectionSlug: string;
      documentId: string;
      memberId: string;
    };

export interface NpReputationAdapter {
  apply(event: NpReputationEvent): number | Promise<number>;
}

export interface CommunityRoleDefinition {
  role: string;
  scopeType: CommunityScope;
  capabilities: readonly CommunityCapability[];
  label?: string;
  source?: string;
}

export interface NpCommunityScopeOptionWire {
  scopeType: Exclude<CommunityScope, "site">;
  scopeId: string;
  label: string;
  sourceCollection: string;
}

export interface NpCommentRow {
  id: string;
  targetType: string;
  targetId: string;
  parentId: string | null;
  memberId: string;
  bodyMd: string;
  bodyHtml: string;
  status: CommentStatus;
  hiddenByUserId: string | null;
  hiddenByMemberId: string | null;
  hiddenReason: string | null;
  editedAt: Date | null;
  siteId: string;
  createdAt: Date;
  authorStatus?: string | null;
}

export type NpCommentWireRow = Omit<NpCommentRow, "editedAt" | "createdAt"> & {
  editedAt: string | null;
  createdAt: string;
};

/** Public, PII-free author projection attached to comment list rows. */
export interface NpCommentAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Exact PII-free public member profile shared by API, routes, and themes. */
export interface NpPublicMemberProfileWire {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  reputation: number;
  joinedAt: string;
}

export interface NpMemberProfileDocumentActivityWire {
  kind: "document";
  collectionSlug: string;
  collectionLabel: string;
  documentId: string;
  title: string;
  href: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NpMemberProfileCommentActivityWire {
  kind: "comment";
  commentId: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  href: string | null;
  excerpt: string;
  createdAt: string;
  editedAt: string | null;
}

export type NpMemberProfileActivityItemWire =
  NpMemberProfileDocumentActivityWire | NpMemberProfileCommentActivityWire;

export interface NpMemberProfileActivityQuery {
  kind: NpMemberProfileActivityKind;
  page: number;
  limit: number;
}

export interface NpMemberProfileActivityPageWire {
  kind: NpMemberProfileActivityKind;
  items: NpMemberProfileActivityItemWire[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * A list row combines the persisted comment with the public author and the
 * viewer-aware reaction summary needed to render it without per-row fetches.
 */
export type NpCommentListItem = NpCommentRow & {
  author: NpCommentAuthor | null;
  reactions: NpReactionSummaryWire;
};

export type NpCommentListItemWire = Omit<NpCommentListItem, "editedAt" | "createdAt"> & {
  editedAt: string | null;
  createdAt: string;
};

export interface NpCommentCreateInput {
  targetType: string;
  targetId: string;
  parentId?: string | null;
  memberId: string;
  bodyMd: string;
}

export interface NpCommentListOptions {
  limit?: number;
  offset?: number;
  order?: NpCommentSort;
  includeHidden?: boolean;
  viewerMemberId?: string;
}

export interface NpCommentListResult {
  comments: NpCommentListItem[];
  totalDocs: number;
  limit: number;
  offset: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NpCommentListWire {
  comments: NpCommentListItemWire[];
  totalDocs: number;
  limit: number;
  offset: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NpCommentUpdateInput {
  commentId: string;
  memberId: string;
  bodyMd: string;
}

export interface NpCommentDeleteInput {
  commentId: string;
  memberId: string;
}

export interface NpCommentHideInput extends NpCommentDeleteInput {
  reason?: string | null;
}

export interface NpCommentRestoreInput extends NpCommentDeleteInput {}

export interface NpReactionRow {
  id: string;
  targetType: string;
  targetId: string;
  memberId: string;
  kind: string;
  siteId: string;
  createdAt: Date;
}

export type NpReactionWireRow = Omit<NpReactionRow, "createdAt"> & { createdAt: string };

export interface NpReactToInput {
  targetType: string;
  targetId: string;
  memberId: string;
  kind: string;
}

export interface NpReactionSummaryWire {
  counts: Record<string, number>;
  mine: string[];
}

export interface NpEngagementTarget {
  targetType: string;
  targetId: string;
}

export interface NpContentViewRow extends NpEngagementTarget {
  id: string;
  viewerHash: string;
  viewedOn: string;
  siteId: string;
  createdAt: Date;
}

export interface NpContentViewReceiptWire {
  counted: boolean;
  viewCount: number;
}

export interface NpContentEngagementSummary extends NpEngagementTarget {
  viewCount: number;
  commentCount: number;
  reactionCount: number;
  reactions: Record<string, number>;
}

export interface NpFollowRow {
  id: string;
  followerId: string;
  targetType: NpFollowTarget;
  targetId: string;
  siteId: string;
  createdAt: Date;
}

export type NpFollowWireRow = Omit<NpFollowRow, "createdAt"> & { createdAt: string };

export interface NpFollowInput {
  followerId: string;
  targetType: NpFollowTarget;
  targetId: string;
}

export type NpFollowActivityNotificationPayload = {
  activity: NpFollowActivityKind;
  subjectType: string;
  subjectId: string;
  targetType: string;
  targetId: string;
  href: string;
  commentId: string | null;
};

export interface NpNotificationRow {
  id: string;
  memberId: string;
  kind: string;
  payload: NpCommunityJsonObject;
  readAt: Date | null;
  siteId: string;
  createdAt: Date;
}

export type NpNotificationWireRow = Omit<NpNotificationRow, "readAt" | "createdAt"> & {
  readAt: string | null;
  createdAt: string;
};

export interface CreateNotificationInput {
  memberId: string;
  kind: string;
  payload?: NpCommunityJsonObject;
  actorMemberId?: string | null;
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface NpNotificationListResult {
  notifications: NpNotificationRow[];
  totalDocs: number;
  unread: number;
}

export interface NpNotificationListWire {
  notifications: NpNotificationWireRow[];
  totalDocs: number;
  unread: number;
}

/**
 * Short-lived invalidation outbox row. Document channels are addressed by
 * target while the private notification channel is addressed by member.
 */
export interface NpCommunityRealtimeEventRow {
  id: string;
  sequence: number;
  channel: NpCommunityRealtimeChannel;
  targetType: string | null;
  targetId: string | null;
  memberId: string | null;
  siteId: string;
  createdAt: Date;
}

export type NpCommunityRealtimeEventKind = `${NpCommunityRealtimeChannel}.changed`;

/** PII-free SSE payload. Authorization and routing stay server-side. */
export interface NpCommunityRealtimeEventWire {
  version: 1;
  id: string;
  kind: NpCommunityRealtimeEventKind;
  occurredAt: string;
}

export type NpCommunityRealtimeSubscription =
  | {
      scope: "document";
      targetType: string;
      targetId: string;
    }
  | {
      scope: "inbox";
    };

export interface MarkReadInput {
  memberId: string;
  notificationIds: string[];
}

export type NpMarkNotificationsReadRequest = { all: true } | { ids: string[] };
export type NpMarkNotificationsReadWire = { marked: number; all?: true };

export interface NpReportRow {
  id: string;
  reporterId: string;
  targetType: NpReportTarget;
  targetId: string;
  reason: string;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolvedByMemberId: string | null;
  resolution: NpReportResolutionAction | null;
  siteId: string;
  createdAt: Date;
}

export type NpReportWireRow = Omit<NpReportRow, "resolvedAt" | "createdAt"> & {
  resolvedAt: string | null;
  createdAt: string;
};

export type NpReportTargetContextKind = "comment" | "document" | "member" | "missing";

/** Operator-safe target projection for the moderation queue. */
export interface NpReportTargetContextWire {
  kind: NpReportTargetContextKind;
  label: string;
  excerpt: string | null;
  status: string | null;
  href: string | null;
  collectionSlug: string | null;
  documentId: string | null;
  authorMemberId: string | null;
}

export interface NpModerationReportWireRow extends NpReportWireRow {
  target: NpReportTargetContextWire;
}

export interface FileReportInput {
  reporterId: string;
  targetType: NpReportTarget;
  targetId: string;
  reason: string;
}

export interface ListReportsOptions {
  status?: NpReportStatus;
  targetType?: NpReportTarget;
  siteId?: string | null;
  limit?: number;
  offset?: number;
}

export interface ListReportsResult {
  reports: NpReportRow[];
  totalDocs: number;
}

export interface NpReportPageWire extends NpPageWire<NpReportWireRow> {}

export interface NpModerationReportPageWire extends NpPageWire<NpModerationReportWireRow> {}

export interface NpResolveReportRequest {
  action: NpReportResolutionAction;
}

export interface NpBanRow {
  id: string;
  memberId: string;
  scopeType: BanScope;
  scopeId: string | null;
  kind: BanKind;
  expiresAt: Date | null;
  reason: string | null;
  byUserId: string | null;
  byMemberId: string | null;
  siteId: string;
  createdAt: Date;
}

export type NpBanWireRow = Omit<NpBanRow, "expiresAt" | "createdAt"> & {
  expiresAt: string | null;
  createdAt: string;
};

export interface NpMemberRoleGrantRow {
  id: string;
  memberId: string;
  role: string;
  scopeType: CommunityScope;
  scopeId: string | null;
  grantedBy: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
  siteId: string;
}

export type NpMemberRoleGrantWireRow = Omit<NpMemberRoleGrantRow, "grantedAt" | "expiresAt"> & {
  grantedAt: string;
  expiresAt: string | null;
};

export interface NpMemberMuteRow {
  memberId: string;
  targetId: string;
  siteId: string;
  createdAt: Date;
}

export interface NpMemberMuteSummary {
  targetId: string;
  handle: string;
  displayName: string;
  createdAt: string;
}

export type AuditActor =
  { kind: "staff"; userId: string } | { kind: "member"; memberId: string } | { kind: "system" };

export interface RecordAuditEventInput {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  siteId?: string | null;
}

export interface AuditEventRow {
  id: string;
  actorKind: AuditActorKind;
  actorUserId: string | null;
  actorMemberId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: NpCommunityJsonObject;
  siteId: string | null;
  createdAt: Date;
}

export type NpAuditEventWireRow = Omit<AuditEventRow, "createdAt"> & { createdAt: string };
export interface NpAuditPageWire extends NpPageWire<NpAuditEventWireRow> {}

export interface NpMemberPurgeResult {
  comments: number;
  documents: Record<string, number>;
  media: { deleted: number; skipped: number };
}

export interface NpPageWire<T> {
  docs: T[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface NpCommunityRuntimeDiagnostic {
  source:
    | "roles"
    | "notification-kinds"
    | "notification-prefs"
    | "notifications"
    | "realtime"
    | "spam"
    | "profanity"
    | "reputation"
    | "profiles"
    | "audience";
  message: string;
  occurredAt: string;
}

export type NpCommunityContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "duplicate" | "invariant" | "limit";

export interface NpCommunityContractIssue {
  code: NpCommunityContractIssueCode;
  path: string;
  message: string;
}

export type NpCommunityContractResult<T> =
  { ok: true; value: T } | { ok: false; issues: NpCommunityContractIssue[] };
