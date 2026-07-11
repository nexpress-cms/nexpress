import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createBlockRegistry } from "./registry.js";
import { renderBlocks } from "./render-blocks.js";

describe("renderBlocks definition contract", () => {
  it("fails closed before invoking a known renderer with invalid props", () => {
    const render = vi.fn(() => <div>rendered</div>);
    const registry = createBlockRegistry();
    registry.register({
      type: "card",
      label: "Card",
      defaultProps: {},
      propsSchema: [
        {
          name: "title",
          label: "Title",
          type: "text",
          translatable: true,
          required: true,
        },
      ],
      render,
    });

    const tree = renderBlocks([{ id: "card-1", type: "card", props: {} }], { registry });
    expect(renderToStaticMarkup(tree)).toContain("np-block-invalid");
    expect(render).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed root payload passed through an untyped boundary", () => {
    const tree = renderBlocks({ blocks: [] } as never);
    expect(renderToStaticMarkup(tree)).toContain("np-blocks-invalid");
  });

  it("keeps unknown plugin content visible as a preservation placeholder", () => {
    const tree = renderBlocks([{ id: "old-1", type: "plugin.disabled", props: {} }]);
    expect(renderToStaticMarkup(tree)).toContain("Unknown block type: plugin.disabled");
  });
});
