import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findUnpublishedWorkspacePackages,
  readPublishableWorkspacePackages,
  verifyPublishedWorkspacePackages,
  verifyWorkspacePackageRegistryVisibility,
  type NpPublishedWorkspacePackage,
} from "./published-release-contract.mjs";

const maxBootstrapPackageCount = 50;

export function initializeChangesetsOutputFile(outputPath = process.env.CHANGESETS_OUTPUT): void {
  if (!outputPath) return;
  // changesets/action v2 always reads this NDJSON file after a custom publish
  // script returns. Our verified wrapper can legitimately short-circuit before
  // invoking Changesets CLI when every workspace version is already public;
  // an empty file records that no packages were published without a warning.
  writeFileSync(outputPath, "", { encoding: "utf8", mode: 0o600 });
}

function run(command: string, args: string[], repoRoot: string): void {
  // Keep the caller environment explicit: changesets/action v2 injects
  // CHANGESETS_OUTPUT into the custom publish script and Changesets CLI v3
  // consumes it when invoked below. Other release credentials are narrowed
  // separately before this helper runs.
  execFileSync(command, args, { cwd: repoRoot, env: process.env, stdio: "inherit" });
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

export function parseNpmBootstrapPackageNames(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return [];
  if (value.length > 4_096) {
    throw new Error("NPM_BOOTSTRAP_PACKAGES must not exceed 4096 characters.");
  }

  const names = value
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length > maxBootstrapPackageCount) {
    throw new Error(
      `NPM_BOOTSTRAP_PACKAGES must contain at most ${maxBootstrapPackageCount} package names.`,
    );
  }
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    throw new Error(`NPM_BOOTSTRAP_PACKAGES contains duplicate ${duplicate}.`);
  }
  return names;
}

export function selectNpmBootstrapPackages(
  packages: NpPublishedWorkspacePackage[],
  packageNames: string[],
): NpPublishedWorkspacePackage[] {
  const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  return packageNames.map((name) => {
    const pkg = packagesByName.get(name);
    if (!pkg) throw new Error(`Bootstrap package ${name} is not a publishable workspace.`);
    return pkg;
  });
}

export function npmTrustedPublisherAccessUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${packageName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}/access`;
}

interface BootstrapNpmPackagesOptions {
  packages: NpPublishedWorkspacePackage[];
  unpublished: NpPublishedWorkspacePackage[];
  token: string;
  publishPackage?: (pkg: NpPublishedWorkspacePackage) => void | Promise<void>;
  verifyPublished?: (packages: NpPublishedWorkspacePackage[]) => Promise<void>;
  verifyVisibility?: (packages: NpPublishedWorkspacePackage[]) => Promise<void>;
}

export async function bootstrapNpmPackages({
  packages,
  unpublished,
  token,
  publishPackage = (pkg) =>
    run("pnpm", ["publish", "--access", "public", "--no-git-checks"], pkg.directory),
  verifyPublished = verifyPublishedWorkspacePackages,
  verifyVisibility = verifyWorkspacePackageRegistryVisibility,
}: BootstrapNpmPackagesOptions): Promise<void> {
  if (packages.length === 0) return;

  const unpublishedNames = new Set(unpublished.map((pkg) => pkg.name));
  const publishErrors: unknown[] = [];
  for (const bootstrapPackage of packages) {
    if (!unpublishedNames.has(bootstrapPackage.name)) {
      console.log(
        `[release] ${bootstrapPackage.name}@${bootstrapPackage.version} is already published; skipping bootstrap publish.`,
      );
      continue;
    }

    console.log(`[release] bootstrapping new npm package ${bootstrapPackage.name}.`);
    try {
      await withNodeAuthToken(token, () => publishPackage(bootstrapPackage));
    } catch (error) {
      publishErrors.push(
        new Error(`${bootstrapPackage.name}: bootstrap publish command failed`, { cause: error }),
      );
    }
  }

  try {
    await verifyPublished(packages);
    await verifyVisibility(packages);
  } catch (verificationError) {
    if (publishErrors.length > 0) {
      throw new AggregateError(
        [...publishErrors, verificationError],
        "One or more npm bootstrap publishes failed and the registry did not converge.",
      );
    }
    throw verificationError;
  }
  if (publishErrors.length > 0) {
    console.warn(
      `[release] ${publishErrors.length} bootstrap publish command(s) exited non-zero, but every explicitly authorized package converged in npm; continuing.`,
    );
  }
}

function printTrustedPublisherChecklist(packages: NpPublishedWorkspacePackage[]): void {
  if (packages.length === 0) return;
  console.log("[release] first-publish follow-up — register this workflow as Trusted Publisher:");
  console.log(
    "  GitHub Actions · nexpress-cms/nexpress · release.yml · environment name left blank",
  );
  for (const pkg of packages) {
    console.log(`  - ${pkg.name}: ${npmTrustedPublisherAccessUrl(pkg.name)}`);
  }
  console.log(
    "[release] then delete NPM_BOOTSTRAP_TOKEN and NPM_BOOTSTRAP_PACKAGES and revoke the temporary npm token.",
  );
}

export async function release(repoRoot: string): Promise<void> {
  initializeChangesetsOutputFile();
  const bootstrapToken = process.env.NODE_AUTH_TOKEN?.trim() || undefined;
  delete process.env.NODE_AUTH_TOKEN;
  const bootstrapPackageNames = parseNpmBootstrapPackageNames(
    process.env.NP_NPM_BOOTSTRAP_PACKAGES,
  );
  if (bootstrapPackageNames.length > 0 && !bootstrapToken) {
    throw new Error(
      "First publish requires the temporary NPM_BOOTSTRAP_TOKEN secret when NPM_BOOTSTRAP_PACKAGES is set.",
    );
  }
  if (bootstrapToken && bootstrapPackageNames.length === 0) {
    throw new Error(
      "NPM_BOOTSTRAP_TOKEN is set without an explicit NPM_BOOTSTRAP_PACKAGES allowlist.",
    );
  }

  const packages = readPublishableWorkspacePackages(repoRoot);
  const unpublished = await findUnpublishedWorkspacePackages(packages);
  const bootstrapPackages = selectNpmBootstrapPackages(packages, bootstrapPackageNames);

  if (unpublished.length === 0) {
    if (bootstrapToken) {
      await bootstrapNpmPackages({
        packages: bootstrapPackages,
        unpublished,
        token: bootstrapToken,
      });
      printTrustedPublisherChecklist(bootstrapPackages);
    }
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

  if (bootstrapToken) {
    await bootstrapNpmPackages({
      packages: bootstrapPackages,
      unpublished,
      token: bootstrapToken,
    });
    printTrustedPublisherChecklist(bootstrapPackages);
  }

  let publishError: unknown;
  try {
    run("pnpm", ["exec", "changeset", "publish", "--no-git-tag"], repoRoot);
  } catch (error) {
    publishError = error;
  }
  try {
    await verifyPublishedWorkspacePackages(packages);
  } catch (verificationError) {
    if (publishError) {
      throw new AggregateError(
        [publishError, verificationError],
        "Changesets publish failed and the exact registry contract did not converge.",
      );
    }
    throw verificationError;
  }
  if (publishError) {
    console.warn(
      "[release] Changesets exited non-zero, but every exact package manifest and provenance attestation is present; continuing.",
    );
  }
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
