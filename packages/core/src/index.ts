export type {
  NpUserRole,
  NpAuthUser,
  NpAccessFunction,
  NpFieldCondition,
  NpFieldValidator,
  NpRichTextContent,
  NpEditorConfig,
  NpTextField,
  NpTextareaField,
  NpNumberField,
  NpRichTextField,
  NpBlocksField,
  NpCheckboxField,
  NpDateField,
  NpUploadField,
  NpRelationshipField,
  NpSelectField,
  NpRadioField,
  NpEmailField,
  NpJsonField,
  NpArrayField,
  NpGroupField,
  NpRowField,
  NpCollapsibleField,
  NpFieldConfig,
  NpCollectionHook,
  NpHookPrincipal,
  NpPrincipal,
  NpUploadConfig,
  NpImageSize,
  NpCollectionConfig,
  NpBlockConfig,
  NpBlockInstance,
  NpPluginConfig,
  NpPluginContext,
  NpResolvedPluginLike,
  NpNavItem,
  NpConfig,
  NpThemeManifest,
  NpAdminGroupMeta,
  NpThemeCollectionRequirement,
  NpThemeCollectionKind,
  NpThemeFieldRequirement,
  NpRegisteredTheme,
  NpI18nConfig,
  NpJobType,
  NpFindOptions,
  NpFindResult,
  NpFindWhere,
  NpFindWhereSystemTokens,
  NpSaveOptions,
  NpSaveResult,
  NpDocumentStatus,
} from "./config/types.js";

// `hasRole` / `isStaffMod` were retired in favour of `can(user, capability)` (#273).
export { ROLE_HIERARCHY } from "./config/types.js";
export { defineConfig } from "./config/define-config.js";
export { defineCollection } from "./config/define-collection.js";
export { authenticated, isAdmin, isEditorOrAbove, isOwnerOrAdmin } from "./config/access.js";

export {
  NpError,
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
  NpAuthError,
  NpConflictError,
  NpRateLimitError,
  NpSiteContextMissingError,
  type NpErrorCode,
  type NpErrorCodeInput,
} from "./errors.js";

export {
  buildSearchVector,
  buildSearchVectorParts,
  buildWeightedSearchVectorSql,
} from "./collections/search.js";
export type { NpSearchVectorParts } from "./collections/search.js";
export {
  buildSitemap,
  renderSitemapXml,
  renderSitemapIndexXml,
} from "./seo/sitemap.js";
export type {
  NpSitemapEntry,
  NpSitemapIndexEntry,
  BuildSitemapOptions,
} from "./seo/sitemap.js";
export {
  DEFAULT_SITE_SEO_SETTINGS,
  buildPageMetadata,
  getSiteSeoSettings,
  validateSeoSettingsPatch,
} from "./seo/page-metadata.js";
export type {
  NpSiteSeoSettings,
  NpPageMetadata,
  NpPageMetadataInput,
  NpSeoSettingsPatch,
} from "./seo/page-metadata.js";
export { buildAtomFeed, renderAtomFeed } from "./seo/feed.js";
export type { NpFeedEntry, BuildAtomFeedOptions } from "./seo/feed.js";
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
  NpTranslationProgress,
  NpCollectionTranslationProgress,
  NpTranslationProgressLocaleStats,
} from "./collections/translations.js";
export type {
  NpRevision,
  NpRevisionSummary,
  NpRevisionStatus,
  NpRevisionListOptions,
  NpRevisionListResult,
  PublishScheduledResult,
  NpPendingDocSummary,
  NpListPendingDocsOptions,
  NpListPendingDocsResult,
  SearchCollectionsOptions,
  SearchResult,
  SearchResultItem,
  ReindexResult,
  NpSearchAdapter,
  NpSearchAdapterContext,
} from "./collections/index.js";

export {
  getTheme,
  getNavigation,
  getPageBySlug,
  getPostBySlug,
  findPosts,
  findSlugRedirect,
  getAllPageSlugs,
  getSetting,
} from "./content/index.js";
export {
  buildZodSchema,
  collectHiddenFieldNames,
  getCollectionZodSchema,
} from "./collections/validation.js";

export { collectionConfigSchema, npConfigSchema } from "./config/validation.js";

export { createDbConnection } from "./db/connection.js";
export { setDb, getDb } from "./db/runtime.js";
export * from "./db/schema/index.js";
export { generateDrizzleSchema } from "./db/generator.js";
export { generateTypeScript, generateDocumentsModule } from "./db/type-generator.js";

