import * as React from "react";

import { readGridChildLayout } from "./blocks/grid.js";
import { getSharedRegistry } from "./registry.js";
import { createDefaultBlockRenderContext } from "./render-context.js";
import type {
  NpBlockInstance,
  NpBlockRegistry,
  NpBlockRenderContext,
  NpPageBlocks,
} from "./types.js";

export interface NpRenderBlocksOptions {
  /**
   * Override the block lookup. Defaults to the shared module-scoped
   * registry — plugins register into it at boot, so their blocks
   * resolve here automatically. Pass a custom registry only when you
   * want to scope renders to a strict subset (tests, sandboxed
   * previews).
   */
  registry?: NpBlockRegistry;
  /**
   * Read-only data ctx forwarded as the third arg to each block's
   * `render(props, children, ctx)`. The default ctx uses an internal
   * "block-render" principal against `findDocuments` so static blocks
   * stay unaware of auth — pass your own when a page render needs to
   * scope content reads to a specific viewer / site.
   */
  ctx?: NpBlockRenderContext;
}

/**
 * Walk a tree of block instances and render the React tree.
 * Container blocks (`acceptsChildren: true`) get their rendered
 * children passed in as the second arg of `definition.render`;
 * the renderer itself handles the recursion + the grid-child
 * `_layout.colSpan` wrapping so individual block renders stay
 * unaware of where they're placed.
 *
 * The legacy `renderBlocks(pageBlocks, registry)` signature is kept for
 * back-compat — passing a registry directly still works, the new
 * options-object form is preferred for new call sites that want to
 * supply a render ctx.
 */
export function renderBlocks(
  pageBlocks: NpPageBlocks,
  optionsOrRegistry?: NpRenderBlocksOptions | NpBlockRegistry,
): React.ReactElement | null {
  if (pageBlocks.length === 0) {
    return null;
  }

  const options: NpRenderBlocksOptions = isRegistry(optionsOrRegistry)
    ? { registry: optionsOrRegistry }
    : (optionsOrRegistry ?? {});
  const registry = options.registry ?? getSharedRegistry();
  const ctx = options.ctx ?? createDefaultBlockRenderContext();

  return (
    <div className="np-blocks">
      {pageBlocks.map((b) => renderBlock(b, registry, ctx))}
    </div>
  );
}

function isRegistry(
  value: NpRenderBlocksOptions | NpBlockRegistry | undefined,
): value is NpBlockRegistry {
  return (
    !!value &&
    typeof (value as { register?: unknown }).register === "function" &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

function renderBlock(
  instance: NpBlockInstance,
  registry: NpBlockRegistry,
  ctx: NpBlockRenderContext,
  parentType?: string,
): React.ReactElement {
  const definition = registry.get(instance.type);

  if (!definition) {
    return (
      <div key={instance.id} className="np-block-unknown">
        Unknown block type: {instance.type}
      </div>
    );
  }

  let rendered: React.ReactNode = null;
  if (definition.acceptsChildren && Array.isArray(instance.children)) {
    // Recurse first, then hand the rendered tree to the parent's
    // render() so the parent decides where to place children
    // (inside its grid wrapper, columns, etc.).
    rendered = instance.children.map((child) =>
      renderBlock(child, registry, ctx, instance.type),
    );
  }

  // The render type allows `Promise<ReactElement>` so blocks can be
  // async server components. React 19 resolves promise children inline,
  // so cast through `ReactNode` here keeps `<>{node}</>` typed.
  const node = definition.render(instance.props, rendered, ctx) as React.ReactNode;

  // When this block is itself a grid child, wrap it in a span div
  // so the grid layout reads the colSpan meta off `props._layout`.
  // We do this at the renderer (not inside each leaf block) so
  // every existing block reuses the same wrapper without changes.
  if (parentType === "grid") {
    const { colSpan } = readGridChildLayout(instance.props, 12);
    return (
      <div
        key={instance.id}
        className="np-block-grid-cell"
        style={{ gridColumn: `span ${colSpan} / span ${colSpan}` }}
      >
        {node}
      </div>
    );
  }

  return <React.Fragment key={instance.id}>{node}</React.Fragment>;
}
