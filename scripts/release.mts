import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findUnpublishedWorkspacePackages,
  readPublishableWorkspacePackages,
  verifyPublishedWorkspacePackages,
} from "./published-release-contract.mjs";
import {
  repairAccidentalFamilyRelease,
  validateAccidentalFamilyReleaseRepair,
} from "./npm-release-repair.mjs";

function run(command: string, args: string[], repoRoot: string): void {
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

async function withNodeAuthToken<T>(token: string, callback: () => T | Promise<T>): Promise<T> {
  const previousToken = process.env.NODE_AUTH_TOKEN;
  process.env.NODE_AUTH_TOKEN = token;
  try {
    return await callback();
  } finally {
    if (previousToken === undefined) {
      delete process.env.NODE_AUTH_TOKEN;
    } else {
      process.env.NODE_AUTH_TOKEN = previousToken;
    }
  }
}

export async function release(repoRoot: string): Promise<void> {
  const packages = readPublishableWorkspacePackages(repoRoot);
  const unpublished = await findUnpublishedWorkspacePackages(packages);
  const bootstrapPackageName = process.env.NP_NPM_BOOTSTRAP_PACKAGE;
  const bootstrapToken = process.env.NODE_AUTH_TOKEN;
  delete process.env.NODE_AUTH_TOKEN;
  const repairFrom = process.env.NP_RELEASE_REPAIR_FROM;
  const repairTo = process.env.NP_RELEASE_REPAIR_TO;
  const repairRequested = repairFrom !== undefined || repairTo !== undefined;

  if (bootstrapPackageName && !bootstrapToken) {
    throw new Error(
      `First publish of ${bootstrapPackageName} requires the temporary NPM_BOOTSTRAP_TOKEN secret.`,
    );
  }
  if (bootstrapPackageName && !packages.some((pkg) => pkg.name === bootstrapPackageName)) {
    throw new Error(`Bootstrap package ${bootstrapPackageName} is not a publishable workspace.`);
  }
  if (repairRequested && (!repairFrom || !repairTo || !bootstrapToken)) {
    throw new Error(
      "Release repair requires NP_RELEASE_REPAIR_FROM, NP_RELEASE_REPAIR_TO, and NPM_BOOTSTRAP_TOKEN.",
    );
  }
  if (repairFrom && repairTo) {
    validateAccidentalFamilyReleaseRepair(packages, repairFrom, repairTo);
  }

  if (unpublished.length === 0) {
    await verifyPublishedWorkspacePackages(packages);
    if (repairFrom && repairTo && bootstrapToken) {
      await withNodeAuthToken(bootstrapToken, () =>
        repairAccidentalFamilyRelease(packages, repairFrom, repairTo),
      );
      run("pnpm", ["exec", "tsx", "scripts/tag-release.mts"], repoRoot);
    } else {
      console.log("[release] every workspace version is already published; nothing to do.");
    }
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

  if (bootstrapPackageName && bootstrapToken) {
    const bootstrapPackage = unpublished.find((pkg) => pkg.name === bootstrapPackageName);
    if (bootstrapPackage) {
      console.log(`[release] bootstrapping new npm package ${bootstrapPackage.name}.`);
      await withNodeAuthToken(bootstrapToken, () =>
        run(
          "pnpm",
          ["publish", "--access", "public", "--no-git-checks"],
          bootstrapPackage.directory,
        ),
      );
      await verifyPublishedWorkspacePackages([bootstrapPackage]);
    }
  }

  run("pnpm", ["exec", "changeset", "publish", "--no-git-tag"], repoRoot);

  await verifyPublishedWorkspacePackages(packages);
  console.log(`[release] verified ${packages.length} package manifests and attestations on npm.`);
  if (repairFrom && repairTo && bootstrapToken) {
    await withNodeAuthToken(bootstrapToken, () =>
      repairAccidentalFamilyRelease(packages, repairFrom, repairTo),
    );
    console.log(
      `[release] deprecated the accidental ${repairFrom} family and restored latest=${repairTo}.`,
    );
  }
  run("pnpm", ["exec", "tsx", "scripts/tag-release.mts"], repoRoot);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  release(resolve(import.meta.dirname, "..")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
