import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PackageManifest {
  name?: string;
  private?: boolean;
  version?: string;
}

async function findPackageDirectories(root: string): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(root, entry.name);
    const files = await readdir(directory, { withFileTypes: true });
    if (files.some((file) => file.isFile() && file.name === "package.json")) {
      found.push(directory);
      continue;
    }
    found.push(...(await findPackageDirectories(directory)));
  }

  return found;
}

test("every published workspace package ships a README", async () => {
  const packageDirectories = await findPackageDirectories(resolve(repoRoot, "packages"));
  const issues: string[] = [];

  for (const directory of packageDirectories) {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "package.json"), "utf8"),
    ) as PackageManifest;
    if (manifest.private === true) continue;

    const files = await readdir(directory);
    if (!files.includes("README.md")) {
      issues.push(`missing: ${manifest.name ?? "(unnamed)"} (${relative(repoRoot, directory)})`);
      continue;
    }

    const readme = await readFile(resolve(directory, "README.md"), "utf8");
    const expectedHeading = `# ${manifest.name ?? "(unnamed)"}`;
    if (readme.split(/\r?\n/, 1)[0] !== expectedHeading) {
      issues.push(`heading: ${relative(repoRoot, directory)} must start with ${expectedHeading}`);
    }
  }

  assert.deepEqual(issues, []);
});

test("the live-guide index includes every top-level guide", async () => {
  const docsDirectory = resolve(repoRoot, "docs");
  const index = await readFile(resolve(docsDirectory, "README.md"), "utf8");
  const excluded = new Set(["README.md", "roadmap.md"]);
  const missing = (await readdir(docsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !excluded.has(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !index.includes(`](${name})`));

  assert.deepEqual(missing, []);
});

test("public status docs name the current pre-1.0 release line", async () => {
  const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");
  const security = await readFile(resolve(repoRoot, "SECURITY.md"), "utf8");
  const manifest = JSON.parse(
    await readFile(resolve(repoRoot, "packages/core/package.json"), "utf8"),
  ) as PackageManifest;
  const match = manifest.version?.match(/^(\d+)\.(\d+)\./);
  assert.ok(match, "@nexpress/core must have a semver version");
  const releaseLine = `${match[1]}.${match[2]}.x`;
  assert.ok(readme.includes(`Status — pre-1.0 (\`v${releaseLine}\`)`));
  assert.ok(security.includes(`current framework release line is\n\`${releaseLine}\``));
});

test("local links in current README and guide surfaces resolve", async () => {
  const docsDirectory = resolve(repoRoot, "docs");
  const packageDirectories = await findPackageDirectories(resolve(repoRoot, "packages"));
  const docs = (await readdir(docsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(docsDirectory, entry.name));
  const files = [
    resolve(repoRoot, "README.md"),
    resolve(repoRoot, "AGENTS.md"),
    resolve(repoRoot, "CONTRIBUTING.md"),
    resolve(repoRoot, "SECURITY.md"),
    ...docs,
    ...packageDirectories.map((directory) => resolve(directory, "README.md")),
  ];
  const broken: string[] = [];

  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)\n]+)\)/g)) {
      const target = match[1]?.trim().replace(/^</, "").replace(/>$/, "");
      if (!target || target.startsWith("#") || target.startsWith("/")) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;

      const path = decodeURIComponent(target.split("#", 1)[0] ?? "");
      if (!path) continue;
      try {
        await access(resolve(dirname(file), path));
      } catch {
        broken.push(`${relative(repoRoot, file)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(broken, []);
});
