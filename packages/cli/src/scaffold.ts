import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import pc from "picocolors";

import type { ProjectConfig } from "./prompts.js";
import { getProjectFiles } from "./templates.js";
import { dbPortFromProject, generateSecret } from "./utils.js";

export async function scaffoldProject(config: ProjectConfig): Promise<void> {
  const targetDir = path.resolve(process.cwd(), config.projectName);

  await ensureTargetDirectory(targetDir);

  const secret = generateSecret();
  const dbPort = dbPortFromProject(config.projectName);
  const files = getProjectFiles({
    ...config,
    secret,
    dbPort,
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

export function buildSuccessLines(
  projectName: string,
  dockerSetup: boolean,
  localMode: boolean,
): string[] {
  const installStep = localMode
    ? "  pnpm install         (run from the monorepo root — uses workspace:* links)"
    : "  pnpm install        (or npm install)";
  // `pnpm run setup`, not `pnpm setup` — `pnpm setup` is a pnpm
  // built-in (installs pnpm itself) and shadows our package script.
  const setupStep = localMode
    ? `  pnpm --filter ${projectName} run setup`
    : "  pnpm run setup      (wizard: DB / secret / storage / migrations)";
  const devStep = localMode ? `  pnpm --filter ${projectName} dev` : "  pnpm dev";
  const nextSteps = [
    `  cd ${projectName}`,
    installStep,
    ...(dockerSetup ? ["  docker compose -f docker/docker-compose.yml up -d db"] : []),
    setupStep,
    devStep,
  ];
  const lines = [`${pc.green("✓")} Project created at ./${projectName}`];

  if (localMode) {
    lines.push(
      pc.yellow(
        "  Local mode: @nexpress/* deps use workspace:*. Scaffold inside a NexPress monorepo app folder.",
      ),
    );
  }

  lines.push("", "Next steps:", ...nextSteps);
  lines.push(
    "",
    "Admin: http://localhost:3000/admin (the first-boot wizard collects your admin account)",
    "Status: pnpm run ops:status -- --brief --no-color",
    "Jobs: pnpm run ops:jobs -- --brief --no-color",
    "Storage: pnpm run ops:storage -- --brief --no-color",
    "Plugins: pnpm run ops:plugins -- doctor --brief --no-color",
    "Stuck? pnpm run doctor",
    "",
    "Deploy preflight:",
    "  pnpm run ops:preflight -- --target vercel --brief --no-color",
    "  pnpm run ops:health -- --url http://localhost:3000 --brief --no-color",
    "  pnpm run doctor:prod -- --target vercel --fix-plan   # if blocked",
    "Deploy guide: https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md",
  );

  return lines;
}

function printSuccess(projectName: string, dockerSetup: boolean, localMode: boolean): void {
  for (const line of buildSuccessLines(projectName, dockerSetup, localMode)) {
    console.log(line);
  }
}
