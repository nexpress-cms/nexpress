import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packageNameFromThemeSlug, scaffoldTheme } from "./scaffold-theme.js";

describe("scaffoldTheme", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-scaffold-theme-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("normalizes author-friendly slugs to theme package names", () => {
    expect(packageNameFromThemeSlug("newsroom")).toBe("theme-newsroom");
    expect(packageNameFromThemeSlug("theme-newsroom")).toBe("theme-newsroom");
    expect(packageNameFromThemeSlug("@acme/newsroom")).toBe("@acme/theme-newsroom");
    expect(packageNameFromThemeSlug("@acme/theme-newsroom")).toBe("@acme/theme-newsroom");
  });

  it("writes a buildable baseline theme package", async () => {
    const result = await scaffoldTheme({ slug: "newsroom", outDir: workdir });

    expect(result.files.sort()).toEqual([
      "README.md",
      "package.json",
      "src/footer.tsx",
      "src/header.tsx",
      "src/index.ts",
      "src/shell.tsx",
      "src/styles.ts",
      "src/templates/page-default.tsx",
      "tsconfig.json",
      "tsup.config.ts",
    ]);
    expect(result.kind).toBe("theme");
    expect(result.interactive).toBe(false);
    expect(result.packageDir.endsWith("newsroom")).toBe(true);
  });

  it("derives package, manifest id, and named export consistently", async () => {
    const result = await scaffoldTheme({ slug: "@acme/theme-news-room", outDir: workdir });
    const pkg = JSON.parse(await readFile(join(result.packageDir, "package.json"), "utf-8")) as {
      name: string;
      dependencies: Record<string, string>;
    };
    const source = await readFile(join(result.packageDir, "src/index.ts"), "utf-8");

    expect(pkg.name).toBe("@acme/theme-news-room");
    expect(pkg.dependencies["@nexpress/blocks"]).toBe("workspace:*");
    expect(pkg.dependencies["@nexpress/theme"]).toBe("workspace:*");
    expect(pkg.dependencies["@nexpress/plugin-sdk"]).toBeUndefined();
    expect(source).toContain("export const newsRoomTheme = defineTheme");
    expect(source).toContain('id: "news-room"');
    expect(source).not.toContain("license:");
  });

  it("documents local theme registration and activation", async () => {
    const result = await scaffoldTheme({ slug: "newsroom", outDir: workdir });
    const readme = await readFile(join(result.packageDir, "README.md"), "utf-8");

    expect(readme).toContain("pnpm --filter theme-newsroom build");
    expect(readme).toContain("pnpm exec nexpress theme add theme-newsroom --yes");
    expect(readme).toContain("pnpm db:generate && pnpm db:migrate");
    expect(readme).toContain("Activate the theme in Admin -> Settings -> Theme.");
  });

  it("can inherit theme dependency ranges from a project scaffold", async () => {
    const result = await scaffoldTheme({
      slug: "project-ranges",
      outDir: workdir,
      dependencyRanges: {
        "@nexpress/blocks": "file:/tmp/nexpress-blocks-0.4.0.tgz",
        "@nexpress/theme": "0.4.0",
      },
    });
    const pkg = JSON.parse(await readFile(join(result.packageDir, "package.json"), "utf-8")) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.dependencies["@nexpress/blocks"]).toBe("file:/tmp/nexpress-blocks-0.4.0.tgz");
    expect(pkg.dependencies["@nexpress/theme"]).toBe("0.4.0");
  });

  it("refuses to overwrite existing dirs", async () => {
    await scaffoldTheme({ slug: "twice", outDir: workdir });
    await expect(scaffoldTheme({ slug: "twice", outDir: workdir })).rejects.toThrow(
      /Refusing to overwrite/,
    );
  });
});
