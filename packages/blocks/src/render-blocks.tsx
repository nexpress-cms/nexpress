import * as React from "react";

import { readGridChildLayout } from "./blocks/grid.js";
import { getDefaultBlocks, createBlockRegistry } from "./registry.js";
import type { NxBlockInstance, NxBlockRegistry, NxPageBlocks } from "./types.js";

const defaultRegistry = (() => {
  const registry = createBlockRegistry();

  for (const block of getDefaultBlocks()) {
    registry.register(block);
  }

  return registry;
})();

/**
 * Walk a tree of block instances and render the React tree.
 * Container blocks (`acceptsChildren: true`) get their rendered
 * children passed in as the second arg of `definition.render`;
 * the renderer itself handles the recursion + the grid-child
 * `_layout.colSpan` wrapping so individual block renders stay
 * unaware of where they're placed.
 */
export const renderBlocks = (
  pageBlocks: NxPageBlocks,
  registry: NxBlockRegistry = defaultRegistry,
): React.ReactElement | null => {
  if (pageBlocks.length === 0) {
    return null;
  }

  return <div className="nx-blocks">{pageBlocks.map((b) => renderBlock(b, registry))}</div>;
};

function renderBlock(
  instance: NxBlockInstance,
  registry: NxBlockRegistry,
  parentType?: string,
): React.ReactElement {
  const definition = registry.get(instance.type);

  if (!definition) {
    return (
      <div key={instance.id} className="nx-block-unknown">
        Unknown block type: {instance.type}
      </div>
    );
  }

  let rendered: React.ReactNode = null;
  if (definition.acceptsChildren && Array.isArray(instance.children)) {
    // Recurse first, then hand the rendered tree to the parent's
    // render() so the parent decides where to place children
    // (inside its grid wrapper, columns, etc.).
    rendered = instance.children.map((child) => renderBlock(child, registry, instance.type));
  }

  const node = definition.render(instance.props, rendered);

  // When this block is itself a grid child, wrap it in a span div
  // so the grid layout reads the colSpan meta off `props._layout`.
  // We do this at the renderer (not inside each leaf block) so
  // every existing block reuses the same wrapper without changes.
  if (parentType === "grid") {
    const { colSpan } = readGridChildLayout(instance.props, 12);
    return (
      <div
        key={instance.id}
        className="nx-block-grid-cell"
        style={{ gridColumn: `span ${colSpan} / span ${colSpan}` }}
      >
        {node}
      </div>
    );
  }

  return <React.Fragment key={instance.id}>{node}</React.Fragment>;
}
