import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ReleaseDocSources {
  readme: string;
  security: string;
  releasing: string;
}

interface ReleaseVersions {
  coreVersion: string;
  createNexpressVersion: string;
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

const exactVersionPattern = /^\d+\.\d+\.\d+$/;

function assertExactVersion(version: string, packageName: string): void {
  if (!exactVersionPattern.test(version)) {
    throw new Error(
      `${packageName} must have an exact stable semver version; received ${version}.`,
    );
  }
}

function replaceExactlyOnce(
  source: string,
  pattern: RegExp,
  replacement: string,
  label: string,
): string {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one release marker; found ${matches.length}.`);
  }
  return source.replace(pattern, replacement);
}

export function renderReleaseDocs(
  sources: ReleaseDocSources,
  versions: ReleaseVersions,
): ReleaseDocSources {
  assertExactVersion(versions.coreVersion, "@nexpress/core");
  assertExactVersion(versions.createNexpressVersion, "create-nexpress");

  const [major, minor] = versions.coreVersion.split(".");
  const releaseLine = `${major}.${minor}.x`;

  return {
    readme: replaceExactlyOnce(
      sources.readme,
      /Status — pre-1\.0 \(`v\d+\.\d+\.x`\)/,
      `Status — pre-1.0 (\`v${releaseLine}\`)`,
      "README.md",
    ),
    security: replaceExactlyOnce(
      sources.security,
      /current framework release line is\n`\d+\.\d+\.x`/,
      `current framework release line is\n\`${releaseLine}\``,
      "SECURITY.md",
    ),
    releasing: replaceExactlyOnce(
      sources.releasing,
      /\*\*Current published baseline:\*\* NexPress `\d+\.\d+\.\d+` and `create-nexpress \d+\.\d+\.\d+`\n\(tag `v\d+\.\d+\.\d+`\)\./,
      `**Current published baseline:** NexPress \`${versions.coreVersion}\` and \`create-nexpress ${versions.createNexpressVersion}\`\n(tag \`v${versions.coreVersion}\`).`,
      "docs/releasing.md",
    ),
  };
}

async function readVersion(path: string, expectedName: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as PackageManifest;
  if (manifest.name !== expectedName || typeof manifest.version !== "string") {
    throw new Error(`${path} must declare ${expectedName} with a version.`);
  }
  return manifest.version;
}

export async function syncReleaseDocs(repoRoot: string): Promise<void> {
  const paths = {
    readme: resolve(repoRoot, "README.md"),
    security: resolve(repoRoot, "SECURITY.md"),
    releasing: resolve(repoRoot, "docs/releasing.md"),
  };
  const sources = {
    readme: await readFile(paths.readme, "utf8"),
    security: await readFile(paths.security, "utf8"),
    releasing: await readFile(paths.releasing, "utf8"),
  };
  const rendered = renderReleaseDocs(sources, {
    coreVersion: await readVersion(
      resolve(repoRoot, "packages/core/package.json"),
      "@nexpress/core",
    ),
    createNexpressVersion: await readVersion(
      resolve(repoRoot, "packages/cli/package.json"),
      "create-nexpress",
    ),
  });

  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    if (sources[key] !== rendered[key]) {
      await writeFile(paths[key], rendered[key], "utf8");
      console.log(`[release-docs] synchronized ${key}.`);
    }
  }
}

const entrypoint = process.argv[1] ? realpathSync(resolve(process.argv[1])) : undefined;
if (entrypoint === realpathSync(fileURLToPath(import.meta.url))) {
  syncReleaseDocs(resolve(import.meta.dirname, "..")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
