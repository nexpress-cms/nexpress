import { describe, expect, it } from "vitest";

import { buildPluginInstallHints, pluginImportName } from "./install-hints.js";

describe("plugin discover install hints", () => {
  it("derives a readable import name from common plugin package names", () => {
    expect(pluginImportName("@nexpress/plugin-reading-time")).toBe("readingTimePlugin");
    expect(pluginImportName("@acme/nexpress-plugin-seo-audit")).toBe("seoAuditPlugin");
    expect(pluginImportName("plugin-forms")).toBe("formsPlugin");
  });

  it("prefixes import names that would start with a number", () => {
    expect(pluginImportName("@acme/plugin-404-redirects")).toBe("plugin404RedirectsPlugin");
  });

  it("builds copyable install, registration, and verification commands", () => {
    const hints = buildPluginInstallHints("@nexpress/plugin-reading-time");

    expect(hints.installCommand).toBe("pnpm add @nexpress/plugin-reading-time");
    expect(hints.verifyCommand).toBe("nexpress ops plugins doctor --json");
    expect(hints.projectVerifyCommand).toBe("pnpm run ops:plugins -- doctor --json");
    expect(hints.registerSnippet).toContain(
      `import readingTimePlugin from "@nexpress/plugin-reading-time";`,
    );
    expect(hints.registerSnippet).toContain("plugins: [");
    expect(hints.registerSnippet).toContain("readingTimePlugin,");
  });
});