export { signToken, verifyToken, isTokenVerificationError } from "./auth/token.js";
export type { NpTokenPayload } from "./auth/token.js";
export { getUserById } from "./auth/users.js";
export type { NpUserBasic } from "./auth/users.js";
export { hashPassword, verifyPassword, ARGON2_OPTIONS } from "./auth/password.js";
export { verifyCsrf } from "./auth/csrf.js";
export { can, type NpCapability } from "./auth/capabilities.js";
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
export type { NpUserIdentityRow, NpMemberIdentityRow } from "./auth/identities-admin.js";
export {
  createPasswordResetToken,
  requestPasswordReset,
  consumePasswordResetToken,
} from "./auth/reset-token.js";
export { signMemberToken, verifyMemberToken } from "./auth/member-token.js";
export type { NpMemberTokenPayload } from "./auth/member-token.js";
export { getMemberFromTokenPayload, invalidateAllMemberSessions } from "./auth/member-session.js";
export type { NpMemberAuthRow } from "./auth/member-session.js";
export {
  createMemberEmailVerifyToken,
  consumeMemberEmailVerifyToken,
  requestMemberPasswordReset,
  consumeMemberPasswordReset,
} from "./auth/member-credentials.js";
export type {
  NpIssuedMemberToken,
  NpConsumeMemberEmailVerifyResult,
  NpMemberResetRequestResult,
  NpConsumeMemberResetResult,
} from "./auth/member-credentials.js";
export type {
  NpPasswordResetPurpose,
  NpIssuedResetToken,
  NpCreateResetTokenOptions,
  NpResetRequestResult,
  NpConsumeResetTokenOptions,
  NpConsumeResetTokenResult,
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
  purgeStaleWorkers,
  countAliveWorkers,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_STALE_THRESHOLD_MS,
  getJobsPauseState,
  setJobsPauseState,
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
  NpJobHandler,
  NpJobQueue,
  NpJobState,
  NpJobSummary,
  NpJobListOptions,
  NpJobListResult,
  NpJobCountOptions,
  NpJobStateCounts,
  NpPluginScheduleStats,
  NpReconcileSchedulesResult,
  NpScheduleSummary,
  NpWorkerHeartbeat,
  NpWorkerHealthSummary,
  NpJobsPauseState,
  SetJobsPauseStateInput,
  NpJobLogEntry,
  ListJobLogsOptions,
} from "./jobs/index.js";

export type { NpStorageAdapter, NpFileMetadata } from "./storage/types.js";
export { LocalStorageAdapter } from "./storage/local.js";
export { S3StorageAdapter } from "./storage/s3.js";
export { createStorageAdapter } from "./storage/index.js";

export type {
  NpEmailAdapter,
  NpEmailMessage,
  NpEmailTemplate,
  NpPasswordResetTemplateData,
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
  uploadMedia,
  processMediaImage,
  getMediaById,
  deleteMedia,
  listMedia,
  cleanupDeletedMedia,
} from "./media/service.js";
export type { NpMediaUploader, NpMediaUploaderKindFilter } from "./media/service.js";
export { processImage, DEFAULT_IMAGE_SIZES } from "./media/processor.js";
export type { NpProcessedImageVariant, NpProcessedImageResult } from "./media/processor.js";
export { extractMediaIds } from "./media/refs.js";
export { getMediaUrl } from "./media/url.js";
export type { NpMediaVariantName, NpGetMediaUrlOptions } from "./media/url.js";

