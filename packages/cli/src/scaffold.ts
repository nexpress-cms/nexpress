import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import pc from "picocolors";

import type { ProjectConfig } from "./prompts.js";
import { getProjectFiles } from "./templates.js";
import { generateSecret } from "./utils.js";

export async function scaffoldProject(config: ProjectConfig): Promise<void> {
  const targetDir = path.resolve(process.cwd(), config.projectName);

  await ensureTargetDirectory(targetDir);

  const secret = generateSecret();
  const files = getProjectFiles({
    ...config,
    secret,
  });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(targetDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  printSuccess(config.projectName, config.dockerSetup);
}

async function ensureTargetDirectory(targetDir: string): Promise<void> {
  const targetStats = await stat(targetDir).catch(() => null);

  if (!targetStats) {
    await mkdir(targetDir, { recursive: true });
    return;
  }

  if (!targetStats.isDirectory()) {
    throw new Error(`Target path exists and is not a directory: ${targetDir}`);
  }

  const entries = await readdir(targetDir);

  if (entries.length > 0) {
    throw new Error(`Target directory already exists and is not empty: ${targetDir}`);
  }
}

function printSuccess(projectName: string, dockerSetup: boolean): void {
  const nextSteps = [
    `  cd ${projectName}`,
    "  pnpm install        (or npm install)",
    ...(dockerSetup ? ["  docker compose -f docker/docker-compose.yml up -d db"] : []),
    "  pnpm dev",
  ];

  console.log(`${pc.green("✓")} Project created at ./${projectName}`);
  console.log("\nNext steps:");

  for (const step of nextSteps) {
    console.log(step);
  }

  console.log("\nAdmin: http://localhost:3000/admin");
}
