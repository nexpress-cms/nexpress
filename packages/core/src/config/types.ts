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

/**
 * Free-form predicate. Server-only — functions don't survive the
 * server→client boundary in Next.js (the framework's
 * `toClientCollectionConfig` strips them). For conditions that
 * need to run in the admin editor's browser-side renderer, use
 * `NpFieldConditionExpr` (serializable JSON shape) instead.
 */
export type NpFieldCondition = (
  data: Record<string, unknown>,
  siblingData: Record<string, unknown>,
) => boolean;

/**
 * Serializable condition predicate. Evaluated client-side (admin
 * editor) AND server-side (pipeline validation) from the same
 * declaration — survives the RSC serialization boundary because
 * it's plain JSON.
 *
 * Examples:
 *   `{ when: "kind", equals: "doc" }`
 *   `{ when: "kind", notEquals: "doc" }`
 *   `{ when: "kind", in: ["doc", "page"] }`
 *   `{ when: "wpOriginalAuthor", exists: true }`
 *   `{ all: [{ when: "kind", equals: "doc" }, { when: "publishedAt", exists: true }] }`
 *   `{ any: [{ when: "kind", equals: "doc" }, { when: "kind", equals: "page" }] }`
 *
 * `exists: true` returns true when the value is defined, not null,
 * not the empty string, and not an empty array. `exists: false`
 * is the inverse. `equals` / `notEquals` use strict equality.
 * `in` / `notIn` check membership against an unknown[] list.
 * `all` / `any` are AND / OR over a list of nested expressions.
 */
