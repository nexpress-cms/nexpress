import prompts from "prompts";

import { formatProjectName } from "./utils.js";

export interface ProjectConfig {
  projectName: string;
  includeExampleContent: boolean;
  dockerSetup: boolean;
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
  yes?: boolean;
}

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
  } satisfies ProjectConfig;
}
