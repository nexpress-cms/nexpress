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
  NxJobType,
  NxFindOptions,
  NxFindResult,
  NxSaveOptions,
  NxSaveResult,
  NxDocumentStatus,
} from "./config/types.js";

export { ROLE_HIERARCHY, hasRole } from "./config/types.js";
export { defineConfig } from "./config/define-config.js";
export { defineCollection } from "./config/define-collection.js";
export {
  authenticated,
  isAdmin,
  isEditorOrAbove,
  isOwnerOrAdmin,
} from "./config/access.js";

export {
  NxError,
  NxForbiddenError,
  NxNotFoundError,
  NxValidationError,
  NxAuthError,
  NxConflictError,
} from "./errors.js";

export { buildSearchVector } from "./collections/search.js";
export {
  registerCollection,
  getCollectionConfig,
  getCollectionTable,
  getCollectionRegistration,
  getAllCollectionSlugs,
  setDb,
  getDb,
  saveDocument,
  deleteDocument,
  findDocuments,
  getDocumentById,
  listRevisions,
  getRevision,
  restoreRevision,
  publishScheduledDocuments,
  searchCollections,
  reindexCollection,
} from "./collections/index.js";
export type {
  NxRevision,
  NxRevisionSummary,
  NxRevisionStatus,
  NxRevisionListOptions,
  NxRevisionListResult,
  PublishScheduledResult,
  SearchCollectionsOptions,
  SearchResult,
  SearchResultItem,
  ReindexResult,
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
export { sha256, verifyTokenFull, invalidateAllSessions } from "./auth/session.js";
export {
  createPasswordResetToken,
  requestPasswordReset,
  consumePasswordResetToken,
} from "./auth/reset-token.js";
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
  enqueueJob,
  startWorker,
  stopWorker,
  startProducer,
  stopProducer,
  PgBossAdapter,
  registerBuiltinHandlers,
} from "./jobs/index.js";
export type { NxJobHandler, NxJobQueue } from "./jobs/index.js";

export type { NxStorageAdapter, NxFileMetadata } from "./storage/types.js";
export { LocalStorageAdapter } from "./storage/local.js";
export { S3StorageAdapter } from "./storage/s3.js";
export { createStorageAdapter } from "./storage/index.js";

export type { NxEmailAdapter, NxEmailMessage, NxEmailTemplate, NxPasswordResetTemplateData, SmtpEmailAdapterOptions } from "./email/index.js";
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
