import type { ReactElement, ReactNode } from "react";

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
}

export interface NpBlockDefinition extends NpBlockMetadata {
  /**
   * Block renderer. Container blocks (`acceptsChildren: true`) get
   * the rendered child tree as a React node — they decide where to
   * place it in their JSX (e.g. inside the grid wrapper). Leaf
   * blocks ignore the second argument.
   */
  render: (props: Record<string, unknown>, children?: ReactNode) => ReactElement;
}

export interface NpBlockPropField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "url" | "richtext" | "image";
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
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
