export type NpUserRole = "admin" | "editor" | "moderator" | "author" | "viewer";

export interface NpAuthUser {
  id: string;
  email: string;
  name: string;
  role: NpUserRole;
  tokenVersion: number;
}

export type NpAccessFunction = (args: {
  user: NpAuthUser | null;
  doc?: Record<string, unknown>;
  data?: Record<string, unknown>;
}) => boolean | Promise<boolean>;

export type NpFieldCondition = (
  data: Record<string, unknown>,
  siblingData: Record<string, unknown>,
) => boolean;

export type NpFieldValidator = (
  value: unknown,
  args: { data: Record<string, unknown>; siblingData: Record<string, unknown> },
) => string | true | Promise<string | true>;

export type NpRichTextContent = Record<string, unknown>;

export interface NpEditorConfig {
  features?: string[];
  // Other knobs (e.g. `onUploadImage` for the Insert Image dialog
  // that landed in 9.7j) are typed in `@nexpress/editor`'s own
  // `NpEditorConfig`. Keeping core's version minimal avoids
  // dragging the DOM lib (`File`, `Blob`) into the server-evaluated
  // collection config types.
}

interface NpFieldBase {
  name: string;
  label?: string;
  required?: boolean;
  defaultValue?: unknown;
  hidden?: boolean;
  admin?: {
    description?: string;
    placeholder?: string;
    readOnly?: boolean;
    condition?: NpFieldCondition;
    width?: string;
    /**
     * Optional override for the admin field renderer. The default
     * renderer dispatches on `type` (text → input, textarea →
     * textarea, etc.); `kind` overrides that with a specialized
     * widget.
     *   - `templatePicker` (Phase 11.3) replaces the input with a
     *     dropdown sourced from the active theme's
     *     `templates.{collection}` registry.
     *   - `title` renders a large borderless headline input that
     *     sits above the rest of the form (intended for the
     *     primary title of a document). The edit view skips the
     *     Card wrapper around it so the title flows naturally
     *     into the editor canvas underneath.
     */
    kind?: "templatePicker" | "title";
    /**
     * Where the field should land in the edit view's two-column
     * layout. Mark publishing-related metadata (SEO, template
     * choice, scheduling inputs) as `"sidebar"` so they group
     * with Status / Slug in the sticky right column rather than
     * competing with the primary editing surface.
     *
     * When unset, the legacy heuristic decides: `type: "date"`
     * fields, fields with an explicit `admin.width`, and the
     * well-known names `status` / `publishedAt` / `slug` all
     * land in the sidebar; everything else goes to main. An
     * explicit `"main"` overrides that heuristic — useful for
     * surfacing a date input in the primary column.
     */
    position?: "main" | "sidebar";
  };
  validate?: NpFieldValidator;
}

export interface NpTextField extends NpFieldBase {
  type: "text";
  minLength?: number;
  maxLength?: number;
  unique?: boolean;
}

export interface NpTextareaField extends NpFieldBase {
  type: "textarea";
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

export interface NpNumberField extends NpFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  integerOnly?: boolean;
}

export interface NpRichTextField extends NpFieldBase {
  type: "richText";
  editor?: NpEditorConfig;
}

export interface NpBlocksField extends NpFieldBase {
  type: "blocks";
  allowedBlocks?: string[];
  minRows?: number;
  maxRows?: number;
}

export interface NpCheckboxField extends NpFieldBase {
  type: "checkbox";
  defaultValue?: boolean;
}

export interface NpDateField extends NpFieldBase {
  type: "date";
  pickerOptions?: {
    format?: string;
    includeTime?: boolean;
  };
}

export interface NpUploadField extends NpFieldBase {
  type: "upload";
  relationTo: string;
}

export interface NpRelationshipField extends NpFieldBase {
  type: "relationship";
  relationTo: string | string[];
  hasMany?: boolean;
  filterOptions?: Record<string, unknown>;
}

export interface NpSelectField extends NpFieldBase {
  type: "select";
  options: Array<{ label: string; value: string }>;
  hasMany?: boolean;
}

export interface NpRadioField extends NpFieldBase {
  type: "radio";
  options: Array<{ label: string; value: string }>;
}

export interface NpEmailField extends NpFieldBase {
  type: "email";
}

export interface NpJsonField extends NpFieldBase {
  type: "json";
}

export interface NpArrayField extends NpFieldBase {
  type: "array";
  fields: NpFieldConfig[];
  minRows?: number;
  maxRows?: number;
}

