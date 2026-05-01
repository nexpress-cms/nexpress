export type NxUserRole = "admin" | "editor" | "moderator" | "author" | "viewer";

export interface NxAuthUser {
  id: string;
  email: string;
  name: string;
  role: NxUserRole;
  tokenVersion: number;
}

export type NxAccessFunction = (args: {
  user: NxAuthUser | null;
  doc?: Record<string, unknown>;
  data?: Record<string, unknown>;
}) => boolean | Promise<boolean>;

export type NxFieldCondition = (
  data: Record<string, unknown>,
  siblingData: Record<string, unknown>,
) => boolean;

export type NxFieldValidator = (
  value: unknown,
  args: { data: Record<string, unknown>; siblingData: Record<string, unknown> },
) => string | true | Promise<string | true>;

export type NxRichTextContent = Record<string, unknown>;

export interface NxEditorConfig {
  features?: string[];
  // Other knobs (e.g. `onUploadImage` for the Insert Image dialog
  // that landed in 9.7j) are typed in `@nexpress/editor`'s own
  // `NxEditorConfig`. Keeping core's version minimal avoids
  // dragging the DOM lib (`File`, `Blob`) into the server-evaluated
  // collection config types.
}

interface NxFieldBase {
  name: string;
  label?: string;
  required?: boolean;
  defaultValue?: unknown;
  hidden?: boolean;
  admin?: {
    description?: string;
    placeholder?: string;
    readOnly?: boolean;
    condition?: NxFieldCondition;
    width?: string;
    /**
     * Optional override for the admin field renderer. The default
     * renderer dispatches on `type` (text → input, textarea →
     * textarea, etc.); `kind` overrides that with a specialized
     * widget. v1: `templatePicker` (Phase 11.3) replaces the
     * input with a dropdown sourced from the active theme's
     * `templates.{collection}` registry.
     */
    kind?: "templatePicker";
  };
  validate?: NxFieldValidator;
}

export interface NxTextField extends NxFieldBase {
  type: "text";
  minLength?: number;
  maxLength?: number;
  unique?: boolean;
}

export interface NxTextareaField extends NxFieldBase {
  type: "textarea";
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

export interface NxNumberField extends NxFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  integerOnly?: boolean;
}

export interface NxRichTextField extends NxFieldBase {
  type: "richText";
  editor?: NxEditorConfig;
}

export interface NxBlocksField extends NxFieldBase {
  type: "blocks";
  allowedBlocks?: string[];
  minRows?: number;
  maxRows?: number;
}

export interface NxCheckboxField extends NxFieldBase {
  type: "checkbox";
  defaultValue?: boolean;
}

export interface NxDateField extends NxFieldBase {
  type: "date";
  pickerOptions?: {
    format?: string;
    includeTime?: boolean;
  };
}

export interface NxUploadField extends NxFieldBase {
  type: "upload";
  relationTo: string;
}

export interface NxRelationshipField extends NxFieldBase {
  type: "relationship";
  relationTo: string | string[];
  hasMany?: boolean;
  filterOptions?: Record<string, unknown>;
}

export interface NxSelectField extends NxFieldBase {
  type: "select";
  options: Array<{ label: string; value: string }>;
  hasMany?: boolean;
}

export interface NxRadioField extends NxFieldBase {
  type: "radio";
  options: Array<{ label: string; value: string }>;
}

export interface NxEmailField extends NxFieldBase {
  type: "email";
}

export interface NxJsonField extends NxFieldBase {
  type: "json";
}

export interface NxArrayField extends NxFieldBase {
  type: "array";
  fields: NxFieldConfig[];
  minRows?: number;
  maxRows?: number;
}

export interface NxGroupField extends NxFieldBase {
  type: "group";
  fields: NxFieldConfig[];
}

export interface NxRowField {
  type: "row";
  fields: NxFieldConfig[];
}

export interface NxCollapsibleField {
  type: "collapsible";
  label: string;
  fields: NxFieldConfig[];
}

export type NxFieldConfig =
  | NxTextField
  | NxTextareaField
  | NxNumberField
  | NxRichTextField
  | NxBlocksField
  | NxCheckboxField
  | NxDateField
  | NxUploadField
  | NxRelationshipField
  | NxSelectField
  | NxRadioField
  | NxEmailField
  | NxJsonField
  | NxArrayField
  | NxGroupField
  | NxRowField
  | NxCollapsibleField;