export type {
  NpThemeTokens,
  NpThemeColors,
  NpThemeTypography,
  NpThemeShape,
  NpThemeTokensOverlay,
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
export type { NpThemeTemplateSummary } from "./themes/registry.js";

export { checkThemeRequirements } from "./themes/requirements.js";
export type {
  NpThemeRequirementResult,
  NpThemeRequirementMissingField,
  NpThemeRequirementTypeConflict,
  NpThemeRequirementRelationConflict,
} from "./themes/requirements.js";

export { mergeThemeRequirements } from "./themes/merge-requirements.js";

export {
  getThemeSettings,
  getThemeSettingsWithStatus,
  setThemeSettings,
  activeThemeContributesSeo,
} from "./themes/settings.js";
export type { NpThemeSettingsResult } from "./themes/settings.js";

export { getActiveThemeNavLocations } from "./themes/nav-locations.js";
export type { NpThemeNavLocationDescriptor } from "./themes/nav-locations.js";

export {
  extractNotFoundComponent,
  extractErrorComponent,
  extractMembersNotFoundComponent,
  extractSeoHooks,
  getActiveThemeNotFound,
  getActiveThemeError,
  getActiveThemeMembersNotFound,
  getActiveThemeSeoHooks,
} from "./themes/error-seo.js";
export type { NpThemeSeoHooksExtracted } from "./themes/error-seo.js";

export { introspectThemeSettingsSchema } from "./themes/settings-schema.js";
export type {
  NpThemeSettingsField,
  NpThemeSettingsTextField,
  NpThemeSettingsTextareaField,
  NpThemeSettingsUrlField,
  NpThemeSettingsColorField,
  NpThemeSettingsNumberField,
  NpThemeSettingsBooleanField,
  NpThemeSettingsEnumField,
  NpThemeSettingsArrayField,
  NpThemeSettingsObjectField,
  NpThemeSettingsUnsupportedField,
} from "./themes/settings-schema.js";

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
  NP_DEFAULT_SITE_ID,
} from "./sites/registry.js";
export type {
  NpSite,
  NpSiteUsage,
  NpDeleteSiteOptions,
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
export { resolveLocale, getCurrentLocale } from "./i18n/locale-resolver.js";
export type {
  NpResolveLocaleInput,
  NpResolveLocaleResult,
} from "./i18n/locale-resolver.js";
export {
  addStrings,
  setStrings,
  resetStrings,
  resetTranslationCache,
  getStrings,
  getAllStrings,
  t,
  tSync,
  type NpTranslationParams,
} from "./i18n/strings.js";
export type { NpTranslationBundle } from "./i18n/strings.js";
export { getLocaleDirection, type NpLocaleDirection } from "./i18n/direction.js";
export {
  formatNumber,
  formatDate,
  formatRelativeTime,
  resetIntlFormatterCache,
} from "./i18n/format.js";
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
export type { NpStringOverrideRow } from "./i18n/string-overrides.js";

export { configureBuiltinJobContext } from "./jobs/builtin-handlers.js";

export {
  loadPlugins,
  runHook,
  runHookAndCollect,
  getPluginRoutes,
  getPluginPageRoutes,
  getPluginRegistration,
  getPluginConfig,
  getPluginConfigWithStatus,
  setPluginConfig,
  pluginConfigCacheTag,
  getAllPluginIds,
  getPluginAdminExtension,
  getCollectionTabsForSlug,
  getDashboardWidgetsFromPlugins,
  dispatchPluginAction,
  schedulePluginTask,
  getRegisteredPluginSchedules,
  runPluginScheduledTask,
  resetPlugins,
  isPluginEnabled,
  invalidatePluginEnabled,
  listPluginStates,
  getPluginState,
  syncPluginRegistrations,
  updatePluginState,
  checkNexpressCompat,
  compareSemver,
  getFrameworkVersion,
} from "./plugins/index.js";

export type { NpPluginConfigResult } from "./plugins/index.js";
export type {
  PluginHookHandler,
  PluginRouteHandler,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginAdminExtension,
  PluginPageRouteEntry,
  ResolvedCollectionTab,
  ResolvedDashboardWidget,
  NpPluginState,
  NpPluginStateUpdate,
  NexpressCompatResult,
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
  verifyStartupSafety,
} from "./observability/index.js";
export type {
  NpLogLevel,
  NpLogger,
  NpErrorReporter,
  NpErrorReportContext,
  NpStartupSafetyInput,
} from "./observability/index.js";

// Phase 23.7 — pluggable rate-limiter adapter. The full surface
// lives at the `@nexpress/core/rate-limit` subpath; the root
// keeps the registry helpers re-exported for back-compat with
// callers that already pull through the catch-all.
export {
  InMemoryRateLimiter,
  setRateLimiter,
  getRateLimiter,
  getOptionalRateLimiter,
} from "./rate-limit/index.js";
export type {
  NpRateLimitDecision,
  NpRateLimiterAdapter,
} from "./rate-limit/index.js";

export {
  getCommunityRole,
  listCommunityRoles,
  registerCommunityRole,
  resetCommunityRoles,
  memberCan,
  assertNotBanned,
  withMemberWrite,
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
  getMemberProfile,
  getMemberProfiles,
} from "./community/index.js";
export type {
  CommunityCapability,
  CommunityRoleDefinition,
  CommunityScope,
  MemberAction,
  MemberCanTarget,
  NpSpamAdapter,
  NpSpamCheckContext,
  NpSpamVerdict,
  NpSpamVerdictKind,
  NpProfanityAdapter,
  NpProfanityCheckContext,
  NpProfanityVerdict,
  NpProfanityVerdictKind,
  NpReputationAdapter,
  NpReputationEvent,
  NpCommunitySettings,
  NpMemberUploadQuota,
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
  NpReactionRow,
  NpReactToInput,
  NpFollowRow,
  NpFollowInput,
  NpNotificationRow,
  CreateNotificationInput,
  ListNotificationsOptions,
  NpNotificationListResult,
  MarkReadInput,
  Principal,
  AuditActor,
  AuditActorKind,
  AuditEventRow,
  RecordAuditEventInput,
  ListAuditOptions,
  NpReportRow,
  FileReportInput,
  ListReportsOptions,
  ListReportsResult,
  ResolveReportInput,
  NpBanRow,
  BanScope,
  BanKind,
  IssueBanInput,
  RevokeBanInput,
  NpMemberRoleGrantRow,
  GrantMemberRoleInput,
  RevokeMemberRoleInput,
  NpMemberPurgeResult,
  NpMemberMuteRow,
  NpMemberMuteSummary,
  MuteMemberInput,
  ListMutesOptions,
  NpMentionTarget,
  FanOutMentionsInput,
  NpNotificationKindMeta,
  NpNotificationPrefs,
  NpDigestCadence,
  SetMemberNotificationPrefsInput,
  NpDigestEmailContent,
  NpDigestNotificationSummary,
  BuildDigestEmailInput,
  RunDigestSweepInput,
  RunDigestSweepResult,
  NpMemberProfile,
} from "./community/index.js";

export {
  registerCustomRoute,
  getCustomRoutes,
  clearCustomRoutes,
} from "./routes/index.js";
export type { NpCustomRoute } from "./routes/index.js";