export interface NpGroupField extends NpFieldBase {
  type: "group";
  fields: NpFieldConfig[];
}

export interface NpRowField {
  type: "row";
  fields: NpFieldConfig[];
}

export interface NpCollapsibleField {
  type: "collapsible";
  label: string;
  fields: NpFieldConfig[];
}

export type NpFieldConfig =
  | NpTextField
  | NpTextareaField
  | NpNumberField
  | NpRichTextField
  | NpBlocksField
  | NpCheckboxField
  | NpDateField
  | NpUploadField
  | NpRelationshipField
  | NpSelectField
  | NpRadioField
  | NpEmailField
  | NpJsonField
  | NpArrayField
  | NpGroupField
  | NpRowField
  | NpCollapsibleField;

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
// `NpHookPrincipal` is the historical name plugin authors see in
// hook payloads. It's the same union as `NpPrincipal`; kept as an
// alias so existing plugin code keeps compiling (#319).
import type { NpPrincipal } from "../auth/principal.js";
export type { NpPrincipal, NpPrincipal as NpHookPrincipal };
type NpHookPrincipal = NpPrincipal;

export type NpCollectionHook = (args: {
  data: Record<string, unknown>;
  /**
   * Resolved staff session, or `null` when the actor is a member.
   * Pre-9.7o this was always non-null because member writes
   * skipped collection hooks entirely. Hooks that key off staff
   * identity should now switch on `principal.kind` instead.
   */
  user: NpAuthUser | null;
  /** Polymorphic actor — see `NpHookPrincipal`. */
  principal: NpHookPrincipal;
  collection: string;
  originalDoc?: Record<string, unknown> | null;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface NpUploadConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  imageSizes?: NpImageSize[];
}

export interface NpImageSize {
  name: string;
  width: number;
  height?: number;
  crop?: "center" | "top" | "bottom" | "left" | "right";
}

export interface NpCollectionConfig {
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
   * missing-locale writes with NpValidationError).
   *
   * Requires the top-level `i18n` config to also be set.
   * Without it, `i18n: true` here errors at config validation
   * time — the framework needs to know the locale enum to
   * validate writes.
   */
  i18n?: boolean;
  fields: NpFieldConfig[];
  access?: {
    create?: NpAccessFunction;
    read?: NpAccessFunction;
    update?: NpAccessFunction;
    delete?: NpAccessFunction;
  };
  hooks?: {
    beforeCreate?: NpCollectionHook[];
    afterCreate?: NpCollectionHook[];
    beforeUpdate?: NpCollectionHook[];
    afterUpdate?: NpCollectionHook[];
    beforeDelete?: NpCollectionHook[];
    afterDelete?: NpCollectionHook[];
    beforeRead?: NpCollectionHook[];
    afterRead?: NpCollectionHook[];
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
    /**
     * Opts the collection's edit view into the "In navigation"
     * side panel. Documents in this collection are addressable
     * from the nav editor's `type: "page"` picker via the
     * membership endpoint, so the operator can add/remove the
     * doc from any nav location without leaving the page.
     *
     * Defaults to `false`. The reference `pages` collection in
     * `apps/web` flips it on; sites with a `static-pages` or
     * `landing-pages` collection that should also surface in nav
     * can opt in here too.
     */
    navMembership?: boolean;
    /**
     * Lucide icon name for the admin sidebar entry. Defaults to
     * `FileText` when unset or unrecognized. Examples:
     * `"Newspaper"` for posts, `"FileStack"` for pages,
     * `"FolderTree"` for categories, `"Tag"` for tags.
     *
     * Resolved client-side by `admin-shell.tsx` against a small
     * lucide-react registry; unknown names fall back to the
     * default so a typo can't break the sidebar render.
     */
    icon?: string;
  };
  upload?: NpUploadConfig;
}

export interface NpBlockConfig {
  slug: string;
  labels: { singular: string; plural: string };
  fields: NpFieldConfig[];
  imageUrl?: string;
}

export type NpBlockInstance = {
  blockType: string;
  [key: string]: unknown;
};

export interface NpPluginConfig {
  id: string;
  name: string;
  init?: (ctx: NpPluginContext) => void | Promise<void>;
}

/**
 * Structural shape accepted by `loadPlugins()` for SDK-built plugins.
 * Declared here rather than imported from `@nexpress/plugin-sdk` to avoid a
 * dependency cycle (plugin-sdk already depends on core).
 */
