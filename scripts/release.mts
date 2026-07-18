import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findUnpublishedWorkspacePackages,
  readPublishableWorkspacePackages,
  verifyPublishedWorkspacePackages,
} from "./published-release-contract.mjs";

function run(command: string, args: string[], repoRoot: string): void {
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

export async function release(repoRoot: string): Promise<void> {
  const packages = readPublishableWorkspacePackages(repoRoot);
  const unpublished = await findUnpublishedWorkspacePackages(packages);
  if (unpublished.length === 0) {
    console.log("[release] every workspace version is already published; nothing to do.");
    return;
  }

  console.log(
    `[release] publishing ${unpublished.length} workspace version(s):\n${unpublished
      .map((pkg) => `  - ${pkg.name}@${pkg.version}`)
      .join("\n")}`,
  );
  run("pnpm", ["test:repo"], repoRoot);
  run("pnpm", ["build"], repoRoot);
  run("pnpm", ["typecheck"], repoRoot);
  run("pnpm", ["exec", "changeset", "publish", "--no-git-tag"], repoRoot);

  await verifyPublishedWorkspacePackages(packages);
  console.log(`[release] verified ${packages.length} package manifests and attestations on npm.`);
  run("pnpm", ["exec", "tsx", "scripts/tag-release.mts"], repoRoot);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  release(resolve(import.meta.dirname, "..")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
