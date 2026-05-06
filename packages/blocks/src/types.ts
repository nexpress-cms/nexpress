import type { ReactElement, ReactNode } from "react";

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

export interface NpBlockPropField {
  name: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "url"
    | "richtext"
    | "image"
    /** CSS color picker (`<input type="color">`). Stores `#rrggbb`. */
    | "color"
    /**
     * Picker that lists collection slugs registered with the host. The
     * admin renderer feeds the option list at form time via
     * `useCollectionOptions()` (see registry-context). Stops
     * `latest-posts` / `stats.counter` style blocks from silently
     * empty-listing on a typed slug.
     */
    | "collection"
    /**
     * Repeating list of nested fields. Stores `unknown[]` on the block
     * props; the admin renderer shows an Add / Remove / Reorder UI and
     * recurses into `itemSchema` for each entry. Use for things like a
     * pricing table's tiers, a feature-grid's items, or a CTA strip's
     * buttons. `itemSchema` cannot itself contain another `array`
     * (one level of nesting in v1) — keeps the renderer + storage
     * shape predictable.
     */
    | "array"
    /**
     * Media-library picker. Stores the media id (string) the host's
     * media service hands back. `image` is the legacy "URL string"
     * field; `media` is the proper picker with a thumbnail preview.
     * Resolves to a real `<img>` at render time via the host's media
     * adapter (`ctx.media.getUrl()`).
     */
    | "media";
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  /** Optional helper text rendered under the field in the props form. */
  description?: string;
  /**
   * Native input placeholder. Applies to `text` / `textarea` /
   * `url` / `number`. Ignored for non-input types (`boolean`,
   * `select`, `image`, `media`, `richtext`, `array`, `collection`,
   * `color`).
   */
  placeholder?: string;
  /**
   * For `type: "number"`. Mirrors the HTML number input
   * attributes. Validation pass surfaces a soft warning when the
   * stored value falls outside `[min, max]` or doesn't align to
   * `step` from `min` (or 0 if `min` is omitted).
   */
  min?: number;
  max?: number;
  step?: number;
  /**
   * For `type: "text"` / `type: "url"`. Regex source string —
   * the validation pass tests the stored value against
   * `new RegExp(pattern)`. Invalid patterns are silently dropped
   * (we don't want a typo in an author's schema to crash the
   * editor). Use anchors (`^…$`) to constrain the entire value.
   */
  pattern?: string;
  /** Custom error message paired with `pattern` / `min` / `max`. */
  patternMessage?: string;
  /**
   * For `type: "textarea"`. Number of visible rows. Defaults to
   * 4 when omitted (matching the existing renderer).
   */
  rows?: number;
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
   * current `props`. Lets a schema express "show `ctaUrl` only
   * when `showCta` is true". Leaving the array empty (or omitting
   * the field) keeps the field always visible.
   *
   * Predicate semantics: a missing prop on the block compares
   * against `undefined`, so `hiddenWhen: [["showCta", undefined]]`
   * hides until `showCta` is set to anything.
   */
  hiddenWhen?: ReadonlyArray<readonly [string, unknown]>;
  /**
   * Conditional visibility — inverse of `hiddenWhen`. The field is
   * shown only when *all* of the listed `[propName, value]`
   * predicates match the block's current `props`. Lets a schema
   * express "show `imageUrl` only when `mode === 'media'`".
   * Leaving the array empty (or omitting the field) keeps the
   * field always visible (subject to `hiddenWhen`).
   *
   * If both `hiddenWhen` and `visibleWhen` are set, the field is
   * shown when `visibleWhen` matches AND `hiddenWhen` doesn't.
   */
  visibleWhen?: ReadonlyArray<readonly [string, unknown]>;
  /**
   * For `type: "array"`. Schema applied to every entry in the stored
   * `unknown[]`. The admin renderer recurses through this list when an
   * operator clicks "Add" — fields here use the same `NpBlockPropField`
   * shape minus a second-level `array` (rejected by the renderer).
   */
  itemSchema?: NpBlockPropField[];
  /**
   * For `type: "array"`. Default object shape inserted when the
   * operator clicks "Add". Optional; falls back to a `{}` populated
   * from each `itemSchema[].defaultValue`.
   */
  itemDefault?: Record<string, unknown>;
  /**
   * For `type: "media"`. Restricts the picker to the listed mime
   * prefixes (e.g. `["image/", "video/mp4"]`). Empty / omitted
   * accepts everything the media library has.
   */
  accept?: readonly string[];
}

export interface NpBlockInstance {
  id: string;
  type: string;
  props: Record<string, unknown>;
  /**
   * Nested block instances. Set on container blocks (those whose
   * definition has `acceptsChildren: true`). Empty / undefined on
   * leaf blocks. The renderer walks the tree depth-first and feeds
   * each level's rendered output to the parent's `render(_, children)`.
   *
   * Children may carry layout-meta props the parent reads (e.g. a
   * grid's children read `_layout: { colSpan }`). The shape of
   * that meta is the parent block's contract — not part of the
   * core type.
   */
  children?: NpBlockInstance[];
}

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

void (0 as ReactNode | undefined);
