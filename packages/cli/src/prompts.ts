import prompts from "prompts";

import { formatProjectName } from "./utils.js";

export type DatabaseMode = "local-docker" | "remote-url";
export type StorageMode = "local" | "s3";

export interface ProjectConfig {
  projectName: string;
  databaseMode: DatabaseMode;
  storageMode: StorageMode;
  includeExampleContent: boolean;
  dockerSetup: boolean;
}

export async function promptForProjectConfig(
  initialProjectName?: string,
): Promise<ProjectConfig> {
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
        type: "select",
        name: "databaseMode",
        message: "Database",
        choices: [
          {
            title: "Local Docker (recommended)",
            value: "local-docker",
          },
          {
            title: "Remote PostgreSQL URL",
            value: "remote-url",
          },
        ],
        initial: 0,
      },
      {
        type: "select",
        name: "storageMode",
        message: "Storage",
        choices: [
          {
            title: "Local filesystem (recommended)",
            value: "local",
          },
          {
            title: "S3/MinIO",
            value: "s3",
          },
        ],
        initial: 0,
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
    databaseMode: response.databaseMode,
    storageMode: response.storageMode,
    includeExampleContent: response.includeExampleContent,
    dockerSetup: response.dockerSetup,
  } satisfies ProjectConfig;
}
