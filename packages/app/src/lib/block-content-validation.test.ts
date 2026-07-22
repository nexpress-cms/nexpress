import { beforeEach, describe, expect, it, vi } from "vitest";

import { NpValidationError } from "@nexpress/core";
import type * as BlocksModule from "@nexpress/blocks";
import type * as CoreModule from "@nexpress/core";
import type * as NextModule from "@nexpress/next";

vi.mock("@nexpress/core", async () => {
  const actual = await vi.importActual<typeof CoreModule>("@nexpress/core");
  return { ...actual, getCollectionConfig: vi.fn() };
});

vi.mock("@nexpress/blocks", async () => {
  const actual = await vi.importActual<typeof BlocksModule>("@nexpress/blocks");
  return { ...actual, getRegisteredBlockMetadataForActiveSources: vi.fn() };
});

vi.mock("@nexpress/next", async () => {
  const actual = await vi.importActual<typeof NextModule>("@nexpress/next");
  return {
    ...actual,
    createSiteScopedBlockRenderContext: vi.fn(() =>
      Promise.resolve({
        activeSources: { themeId: "default", pluginIds: new Set(["active-plugin"]) },
      }),
    ),
  };
});

const core = await import("@nexpress/core");
const blocks = await import("@nexpress/blocks");
const { validateDocumentBlockContent } = await import("./block-content-validation.js");

describe("validateDocumentBlockContent", () => {
  beforeEach(() => {
    vi.mocked(blocks.getRegisteredBlockMetadataForActiveSources).mockReturnValue([
      {
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
      },
    ]);
  });

  it("rejects a known block mismatch before a write", async () => {
    vi.mocked(core.getCollectionConfig).mockReturnValue({
      slug: "pages",
      labels: { singular: "Page", plural: "Pages" },
      fields: [{ type: "blocks", name: "content" }],
    });

    await expect(
      validateDocumentBlockContent("pages", {
        content: [{ id: "card-1", type: "card", props: {} }],
      }),
    ).rejects.toThrow(NpValidationError);
  });

  it("walks nested field containers and permits inactive block types", async () => {
    vi.mocked(core.getCollectionConfig).mockReturnValue({
      slug: "pages",
      labels: { singular: "Page", plural: "Pages" },
      fields: [
        {
          type: "group",
          name: "layout",
          fields: [
            {
              type: "array",
              name: "sections",
              fields: [{ type: "blocks", name: "content" }],
            },
          ],
        },
      ],
    });

    await expect(
      validateDocumentBlockContent("pages", {
        layout: {
          sections: [{ content: [{ id: "old-1", type: "plugin.disabled", props: {} }] }],
        },
      }),
    ).resolves.toBeUndefined();
  });
});
