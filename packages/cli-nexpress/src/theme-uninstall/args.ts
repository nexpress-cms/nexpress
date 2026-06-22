interface ParseOptions {
  commandName: string;
  example: string;
}

export interface ParsedThemeUninstallArgs {
  themePackage: string;
  flags: {
    dryRun: boolean;
    yes: boolean;
    withCollections: boolean;
    apply: boolean;
  };
}

export type ThemeUninstallArgsParseResult =
  | { ok: true; value: ParsedThemeUninstallArgs }
  | { ok: false; message: string };

export function parseThemeUninstallArgs(
  args: readonly string[],
  options: ParseOptions,
): ThemeUninstallArgsParseResult {
  let themePackage: string | undefined;
  let dryRun = false;
  let yes = false;
  let withCollections = false;
  let apply = false;

  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--with-collections") withCollections = true;
    else if (arg === "--apply") apply = true;
    else if (arg.startsWith("--")) {
      return { ok: false, message: `Unknown flag for ${options.commandName}: ${arg}` };
    } else if (themePackage === undefined) {
      themePackage = arg;
    } else {
      return { ok: false, message: `Unexpected positional: ${arg}` };
    }
  }

  if (!themePackage) {
    return {
      ok: false,
      message: `${options.commandName} requires a theme package name. Example: ${options.example}`,
    };
  }

  return {
    ok: true,
    value: {
      themePackage,
      flags: { dryRun, yes, withCollections, apply },
    },
  };
}