/**
 * Polymorphic actor reference for collection hooks. Phase 9.7o
 * widened the hook surface so plugins can react to member writes,
 * not just staff writes:
 *
 *   - `{ kind: "staff", user }`   — staff-authored write; `user` is
 *     the resolved staff session as before.
 *   - `{ kind: "member", memberId }` — member-authored write
 *     (`createMemberDocument` / `updateMemberDocument` /
 *     `deleteMemberDocument`).
 *
 * Hooks that only care about staff identity can switch on
 * `principal.kind === "staff"` and read `principal.user`. The
 * top-level `user` field is also still passed (`null` for member
 * actors) so existing hooks that destructure `{ user }` keep
 * compiling — they just need to handle the null case now.
 */
export type NxHookPrincipal =
  | { kind: "staff"; user: NxAuthUser }
  | { kind: "member"; memberId: string };

export type NxCollectionHook = (args: {
  data: Record<string, unknown>;
  /**
   * Resolved staff session, or `null` when the actor is a member.
   * Pre-9.7o this was always non-null because member writes
   * skipped collection hooks entirely. Hooks that key off staff
   * identity should now switch on `principal.kind` instead.
   */
  user: NxAuthUser | null;
  /** Polymorphic actor — see `NxHookPrincipal`. */
  principal: NxHookPrincipal;
  collection: string;
  originalDoc?: Record<string, unknown> | null;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface NxUploadConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  imageSizes?: NxImageSize[];
}

export interface NxImageSize {
  name: string;
  width: number;
  height?: number;
  crop?: "center" | "top" | "bottom" | "left" | "right";
}

export interface NxCollectionConfig {
  slug: string;
  labels: { singular: string; plural: string };
  slugField?:
    | boolean
    | {
        useField?: string;
        unique?: boolean;
      };
  /**
   * Phase 12.1 — opt this collection into i18n. When set, the
   * codegen adds a `locale` text column and a
   * `translation_group_id` uuid column to the generated table.
   * The slug uniqueness index becomes `(locale, slug)` so the
   * same slug can appear in two locales. Fetching helpers
   * (`findDocuments`, `getDoc`) accept a `locale` option;
   * writes require a `locale` field (the pipeline rejects
   * missing-locale writes with NxValidationError).
   *
   * Requires the top-level `i18n` config to also be set.
   * Without it, `i18n: true` here errors at config validation
   * time — the framework needs to know the locale enum to
   * validate writes.
   */
  i18n?: boolean;
  fields: NxFieldConfig[];
  access?: {
    create?: NxAccessFunction;
    read?: NxAccessFunction;
    update?: NxAccessFunction;
    delete?: NxAccessFunction;
  };
  hooks?: {
    beforeCreate?: NxCollectionHook[];
    afterCreate?: NxCollectionHook[];
    beforeUpdate?: NxCollectionHook[];
    afterUpdate?: NxCollectionHook[];
    beforeDelete?: NxCollectionHook[];
    afterDelete?: NxCollectionHook[];
    beforeRead?: NxCollectionHook[];
    afterRead?: NxCollectionHook[];
  };
  versions?: {
    drafts?: boolean | { autosave?: boolean; autosaveInterval?: number };
    max?: number;
  };
  /**
   * Community features opt-in per collection. Comments are off by
   * default; flip `comments: true` to let members post comments
   * underneath this collection's documents. Reactions ride on the
   * comment surface — sites enable reactions by enabling comments;
   * a per-collection reactions toggle isn't needed today.
   *
   * `memberWrite.create` (9.7a) lets logged-in members create
   * documents in this collection without needing a staff role.
   * `memberWrite.update` / `memberWrite.delete` (9.7b) extend the
   * member-write surface with owner-only edit / delete (the row's
   * `member_author_id` must match the caller). The staff
   * `access.create` / `access.delete` functions are bypassed on
   * the member path — gating is `assertNotBanned(memberId)` plus
   * the opt-in flag plus the ownership check, not the staff
   * access tree. Member-authored docs default to
   * `_status = "published"` and members CANNOT change status via
   * update; those transitions remain admin-side affordances
   * (a configurable default-status / moderation gate lands in a
   * follow-up).
   */
  community?: {
    comments?: boolean;
    memberWrite?: {
      create?: boolean;
      update?: boolean;
      delete?: boolean;
      /**
       * Status that member-authored creates land in by default.
       * Defaults to `"published"` (a member's thread is live as
       * soon as it's submitted). Set to `"pending"` to require a
       * mod to promote the row before it shows up on the public
       * site — a flag-on-write moderation gate without writing a
       * spam adapter. The spam adapter, if installed, can also
       * downgrade an individual row to `pending` regardless of
       * this default (`flag` verdict).
       */
      defaultStatus?: "published" | "pending";
    };
  };
  /**
   * SEO configuration. Phase 10 introduced this surface for the
   * sitemap / RSS / OG metadata pipeline. The contract is
   * opt-in: a collection appears in `/sitemap.xml` iff it
   * declares `seo.urlPath`, which maps a document row to its
   * public URL path (e.g. `(doc) => "/blog/" + doc.slug`).
   * Collections without `seo.urlPath` are assumed to be admin-
   * internal or rendered through a custom route the framework
   * can't introspect.
   */
  seo?: {
    /**
     * Maps a document row to the public URL path the row is
     * served at, or `null` to skip the row (e.g. a draft / a
     * row whose URL is computed dynamically and shouldn't be
     * indexed). Returned paths must start with `/`. The host
     * comes from `SITE_URL` at sitemap-build time.
     */
    urlPath?: (doc: Record<string, unknown>) => string | null;
    /**
     * Hint for sitemap consumers about how often this
     * collection's content changes. Optional — Google now
     * largely ignores it but other crawlers still honor it.
     */
    changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
    /**
     * Sitemap priority hint, 0.0–1.0. Optional, same caveat as
     * changefreq.
     */
    priority?: number;
  };
  timestamps?: boolean;
  admin?: {
    listColumns?: string[];
    defaultSort?: string;
    group?: string;
    hidden?: boolean;
    description?: string;
    components?: {
      listView?: string;
      editView?: string;
      createView?: string;
    };
  };
  upload?: NxUploadConfig;
}

export interface NxBlockConfig {
  slug: string;
  labels: { singular: string; plural: string };
  fields: NxFieldConfig[];
  imageUrl?: string;
}

export type NxBlockInstance = {
  blockType: string;
  [key: string]: unknown;
};

export interface NxPluginConfig {
  id: string;
  name: string;
  init?: (ctx: NxPluginContext) => void | Promise<void>;
}

/**
 * Structural shape accepted by `loadPlugins()` for SDK-built plugins.
 * Declared here rather than imported from `@nexpress/plugin-sdk` to avoid a
 * dependency cycle (plugin-sdk already depends on core).
 */
export interface NxResolvedPluginLike {
  manifest: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    capabilities: readonly string[];
  };
  hooks?: Record<string, unknown>;
  routes?: ReadonlyArray<{
    path: string;
    method: string;
    handler: unknown;
    description?: string;
    auth?: boolean;
  }>;
  /**
   * Phase 12.5 — optional UI string bundles per locale. Keys
   * are plugin-namespaced strings the plugin's own templates /
   * routes / admin pages call `t()` against. The host merges
   * every plugin's bundle into the global registry at boot;
   * later plugins overwrite earlier ones on key collision so
   * sites can layer overrides via plugin order.
   */
  i18n?: Record<string, Record<string, string>>;
  /**
   * Phase 14.5 — page templates the plugin contributes to the
   * shared template registry. Same shape as a theme's
   * `impl.templates`: keyed by collection slug, then by
   * template id, with `{ label, description?, component }`
   * values. The plugin host merges these at boot;
   * `getThemeTemplateSummaries` returns plugin templates +
   * theme templates as a union, with theme entries winning
   * id collisions (the active theme is the site's design
   * authority).
   *
   *   templates: {
   *     pages: {
   *       docs: { label: "Documentation", component: DocsTemplate },
   *     },
   *   }
   */
  templates?: Record<string, Record<string, unknown>>;
}

