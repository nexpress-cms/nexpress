import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { freezeSiteBuildCapsuleV1 } from "./frozen-capsule.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-capsule-fixture-")));
  roots.push(root);
  const packages = [
    "@nexpress/app",
    "@nexpress/blocks",
    "@nexpress/cli",
    "@nexpress/core",
    "@nexpress/theme",
    "react",
    "react-dom",
  ];
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      dependencies: Object.fromEntries(packages.map((name) => [name, "1.0.0"])),
    }),
  );
  await mkdir(join(root, "src"));
  await writeFile(join(root, "nexpress.config.ts"), "export default { synthetic: true };\n");
  await writeFile(join(root, "src/fixture.ts"), "export const fixture = 'unchanged';\n");
  await writeFile(join(root, ".env.local"), "SYNTHETIC_SECRET=must-not-be-mounted\n");
  await writeFile(join(root, ".pnpmfile.cjs"), "synthetic package hook credential\n");
  await mkdir(join(root, "src/.aws"));
  await writeFile(join(root, "src/.aws/credentials"), "synthetic forbidden secret");
  await writeFile(join(root, "unrelated.md"), "preserve this dirty original file\r\n");
  for (const name of packages) {
    const path = join(root, "node_modules", name);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        dependencies: name === "@nexpress/app" ? { "@nexpress/core": "1.0.0" } : {},
      }),
    );
    await writeFile(join(path, "index.js"), "export const fixture = 'observed payload';\n");
  }
  return root;
}

it("freezes owned source/payload copies, excludes secrets and leaves original dirty files intact", async () => {
  const root = await fixture(),
    capsule = await freezeSiteBuildCapsuleV1(root, "nexpress.config.ts");
  try {
    expect(capsule.renderer.projectSources.files.map((file) => file.path)).toEqual([
      ".np-build-modules.json",
      "nexpress.config.ts",
      "package.json",
      "src/fixture.ts",
    ]);
    expect(await readFile(join(capsule.project, "src/fixture.ts"), "utf8")).toContain("unchanged");
    await expect(lstat(join(capsule.project, ".env.local"))).rejects.toThrow();
    await expect(lstat(join(capsule.project, "src/.aws"))).rejects.toThrow();
    const original = join(root, "node_modules/@nexpress/cli/index.js"),
      copied = join(capsule.cliRoot, "index.js");
    expect((await lstat(original)).ino).not.toBe((await lstat(copied)).ino);
    expect(await readFile(copied)).toEqual(await readFile(original));
    await capsule.assertOriginalUnchanged();
    expect(await readFile(join(root, "unrelated.md"), "utf8")).toBe(
      "preserve this dirty original file\r\n",
    );
    await writeFile(join(root, "src/fixture.ts"), "changed after observation\n");
    await expect(capsule.assertOriginalUnchanged()).rejects.toThrow();
    expect(await readFile(join(capsule.project, "src/fixture.ts"), "utf8")).toContain("unchanged");
  } finally {
    await capsule.close();
  }
});

it("detects package changes and newly added root modules after the capsule is frozen", async () => {
  const root = await fixture(),
    capsule = await freezeSiteBuildCapsuleV1(root, "nexpress.config.ts");
  try {
    await writeFile(join(root, "added.ts"), "export {};\n");
    await expect(capsule.assertOriginalUnchanged()).rejects.toThrow();
  } finally {
    await capsule.close();
  }
  const second = await freezeSiteBuildCapsuleV1(root, "nexpress.config.ts");
  try {
    await writeFile(
      join(root, "node_modules/@nexpress/core/index.js"),
      "Changed installed file; same version\n",
    );
    await expect(second.assertOriginalUnchanged()).rejects.toThrow();
  } finally {
    await second.close();
  }
});
