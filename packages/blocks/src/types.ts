import type { ReactElement, ReactNode } from "react";
import type { NpBlockInstance, NpRichTextContent } from "@nexpress/core/fields";

export type { NpBlockInstance, NpBlockLayout } from "@nexpress/core/fields";

import type { NpFindOptions, NpFindResult } from "@nexpress/core";

/**
 * Read-only data API exposed to a block's `render()` so blocks can
 * surface live counts / lists without each plugin writing its own
 * `findDocuments` boilerplate. Server-only by design — `renderBlocks`
 * runs on the server, the metadata that crosses the server → client
 * boundary (`NpBlockMetadata`) deliberately omits `render` and `ctx`.
 *
 * Capabilities aren't enforced here: every block sees the same read
 * surface. The dispatcher (host app's site renderer) is responsible
 * for not piping privileged data into a public page render. Mutations
 * are intentionally absent — blocks are display-only at v1.
 */
export interface NpBlockRenderContext {
  readonly content: {
    /** Equivalent to `findDocuments`. Includes ACL + draft/published filtering. */
    find(collection: string, options?: Partial<NpFindOptions>): Promise<NpFindResult>;
    findOne(collection: string, id: string): Promise<Record<string, unknown> | null>;
    count(collection: string): Promise<number>;
  };
  /**
   * Phase F.4 — active source context. When present, `renderBlocks`
   * filters block instances whose `source` doesn't belong to the
   * active set, rendering a "from inactive theme" placeholder
   * instead of the block. Without this field, all registered
   * blocks render unconditionally (back-compat with pre-F.4
   * callers that don't build ctx with active sources).
   *
   * v0.2 only carries `themeId` — plugins are process-global
   * and already pruned at registry-write time, so a plugin
   * block reaching the renderer is necessarily from an enabled
   * plugin. See `source.ts` `isBlockSourceActive` for the rules.
   */
  readonly activeSources?: {
    themeId: string | null;
  };
}

/**
 * Serializable metadata about a block — everything `NpBlockDefinition`
 * carries *except* the `render` function. The page-builder admin
 * receives this shape (functions can't cross the server → client
 * boundary in Next.js) and uses it for the picker, the props form,
 * and ADD-action defaults. Renders only happen server-side via
 * `renderBlocks`, which reads the full definition from the shared
 * registry directly.
 */
