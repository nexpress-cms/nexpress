export type {
  NxUserRole,
  NxAuthUser,
  NxAccessFunction,
  NxFieldCondition,
  NxFieldValidator,
  NxRichTextContent,
  NxEditorConfig,
  NxTextField,
  NxTextareaField,
  NxNumberField,
  NxRichTextField,
  NxBlocksField,
  NxCheckboxField,
  NxDateField,
  NxUploadField,
  NxRelationshipField,
  NxSelectField,
  NxRadioField,
  NxEmailField,
  NxJsonField,
  NxArrayField,
  NxGroupField,
  NxRowField,
  NxCollapsibleField,
  NxFieldConfig,
  NxCollectionHook,
  NxHookPrincipal,
  NxUploadConfig,
  NxImageSize,
  NxCollectionConfig,
  NxBlockConfig,
  NxBlockInstance,
  NxPluginConfig,
  NxPluginContext,
  NxResolvedPluginLike,
  NxNavItem,
  NxConfig,
  NxThemeManifest,
  NxRegisteredTheme,
  NxI18nConfig,
  NxJobType,
  NxFindOptions,
  NxFindResult,
  NxSaveOptions,
  NxSaveResult,
  NxDocumentStatus,
} from "./config/types.js";

export { ROLE_HIERARCHY, hasRole, isStaffMod } from "./config/types.js";
export { defineConfig } from "./config/define-config.js";
export { defineCollection } from "./config/define-collection.js";
export { authenticated, isAdmin, isEditorOrAbove, isOwnerOrAdmin } from "./config/access.js";

export {
  NxError,
  NxForbiddenError,
  NxNotFoundError,
  NxValidationError,
  NxAuthError,
  NxConflictError,
  NxRateLimitError,
} from "./errors.js";

export {
  buildSearchVector,
  buildSearchVectorParts,
  buildWeightedSearchVectorSql,
} from "./collections/search.js";
export type { NxSearchVectorParts } from "./collections/search.js";
export { buildSitemap, renderSitemapXml } from "./seo/sitemap.js";
export type { NxSitemapEntry, BuildSitemapOptions } from "./seo/sitemap.js";
export {
  DEFAULT_SITE_SEO_SETTINGS,
  buildPageMetadata,
  getSiteSeoSettings,
  validateSeoSettingsPatch,
} from "./seo/page-metadata.js";
export type {
  NxSiteSeoSettings,
  NxPageMetadata,
  NxPageMetadataInput,
  NxSeoSettingsPatch,
} from "./seo/page-metadata.js";
export { buildAtomFeed, renderAtomFeed } from "./seo/feed.js";
export type { NxFeedEntry, BuildAtomFeedOptions } from "./seo/feed.js";
export {
  buildArticleJsonLd,
  buildDiscussionForumPostingJsonLd,
  buildPersonJsonLd,
  buildWebSiteJsonLd,
} from "./seo/json-ld.js";
export type {
  ArticleJsonLd,
  ArticleJsonLdInput,
  BuildJsonLdContext,
  DiscussionForumPostingJsonLd,
  PersonJsonLd,
  PersonJsonLdInput,
  WebSiteJsonLd,
} from "./seo/json-ld.js";
export {
  registerCollection,
  getCollectionConfig,
  getCollectionTable,
  getCollectionRegistration,
  getAllCollectionSlugs,
  setDb,
  getDb,
  saveDocument,
  createMemberDocument,
  updateMemberDocument,
  promoteMemberDocument,
  autosaveRevision,
  deleteDocument,
  deleteMemberDocument,
  findDocuments,
  getDocumentById,
  listRevisions,
  getRevision,
  restoreRevision,
  publishScheduledDocuments,
  listPendingMemberDocs,
  searchCollections,
  reindexCollection,
  getSearchAdapter,
  resetSearchAdapter,
  setSearchAdapter,
  findTranslations,
  createTranslation,
  getTranslationProgress,
} from "./collections/index.js";
export type {
  NxTranslationProgress,
  NxCollectionTranslationProgress,
  NxTranslationProgressLocaleStats,
} from "./collections/translations.js";
export type {
  NxRevision,
  NxRevisionSummary,
  NxRevisionStatus,
  NxRevisionListOptions,
  NxRevisionListResult,
  PublishScheduledResult,
  NxPendingDocSummary,
  NxListPendingDocsOptions,
  NxListPendingDocsResult,
  SearchCollectionsOptions,
  SearchResult,
  SearchResultItem,
  ReindexResult,
  NxSearchAdapter,
  NxSearchAdapterContext,
} from "./collections/index.js";

