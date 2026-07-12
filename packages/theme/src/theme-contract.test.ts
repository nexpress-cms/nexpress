import * as React from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";

import { defineTheme, type NpTheme } from "./define-theme.js";
import { npAnalyzeThemeDefinition, npValidateThemeDefinition } from "./theme-contract.js";

function validTheme(): NpTheme {
  return {
    manifest: {
      id: "newsroom",
      name: "Newsroom",
      version: "1.0.0",
      settingsSchema: z.object({ compact: z.boolean().default(false) }),
    },
    impl: {
      templates: {
        pages: {
          default: { label: "Default", component: () => null },
        },
      },
      blocks: [
        {
          type: "newsroom.hero",
          label: "Hero",
          defaultProps: { title: "Headline" },
          propsSchema: [
            {
              name: "title",
              label: "Headline",
              type: "text",
              required: true,
              translatable: true,
            },
          ],
          render: () => React.createElement("div"),
        },
      ],
      patterns: [
        {
          id: "newsroom.hero",
          label: "Hero",
          blocks: [{ id: "hero-1", type: "newsroom.hero", props: { title: "Headline" } }],
        },
      ],
      seedContent: {
        pages: [
          {
            title: "Home",
            slug: "/",
            template: "default",
            blocks: [{ id: "hero-1", type: "newsroom.hero", props: { title: "Welcome" } }],
          },
        ],
        posts: [
          {
            title: "Hello",
            excerpt: "Welcome to the newsroom.",
            content: npCreateEmptyRichTextContent(),
            publishedAt: "2026-07-12T00:00:00.000Z",
          },
        ],
      },
    },
  };
}

describe("theme definition contract", () => {
  it("accepts blocks, patterns, settings, and seed content together", () => {
    const theme = validTheme();
    expect(npValidateThemeDefinition(theme)).toEqual({ ok: true });
    expect(defineTheme(theme)).toBe(theme);
  });

  it("rejects invalid block definitions during module evaluation", () => {
    const theme = validTheme();
    theme.impl.blocks = [
      {
        type: "newsroom.bad",
        label: "Bad",
        defaultProps: { count: "not-a-number" },
        propsSchema: [{ name: "count", label: "Count", type: "number" }],
        render: () => React.createElement("div"),
      },
    ];

    expect(() => defineTheme(theme)).toThrow(
      /Invalid theme definition at impl.blocks.*must be a finite number/,
    );
  });

  it("requires a top-level object settings schema", () => {
    const theme = validTheme();
    theme.manifest.settingsSchema = z.string();

    expect(npAnalyzeThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "settings",
          location: "manifest.settingsSchema",
          message: expect.stringMatching(/top-level Zod object/),
        }),
      ]),
    );
  });

  it("rejects known pattern prop mismatches during module evaluation", () => {
    const theme = validTheme();
    const patterns = theme.impl.patterns;
    if (!patterns?.[0]) throw new Error("fixture missing pattern");
    patterns[0].blocks = [{ id: "hero-1", type: "newsroom.hero", props: { title: 42 } }];

    expect(npAnalyzeThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "patterns", message: expect.stringMatching(/string/) }),
      ]),
    );
  });

  it("rejects known invalid seed block props while preserving unknown types", () => {
    const invalid = validTheme();
    const invalidPages = invalid.impl.seedContent?.pages;
    if (!invalidPages?.[0]) throw new Error("fixture missing page");
    invalidPages[0].blocks = [{ id: "hero-1", type: "newsroom.hero", props: { title: 42 } }];
    expect(npAnalyzeThemeDefinition(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "seed-content", message: expect.stringMatching(/string/) }),
      ]),
    );

    const unknown = validTheme();
    const unknownPages = unknown.impl.seedContent?.pages;
    if (!unknownPages?.[0]) throw new Error("fixture missing page");
    unknownPages[0].blocks = [
      { id: "plugin-1", type: "plugin.runtime-block", props: { opaque: true } },
    ];
    expect(npValidateThemeDefinition(unknown)).toEqual({ ok: true });
  });

  it("rejects raw rich-text seed values", () => {
    const theme = validTheme();
    const posts = theme.impl.seedContent?.posts;
    if (!posts?.[0]) throw new Error("fixture missing post");
    posts[0].content = { root: { type: "root" } };

    expect(npAnalyzeThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "seed-content",
          location: "impl.seedContent.posts.0.content",
        }),
      ]),
    );
  });

  it("delegates seed trees and location keys to the canonical navigation contract", () => {
    const theme = validTheme();
    if (!theme.impl.seedContent) throw new Error("fixture missing seed content");
    theme.impl.seedContent.navigation = {
      header: [
        {
          id: "duplicate",
          label: "Unsafe",
          type: "link",
          url: "javascript:alert(1)",
          children: [{ id: "duplicate", label: "Duplicate", type: "link", url: "/duplicate" }],
        },
      ],
    };
    theme.impl.navLocations = { "Bad Location": { label: "Bad" } };

    expect(npAnalyzeThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "seed-content",
          location: "impl.seedContent.navigation.header.0.url",
        }),
        expect.objectContaining({
          code: "seed-content",
          location: "impl.seedContent.navigation.header.0.children.0.id",
          message: expect.stringMatching(/duplicates/),
        }),
        expect.objectContaining({
          code: "implementation",
          location: "impl.navLocations.Bad Location",
        }),
      ]),
    );
  });

  it("rejects unsupported and malformed seed fields", () => {
    const unsupported = validTheme() as unknown as Record<string, unknown>;
    const unsupportedImpl = unsupported.impl as { seedContent: { posts: object[] } };
    unsupportedImpl.seedContent.posts[0] = {
      ...unsupportedImpl.seedContent.posts[0],
      typoField: true,
    };
    expect(npAnalyzeThemeDefinition(unsupported)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "impl.seedContent.posts.0.typoField",
          message: 'unsupported seed field "typoField".',
        }),
      ]),
    );

    const malformed = validTheme() as unknown as Record<string, unknown>;
    const malformedImpl = malformed.impl as { seedContent: { posts: object[] } };
    malformedImpl.seedContent.posts[0] = {
      ...malformedImpl.seedContent.posts[0],
      order: Number.NaN,
    };
    expect(npAnalyzeThemeDefinition(malformed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "impl.seedContent.posts.0.order",
          message: expect.stringMatching(/non-negative integer/),
        }),
      ]),
    );
  });
});
