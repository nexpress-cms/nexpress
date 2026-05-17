import prompts from "prompts";

import { formatProjectName } from "./utils.js";

export interface ProjectConfig {
  projectName: string;
  includeExampleContent: boolean;
  dockerSetup: boolean;
  /**
   * Picked starter / theme id. Set from `--starter`, `--theme`, or
   * the interactive starter prompt. Written into the scaffold's
   * `.env` as `NP_ADMIN_THEME=<id>`; the first-boot admin setup
   * wizard at `/admin/setup` reads it as the picker's initial
   * selection. Operator can still override later in the wizard or
   * via the admin theme switcher.
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
 * `themeId` accepts the picked starter at scaffold time: from
 * `--starter <id>` (friendly alias, e.g. `blog`), from `--theme <id>`
 * (raw theme id, e.g. `default`), or — when no flag is supplied and
 * stdin is a TTY — from the interactive starter prompt.
 */
export interface CliFlags {
  projectName?: string;
  includeExampleContent?: boolean;
  dockerSetup?: boolean;
  /**
   * Canonical theme id (post-`resolveStarter`) for the picked
   * starter. Validated against `BUILTIN_THEME_IDS`.
   */
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

/**
 * Friendly starter aliases that map to a different theme id. Only
 * real aliases live here — `magazine`, `portfolio`, `docs` are both
 * the starter name AND the theme id, so they fall through
 * `resolveStarter` unchanged. The `blog` → `default` mapping is the
 * only case where the operator-facing name diverges from the
 * underlying theme id.
 */
const STARTER_TO_THEME: Record<string, string> = {
  blog: "default",
};

/**
 * Resolve a `--starter` value to the canonical theme id. Friendly
 * aliases (`blog`) map to their theme; raw theme ids pass through.
 * Unknown values fall through to the existing `BUILTIN_THEME_IDS`
 * validator, which produces the standard error message naming the
 * known ids — no need for a parallel error path here.
 */
export function resolveStarter(value: string): string {
  return STARTER_TO_THEME[value] ?? value;
}

/**
 * Starter choices rendered in the interactive picker. `title` is the
 * friendly label, `value` is the underlying theme id written to
 * `.env` as `NP_ADMIN_THEME`. Order matches a first-time operator's
 * likely path: a general blog is the safest default, then niche.
 */
const STARTER_OPTIONS: ReadonlyArray<{
  title: string;
  description: string;
  value: string;
}> = [
  {
    title: "Blog",
    description: "Home, about, blog, pricing, contact. Friendliest first pick.",
    value: "default",
  },
  {
    title: "Magazine",
    description: "Editorial multi-column layout with feature + dispatches column.",
    value: "magazine",
  },
  {
    title: "Portfolio",
    description: "Project grid with asymmetric layouts. Designers and agencies.",
    value: "portfolio",
  },
  {
    title: "Docs",
    description: "Sidebar + breadcrumbs, with kind:doc posts. Product / API docs.",
    value: "docs",
  },
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

  // Starter goes BEFORE "include example content" because the theme
  // is the whole-site shell, not just a seed knob. Even an operator
  // who declines the sample content still gets the picked theme's
  // header / footer / layout. Order in the prompt reflects that:
  // pick the site shape first, then opt into the demo content for it.
  if (flags.themeId === undefined && !yes) {
    questions.push({
      type: "select",
      name: "themeId",
      message: "Pick a starter",
      choices: STARTER_OPTIONS.map((option) => ({
        title: option.title,
        description: option.description,
        value: option.value,
      })),
      initial: 0,
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

  // Validate any flag-supplied id BEFORE asking the interactive
  // question — a typo'd `--theme=magaznie` should surface at flag
  // time rather than bake a typo'd `NP_ADMIN_THEME` into `.env` that
  // the wizard would silently fall back to the first registered
  // theme for. The interactive prompt is value-safe by construction
  // (operator picks from a fixed list), so it doesn't need to flow
  // through this gate.
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

  const pickedThemeId =
    flags.themeId ??
    (typeof response.themeId === "string" ? response.themeId : undefined);

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
    ...(pickedThemeId && pickedThemeId.length > 0
      ? { themeId: pickedThemeId }
      : {}),
  } satisfies ProjectConfig;
}
