import * as React from "react";

import { getDefaultBlocks, createBlockRegistry } from "./registry.js";
import type { NxBlockRegistry, NxPageBlocks } from "./types.js";

const defaultRegistry = (() => {
  const registry = createBlockRegistry();

  for (const block of getDefaultBlocks()) {
    registry.register(block);
  }

  return registry;
})();

export const renderBlocks = (
  pageBlocks: NxPageBlocks,
  registry: NxBlockRegistry = defaultRegistry,
): React.ReactElement | null => {
  if (pageBlocks.blocks.length === 0) {
    return null;
  }

  return (
    <div className="nx-blocks">
      {pageBlocks.blocks.map((instance) => {
        const definition = registry.get(instance.type);

        if (!definition) {
          return (
            <div key={instance.id} className="nx-block-unknown">
              Unknown block type: {instance.type}
            </div>
          );
        }

        return <React.Fragment key={instance.id}>{definition.render(instance.props)}</React.Fragment>;
      })}
    </div>
  );
};
