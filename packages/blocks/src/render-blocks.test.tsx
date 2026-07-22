import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createBlockRegistry, registerBlock, resetSharedBlockRegistry } from "./registry.js";
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

  it("validates and renders against the active owner after a block collision", async () => {
    resetSharedBlockRegistry();
    registerBlock({
      type: "shared-card",
      label: "First",
      source: "plugin:first",
      defaultProps: {},
      propsSchema: [],
      render: () => <div>first owner</div>,
    });
    registerBlock({
      type: "shared-card",
      label: "Second",
      source: "plugin:second",
      defaultProps: {},
      propsSchema: [
        { name: "title", label: "Title", type: "text", translatable: true, required: true },
      ],
      render: () => <div>second owner</div>,
    });

    const tree = renderBlocks([{ id: "card-1", type: "shared-card", props: {} }], {
      ctx: {
        activeSources: { themeId: null, pluginIds: new Set(["first"]) },
      } as never,
    });
    const markup = await new Response(await renderToReadableStream(tree)).text();
    expect(markup).toContain("first owner");
    resetSharedBlockRegistry();
  });

  it("renders grid child spans from the top-level layout contract", async () => {
    const registry = createBlockRegistry();
    registry.register({
      type: "grid",
      label: "Grid",
      defaultProps: {},
      propsSchema: [],
      acceptsChildren: true,
      render: (_props, children) => <div className="grid">{children}</div>,
    });
    registry.register({
      type: "copy",
      label: "Copy",
      defaultProps: {},
      propsSchema: [],
      render: () => <p>Copy</p>,
    });

    const tree = renderBlocks(
      [
        {
          id: "grid-1",
          type: "grid",
          props: { columns: 12 },
          children: [
            {
              id: "copy-1",
              type: "copy",
              props: {},
              layout: { colSpan: 12, mdColSpan: 8, lgColSpan: 6 },
            },
          ],
        },
      ],
      { registry },
    );
    const markup = await new Response(await renderToReadableStream(tree)).text();
    expect(markup).toContain("np-block-grid-cell");
    expect(markup).toContain("--np-cell-span:12");
    expect(markup).toContain("--np-cell-span-md:8");
    expect(markup).toContain("--np-cell-span-lg:6");
  });

  it("defaults an unconfigured child to its parent grid's column count", async () => {
    const registry = createBlockRegistry();
    registry.register({
      type: "grid",
      label: "Grid",
      defaultProps: {},
      propsSchema: [],
      acceptsChildren: true,
      render: (_props, children) => <div>{children}</div>,
    });
    registry.register({
      type: "copy",
      label: "Copy",
      defaultProps: {},
      propsSchema: [],
      render: () => <p>Copy</p>,
    });

    const tree = renderBlocks(
      [
        {
          id: "grid-1",
          type: "grid",
          props: { columns: 8 },
          children: [
            {
              id: "copy-1",
              type: "copy",
              props: { _layout: { colSpan: 3 } },
            },
          ],
        },
      ],
      { registry },
    );
    expect(await new Response(await renderToReadableStream(tree)).text()).toContain(
      "--np-cell-span:8",
    );
  });
});
