import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  npAnalyzeRegisteredThemeDefinition,
  npValidateRegisteredThemeDefinition,
} from "./definition-contract.js";
import { getAllStrings } from "../i18n/strings.js";
import { getRegisteredThemes, registerThemes, resetThemes } from "./registry.js";

function validTheme(): Record<string, unknown> {
  return {
    manifest: {
      id: "newsroom",
      name: "Newsroom",
      version: "1.2.3",
      description: "An editorial theme.",
      author: { name: "NexPress", url: "https://example.com" },
      nexpress: { minVersion: "0.3.0" },
      settingsSchema: z.object({ compact: z.boolean().default(false) }),
      requires: {
        collections: {
          posts: {
            fields: {
              featured: { type: "checkbox", required: false },
              category: {
                type: "select",
                options: [{ label: "News", value: "news" }],
              },
            },
          },
        },
      },
    },
    impl: {
      shell: () => null,
      slots: { header: () => null },
      templates: {
        pages: { default: { label: "Default", component: () => null } },
      },
      tokens: { colors: { primary: "#123456" } },
      css: ".np-newsroom { color: var(--np-color-primary); }",
      i18n: { en: { "newsroom.title": "Newsroom" } },
      routes: [{ pattern: "/news/:slug", component: () => null }],
      navLocations: { primary: { label: "Primary", maxItems: 8 } },
      members: {
        shell: null,
        publicProfile: () => null,
        pageTitle: { login: "Sign in" },
      },
      seo: { robotsTxt: () => "User-agent: *" },
      blocks: [],
      patterns: [],
      seedContent: { pages: [], posts: [] },
    },
  };
}

describe("registered theme definition contract", () => {
  it("accepts a complete theme definition", () => {
    expect(npValidateRegisteredThemeDefinition(validTheme())).toEqual({ ok: true });
  });

  it.each([
    [{}, /manifest/],
    [{ ...validTheme(), extra: true }, /unsupported theme definition field/],
    [
      { ...validTheme(), manifest: { ...(validTheme().manifest as object), id: "Bad Theme" } },
      /lowercase/,
    ],
    [
      { ...validTheme(), manifest: { ...(validTheme().manifest as object), version: "latest" } },
      /semantic version/,
    ],
    [
      {
        ...validTheme(),
        manifest: {
          ...(validTheme().manifest as object),
          settingsVersion: 2,
        },
      },
      /requires settingsMigrate/,
    ],
    [
      {
        ...validTheme(),
        impl: { routes: [{ component: (): null => null }] },
      },
      /pattern is required/,
    ],
    [
      {
        ...validTheme(),
        impl: {
          routes: [
            { pattern: "/same", component: () => null },
            { pattern: "/same", component: () => null },
          ],
        },
      },
      /duplicate theme route pattern/,
    ],
    [
      { ...validTheme(), impl: { navLocations: { primary: { label: "", maxItems: 0 } } } },
      /labels must be non-empty/,
    ],
    [
      { ...validTheme(), impl: { members: { publicProfile: "not-a-component" } } },
      /publicProfile must be a function/,
    ],
    [{ ...validTheme(), impl: { i18n: { "en-us": { title: "Hi" } } } }, /canonical BCP 47/],
    [
      {
        ...validTheme(),
        manifest: { ...(validTheme().manifest as object), settingsSchema: z.string() },
      },
      /top-level Zod object/,
    ],
  ])("rejects malformed definitions", (value, expected) => {
    expect(npAnalyzeRegisteredThemeDefinition(value)[0]?.message).toMatch(expected);
  });

  it("reports invalid requirements instead of letting config merge trust them", () => {
    const theme = validTheme();
    theme.manifest = {
      ...(theme.manifest as object),
      requires: {
        collections: {
          posts: {
            fields: {
              category: {
                type: "select",
                options: [
                  { label: "News", value: "news" },
                  { label: "Duplicate", value: "news" },
                ],
              },
            },
          },
        },
      },
    };

    expect(npAnalyzeRegisteredThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "requirements",
          message: 'duplicate option value "news".',
        }),
      ]),
    );
  });

  it("uses the canonical token overlay contract for theme defaults", () => {
    const theme = validTheme();
    theme.impl = {
      ...(theme.impl as object),
      tokens: {
        colors: {
          primary: "url(https://example.com/tracker)",
          brand: "#fff",
        },
      },
    };

    expect(npAnalyzeRegisteredThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "implementation",
          location: "impl.tokens.colors.primary",
          message: expect.stringMatching(/resource-loading/),
        }),
        expect.objectContaining({
          location: "impl.tokens.colors.brand",
          message: expect.stringMatching(/unsupported/),
        }),
      ]),
    );
  });

  it("rejects requirement properties that do not apply to the field type", () => {
    const theme = validTheme();
    theme.manifest = {
      ...(theme.manifest as object),
      requires: {
        collections: {
          posts: {
            fields: {
              title: { type: "text", relationTo: "authors", options: [] },
            },
          },
        },
      },
    };

    expect(npAnalyzeRegisteredThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/relationship or upload fields/),
        }),
        expect.objectContaining({ message: expect.stringMatching(/select fields/) }),
      ]),
    );
  });

  it("allows only the slug parameter in kind URL patterns", () => {
    const theme = validTheme();
    theme.manifest = {
      ...(theme.manifest as object),
      requires: {
        collections: {
          posts: {
            kinds: {
              article: {
                label: "Article",
                labelPlural: "Articles",
                urlPattern: "/:section/:slugger",
              },
            },
          },
        },
      },
    };

    expect(npAnalyzeRegisteredThemeDefinition(theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/containing :slug/) }),
      ]),
    );
  });

  it("validates a whole registry batch before mutating global state", () => {
    resetThemes();
    expect(() =>
      registerThemes([validTheme(), { manifest: { id: "broken" }, impl: {} }] as never),
    ).toThrow(/Invalid theme definition/);
    expect(getRegisteredThemes()).toEqual([]);
  });

  it("rejects duplicate ids within one registry batch", () => {
    resetThemes();
    const theme = validTheme();
    expect(() => registerThemes([theme, theme] as never)).toThrow(/duplicate theme id/);
    expect(getRegisteredThemes()).toEqual([]);
  });

  it("replaces a theme's source-owned catalog without retaining stale keys", () => {
    resetThemes();
    const first = validTheme();
    first.impl = {
      ...(first.impl as object),
      i18n: { en: { stale: "old", current: "v1" } },
    };
    registerThemes([first as never]);

    const replacement = validTheme();
    replacement.impl = {
      ...(replacement.impl as object),
      i18n: { en: { current: "v2" } },
    };
    registerThemes([replacement as never]);

    expect(getAllStrings().en).toEqual({ current: "v2" });
    resetThemes();
  });
});