export {
  getTheme,
  getNavigation,
  getPageBySlug,
  getPostBySlug,
  findPosts,
  getAllPageSlugs,
  getSetting,
} from "./content/index.js";
export { buildZodSchema, getCollectionZodSchema } from "./collections/validation.js";

export { collectionConfigSchema, nxConfigSchema } from "./config/validation.js";

export { createDbConnection } from "./db/connection.js";
export * from "./db/schema/index.js";
export { generateDrizzleSchema } from "./db/generator.js";
export { generateTypeScript } from "./db/type-generator.js";

export { signToken, verifyToken } from "./auth/token.js";
export type { NxTokenPayload } from "./auth/token.js";
export { hashPassword, verifyPassword, ARGON2_OPTIONS } from "./auth/password.js";
export { verifyCsrf } from "./auth/csrf.js";
export {
  registerOAuthProvider,
  getOAuthProvider,
  listOAuthProviders,
  resetOAuthProviders,
} from "./auth/oauth-providers.js";
export type {
  OAuthProvider,
  OAuthProfile,
  OAuthAuthorizeParams,
  OAuthExchangeParams,
} from "./auth/oauth-providers.js";
export { resolveOAuthLogin } from "./auth/oauth-resolve.js";
export { resolveMemberOAuthLogin } from "./auth/oauth-resolve-member.js";
export type {
  ResolveMemberOAuthLoginInput,
  ResolveMemberOAuthLoginResult,
  ResolvedOAuthMember,
} from "./auth/oauth-resolve-member.js";
export { issueOAuthState, verifyOAuthState } from "./auth/oauth-state.js";
export type {
  IssuedOAuthState,
  OAuthStatePayload,
  VerifyOAuthStateResult,
} from "./auth/oauth-state.js";
export { fromArctic } from "./auth/oauth-arctic.js";
export type {
  ArcticLikeProvider,
  ArcticLikeTokens,
  FromArcticOptions,
} from "./auth/oauth-arctic.js";
export type {
  ResolveOAuthLoginInput,
  ResolveOAuthLoginResult,
  ResolvedOAuthUser,
} from "./auth/oauth-resolve.js";
export { sha256, verifyTokenFull, invalidateAllSessions } from "./auth/session.js";
export {
  listUserIdentities,
  listMemberIdentities,
  revokeUserIdentity,
  revokeMemberIdentity,
} from "./auth/identities-admin.js";
export type { NxUserIdentityRow, NxMemberIdentityRow } from "./auth/identities-admin.js";
export {
  createPasswordResetToken,
  requestPasswordReset,
  consumePasswordResetToken,
} from "./auth/reset-token.js";
export { signMemberToken, verifyMemberToken } from "./auth/member-token.js";
export type { NxMemberTokenPayload } from "./auth/member-token.js";
export { getMemberFromTokenPayload, invalidateAllMemberSessions } from "./auth/member-session.js";
export type { NxMemberAuthRow } from "./auth/member-session.js";
export {
  createMemberEmailVerifyToken,
  consumeMemberEmailVerifyToken,
  requestMemberPasswordReset,
  consumeMemberPasswordReset,
} from "./auth/member-credentials.js";
export type {
  NxIssuedMemberToken,
  NxConsumeMemberEmailVerifyResult,
  NxMemberResetRequestResult,
  NxConsumeMemberResetResult,
} from "./auth/member-credentials.js";
export type {
  NxPasswordResetPurpose,
  NxIssuedResetToken,
  NxCreateResetTokenOptions,
  NxResetRequestResult,
  NxConsumeResetTokenOptions,
  NxConsumeResetTokenResult,
} from "./auth/reset-token.js";

export {
  registerJobHandler,
  getJobHandler,
  getAllJobHandlers,
  setJobQueue,
  getJobQueue,
  getOptionalJobQueue,
  enqueueJob,
  startWorker,
  stopWorker,
  startProducer,
  stopProducer,
  PgBossAdapter,
  registerBuiltinHandlers,
  recordHeartbeat,
  markWorkerStopped,
  listWorkerHealth,
  startHeartbeatLoop,
  purgeStaleWorkers,
  countAliveWorkers,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_STALE_THRESHOLD_MS,
  getJobsPauseState,
  setJobsPauseState,
  startPauseSyncLoop,
  PAUSE_SYNC_INTERVAL_MS,
  recordJobLog,
  listJobLogs,
  countJobLogs,
  pruneJobLogsOlderThan,
  runInJobContext,
  getCurrentJobId,
  DEFAULT_JOB_LOG_RETENTION_MS,
} from "./jobs/index.js";
export type {
  NxJobHandler,
  NxJobQueue,
  NxJobState,
  NxJobSummary,
  NxJobListOptions,
  NxJobListResult,
  NxScheduleSummary,
  NxWorkerHeartbeat,
  NxWorkerHealthSummary,
  NxJobsPauseState,
  SetJobsPauseStateInput,
  PauseSyncLoopHandle,
  NxJobLogEntry,
  ListJobLogsOptions,
} from "./jobs/index.js";

