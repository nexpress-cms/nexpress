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

  for (const [relativePath, file] of Object.entries(files)) {
    const absolutePath = path.join(targetDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    if (file.encoding === "base64") {
      await writeFile(absolutePath, Buffer.from(file.content, "base64"));
    } else {
      await writeFile(absolutePath, file.content, "utf8");
    }
  }

  printSuccess(config.projectName, config.dockerSetup, config.localMode ?? false);
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

function printSuccess(projectName: string, dockerSetup: boolean, localMode: boolean): void {
  const installStep = localMode
    ? "  pnpm install         (run from the monorepo root — uses workspace:* links)"
    : "  pnpm install        (or npm install)";
  // `pnpm run setup`, not `pnpm setup` — `pnpm setup` is a pnpm
  // built-in (installs pnpm itself) and shadows our package script.
  const setupStep = localMode
    ? `  pnpm --filter ${projectName} run setup`
    : "  pnpm run setup      (browser env wizard — DB / secret / storage)";
  const devStep = localMode ? `  pnpm --filter ${projectName} dev` : "  pnpm dev";
  const nextSteps = [
    `  cd ${projectName}`,
    installStep,
    ...(dockerSetup ? ["  docker compose -f docker/docker-compose.yml up -d db"] : []),
    setupStep,
    devStep,
  ];

  console.log(`${pc.green("✓")} Project created at ./${projectName}`);

  if (localMode) {
    console.log(
      pc.yellow(
        "  Local mode: @nexpress/* deps use workspace:*. Scaffold inside a NexPress monorepo app folder.",
      ),
    );
  }

  console.log("\nNext steps:");

  for (const step of nextSteps) {
    console.log(step);
  }

  console.log(
    "\nAdmin: http://localhost:3000/admin (the first-boot wizard collects your admin account)",
  );
}