export type NpFieldConditionExpr =
  | { when: string; equals: unknown }
  | { when: string; notEquals: unknown }
  | { when: string; in: unknown[] }
  | { when: string; notIn: unknown[] }
  | { when: string; exists: boolean }
  | { all: NpFieldConditionExpr[] }
  | { any: NpFieldConditionExpr[] };

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
    condition?: NpFieldCondition | NpFieldConditionExpr;
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
    /**
     * Sidebar grouping label. Sidebar fields with the same
     * `group` render together in one collapsible Card with the
     * group name as the title. Fields with no group fall into
     * the default "Publish" Card. Group order in the rendered
     * sidebar follows first-seen order in the collection's
     * `fields` array — operators control layout by ordering.
     *
     * Examples: `"Publish"`, `"Lead"`, `"Taxonomy"`, `"Author"`,
     * `"Hierarchy"`, `"SEO"`. The group label is the visible
     * Card title (not a slug), so it doesn't have to be
     * machine-friendly.
     *
     * Only meaningful when `position: "sidebar"`. Main-column
     * fields ignore this — they render in field-array order
     * without grouping.
     */
    group?: string;
    /**
     * The id of the theme whose `requires.collections.<slug>.fields`
     * contributed this field. Stamped by `mergeThemeRequirements`;
     * never set this from operator config. Same convention as
     * `admin._themeOrigin` at the collection level and per-`kinds`
     * entry: when an operator switches to a different active
     * theme, the admin filters out fields whose origin doesn't
     * match. Operator-declared fields carry no origin and always
     * pass through.
     */
    _themeOrigin?: string;
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
    /**
     * Framework-set. Stamped by `mergeThemeRequirements` on
     * collections it synthesised via a theme's
     * `requires.collections.<slug>.createIfAbsent: true`. The
     * admin sidebar uses it to hide collections whose owning
     * theme isn't active — the bundled-themes prebake puts
     * EVERY built-in theme's `createIfAbsent` slug into the
     * schema so swap-from-admin is migration-free, but the
     * operator shouldn't see `authors` in the sidebar while
     * running the docs theme.
     *
     * NEVER set this by hand from operator config. The
     * underscore is intentional — it marks "this is the
     * framework's view of the config, not the operator's
     * intent". Operator-declared collections (slug exists
     * before merge) keep this unset and always show.
     */
    _themeOrigin?: string;
    /**
     * Framework-set. Stamped by `mergeThemeRequirements` from
     * `theme.manifest.requires.collections.<slug>.kinds`,
     * unioned across all registered themes. The admin sidebar
     * walks this map to render per-kind entries under "Content"
     * (universal-content-model #748).
     *
     * Keyed by the discriminator value declared on the
     * `kind` field's options. Empty / missing → admin shows a
     * single collection entry like before.
     */
    kinds?: Record<string, NpThemeCollectionKind>;
    /**
     * Visual metadata for sidebar field groups. Keyed by the
     * `admin.group` label used on individual fields. The editor's
     * `SidebarGroupCard` reads this to render an icon next to
     * the group title and optionally surface a description.
     *
     * Operator-declared collections set this directly. Themes
     * contribute their own group icons via
     * `requires.collections.<slug>.groupMeta` (merged through
     * `mergeThemeRequirements`, unioned across themes with
     * last-write-wins on per-key props).
     *
     * Groups without an entry render without an icon — same
     * behavior as before this surface existed.
     */
    groupMeta?: Record<string, NpAdminGroupMeta>;
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
  /**
   * Plugin page routes (#623). React-free shape — the framework
   * narrows `component` to `ComponentType<NpRouteRenderProps>`
   * at the dispatcher site. See
   * `docs/design/plugin-routes.md` for the contract +
   * precedence rules.
   */
  pageRoutes?: ReadonlyArray<{
    pattern: string;
    component: unknown;
    metadata?: unknown;
    surface?: "site" | "member";
    locale?: "auto" | "none";
  }>;
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
   * 1. `defineConfig` calls `mergeThemeRequirements` to UNION
   *    declared fields into the operator's `collections` array
   *    at config-resolution time. Operator-authored fields with
   *    the same name always win, so the merge is non-
   *    destructive. The framework's codegen then picks up the
   *    union shape; the operator's next `pnpm db:generate &&
   *    pnpm db:migrate` materialises the columns. Operators
   *    add a theme via `pnpm nexpress theme add <pkg>` — there
   *    is no longer a `theme:install` AST-patcher that touches
   *    `src/collections/*.ts` (that flow was retired alongside
   *    the auto-merge).
   * 2. Admin theme switcher: compares against the resolved
   *    collections at activation time and surfaces residual
   *    mismatches — chiefly TYPE conflicts where the operator
   *    declared a field with the same name but a different
   *    `type` and the merge respected the operator's choice.
   */
  requires?: {
    collections?: Record<string, NpThemeCollectionRequirement>;
  };
  /**
   * Phase F.3 (theme v0.2) — operator-tunable theme options.
   *
   * A Zod schema describing settings the admin should expose as
   * a form. The framework generates the form fields from the
   * schema (no per-theme admin UI code), persists submissions in
   * `np_settings` keyed by `theme.settings:<themeId>`, and
   * exposes the parsed value to theme components via
   * `getThemeSettings()`.
   *
   * Supported field types in v0.2:
   *   - z.string() / z.string().url() / z.string().regex(...)
   *   - z.number().int().min().max()
   *   - z.boolean()
   *   - z.enum([...])
   *   - z.array(z.object({...}))
   *   - z.object({...})
   *
   * Use `.default(value)` for initial form values and
   * `.describe("Help text")` for the field label/description
   * the admin auto-form picks up.
   *
   * Typed as `unknown` here so `@nexpress/core` doesn't have to
   * re-export Zod type unions through every public surface;
   * theme authors writing `defineTheme({ manifest: { ... } })`
   * still get the proper Zod typing because they construct the
   * schema with `z.object(...)` themselves. The framework
   * narrows back to `ZodTypeAny` at the call site that runs
   * introspection / validation.
   */
  settingsSchema?: unknown;
  /**
   * v0.3 (D) — settings schema version, used by the migration
   * pipeline to detect when stored settings need upgrading.
   *
   * Theme authors bump this whenever `settingsSchema` changes
   * shape in a non-additive way (renaming a field, removing one,
   * tightening a default). Adding a NEW optional field is
   * compatible without bumping — Zod fills the missing key with
   * the field's default on parse.
   *
   * The framework treats absent / undefined as `1` (the v0.2
   * baseline). Themes that never bump stay forever at v1, no
   * migration ever runs.
   */
  settingsVersion?: number;
  /**
   * v0.3 (D) — migration function that brings a value persisted
   * under an older `settingsVersion` up to the current shape.
   *
   * Called on read when stored version < `settingsVersion`. The
   * function receives the OLD value (whatever shape v(N-1) had)
   * and the version it came from (so multi-step migrations can
   * branch). Returns a value that matches the CURRENT
   * `settingsSchema`. The framework re-parses the result and
   * falls back to schema defaults if the migration's output
   * still doesn't validate (defensive — a buggy migrate fn
   * shouldn't blow up the public site).
   *
   * The framework persists the migrated value back on the
   * operator's NEXT save through the admin form. Read paths
   * don't auto-write; the migration is recomputed on each read
   * until the operator triggers a save. That keeps read paths
   * pure (matches every other cached read in the framework).
   *
   * Example for a `accent` → `accentColor` rename at v2:
   *
   * ```ts
   * defineTheme({
   *   manifest: {
   *     settingsSchema: z.object({
   *       accentColor: z.string().regex(...).optional(),
   *       ...
   *     }),
   *     settingsVersion: 2,
   *     settingsMigrate: (old, from) => {
   *       if (from === 1) {
   *         const o = old as { accent?: string };
   *         return { ...o, accentColor: o.accent };
   *       }
   *       return old;
   *     },
   *   }
   * })
   * ```
   */
  settingsMigrate?: (old: unknown, fromVersion: number) => unknown;
}