export type { NxStorageAdapter, NxFileMetadata } from "./storage/types.js";
export { LocalStorageAdapter } from "./storage/local.js";
export { S3StorageAdapter } from "./storage/s3.js";
export { createStorageAdapter } from "./storage/index.js";

export type {
  NxEmailAdapter,
  NxEmailMessage,
  NxEmailTemplate,
  NxPasswordResetTemplateData,
  SmtpEmailAdapterOptions,
} from "./email/index.js";
export {
  NoopEmailAdapter,
  SmtpEmailAdapter,
  getEmailAdapter,
  setEmailAdapter,
  resetEmailAdapter,
  buildInviteEmail,
  buildResetEmail,
} from "./email/index.js";

export {
  setStorageAdapter,
  getStorageAdapter,
  setMediaDb,
  getMediaDb,
  uploadMedia,
  processMediaImage,
  getMediaById,
  deleteMedia,
  listMedia,
  cleanupDeletedMedia,
} from "./media/service.js";
export type { NxMediaUploader, NxMediaUploaderKindFilter } from "./media/service.js";
export { processImage, DEFAULT_IMAGE_SIZES } from "./media/processor.js";
export type { NxProcessedImageVariant, NxProcessedImageResult } from "./media/processor.js";
export { extractMediaIds } from "./media/refs.js";

export type {
  NxThemeTokens,
  NxThemeColors,
  NxThemeTypography,
  NxThemeShape,
} from "./theme/types.js";
export { DEFAULT_THEME } from "./theme/defaults.js";
export { sanitizeTokenValue } from "./theme/sanitize.js";

export {
  registerThemes,
  resetThemes,
  getRegisteredThemes,
  getThemeById,
  getActiveTheme,
  getActiveThemeId,
  setActiveThemeId,
  getThemeTemplateSummaries,
  resolveTemplateComponent,
} from "./themes/registry.js";
export type { NxThemeTemplateSummary } from "./themes/registry.js";

export {
  registerPluginTemplates,
  resetPluginTemplates,
  getPluginTemplatesForCollection,
} from "./plugins/templates.js";

export {
  ensureDefaultSite,
  listSites,
  getSiteById,
  getSiteByHostname,
  getDefaultSite,
  resolveSiteForHostname,
  createSite,
  updateSite,
  deleteSite,
  getSiteUsageSummary,
  NX_DEFAULT_SITE_ID,
} from "./sites/registry.js";
export type {
  NxSite,
  NxSiteUsage,
  NxDeleteSiteOptions,
  CreateSiteInput,
} from "./sites/registry.js";
export {
  setCurrentSiteResolver,
  resetCurrentSiteResolver,
  getCurrentSiteId,
  withCurrentSite,
} from "./sites/context.js";
export {
  listSiteMemberships,
  listMembershipsForUser,
  getMembership,
  grantSiteMembership,
  revokeSiteMembership,
  setSuperAdmin,
  resolveUserRoleOnSite,
  hasRoleOnSite,
  isSuperAdmin,
} from "./sites/memberships.js";
export type { SiteMembership } from "./sites/memberships.js";

export { setI18nConfig, getI18nConfig, resetI18nConfig } from "./i18n/registry.js";
export {
  addStrings,
  setStrings,
  resetStrings,
  resetTranslationCache,
  getStrings,
  getAllStrings,
  t,
  tSync,
  type NxTranslationParams,
} from "./i18n/strings.js";
export type { NxTranslationBundle } from "./i18n/strings.js";
export { getLocaleDirection, type NxLocaleDirection } from "./i18n/direction.js";
export {
  loadStringOverridesForSite,
  getStringOverridesForSite,
  clearStringOverrideCacheForSite,
  resetStringOverrideCache,
  getStringOverride,
  setStringOverride,
  deleteStringOverride,
  listStringOverridesForSite,
} from "./i18n/string-overrides.js";
export type { NxStringOverrideRow } from "./i18n/string-overrides.js";

export { configureBuiltinJobContext } from "./jobs/builtin-handlers.js";

export {
  loadPlugins,
  runHook,
  runHookAndCollect,
  getPluginRoutes,
  getPluginRegistration,
  getAllPluginIds,
  getPluginAdminExtension,
  getCollectionTabsForSlug,
  getDashboardWidgetsFromPlugins,
  dispatchPluginAction,
  schedulePluginTask,
  getRegisteredPluginSchedules,
  runPluginScheduledTask,
  resetPlugins,
  listPluginStates,
  getPluginState,
  syncPluginRegistrations,
  updatePluginState,
} from "./plugins/index.js";
export type {
  PluginHookHandler,
  PluginRouteHandler,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginAdminExtension,
  ResolvedCollectionTab,
  ResolvedDashboardWidget,
  NxPluginState,
  NxPluginStateUpdate,
} from "./plugins/index.js";