export interface NxPluginContext {
  addCollection: (config: NxCollectionConfig) => void;
  addBlock: (config: NxBlockConfig) => void;
  addHook: (collection: string, event: string, hook: NxCollectionHook) => void;
}

export interface NxNavItem {
  id: string;
  label: string;
  type: "link" | "collection" | "page";
  url?: string;
  collection?: string;
  pageId?: string;
  children?: NxNavItem[];
}

/**
 * Phase 11.1 — theme manifest. Pure metadata, kept React-free
 * so it can live in `@nexpress/core` (which is server-only and
 * intentionally has no React peer). The full theme — shell,
 * slots, templates with React component types — lives in
 * `@nexpress/theme` via `defineTheme()`. The registry stores
 * `NxRegisteredTheme` instances; `impl` is opaque to core but
 * typed for consumers downstream.
 */
export interface NxThemeManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: { name: string; url?: string };
  /** Optional minimum NexPress version this theme requires. */
  nexpress?: { minVersion?: string };
}

export interface NxRegisteredTheme {
  manifest: NxThemeManifest;
  /**
   * The theme's runtime implementation — shell component,
   * slot components, page templates, default tokens.
   * `@nexpress/theme` types this; core treats it as opaque so
   * the React peer dependency stays out of this package.
   */
  impl: unknown;
}

