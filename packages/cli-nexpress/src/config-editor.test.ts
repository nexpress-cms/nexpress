import { describe, expect, it } from "vitest";

import {
  addPluginToConfig,
  addThemeToConfig,
  buildManualRemoveSnippet,
  buildManualSnippet,
  buildManualThemeSnippet,
  buildManualThemeRemoveSnippet,
  packageToIdentifier,
  packageToThemeIdentifier,
  removePluginFromConfig,
  removeThemeFromConfig,
} from "./config-editor.js";

const baseConfig = `import { defineConfig } from "@nexpress/core";
import { defaultThemes } from "@nexpress/app/config-defaults";

// @nexpress:plugins-imports-start
// @nexpress:plugins-imports-end
// @nexpress:themes-imports-start
// @nexpress:themes-imports-end

export default defineConfig({
  collections: [],
  themes: [
    ...defaultThemes,
    // @nexpress:themes-list-start
    // @nexpress:themes-list-end
  ],
  plugins: [
    // @nexpress:plugins-list-start
    // @nexpress:plugins-list-end
  ],
});
`;

describe("package identifiers", () => {
  it("strips scopes and camel-cases plugin names", () => {
    expect(packageToIdentifier("@nexpress/reading-time")).toBe("readingTime");
    expect(packageToIdentifier("my-plugin")).toBe("myPlugin");
    expect(packageToIdentifier("seo")).toBe("seo");
    expect(packageToIdentifier("@scope/with.dots")).toBe("withDots");
    expect(() => packageToIdentifier("@scope/")).toThrow();
    expect(() => packageToIdentifier("---")).toThrow();
  });

  it("requires the theme prefix and appends Theme to its camel-cased tail", () => {
    expect(packageToThemeIdentifier("@nexpress/theme-magazine")).toBe("magazineTheme");
    expect(packageToThemeIdentifier("@me/theme-cool")).toBe("coolTheme");
    expect(packageToThemeIdentifier("theme-personal")).toBe("personalTheme");
    expect(packageToThemeIdentifier("@scope/theme-my-pet-blog")).toBe("myPetBlogTheme");
    expect(() => packageToThemeIdentifier("@scope/not-a-theme")).toThrow(/theme-/);
    expect(() => packageToThemeIdentifier("magazine")).toThrow(/theme-/);
  });
});

describe.each([
  {
    kind: "plugins",
    entry: { packageName: "@nexpress/reading-time", identifier: "readingTime" },
    importLine: 'import readingTime from "@nexpress/reading-time";',
    add: addPluginToConfig,
    remove: removePluginFromConfig,
    snippet: buildManualSnippet,
    removeSnippet: buildManualRemoveSnippet,
    missingEntry: 'no entry for "@nexpress/reading-time" found',
    malformed: "malformed marker pairs",
  },
  {
    kind: "themes",
    entry: { packageName: "@nexpress/theme-magazine", identifier: "magazineTheme" },
    importLine: 'import { magazineTheme } from "@nexpress/theme-magazine";',
    add: addThemeToConfig,
    remove: removeThemeFromConfig,
    snippet: buildManualThemeSnippet,
    removeSnippet: buildManualThemeRemoveSnippet,
    missingEntry: 'no theme entry for "@nexpress/theme-magazine" found',
    malformed: "malformed theme marker pairs",
  },
])(
  "$kind config editing",
  ({ kind, entry, importLine, add, remove, snippet, removeSnippet, missingEntry, malformed }) => {
    it("adds and removes idempotently while preserving indentation and unmanaged source", () => {
      // Matching lines outside the managed regions must survive removal.
      const original = `${baseConfig}\n${importLine}\n${entry.identifier},\n`;
      const importsEnd = `// @nexpress:${kind}-imports-end`;
      const listEnd = `    // @nexpress:${kind}-list-end`;
      const expected = original
        .replace(importsEnd, `${importLine}\n${importsEnd}`)
        .replace(listEnd, `    ${entry.identifier},\n${listEnd}`);
      expect(add(original, entry)).toEqual({ kind: "ok", content: expected });
      expect(add(expected, entry)).toEqual({
        kind: "no-op",
        reason: `import for "${entry.packageName}" already present`,
      });
      expect(remove(expected, entry)).toEqual({ kind: "ok", content: original });
      expect(remove(original, entry)).toEqual({ kind: "no-op", reason: missingEntry });
    });

    it("reports missing and malformed markers without editing the source", () => {
      const importsStart = `// @nexpress:${kind}-imports-start`;
      const importsEnd = `// @nexpress:${kind}-imports-end`;
      const listStart = `// @nexpress:${kind}-list-start`;
      const listEnd = `// @nexpress:${kind}-list-end`;
      const reversed = `${importsEnd}\n${importsStart}\n${listStart}\n${listEnd}\n`;
      for (const edit of [add, remove]) {
        expect(edit("export default {};\n", entry)).toEqual({
          kind: "no-markers",
          missing: [`${importsStart} / ${importsEnd}`, `${listStart} / ${listEnd}`],
        });
        expect(edit(reversed, entry)).toEqual({ kind: "no-markers", missing: [malformed] });
      }
    });

    it("prints the matching import and list for manual addition and removal", () => {
      expect(snippet(entry)).toContain(importLine);
      expect(snippet(entry)).toContain(`defineConfig({ ${kind}: [...] })`);
      expect(snippet(entry)).toContain(`${entry.identifier},`);
      expect(removeSnippet(entry)).toContain("Remove from the imports section");
      expect(removeSnippet(entry)).toContain(importLine);
      expect(removeSnippet(entry)).toContain(`${entry.identifier},`);
    });
  },
);