export interface NpBlockMetadata {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  defaultProps: Record<string, unknown>;
  propsSchema: NpBlockPropField[];
  /**
   * When true, this block is a *container* — the editor offers an
   * add-block UI inside it and the renderer walks the instance's
   * `children` array, passing the rendered React node tree as the
   * second argument to `render`. When false / omitted (the default),
   * the block is a leaf and any `children` on the instance are
   * ignored at render time.
   */
  acceptsChildren?: boolean;
  /**
   * Optional list of prop names the page-builder reads to render a
   * one-line summary on the collapsed block row (e.g. `["heading",
   * "title"]`). The first non-empty string-shaped value wins, gets
   * truncated, and is shown next to the block label. Purely a
   * presentational hint for the admin UI — runtime renders ignore
   * it. When omitted the row falls back to label + type only.
   */
  summaryFields?: readonly string[];
  /**
   * Optional grouping hint for the admin's Add-block popover.
   * Blocks with the same `category` render under one section
   * header (Layout, Content, Media, Commerce, Community, Plugin,
   * Other). Omitted falls into "Other" so existing definitions
   * keep showing up. Free-form string so themes / plugins can add
   * their own sections without lobbying the framework.
   */
  category?: string;
  /**
   * Optional fuzzy-match tokens for the palette's search filter.
   * Adds searchable terms beyond `label` / `type` / `description`
   * — e.g. `["call to action", "cta strip", "button banner"]` on
   * the CTA block so operators who don't remember the exact label
   * still find it. Empty / omitted leaves the existing match
   * surface intact.
   */
  keywords?: readonly string[];
  /**
   * Where this block came from. Defaults to "built-in" via the
   * shared registry seed; plugin contributions register with
   * `source: "plugin"` so the palette can show a small badge and
   * group them separately. Theme-bundled blocks would use "theme".
   * Free-form to leave room for future ownership scopes.
   */
  source?: "built-in" | "plugin" | "theme" | (string & {});
  /**
   * Optional contract for container blocks (`acceptsChildren:
   * true`). Restricts which child types may be added or moved
   * into this container. Empty / omitted accepts every block
   * type (the historical behavior).
   *
   *   allowedChildTypes: ["pricing", "feature-grid"]
   *
   * Wildcard `"*"` is shorthand for "anything". The admin uses
   * the contract to:
   * - Filter the Add-block popover to valid types when rendered
   *   inside the container.
   * - Reject `MOVE_INTO` actions that violate the contract.
   * - Surface a soft warning when a previously-valid block now
   *   sits under a stricter contract (e.g. plugin tightened the
   *   allowed list).
   *
   * Plugin / theme containers are recommended to set this; the
   * built-in `grid` keeps the open default since its purpose is
   * arbitrary layout composition.
   */
  allowedChildTypes?: readonly string[];
  /**
   * Optional lower bound on the container's children count. The
   * admin shows a warning beneath the container when fewer
   * children are present (it's intentionally not enforced at
   * save time — an in-progress page mid-edit naturally violates
   * lower bounds).
   */
  minChildren?: number;
  /**
   * Optional upper bound on the container's children count. Add-
   * block UI inside the container hides when the count is at
   * `maxChildren`; `MOVE_INTO` rejects when adding would exceed
   * the cap.
   */
  maxChildren?: number;
  /**
   * Hint for the admin's icon resolver. The framework's built-in
   * blocks set `iconKind: "lucide"` and put a Lucide icon name
   * (e.g. `"Sunrise"`, `"LayoutGrid"`) in `icon`. Plugin / theme
   * blocks that still ship an emoji glyph in `icon` can either
   * leave `iconKind` unset (the resolver falls back to text) or
   * set `iconKind: "emoji"` to skip the Lucide lookup entirely.
   *
   * Resolver behavior:
   * - When `iconKind` is `"lucide"` (or omitted), the admin tries
   *   `LUCIDE_ICONS[icon]` first, then `EMOJI_TO_LUCIDE[icon]`,
   *   then falls back to rendering `icon` as text.
   * - When `iconKind` is `"emoji"`, the admin renders `icon`
   *   verbatim — useful for plugin authors who want a glyph that
   *   doesn't have a Lucide counterpart.
   */
  iconKind?: "lucide" | "emoji";
}

export interface NpBlockDefinition extends NpBlockMetadata {
  /**
   * Block renderer. Container blocks (`acceptsChildren: true`) get
   * the rendered child tree as a React node — they decide where to
   * place it in their JSX (e.g. inside the grid wrapper). Leaf
   * blocks ignore the second argument.
   *
   * The third argument is a read-only data ctx (`NpBlockRenderContext`)
   * so blocks can surface live counts / lists without reaching into
   * `@nexpress/core` directly. The return type allows `Promise<ReactElement>`
   * because most data-bound blocks are React Server Components — React 19
   * resolves them as part of the render tree. Static blocks keep the
   * historical sync `(props) => <jsx />` shape unchanged.
   */
  render: (
    props: Record<string, unknown>,
    children?: ReactNode,
    ctx?: NpBlockRenderContext,
  ) => ReactElement | Promise<ReactElement>;
}

export type NpBlockPropConditionValue = string | number | boolean;

export type NpBlockPropCondition = readonly [propName: string, expected: NpBlockPropConditionValue];

