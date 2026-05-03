import prompts from "prompts";

import { formatProjectName } from "./utils.js";

export interface ProjectConfig {
  projectName: string;
  includeExampleContent: boolean;
  dockerSetup: boolean;
  localMode?: boolean;
}

export async function promptForProjectConfig(
  initialProjectName?: string,
): Promise<ProjectConfig> {
  // Database / storage choices used to live here, but `pnpm run setup`
  // (the post-scaffold env wizard) owns those now and writes `.env`
  // directly. Leaving the prompts here forced the operator to make
  // the same decision twice. The scaffolded `nexpress.config.ts`
  // reads `NX_STORAGE_ADAPTER` at runtime, so picking storage at
  // setup time is enough.
  const response = await prompts(
    [
      {
        type: "text",
        name: "projectName",
        message: "Project name",
        initial: initialProjectName ?? "my-nexpress-site",
        format: (value: string) => formatProjectName(value),
        validate: (value: string) => {
          if (formatProjectName(value).length === 0) {
            return "Project name is required";
          }
          return true;
        },
      },
      {
        type: "confirm",
        name: "includeExampleContent",
        message: "Include example content?",
        initial: true,
      },
      {
        type: "confirm",
        name: "dockerSetup",
        message: "Docker setup?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        throw new Error("Scaffolding cancelled.");
      },
    },
  );

  return {
    projectName: formatProjectName(response.projectName),
    includeExampleContent: response.includeExampleContent,
    dockerSetup: response.dockerSetup,
  } satisfies ProjectConfig;
}