export interface NpResolvedPluginLike {
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

export interface NpPluginContext {
  addCollection: (config: NpCollectionConfig) => void;
  addBlock: (config: NpBlockConfig) => void;
  addHook: (collection: string, event: string, hook: NpCollectionHook) => void;
}

export interface NpNavItem {
  id: string;
  label: string;
  type: "link" | "collection" | "page";
  url?: string;
  collection?: string;
  /**
   * Set when `type === "page"` to record which collection the
   * referenced doc lives in. Defaults to `"pages"` when absent so
   * existing nav rows keep resolving against the reference page
   * collection unchanged. The URL resolver walks the doc through
   * the collection's `seo.urlPath` to produce the public path.
   *
   * The editor doesn't expose this as an editable field — the
   * panel that adds the item knows its source collection and
   * stamps it at write time.
   */
  collectionSlug?: string;
  pageId?: string;
  children?: NpNavItem[];
}

/**
 * Phase 11.1 — theme manifest. Pure metadata, kept React-free
 * so it can live in `@nexpress/core` (which is server-only and
 * intentionally has no React peer). The full theme — shell,
 * slots, templates with React component types — lives in
 * `@nexpress/theme` via `defineTheme()`. The registry stores
 * `NpRegisteredTheme` instances; `impl` is opaque to core but
 * typed for consumers downstream.
 */
export interface NpThemeManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: { name: string; url?: string };
  /** Optional minimum NexPress version this theme requires. */
  nexpress?: { minVersion?: string };
  /**
   * Phase F.1 (theme v0.2) — declared data-shape requirements.
   *
   * Themes whose components assume specific collection fields
   * (e.g. magazine theme reads `posts.featured`) declare them
   * here. Two consumers read this:
   *
   * 1. Admin theme switcher (this phase): compares against the
   *    site's registered collections at activation time and
   *    surfaces mismatches to the operator BEFORE they click
   *    "activate" — so they don't end up with a theme that
   *    silently renders fallbacks for missing fields.
   * 2. `pnpm nexpress theme:install` (Phase F.8, deferred):
   *    reads this to AST-patch the operator's
   *    `src/collections/*.ts` files and run codegen + migrate.
   *
   * F.1 ships only the type + admin warning surface. The CLI
   * patcher is its own phase.
   */
  requires?: {
    collections?: Record<string, NpThemeCollectionRequirement>;
  };
}

/**
 * One collection's worth of theme requirements. The collection
 * may exist (admin checks fields) or not (admin flags as missing
 * — the CLI in F.8 will create it if `createIfAbsent` is set).
 */
export interface NpThemeCollectionRequirement {
  fields?: Record<string, NpThemeFieldRequirement>;
  /** True → CLI in F.8 creates this collection if absent.
   *  Admin still warns at activation; the operator must run the
   *  CLI to actually create it. */
  createIfAbsent?: boolean;
}

/**
 * One field's requirement. The `type` matches an `NpFieldConfig`
 * variant's `type` string exactly so the activation check can
 * compare without translation.
 */
export interface NpThemeFieldRequirement {
  type:
    | "text"
    | "textarea"
    | "richText"
    | "number"
    | "checkbox"
    | "date"
    | "select"
    | "upload"
    | "relationship"
    | "blocks";
  /** For `relationship` — the collection slug it points to. */
  relationTo?: string | string[];
  /** For `relationship` / `select` — accepts list values. */
  hasMany?: boolean;
  required?: boolean;
  /**
   * Default `true`. Set `false` for "nice to have, theme degrades
   * gracefully without it" — admin warning shows but at lower
   * severity, and a future F.8 may treat it as opt-in patch.
   */
  hard?: boolean;
}

export interface NpRegisteredTheme {
  manifest: NpThemeManifest;
  /**
   * The theme's runtime implementation — shell component,
   * slot components, page templates, default tokens.
   * `@nexpress/theme` types this; core treats it as opaque so
   * the React peer dependency stays out of this package.
   */
  impl: unknown;
}

