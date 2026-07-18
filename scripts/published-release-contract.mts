import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface NpPublishedWorkspacePackage {
  name: string;
  version: string;
  directory: string;
}

interface WorkspaceRow {
  path?: unknown;
}

interface PackageManifest {
  name?: unknown;
  private?: boolean;
  version?: unknown;
}

interface RegistryInspection {
  errors: string[];
  unpublished: NpPublishedWorkspacePackage[];
}

interface RegistryOptions {
  fetchImpl?: typeof fetch;
  registryBaseUrl?: string;
}

interface VerifyOptions extends RegistryOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readPublishableWorkspacePackages(repoRoot: string): NpPublishedWorkspacePackage[] {
  const rows = JSON.parse(
    execFileSync("pnpm", ["m", "ls", "--json", "--depth=-1"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  ) as WorkspaceRow[];

  const packages: NpPublishedWorkspacePackage[] = [];
  for (const row of rows) {
    if (typeof row.path !== "string" || row.path.length === 0) continue;
    const directory = resolve(row.path);
    const manifest = JSON.parse(
      readFileSync(resolve(directory, "package.json"), "utf8"),
    ) as PackageManifest;
    if (manifest.private === true) continue;
    if (
      typeof manifest.name !== "string" ||
      manifest.name.length === 0 ||
      typeof manifest.version !== "string" ||
      manifest.version.length === 0
    ) {
      throw new Error(`Publishable workspace at ${directory} must declare name and version.`);
    }
    packages.push({ name: manifest.name, version: manifest.version, directory });
  }

  if (packages.length === 0) {
    throw new Error("Publishable workspace inventory must not be empty.");
  }

  const sorted = packages.sort((left, right) => left.name.localeCompare(right.name));
  const duplicate = sorted.find((pkg, index) => pkg.name === sorted[index - 1]?.name);
  if (duplicate) {
    throw new Error(`Publishable workspace inventory contains duplicate ${duplicate.name}.`);
  }
  return sorted;
}

export function analyzePublishedPackageMetadata(
  expected: Pick<NpPublishedWorkspacePackage, "name" | "version">,
  value: unknown,
): string[] {
  const errors: string[] = [];
  const metadata = asRecord(value);
  if (!metadata)
    return [`${expected.name}@${expected.version}: registry metadata is not an object`];

  if (metadata.name !== expected.name) {
    errors.push(`${expected.name}@${expected.version}: registry name is ${String(metadata.name)}`);
  }
  if (metadata.version !== expected.version) {
    errors.push(
      `${expected.name}@${expected.version}: registry version is ${String(metadata.version)}`,
    );
  }

  for (const field of dependencyFields) {
    const value = metadata[field];
    if (value === undefined) continue;
    const dependencies = asRecord(value);
    if (!dependencies) {
      errors.push(`${expected.name}@${expected.version}: ${field} is not an object`);
      continue;
    }
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (typeof specifier !== "string") {
        errors.push(`${expected.name}@${expected.version}: ${field}.${name} is not a string`);
      } else if (specifier.startsWith("workspace:")) {
        errors.push(`${expected.name}@${expected.version}: ${field}.${name} retains ${specifier}`);
      }
    }
  }

  const dist = asRecord(metadata.dist);
  if (typeof dist?.tarball !== "string" || dist.tarball.length === 0) {
    errors.push(`${expected.name}@${expected.version}: dist.tarball is missing`);
  }
  if (typeof dist?.integrity !== "string" || dist.integrity.length === 0) {
    errors.push(`${expected.name}@${expected.version}: dist.integrity is missing`);
  }
  const attestations = asRecord(dist?.attestations);
  const provenance = asRecord(attestations?.provenance);
  if (typeof provenance?.predicateType !== "string" || provenance.predicateType.length === 0) {
    errors.push(`${expected.name}@${expected.version}: provenance attestation is missing`);
  }

  return errors;
}

function registryMetadataUrl(
  packageName: string,
  version: string,
  registryBaseUrl: string,
): string {
  const encodedName = packageName.startsWith("@")
    ? packageName.replace("/", "%2f")
    : encodeURIComponent(packageName);
  return `${registryBaseUrl.replace(/\/$/, "")}/${encodedName}/${encodeURIComponent(version)}`;
}

async function inspectRegistryPackages(
  packages: NpPublishedWorkspacePackage[],
  options: RegistryOptions = {},
): Promise<RegistryInspection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const registryBaseUrl = options.registryBaseUrl ?? "https://registry.npmjs.org";
  const results = await Promise.all(
    packages.map(async (pkg) => {
      const url = registryMetadataUrl(pkg.name, pkg.version, registryBaseUrl);
      try {
        const response = await fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 404) return { pkg, unpublished: true, errors: [] };
        if (!response.ok) {
          return {
            pkg,
            unpublished: false,
            errors: [`${pkg.name}@${pkg.version}: registry returned HTTP ${response.status}`],
          };
        }
        const metadata = (await response.json()) as unknown;
        return {
          pkg,
          unpublished: false,
          errors: analyzePublishedPackageMetadata(pkg, metadata),
        };
      } catch (error) {
        return {
          pkg,
          unpublished: false,
          errors: [
            `${pkg.name}@${pkg.version}: registry request failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ],
        };
      }
    }),
  );

  return {
    errors: results.flatMap((result) => result.errors),
    unpublished: results.flatMap((result) => (result.unpublished ? [result.pkg] : [])),
  };
}

export async function findUnpublishedWorkspacePackages(
  packages: NpPublishedWorkspacePackage[],
  options: RegistryOptions = {},
): Promise<NpPublishedWorkspacePackage[]> {
  const inspection = await inspectRegistryPackages(packages, options);
  if (inspection.errors.length > 0) {
    throw new Error(`Published package contract failed:\n${inspection.errors.join("\n")}`);
  }
  return inspection.unpublished;
}

export async function verifyPublishedWorkspacePackages(
  packages: NpPublishedWorkspacePackage[],
  options: VerifyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let lastProblems: string[] = [];

  while (true) {
    const inspection = await inspectRegistryPackages(packages, options);
    lastProblems = [
      ...inspection.unpublished.map((pkg) => `${pkg.name}@${pkg.version}: not published`),
      ...inspection.errors,
    ];
    if (lastProblems.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`Published package verification timed out:\n${lastProblems.join("\n")}`);
    }

    console.warn(
      `[release] registry is not ready (${lastProblems.length} issue(s)); retrying in ${intervalMs}ms.`,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}
