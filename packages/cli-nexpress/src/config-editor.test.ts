import { describe, expect, it } from "vitest";

import {
  addPluginToConfig,
  addThemeToConfig,
  buildManualRemoveSnippet,
  buildManualSnippet,
  buildManualThemeSnippet,
  packageToIdentifier,
  packageToThemeIdentifier,
  removePluginFromConfig,
} from "./config-editor.js";

const baseConfig = `import { defineConfig } from "@nexpress/core";

// @nexpress:plugins-imports-start
// @nexpress:plugins-imports-end

export default defineConfig({
  collections: [],
  plugins: [
    // @nexpress:plugins-list-start
    // @nexpress:plugins-list-end
  ],
});
`;

describe("packageToIdentifier", () => {
  it("strips the npm scope and camel-cases the rest", () => {
    expect(packageToIdentifier("@nexpress/reading-time")).toBe("readingTime");
    expect(packageToIdentifier("my-plugin")).toBe("myPlugin");
    expect(packageToIdentifier("seo")).toBe("seo");
    expect(packageToIdentifier("@scope/with.dots")).toBe("withDots");
  });

  it("rejects names that produce no valid identifier", () => {
    expect(() => packageToIdentifier("@scope/")).toThrow();
    expect(() => packageToIdentifier("---")).toThrow();
  });
});

describe("addPluginToConfig", () => {
  it("inserts an import + list entry between the markers", () => {
    const result = addPluginToConfig(baseConfig, {
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.content).toContain('import readingTime from "@nexpress/reading-time";');
    expect(result.content).toMatch(
      /plugins:\s*\[\s*\/\/[^\n]*plugins-list-start\s*\n\s*readingTime,/,
    );
  });

  it("preserves the indentation of the surrounding markers", () => {
    const result = addPluginToConfig(baseConfig, {
      packageName: "@nexpress/seo",
      identifier: "seo",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // The list marker is indented 4 spaces in the fixture.
    expect(result.content).toContain("    seo,\n");
  });

  it("is idempotent — adding the same plugin twice short-circuits", () => {
    const first = addPluginToConfig(baseConfig, {
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;

    const second = addPluginToConfig(first.content, {
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(second.kind).toBe("no-op");
  });

  it("returns no-markers when the config doesn't opt in", () => {
    const without = `import { defineConfig } from "@nexpress/core";\nexport default defineConfig({ collections: [], plugins: [] });\n`;
    const result = addPluginToConfig(without, {
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(result.kind).toBe("no-markers");
    if (result.kind !== "no-markers") return;
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

describe("removePluginFromConfig", () => {
  it("removes both the import and the list entry", () => {
    const added = addPluginToConfig(baseConfig, {
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    if (added.kind !== "ok") throw new Error("setup failed");

    const removed = removePluginFromConfig(added.content, {
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(removed.kind).toBe("ok");
    if (removed.kind !== "ok") return;
    expect(removed.content).not.toContain("readingTime");
    expect(removed.content).not.toContain("@nexpress/reading-time");
  });

  it("returns no-op when the plugin isn't in the config", () => {
    const result = removePluginFromConfig(baseConfig, {
      packageName: "@nexpress/never-installed",
      identifier: "neverInstalled",
    });
    expect(result.kind).toBe("no-op");
  });

  it("returns no-markers when the config has no marker block", () => {
    const without = `export default {};\n`;
    const result = removePluginFromConfig(without, {
      packageName: "any",
      identifier: "any",
    });
    expect(result.kind).toBe("no-markers");
  });
});

describe("buildManualSnippet", () => {
  it("includes both the import and the plugin-list line", () => {
    const snippet = buildManualSnippet({
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(snippet).toContain('import readingTime from "@nexpress/reading-time";');
    expect(snippet).toContain("readingTime,");
  });
});

describe("buildManualRemoveSnippet", () => {
  it("includes both the import and the plugin-list line to remove", () => {
    const snippet = buildManualRemoveSnippet({
      packageName: "@nexpress/reading-time",
      identifier: "readingTime",
    });
    expect(snippet).toContain("Remove from the imports section");
    expect(snippet).toContain('import readingTime from "@nexpress/reading-time";');
    expect(snippet).toContain("readingTime,");
  });
});

const baseConfigWithThemeMarkers = `import { defineConfig } from "@nexpress/core";
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

describe("packageToThemeIdentifier", () => {
  it("derives `<name>Theme` from a `theme-<name>` package", () => {
    expect(packageToThemeIdentifier("@nexpress/theme-magazine")).toBe("magazineTheme");
    expect(packageToThemeIdentifier("@me/theme-cool")).toBe("coolTheme");
    expect(packageToThemeIdentifier("theme-personal")).toBe("personalTheme");
  });

  it("camel-cases hyphenated tail words", () => {
    expect(packageToThemeIdentifier("@scope/theme-my-pet-blog")).toBe("myPetBlogTheme");
  });

  it("throws for packages that don't follow the `theme-` convention", () => {
    expect(() => packageToThemeIdentifier("@scope/not-a-theme")).toThrow(/theme-/);
    expect(() => packageToThemeIdentifier("magazine")).toThrow(/theme-/);
  });
});

describe("addThemeToConfig", () => {
  it("inserts a named import + themes-list entry between the theme markers", () => {
    const result = addThemeToConfig(baseConfigWithThemeMarkers, {
      packageName: "@nexpress/theme-magazine",
      identifier: "magazineTheme",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.content).toContain('import { magazineTheme } from "@nexpress/theme-magazine";');
    expect(result.content).toMatch(/themes-list-start\s*\n\s*magazineTheme,/);
  });

  it("is idempotent — second add of the same theme short-circuits", () => {
    const first = addThemeToConfig(baseConfigWithThemeMarkers, {
      packageName: "@nexpress/theme-magazine",
      identifier: "magazineTheme",
    });
    if (first.kind !== "ok") throw new Error("setup failed");

    const second = addThemeToConfig(first.content, {
      packageName: "@nexpress/theme-magazine",
      identifier: "magazineTheme",
    });
    expect(second.kind).toBe("no-op");
  });

  it("returns no-markers when the config lacks theme markers", () => {
    const without = `import { defineConfig } from "@nexpress/core";\nexport default defineConfig({ collections: [], themes: [] });\n`;
    const result = addThemeToConfig(without, {
      packageName: "@nexpress/theme-magazine",
      identifier: "magazineTheme",
    });
    expect(result.kind).toBe("no-markers");
    if (result.kind !== "no-markers") return;
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

describe("buildManualThemeSnippet", () => {
  it("includes a named import and the themes-list line", () => {
    const snippet = buildManualThemeSnippet({
      packageName: "@nexpress/theme-magazine",
      identifier: "magazineTheme",
    });
    expect(snippet).toContain('import { magazineTheme } from "@nexpress/theme-magazine";');
    expect(snippet).toContain("magazineTheme,");
  });
});