interface NpBlockPropFieldBase<TDefault> {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: TDefault;
  /** Optional helper text rendered under the field in the props form. */
  description?: string;
  /**
   * Field grouping label. Fields with the same `group` render
   * under one collapsible section in the props form, in
   * declaration order. Omitted falls into the default ungrouped
   * surface so existing schemas stay flat. Block authors that
   * want a tabbed layout can still rely on field order — the
   * editor lays out groups stacked, not as tabs (a v2 upgrade).
   */
  group?: string;
  /**
   * Conditional visibility — the field is hidden when *all* of
   * the listed `[propName, value]` predicates match the block's
   * current `props`. Every predicate must reference a sibling scalar
   * field and use a value accepted by that field's contract.
   */
  hiddenWhen?: readonly NpBlockPropCondition[];
  /**
   * Conditional visibility — inverse of `hiddenWhen`. The field is
   * shown only when *all* of the listed `[propName, value]`
   * predicates match the block's current `props`. Lets a schema
   * express "show `imageUrl` only when `mode === 'media'`".
   * If both `hiddenWhen` and `visibleWhen` are set, the field is
   * shown when `visibleWhen` matches AND `hiddenWhen` doesn't.
   */
  visibleWhen?: readonly NpBlockPropCondition[];
}

interface NpBlockPatternField {
  /** JavaScript regular-expression source matched against the whole value. */
  pattern?: string;
  /** Custom message for a pattern or numeric constraint violation. */
  validationMessage?: string;
}

export interface NpBlockTextPropField extends NpBlockPropFieldBase<string>, NpBlockPatternField {
  type: "text";
  translatable: boolean;
  placeholder?: string;
}

export interface NpBlockTextareaPropField extends NpBlockPropFieldBase<string> {
  type: "textarea";
  translatable: boolean;
  placeholder?: string;
  /** Number of visible rows. Admin defaults to four when omitted. */
  rows?: number;
}

export interface NpBlockNumberPropField extends NpBlockPropFieldBase<number> {
  type: "number";
  placeholder?: string;
  min?: number;
  max?: number;
  /** Positive increment measured from `min`, or zero when `min` is omitted. */
  step?: number;
  validationMessage?: string;
}

export interface NpBlockBooleanPropField extends NpBlockPropFieldBase<boolean> {
  type: "boolean";
}

export interface NpBlockSelectPropField extends NpBlockPropFieldBase<string> {
  type: "select";
  options: Array<{ label: string; value: string }>;
}

export interface NpBlockUrlPropField extends NpBlockPropFieldBase<string>, NpBlockPatternField {
  type: "url";
  placeholder?: string;
}

export interface NpBlockRichTextPropField extends NpBlockPropFieldBase<NpRichTextContent> {
  type: "richtext";
  translatable: boolean;
}

/** Image URL selected from the media library or entered directly. */
export interface NpBlockImagePropField extends NpBlockPropFieldBase<string> {
  type: "image";
}

/** CSS color value, including theme-token `var(...)` references. */
export interface NpBlockColorPropField extends NpBlockPropFieldBase<string> {
  type: "color";
}

/** Active collection slug. */
export interface NpBlockCollectionPropField extends NpBlockPropFieldBase<string> {
  type: "collection";
}

export interface NpBlockArrayPropField extends NpBlockPropFieldBase<object[]> {
  type: "array";
  /**
   * Schema applied to every object in the stored array. The admin
   * renderer recurses through this list when an
   * operator clicks "Add" — fields here use the same `NpBlockPropField`
   * union, including nested `array` fields.
   */
  itemSchema: NpBlockPropField[];
  /**
   * Values merged over item-field defaults when Admin inserts an item.
   */
  itemDefault?: object;
}

/**
 * Serializable block editor field. Textual controls must explicitly declare
 * whether they contain visitor-facing copy. Translation exporters follow only
 * `translatable: true`; operational strings use `false`. Non-textual controls
 * cannot declare translation intent. Array fields declare it recursively on
 * their `itemSchema` leaves.
 */
export type NpBlockPropField =
  | NpBlockTextPropField
  | NpBlockTextareaPropField
  | NpBlockNumberPropField
  | NpBlockBooleanPropField
  | NpBlockSelectPropField
  | NpBlockUrlPropField
  | NpBlockRichTextPropField
  | NpBlockImagePropField
  | NpBlockColorPropField
  | NpBlockCollectionPropField
  | NpBlockArrayPropField;

