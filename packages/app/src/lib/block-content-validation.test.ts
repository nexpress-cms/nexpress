import { beforeEach, describe, expect, it, vi } from "vitest";

import { NpValidationError } from "@nexpress/core";
import type * as BlocksModule from "@nexpress/blocks";
import type * as CoreModule from "@nexpress/core";

vi.mock("@nexpress/core", async () => {
  const actual = await vi.importActual<typeof CoreModule>("@nexpress/core");
  return { ...actual, getCollectionConfig: vi.fn() };
});

vi.mock("@nexpress/blocks", async () => {
  const actual = await vi.importActual<typeof BlocksModule>("@nexpress/blocks");
  return { ...actual, getRegisteredBlockMetadata: vi.fn() };
});

const core = await import("@nexpress/core");
const blocks = await import("@nexpress/blocks");
const { validateDocumentBlockContent } = await import("./block-content-validation.js");

describe("validateDocumentBlockContent", () => {
  beforeEach(() => {
    vi.mocked(blocks.getRegisteredBlockMetadata).mockReturnValue([
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

  it("rejects a known block mismatch before a write", () => {
    vi.mocked(core.getCollectionConfig).mockReturnValue({
      slug: "pages",
      labels: { singular: "Page", plural: "Pages" },
      fields: [{ type: "blocks", name: "content" }],
    });

    expect(() =>
      validateDocumentBlockContent("pages", {
        content: [{ id: "card-1", type: "card", props: {} }],
      }),
    ).toThrow(NpValidationError);
  });

  it("walks nested field containers and permits inactive block types", () => {
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

    expect(() =>
      validateDocumentBlockContent("pages", {
        layout: {
          sections: [{ content: [{ id: "old-1", type: "plugin.disabled", props: {} }] }],
        },
      }),
    ).not.toThrow();
  });
});