export {
  consoleLogger,
  getLogger,
  getScopedLogger,
  resetLogger,
  setLogger,
  getErrorReporter,
  noopErrorReporter,
  reportError,
  resetErrorReporter,
  setErrorReporter,
} from "./observability/index.js";
export type {
  NxLogLevel,
  NxLogger,
  NxErrorReporter,
  NxErrorReportContext,
} from "./observability/index.js";

export {
  getCommunityRole,
  listCommunityRoles,
  registerCommunityRole,
  resetCommunityRoles,
  memberCan,
  assertNotBanned,
  setSpamAdapter,
  getSpamAdapter,
  resetSpamAdapter,
  setProfanityAdapter,
  getProfanityAdapter,
  resetProfanityAdapter,
  setReputationAdapter,
  getReputationAdapter,
  resetReputationAdapter,
  applyReputation,
  DEFAULT_COMMUNITY_SETTINGS,
  getCommunitySettings,
  updateCommunitySettings,
  validateCommunitySettingsPatch,
  renderCommentMarkdown,
  createComment,
  listComments,
  updateComment,
  deleteComment,
  hideComment,
  restoreComment,
  staffHideComment,
  staffRestoreComment,
  staffDeleteComment,
  DEFAULT_REACTION_KINDS,
  addReaction,
  removeReaction,
  countReactions,
  listMemberReactions,
  assertReactableExists,
  follow,
  unfollow,
  isFollowing,
  listFollowing,
  createNotification,
  listNotifications,
  unreadNotificationCount,
  markNotificationsRead,
  markAllNotificationsRead,
  assertOwnsNotification,
  principalCan,
  recordAuditEvent,
  listAuditEvents,
  fileReport,
  listReports,
  resolveReport,
  unresolvedReportCount,
  issueBan,
  listBansForMember,
  revokeBan,
  grantMemberRole,
  listMemberRoleGrants,
  revokeMemberRole,
  purgeMemberContent,
  muteMember,
  unmuteMember,
  isMuted,
  getMutedTargetIds,
  listMutes,
  MENTION_HANDLE_RE,
  extractMentionHandles,
  extractMentionHandlesFromRichText,
  extractMentionHandlesFromDocData,
  resolveMentionedMembers,
  fanOutMentionNotifications,
  registerNotificationKind,
  listNotificationKinds,
  getMemberNotificationPrefs,
  setMemberNotificationPrefs,
  isNotificationKindEnabled,
  recordDigestSent,
  buildDigestEmail,
  runDigestSweep,
} from "./community/index.js";
export type {
  CommunityCapability,
  CommunityRoleDefinition,
  CommunityScope,
  MemberAction,
  MemberCanTarget,
  NxSpamAdapter,
  NxSpamCheckContext,
  NxSpamVerdict,
  NxSpamVerdictKind,
  NxProfanityAdapter,
  NxProfanityCheckContext,
  NxProfanityVerdict,
  NxProfanityVerdictKind,
  NxReputationAdapter,
  NxReputationEvent,
  NxCommunitySettings,
  NxMemberUploadQuota,
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
  NxReactionRow,
  NxReactToInput,
  NxFollowRow,
  NxFollowInput,
  NxNotificationRow,
  CreateNotificationInput,
  ListNotificationsOptions,
  NxNotificationListResult,
  MarkReadInput,
  Principal,
  AuditActor,
  AuditActorKind,
  AuditEventRow,
  RecordAuditEventInput,
  ListAuditOptions,
  NxReportRow,
  FileReportInput,
  ListReportsOptions,
  ListReportsResult,
  ResolveReportInput,
  NxBanRow,
  BanScope,
  BanKind,
  IssueBanInput,
  RevokeBanInput,
  NxMemberRoleGrantRow,
  GrantMemberRoleInput,
  RevokeMemberRoleInput,
  NxMemberPurgeResult,
  NxMemberMuteRow,
  NxMemberMuteSummary,
  MuteMemberInput,
  ListMutesOptions,
  NxMentionTarget,
  FanOutMentionsInput,
  NxNotificationKindMeta,
  NxNotificationPrefs,
  NxDigestCadence,
  SetMemberNotificationPrefsInput,
  NxDigestEmailContent,
  NxDigestNotificationSummary,
  BuildDigestEmailInput,
  RunDigestSweepInput,
  RunDigestSweepResult,
} from "./community/index.js";
