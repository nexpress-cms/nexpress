import { describe, expect, it } from "vitest";

import { parseThemeRemoveArgs } from "./args.js";

describe("parseThemeRemoveArgs", () => {
  it("parses the friendly theme remove command flags", () => {
    const result = parseThemeRemoveArgs(
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
    const result = parseThemeRemoveArgs(["@nexpress/theme-magazine", "--force"], {
      commandName: "theme remove",
      example: "nexpress theme remove @nexpress/theme-magazine",
    });

    expect(result).toEqual({
      ok: false,
      message: "Unknown flag for theme remove: --force",
    });
  });

  it("labels missing package errors with the current command", () => {
    const result = parseThemeRemoveArgs([], {
      commandName: "theme remove",
      example: "nexpress theme remove @nexpress/theme-magazine",
    });

    expect(result).toEqual({
      ok: false,
      message:
        "theme remove requires a theme package name. Example: nexpress theme remove @nexpress/theme-magazine",
    });
  });
});
