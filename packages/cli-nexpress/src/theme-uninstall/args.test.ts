import { describe, expect, it } from "vitest";

import { parseThemeUninstallArgs } from "./args.js";

describe("parseThemeUninstallArgs", () => {
  it("parses the friendly theme remove command flags", () => {
    const result = parseThemeUninstallArgs(
      ["@nexpress/theme-magazine", "--dry-run", "--yes", "--with-collections", "--apply"],
      {
        commandName: "theme remove",
        example: "nexpress theme remove @nexpress/theme-magazine",
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        themePackage: "@nexpress/theme-magazine",
        flags: {
          dryRun: true,
          yes: true,
          withCollections: true,
          apply: true,
        },
      },
    });
  });

  it("labels unknown flags with the command name", () => {
    const result = parseThemeUninstallArgs(["@nexpress/theme-magazine", "--force"], {
      commandName: "theme remove",
      example: "nexpress theme remove @nexpress/theme-magazine",
    });

    expect(result).toEqual({
      ok: false,
      message: "Unknown flag for theme remove: --force",
    });
  });

  it("keeps legacy theme:uninstall errors discoverable", () => {
    const result = parseThemeUninstallArgs([], {
      commandName: "theme:uninstall",
      example: "nexpress theme:uninstall @nexpress/theme-magazine",
    });

    expect(result).toEqual({
      ok: false,
      message:
        "theme:uninstall requires a theme package name. Example: nexpress theme:uninstall @nexpress/theme-magazine",
    });
  });
});
