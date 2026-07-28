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

interface RegistryPackageMetadata {
  "dist-tags"?: unknown;
  versions?: unknown;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function registryPackageUrl(packageName: string): string {
  const encodedName = packageName.startsWith("@")
    ? packageName.replace("/", "%2f")
    : encodeURIComponent(packageName);
  return `https://registry.npmjs.org/${encodedName}`;
}

async function readRegistryPackage(
  packageName: string,
  fetchImpl: typeof fetch,
): Promise<RegistryPackageMetadata> {
  const response = await fetchImpl(registryPackageUrl(packageName), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${packageName}: registry returned HTTP ${response.status}`);
  }
  return (await response.json()) as RegistryPackageMetadata;
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
      const metadata = await readRegistryPackage(pkg.name, fetchImpl);
      const versions = asRecord(metadata.versions);
      return {
        name: pkg.name,
        previousVersionExists: versions?.[previousVersion] !== undefined,
        deprecationMessage: deprecationMessage(pkg.name, previousVersion, targetVersion),
      };
    }),
  );
}

function collectRepairProblems(
  plans: PackageRepairPlan[],
  metadataByName: Map<string, RegistryPackageMetadata>,
  previousVersion: string,
  targetVersion: string,
): string[] {
  const problems: string[] = [];
  for (const plan of plans) {
    const metadata = metadataByName.get(plan.name);
    const distTags = asRecord(metadata?.["dist-tags"]);
    if (distTags?.latest !== targetVersion) {
      problems.push(
        `${plan.name}: latest is ${String(distTags?.latest)}, expected ${targetVersion}`,
      );
    }

    if (!plan.previousVersionExists) continue;
    const versions = asRecord(metadata?.versions);
    const previous = asRecord(versions?.[previousVersion]);
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
    const metadata = await Promise.all(
      plans.map(
        async (plan) => [plan.name, await readRegistryPackage(plan.name, fetchImpl)] as const,
      ),
    );
    problems = collectRepairProblems(plans, new Map(metadata), previousVersion, targetVersion);
    if (problems.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`Release repair verification timed out:\n${problems.join("\n")}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}
