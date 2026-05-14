import prompts from "prompts";

import { formatProjectName } from "./utils.js";

export interface ProjectConfig {
  projectName: string;
  includeExampleContent: boolean;
  dockerSetup: boolean;
  /**
   * Id of the built-in theme the scaffold should pre-select for the
   * first-boot setup wizard. The wizard ALSO renders a picker — this
   * value just seeds its initial selection via `NP_ADMIN_THEME` in
   * the generated `.env`. The bundled-themes prebake makes swapping
   * migration-free, so no choice here is binding.
   */
  themeId: string;
  localMode?: boolean;
}

/**
 * CLI flags collected by `parseCliArgs` in index.ts. Anything provided
 * here pre-fills the matching question and the prompt for it is skipped.
 * `yes` is the umbrella "use defaults for the rest" switch — it kicks
 * in automatically when stdin isn't a TTY (CI, piped scaffolds, …)
 * because `prompts` would otherwise hang waiting for input that never
 * arrives.
 */
export interface CliFlags {
  projectName?: string;
  includeExampleContent?: boolean;
  dockerSetup?: boolean;
  /** `--theme <id>` — must match a built-in theme id (see `BUILTIN_THEMES`). */
  themeId?: string;
  yes?: boolean;
}

/**
 * Static list of built-in theme options for the scaffold picker.
 *
 * Hardcoded here (not imported from `@nexpress/app/config-defaults`)
 * because the CLI binary runs BEFORE the project is created — at
 * scaffold time nothing is `pnpm add`'d yet, so theme packages
 * aren't installable to introspect. Mirrors `defaultThemes` from
 * `@nexpress/app/config-defaults` and must be kept in sync when a
 * built-in theme is added or renamed.
 *
 * Third-party themes don't appear here; the operator picks them
 * later through the admin's Appearance panel after `pnpm nexpress
 * theme add @vendor/theme-foo`.
 */
export interface BuiltinThemeOption {
  id: string;
  name: string;
  description: string;
}

export const BUILTIN_THEMES: BuiltinThemeOption[] = [
  {
    id: "default",
    name: "Default",
    description: "Clean, modern marketing layout. Good starting point for most sites.",
  },
  {
    id: "magazine",
    name: "Magazine",
    description: "Editorial layout — display-serif masthead, feature-article posts.",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Minimal portfolio shell — dark-on-light, project-focused.",
  },
  {
    id: "docs",
    name: "Docs",
    description: "Documentation layout — sidebar nav, version selector, search.",
  },
];

const DEFAULTS = {
  projectName: "my-nexpress-site",
  includeExampleContent: true,
  dockerSetup: true,
  themeId: BUILTIN_THEMES[0]!.id,
};

export async function promptForProjectConfig(
  flags: CliFlags = {},
): Promise<ProjectConfig> {
  const yes = flags.yes ?? !process.stdin.isTTY;

  // Each prompt is skipped when (a) the operator passed a flag, or
  // (b) `yes` mode is on (explicit `--yes`, or non-TTY auto-yes).
  // Otherwise we ask interactively. Order matches the original UX so
  // a partial flag set still feels familiar.
  const questions: prompts.PromptObject[] = [];

  const projectNameProvided = typeof flags.projectName === "string" && flags.projectName.length > 0;
  if (!projectNameProvided && !yes) {
    questions.push({
      type: "text",
      name: "projectName",
      message: "Project name",
      initial: DEFAULTS.projectName,
      format: (value: string) => formatProjectName(value),
      validate: (value: string) => {
        if (formatProjectName(value).length === 0) {
          return "Project name is required";
        }
        return true;
      },
    });
  }

  if (flags.includeExampleContent === undefined && !yes) {
    questions.push({
      type: "confirm",
      name: "includeExampleContent",
      message: "Include example content?",
      initial: DEFAULTS.includeExampleContent,
    });
  }

  if (flags.dockerSetup === undefined && !yes) {
    questions.push({
      type: "confirm",
      name: "dockerSetup",
      message: "Docker setup?",
      initial: DEFAULTS.dockerSetup,
    });
  }

  const themeProvided = typeof flags.themeId === "string" && flags.themeId.length > 0;
  if (themeProvided && !BUILTIN_THEMES.some((t) => t.id === flags.themeId)) {
    // Surface the misspelling at flag-validation time rather than
    // letting the scaffold ship with a typo'd `NP_ADMIN_THEME` that
    // silently falls back at wizard time. Lists the valid ids so the
    // operator can retry without consulting docs.
    const known = BUILTIN_THEMES.map((t) => t.id).join(", ");
    throw new Error(
      `Unknown --theme value: '${flags.themeId}'. Built-in themes: ${known}.`,
    );
  }
  if (!themeProvided && !yes) {
    questions.push({
      type: "select",
      name: "themeId",
      message: "Theme",
      // Switching themes from the admin's Appearance panel is
      // migration-free thanks to the bundled-themes prebake, so
      // first-pick isn't a commitment.
      hint: "You can change this later from /admin/appearance",
      choices: BUILTIN_THEMES.map((t) => ({
        title: t.name,
        description: t.description,
        value: t.id,
      })),
      initial: 0,
    });
  }

  const response =
    questions.length === 0
      ? ({} as Record<string, unknown>)
      : ((await prompts(questions, {
          onCancel: () => {
            throw new Error("Scaffolding cancelled.");
          },
        })) as Record<string, unknown>);

  const rawProjectName =
    flags.projectName ??
    (typeof response.projectName === "string" ? response.projectName : DEFAULTS.projectName);
  const projectName = formatProjectName(rawProjectName);
  if (projectName.length === 0) {
    throw new Error("Project name is required");
  }

  return {
    projectName,
    includeExampleContent:
      flags.includeExampleContent ??
      (typeof response.includeExampleContent === "boolean"
        ? response.includeExampleContent
        : DEFAULTS.includeExampleContent),
    dockerSetup:
      flags.dockerSetup ??
      (typeof response.dockerSetup === "boolean"
        ? response.dockerSetup
        : DEFAULTS.dockerSetup),
    themeId:
      flags.themeId ??
      (typeof response.themeId === "string" ? response.themeId : DEFAULTS.themeId),
  } satisfies ProjectConfig;
}