export interface NpI18nConfig {
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

export interface NpConfig {
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
  collections: NpCollectionConfig[];
  blocks?: NpBlockConfig[];
  editor?: NpEditorConfig;
  /**
   * Phase 11.1 — multi-theme registry. Sites declare every
   * theme they want available; admins switch between them
   * via the settings UI without rebuilding. The first theme
   * in the array is the default-active until an admin sets
   * a different one (`np_settings.activeTheme`).
   */
  themes?: NpRegisteredTheme[];
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
  i18n?: NpI18nConfig;
  images?: {
    sizes?: NpImageSize[];
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
  plugins?: Array<NpPluginConfig | NpResolvedPluginLike>;
  typescript?: {
    outputFile?: string;
  };
  /**
   * Phase 23.5 — operational thresholds and policies for the job
   * queue. Currently only carries the stuck-job thresholds the
   * admin Jobs widget compares against; future entries land
   * additively.
   */
  jobs?: {
    /**
     * Per-state count thresholds for the admin stuck-job widget.
     * When the live + archive UNION count for a state exceeds the
     * configured value the widget shows a warning indicator. Unset
     * values fall back to sensible defaults applied by the widget
     * itself (currently `failed: 10`, `expired: 50`).
     */
    stuckThreshold?: {
      failed?: number;
      expired?: number;
    };
  };
}

export type NpJobType =
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

/**
 * System-level filters that aren't part of any collection's
 * document shape but still belong on the `where` clause: tenant
 * scoping, visibility gating, locale narrowing. Kept separate
 * from the document type so `Partial<T>` can stay tight while
 * advanced callers (admin queries, bulk exports) can pass these
 * escape-hatch tokens.
 */
export interface NpFindWhereSystemTokens {
  /**
   * Multi-site scoping. Defaults to the resolved current site.
   * Pass `"*"` to query across every site (admin / migration
   * use only — leaks cross-site rows).
   */
  siteId?: string;
  /**
   * Visibility gate. Anonymous traffic is auto-restricted to
   * `"public"`. Pass `"*"` to bypass (the pipeline drops the
   * filter when a user is also passed).
   */
  visibility?: "public" | "private" | "*";
  /**
   * `where: { locale: "ko" }` is equivalent to the top-level
   * `locale` option. Listed here so a typed where clause can
   * still pass it without the document type having to declare
   * a `locale` field (only i18n-enabled collections do).
   */
  locale?: string;
}

/**
 * Strip `null` and unwrap arrays so a hasMany field like
 * `categories: string[] | null` reads as a `string` for the
 * single-target filter case.
 */
type NpFindWhereUnwrap<V> = V extends (infer U)[] | null
  ? U
  : V extends (infer U)[]
    ? U
    : V extends infer U | null
      ? U
      : V;

/**
 * The accepted value shape for a single where field. Either the
 * unwrapped scalar (single match) or an array (IN match). Array
 * with zero elements short-circuits the query to no rows; the
 * pipeline guards against the SQL syntax error this would
 * otherwise produce.
 */
type NpFindWhereValue<V> = NpFindWhereUnwrap<V> | NpFindWhereUnwrap<V>[];

/**
 * Per-row filter. With the default `T = Record<string, unknown>`,
 * any keys are allowed (back-compat). With a typed `T` (the
 * generated wrapper functions pass their `${Pascal}Document`
 * here), only document fields plus the system tokens above are
 * accepted — typos against field names become compile errors.
 *
 * Each field accepts a single value (matched with `=`) or an
 * array (matched with `IN (...)`). For hasMany relationships
 * (where the document's field type is `string[] | null`), the
 * single-value form is the common case — "posts in this one
 * category" — and the array form picks up the `OR` semantics
 * across multiple targets — "posts in any of these categories".
 */
export type NpFindWhere<T extends object = Record<string, unknown>> = {
  [K in keyof T]?: NpFindWhereValue<T[K]>;
} & {
  [K in keyof NpFindWhereSystemTokens]?: NpFindWhereSystemTokens[K];
};

export interface NpFindOptions<T extends object = Record<string, unknown>> {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  where?: NpFindWhere<T>;
  /**
   * Phase 12.1 — restrict the result set to one locale on
   * i18n-enabled collections. Equivalent to passing
   * `where: { locale }`, but kept top-level for ergonomics
   * (callers don't have to know it's a column). Ignored on
   * non-i18n collections (no `locale` column to match).
   */
  locale?: string;
}

export interface NpFindResult<T = Record<string, unknown>> {
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
export type NpDocumentStatus = "draft" | "scheduled" | "published" | "archived" | "pending";

export interface NpSaveOptions {
  status?: NpDocumentStatus;
}

export interface NpSaveResult {
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
export const ROLE_HIERARCHY: Record<NpUserRole, number> = {
  viewer: 0,
  author: 1,
  moderator: 1,
  editor: 2,
  admin: 3,
};
