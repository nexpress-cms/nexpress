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
