import { execFileSync } from "node:child_process";

import type { NpPublishedWorkspacePackage } from "./published-release-contract.mjs";

interface RepairOptions {
  execFile?: typeof execFileSync;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
}

interface PackageRepairPlan {
  name: string;
  previousVersionExists: boolean;
  deprecationMessage: string;
}

interface RegistryPackageVersionMetadata {
  deprecated?: unknown;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function encodedPackageName(packageName: string): string {
  return encodeURIComponent(packageName);
}

function registryPackageVersionUrl(packageName: string, version: string): string {
  return `https://registry.npmjs.org/${encodedPackageName(packageName)}/${encodeURIComponent(version)}`;
}

function registryPackageDistTagsUrl(packageName: string): string {
  return `https://registry.npmjs.org/-/package/${encodedPackageName(packageName)}/dist-tags`;
}

async function readRegistryJson(
  url: string,
  label: string,
  fetchImpl: typeof fetch,
  allowNotFound = false,
): Promise<unknown | null> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    throw new Error(`${label}: registry returned HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

async function readRegistryPackageVersion(
  packageName: string,
  version: string,
  fetchImpl: typeof fetch,
  allowNotFound = false,
): Promise<RegistryPackageVersionMetadata | null> {
  const value = await readRegistryJson(
    registryPackageVersionUrl(packageName, version),
    `${packageName}@${version}`,
    fetchImpl,
    allowNotFound,
  );
  return value === null ? null : (value as RegistryPackageVersionMetadata);
}

async function readRegistryPackageDistTags(
  packageName: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const value = await readRegistryJson(
    registryPackageDistTagsUrl(packageName),
    `${packageName} dist-tags`,
    fetchImpl,
  );
  const distTags = asRecord(value);
  if (!distTags) {
    throw new Error(`${packageName}: registry dist-tags are not an object`);
  }
  return distTags;
}

function deprecationMessage(packageName: string, previousVersion: string, targetVersion: string) {
  return `Accidental ${packageName}@${previousVersion} release; use ${packageName}@${targetVersion}.`;
}

export function validateAccidentalFamilyReleaseRepair(
  packages: NpPublishedWorkspacePackage[],
  previousVersion: string,
  targetVersion: string,
): NpPublishedWorkspacePackage[] {
  if (!VERSION_PATTERN.test(previousVersion) || !VERSION_PATTERN.test(targetVersion)) {
    throw new Error("Release repair versions must be exact semver values.");
  }
  if (previousVersion === targetVersion) {
    throw new Error("Release repair cannot deprecate its target version.");
  }

  const family = packages.filter((pkg) => pkg.name.startsWith("@nexpress/"));
  if (family.length === 0) {
    throw new Error("Release repair requires at least one @nexpress/* package.");
  }
  const mismatched = family.filter((pkg) => pkg.version !== targetVersion);
  if (mismatched.length > 0) {
    throw new Error(
      `Release repair target ${targetVersion} does not match: ${mismatched
        .map((pkg) => `${pkg.name}@${pkg.version}`)
        .join(", ")}`,
    );
  }
  return family;
}

export async function planAccidentalFamilyReleaseRepair(
  packages: NpPublishedWorkspacePackage[],
  previousVersion: string,
  targetVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PackageRepairPlan[]> {
  const family = validateAccidentalFamilyReleaseRepair(packages, previousVersion, targetVersion);
  return Promise.all(
    family.map(async (pkg) => {
      const previous = await readRegistryPackageVersion(pkg.name, previousVersion, fetchImpl, true);
      return {
        name: pkg.name,
        previousVersionExists: previous !== null,
        deprecationMessage: deprecationMessage(pkg.name, previousVersion, targetVersion),
      };
    }),
  );
}

function collectRepairProblems(
  plans: PackageRepairPlan[],
  distTagsByName: Map<string, Record<string, unknown>>,
  previousVersionsByName: Map<string, RegistryPackageVersionMetadata | null>,
  previousVersion: string,
  targetVersion: string,
): string[] {
  const problems: string[] = [];
  for (const plan of plans) {
    const distTags = distTagsByName.get(plan.name);
    if (distTags?.latest !== targetVersion) {
      problems.push(
        `${plan.name}: latest is ${String(distTags?.latest)}, expected ${targetVersion}`,
      );
    }

    if (!plan.previousVersionExists) continue;
    const previous = previousVersionsByName.get(plan.name);
    if (previous?.deprecated !== plan.deprecationMessage) {
      problems.push(`${plan.name}@${previousVersion}: deprecation message is not synchronized`);
    }
  }
  return problems;
}

export async function repairAccidentalFamilyRelease(
  packages: NpPublishedWorkspacePackage[],
  previousVersion: string,
  targetVersion: string,
  options: RepairOptions = {},
): Promise<void> {
  const execFile = options.execFile ?? execFileSync;
  const fetchImpl = options.fetchImpl ?? fetch;
  const plans = await planAccidentalFamilyReleaseRepair(
    packages,
    previousVersion,
    targetVersion,
    fetchImpl,
  );

  for (const plan of plans) {
    if (plan.previousVersionExists) {
      execFile("npm", ["deprecate", `${plan.name}@${previousVersion}`, plan.deprecationMessage], {
        stdio: "inherit",
      });
    }
    execFile("npm", ["dist-tag", "add", `${plan.name}@${targetVersion}`, "latest"], {
      stdio: "inherit",
    });
  }

  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let problems: string[] = [];
  while (true) {
    const distTags = new Map(
      await Promise.all(
        plans.map(
          async (plan) =>
            [plan.name, await readRegistryPackageDistTags(plan.name, fetchImpl)] as const,
        ),
      ),
    );
    const previousVersions = new Map(
      await Promise.all(
        plans.map(
          async (plan) =>
            [
              plan.name,
              plan.previousVersionExists
                ? await readRegistryPackageVersion(plan.name, previousVersion, fetchImpl)
                : null,
            ] as const,
        ),
      ),
    );
    problems = collectRepairProblems(
      plans,
      distTags,
      previousVersions,
      previousVersion,
      targetVersion,
    );
    if (problems.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`Release repair verification timed out:\n${problems.join("\n")}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}
