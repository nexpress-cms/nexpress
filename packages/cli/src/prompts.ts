import prompts from "prompts";

import { formatProjectName } from "./utils.js";

export interface ProjectConfig {
  projectName: string;
  includeExampleContent: boolean;
  dockerSetup: boolean;
  /**
   * Optional pre-pick for the first-boot admin setup wizard. Only
   * set when the operator passes `--theme <id>` — there is no
   * interactive prompt for it. The id is written into the scaffold's
   * `.env` as `NP_ADMIN_THEME=<id>` so headless / CI installs (no
   * browser available for `/admin/setup`) can still ship a chosen
   * theme; the wizard reads the env var as the picker's initial
   * selection. Operators with a browser don't need to set this —
   * just open the wizard and pick.
   */
  themeId?: string;
  localMode?: boolean;
}

/**
 * CLI flags collected by `parseCliArgs` in index.ts. Anything provided
 * here pre-fills the matching question and the prompt for it is skipped.
 * `yes` is the umbrella "use defaults for the rest" switch — it kicks
 * in automatically when stdin isn't a TTY (CI, piped scaffolds, …)
 * because `prompts` would otherwise hang waiting for input that never
 * arrives.
 *
 * `themeId` is a flag-only knob. The full theme picker lives in the
 * first-boot admin wizard at `/admin/setup` (browser); this exists
 * solely so headless flows that can't reach the browser have a way
 * to commit the pick at scaffold time.
 */
export interface CliFlags {
  projectName?: string;
  includeExampleContent?: boolean;
  dockerSetup?: boolean;
  /** `--theme <id>` — validated against `BUILTIN_THEMES`. No prompt. */
  themeId?: string;
  yes?: boolean;
}

/**
 * Static list of built-in theme ids for `--theme` flag validation.
 * Hardcoded here (not imported from `@nexpress/app/config-defaults`)
 * because the CLI binary runs BEFORE the project is created — at
 * scaffold time nothing is `pnpm add`'d yet, so theme packages aren't
 * installable to introspect. Mirrors `defaultThemes` from
 * `@nexpress/app/config-defaults` and must be kept in sync when a
 * built-in theme is added or renamed.
 *
 * Third-party themes don't appear here — the operator installs them
 * later via `pnpm nexpress theme add @vendor/theme-foo`, then picks
 * them in the admin wizard.
 */
export const BUILTIN_THEME_IDS: readonly string[] = [
  "default",
  "magazine",
  "portfolio",
  "docs",
];

const DEFAULTS = {
  projectName: "my-nexpress-site",
  includeExampleContent: true,
  dockerSetup: true,
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

  // `--theme` is opt-in only — no prompt. Validate here so a typo
  // surfaces at flag time rather than baking a typo'd `NP_ADMIN_THEME`
  // into `.env` that the wizard would silently fall back to the
  // first registered theme for.
  if (typeof flags.themeId === "string" && flags.themeId.length > 0) {
    if (!BUILTIN_THEME_IDS.includes(flags.themeId)) {
      const known = BUILTIN_THEME_IDS.join(", ");
      throw new Error(
        `Unknown --theme value: '${flags.themeId}'. Built-in themes: ${known}.`,
      );
    }
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
    ...(typeof flags.themeId === "string" && flags.themeId.length > 0
      ? { themeId: flags.themeId }
      : {}),
  } satisfies ProjectConfig;
}
