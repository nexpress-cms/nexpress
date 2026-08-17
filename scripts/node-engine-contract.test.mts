import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const REQUIRED_NODE_ENGINE = ">=20.19.0";

async function collectPackageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectPackageFiles(absolute)));
    } else if (entry.name === "package.json") {
      files.push(absolute);
    }
  }
  return files;
}

test("every published package and the workspace root declare the supported Node floor", async () => {
  const packageFiles = [
    path.join(ROOT, "package.json"),
    ...(await collectPackageFiles(path.join(ROOT, "packages"))),
  ];
  const mismatches: string[] = [];

  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(await readFile(packageFile, "utf8")) as {
      name?: string;
      private?: boolean;
      engines?: { node?: string };
    };
    const isWorkspaceRoot = packageFile === path.join(ROOT, "package.json");
    if (!isWorkspaceRoot && manifest.private === true) continue;
    if (manifest.engines?.node !== REQUIRED_NODE_ENGINE) {
      mismatches.push(
        `${path.relative(ROOT, packageFile)} (${manifest.name ?? "unnamed"}): ${manifest.engines?.node ?? "missing"}`,
      );
    }
  }

  assert.deepEqual(mismatches, []);
});