/**
 * One collection's worth of theme requirements. The collection
 * may exist (the framework's auto-merge appends fields to the
 * existing array) or not (the merge skips it unless
 * `createIfAbsent` is set, in which case a minimal collection is
 * synthesised on the resolved config).
 */
export interface NpThemeCollectionRequirement {
  fields?: Record<string, NpThemeFieldRequirement>;
  /** True → the framework's `mergeThemeRequirements` step in
   *  `defineConfig` synthesises a minimal collection (slug +
   *  labels + the declared fields) when no collection with this
   *  slug is registered. Operator-authored collections of the
   *  same slug always take precedence. */
  createIfAbsent?: boolean;
  /**
   * Per-kind metadata for the `kind` discriminator field
   * (universal-content-model #748). Themes contribute one entry
   * per kind they author content for; the framework's auto-merge
   * unions entries across registered themes so the admin sidebar
   * and the public-site router both see one canonical map.
   *
   * Keyed by the option value declared on `fields.kind.options`
   * (e.g. `kinds.doc` matches the option whose `value: "doc"`).
   * The collection slug remains `posts`; kinds are a presentation
   * split, not a separate table.
   *
   * The `kind` field itself doesn't have to live on this
   * collection's `fields` for the metadata to apply — themes that
   * extend a single kind (`fields.kind.options: [{value:"doc"}]`
   * + `kinds.doc: {...}`) ship both together and the merge unions
   * them with whatever other themes declare. A `kinds` block on a
   * collection without a corresponding select field is a no-op
   * (the admin shows the regular collection list view).
   */
  kinds?: Record<string, NpThemeCollectionKind>;
  /**
   * Sidebar group metadata the theme contributes. Keyed by the
   * `admin.group` label the theme uses on its contributed fields
   * (e.g. theme-magazine contributes `Magazine: { icon: "Newspaper" }`).
   * Merged into the collection's `admin.groupMeta` via
   * last-write-wins union — two themes claiming the same group
   * label get the later theme's icon / description.
   *
   * Declaring a group key without contributing fields with the
   * same `admin.group` is allowed (the entry is unused but
   * harmless) — useful for overriding a framework default's
   * icon without adding any new fields.
   */
  groupMeta?: Record<string, NpAdminGroupMeta>;
}

/**
 * One kind entry — admin nav + public URL metadata for a single
 * discriminator value on a `select` field (typically `posts.kind`).
 *
 * Field merge: two themes declaring the same kind value get
 * last-wins on every property. Operators rarely need to redefine
 * a kind their theme already ships.
 */
/**
 * Per-group sidebar metadata. Resolves at runtime in the admin
 * edit view; not codegen'd into the DB schema.
 */