// The `blocks` field on a document is stored and edited as a flat
// array of block instances — the editor, the JSONB column, the
// seed scripts, and every theme template all pass an array. The
// historical `{ blocks: [...] }` wrapper was a typing-only mismatch
// that crashed `renderBlocks` whenever a page actually had blocks.
export type NpPageBlocks = NpBlockInstance[];

export interface NpDataBinding {
  collection: string;
  where?: Record<string, unknown>;
  select?: string[];
  sort?: string;
  limit?: number;
}

export interface NpBlockRegistration {
  definition: NpBlockDefinition;
}

export interface NpBlockRegistry {
  register(definition: NpBlockDefinition): void;
  get(type: string): NpBlockDefinition | undefined;
  getAll(): NpBlockDefinition[];
  has(type: string): boolean;
}

/**
 * A "pattern" is a pre-shaped subtree of blocks the page-builder
 * can drop into a page in one click. The wire format mirrors the
 * page-builder's tree state (`NpBlockInstance[]`); the editor's
 * `INSERT_PATTERN` action runs `cloneBlockDeep` over `blocks` so
 * every insertion gets fresh ids.
 *
 * `source` namespaces the origin so the admin can group patterns
 * by where they came from:
 *
 * - `"built-in"`: ships with the editor.
 * - `"custom"`: operator-saved, lives in `localStorage` or
 *   `np_settings` (server-shared).
 * - `"plugin"` / `"theme"`: contributed via the plugin or theme
 *   manifest at boot time. The bootstrap fans these into the
 *   shared pattern registry.
 *
 * String-and-loose for forward compatibility — additional sources
 * (e.g. `"marketplace"`) can land without bumping the union.
 */
export type NpPatternSource = "built-in" | "custom" | "plugin" | "theme" | (string & {});

/**
 * Author-facing pattern contribution. Plugins and themes may omit `source`;
 * the Next bootstrap replaces it with the concrete `plugin:<id>` or
 * `theme:<id>` identity before registration.
 */
export interface NpPatternDefinition {
  id: string;
  label: string;
  description?: string;
  source?: NpPatternSource;
  blocks: NpBlockInstance[];
  /**
   * Phase F.5 — optional preview image path. Themes can ship a
   * thumbnail (typically under the theme package's `public/` so
   * Next can serve it directly) so the page-builder picker can
   * render a visual representation. Picker UI thumbnail rendering
   * shipped in F.5.1 (Cmd-K menu) and F.5.2 (full library
   * dialog).
   *
   * **Recommended convention** (F.5.2): place preview images under
   * the theme package's `public/themes/<theme-id>/patterns/`
   * directory and reference them as
   * `/themes/<theme-id>/patterns/<pattern-id>.png`. Next's static
   * file serving picks them up automatically. Use:
   *
   *   - PNG or WebP (transparent backgrounds OK; admin renders
   *     on a neutral tile)
   *   - 800×500px source (admin uses 16:10 cards; the picker
   *     resizes via `object-cover`)
   *   - Under ~100 KB per thumbnail so the library dialog stays
   *     snappy when a theme ships a dozen patterns
   *
   * The picker tolerates broken / missing previews — when the
   * URL 404s or the field is omitted, the admin falls back to a
   * labeled icon tile (no broken-image glyph reaches operators).
   */
  preview?: string;
  /**
   * Phase F.5 — optional grouping label. The picker can group
   * patterns by category in a future redesign; today it's
   * surfaced as plain metadata. Theme authors typically use
   * `"homepage" | "page" | "section"` but the union is
   * intentionally loose.
   */
  category?: "homepage" | "page" | "section" | (string & {});
}

/** A validated pattern after its concrete source has been assigned. */
export interface NpPattern extends NpPatternDefinition {
  source: NpPatternSource;
}

void (0 as ReactNode | undefined);