export interface NxI18nConfig {
  /**
   * Locales this site supports. Order matters only insofar as
   * the first locale becomes the default when `defaultLocale`
   * isn't explicitly set. Locale strings are passed through to
   * BCP-47 consumers (HTML `lang` attribute, hreflang) so
   * conventional codes are recommended (`en`, `en-US`, `ko`,
   * `pt-BR`).
   */
  locales: string[];
  /**
   * Locale used when the caller doesn't specify one — drives
   * default writes and fallback reads. Must appear in `locales`.
   */
  defaultLocale: string;
}

export interface NxConfig {
  site: {
    name: string;
    url: string;
  };
  db: {
    connectionString: string;
    pool?: { max?: number };
  };
  storage?: {
    adapter: "local" | "s3";
    local?: { directory: string; baseUrl: string };
    s3?: { bucket: string; region: string; endpoint?: string };
  };
  collections: NxCollectionConfig[];
  blocks?: NxBlockConfig[];
  editor?: NxEditorConfig;
  /**
   * Phase 11.1 — multi-theme registry. Sites declare every
   * theme they want available; admins switch between them
   * via the settings UI without rebuilding. The first theme
   * in the array is the default-active until an admin sets
   * a different one (`nx_settings.activeTheme`).
   */
  themes?: NxRegisteredTheme[];
  /**
   * Phase 12.1 — i18n config. Sites that want multi-language
   * content declare every locale they intend to support here.
   * Per-collection opt-in via `defineCollection({ i18n: true })`
   * is required: only collections that declare `i18n` get the
   * `locale` / `translation_group_id` columns codegen'd onto
   * their generated table. Sites with no i18n config (or that
   * opt no collections in) keep the existing single-locale
   * shape — i18n is purely additive.
   *
   *   i18n: { locales: ["en", "ko", "ja"], defaultLocale: "en" }
   *
   * `defaultLocale` is what new docs land in when the caller
   * doesn't pass an explicit locale, and what the framework
   * falls back to when a translation is missing for a requested
   * locale (the public site renders a 404 only when the doc
   * doesn't exist in any locale).
   */
  i18n?: NxI18nConfig;
  images?: {
    sizes?: NxImageSize[];
    format?: "webp" | "avif" | "jpeg" | "png";
    quality?: number;
  };
  auth?: {
    secret: string;
    tokenExpiration?: number;
    refreshTokenExpiration?: number;
    maxLoginAttempts?: number;
    lockoutDuration?: number;
  };
  plugins?: Array<NxPluginConfig | NxResolvedPluginLike>;
  typescript?: {
    outputFile?: string;
  };
}

export type NxJobType =
  | "content:afterSave"
  | "content:afterDelete"
  | "content:publishScheduled"
  | "media:processImage"
  | "media:cleanup"
  | "plugin:scheduledTask"
  | "system:revisionPrune"
  | "system:sessionCleanup"
  | "system:jobLogPrune"
  | "auth:sendPasswordReset"
  | "members:sendVerifyEmail"
  | "members:sendPasswordReset"
  | "notifications:sendDigest";

export interface NxFindOptions {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  where?: Record<string, unknown>;
  /**
   * Phase 12.1 — restrict the result set to one locale on
   * i18n-enabled collections. Equivalent to passing
   * `where: { locale }`, but kept top-level for ergonomics
   * (callers don't have to know it's a column). Ignored on
   * non-i18n collections (no `locale` column to match).
   */
  locale?: string;
}

export interface NxFindResult<T = Record<string, unknown>> {
  docs: T[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * Document lifecycle status. `pending` (Phase 9.7c) is a moderation
 * holding pen for member-authored docs that haven't cleared review
 * — flagged by the spam adapter or sent there because the
 * collection set `community.memberWrite.defaultStatus = "pending"`.
 * Public listings filter to `published`, so pending rows are
 * invisible to anonymous and non-staff members until a mod
 * promotes them.
 */
export type NxDocumentStatus = "draft" | "scheduled" | "published" | "archived" | "pending";

export interface NxSaveOptions {
  status?: NxDocumentStatus;
}

export interface NxSaveResult {
  doc: Record<string, unknown>;
  operation: "create" | "update";
}

/**
 * Numeric ranking of staff roles, retained for the few non-capability
 * call sites that still need to compare role rank — chiefly
 * `hasRoleOnSite()` in `sites/memberships.ts`, which evaluates a
 * per-site membership row's role against the user's. `moderator`
 * shares author-rank because the two are parallel tracks
 * (community-mod vs. content-author authority); the rank is meaningful
 * only on the content-authoring axis.
 *
 * For staff-user authorization, use `can(user, capability)` from
 * `auth/capabilities.ts` (#273) — this hierarchy is no longer the
 * primary check.
 */
export const ROLE_HIERARCHY: Record<NxUserRole, number> = {
  viewer: 0,
  author: 1,
  moderator: 1,
  editor: 2,
  admin: 3,
};