export interface NpAdminGroupMeta {
  /**
   * Lucide icon name (no `Icon` suffix) shown next to the
   * group title in the editor sidebar. Examples: `"Calendar"`,
   * `"BookOpen"`, `"Briefcase"`. Resolved client-side; unknown
   * names render no icon (silent fallback, no warning).
   */
  icon?: string;
  /**
   * One-line description shown beneath the group title. Useful
   * for operator hints like "Search-result preview + social
   * card." Truncated by the admin if it's long.
   */
  description?: string;
}

export interface NpThemeCollectionKind {
  /** Singular human label — "Doc", "Project", "Article". */
  label: string;
  /** Plural label for the admin sidebar entry — "Documentation". */
  labelPlural: string;
  /** Lucide icon name (no `Icon` suffix) — "BookOpen", "Briefcase". */
  icon?: string;
  /**
   * Public-site URL pattern. `:slug` is the only supported param;
   * the catch-all router (`apps/web/src/app/(site)/[[...slug]]/page.tsx`)
   * matches the path, extracts the slug, and queries the host
   * collection with `where: { kind: "<this-key>", slug: "<match>" }`.
   *
   * Omit to fall back to the framework default (`/<collection-slug>/<slug>`,
   * shared with the kind=null catch-all path). Two kinds declaring
   * the same urlPattern collide and the first wins; the admin
   * surfaces this via the requirements diff.
   */
  urlPattern?: string;
  /**
   * True → admin's per-kind list view surfaces `parent` + `order`
   * controls and renders rows as a tree. Themes with hierarchical
   * content (docs, sections) opt in; flat kinds leave it false.
   */
  hierarchical?: boolean;
  /**
   * Framework-set. Stamped by `mergeThemeRequirements` with the
   * id of the theme whose `requires.collections.<slug>.kinds`
   * contributed this entry. The admin sidebar reads it to gate
   * per-kind nav entries on the active theme — the bundled-themes
   * prebake unions every built-in's kinds onto the schema, but
   * only the active theme's kinds deserve sidebar real estate.
   *
   * NEVER set this by hand from operator config. The underscore
   * is intentional — same convention as `admin._themeOrigin` at
   * the collection level.
   */
  _themeOrigin?: string;
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
  /**
   * For `select` only — extra options to union into the existing
   * select field. Two themes can contribute disjoint option sets
   * (e.g. theme-docs adds `kind="doc"`, theme-portfolio adds
   * `kind="project"`); the merge dedupes on `value` and last-wins
   * on `label`. Universal-content-model Phase U.1 (#748).
   *
   * Ignored when the merge can't find an existing select with the
   * same `name`; theme authors that need a brand-new select can't
   * synthesise one through requirements (`NpThemeFieldRequirement`
   * doesn't carry enough to construct a valid `NpSelectField`).
   */
  options?: Array<{ label: string; value: string }>;
  /**
   * Optional admin hints forwarded onto the synthesised field's
   * `admin` slot. Themes use these to bucket their contributed
   * fields into the right sidebar group and hide fields when
   * irrelevant to the active kind.
   *
   * `group` — sidebar Card grouping label
   *           (e.g. `"Media"`, `"SEO"`).
   * `condition` — runtime visibility gate. Either a function
   *               (server-only — stripped at the RSC boundary)
   *               or a serializable expression (works in both
   *               environments). Prefer the expression form so
   *               the admin's client renderer can re-evaluate
   *               on live form values:
   *                 `{ when: "kind", equals: "doc" }`
   *                 `{ when: "kind", notEquals: "doc" }`
   *                 `{ when: "kind", in: ["doc", "page"] }`
   *                 `{ when: "wpOriginalAuthor", exists: true }`
   * `position` — main vs sidebar column. Defaults to the
   *              framework's `isSidebarField` heuristic.
   */
  admin?: {
    group?: string;
    condition?: NpFieldCondition | NpFieldConditionExpr;
    position?: "main" | "sidebar";
  };
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
  /**
   * Lifecycle status filter. Every collection in the framework
   * carries a `status` column (codegen-enforced), so exposing it
   * here lets a typed `where` clause filter to published rows
   * without the doc type having to redeclare it. Accepts a
   * single value or an array (IN match).
   */
  status?: NpDocumentStatus | NpDocumentStatus[];
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
