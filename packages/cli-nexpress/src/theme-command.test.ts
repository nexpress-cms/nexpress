import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runNexpressCli } from "./index.js";

const themeMarkerConfig = `import { defineConfig } from "@nexpress/core";
import { defaultThemes } from "@nexpress/app/config-defaults";

// @nexpress:themes-imports-start
// @nexpress:themes-imports-end

export default defineConfig({
  collections: [],
  themes: [
    ...defaultThemes,
    // @nexpress:themes-list-start
    // @nexpress:themes-list-end
  ],
});
`;

function captureStdout() {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    output += String(chunk);
    return true;
  });
  return {
    read: () => output,
    restore: () => spy.mockRestore(),
  };
}

function captureStderr() {
  let output = "";
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    output += String(chunk);
    return true;
  });
  return {
    read: () => output,
    restore: () => spy.mockRestore(),
  };
}

describe("theme commands", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-theme-command-"));
    await writeFile(
      join(workdir, "package.json"),
      JSON.stringify({ name: "site", packageManager: "pnpm@10.33.0" }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("lists theme remove without the removed alias", async () => {
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "--help"]);

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("nexpress theme remove <package>");
    expect(stdout.read()).not.toContain(["theme:", "uninstall"].join(""));
  });

  it("parses theme remove errors before reaching the remove runner", async () => {
    const stderr = captureStderr();

    const code = await runNexpressCli(["node", "nexpress", "theme", "remove", "--force"]);

    stderr.restore();
    expect(code).toBe(2);
    expect(stderr.read()).toContain("Unknown flag for theme remove: --force");
  });

  it("prints build, theme add, migration, and activation steps after creating a theme", async () => {
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "create", "theme", "newsroom"], {
      cwd: workdir,
    });

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("✓ Scaffolded theme");
    expect(stdout.read()).toContain("pnpm --filter theme-newsroom build");
    expect(stdout.read()).toContain("pnpm exec nexpress theme add theme-newsroom --yes");
    expect(stdout.read()).toContain("pnpm db:generate && pnpm db:migrate");
    expect(stdout.read()).toContain("Activate it in admin -> Settings -> Theme");
  });

  it("prints npm script commands in theme add dry-run for npm projects", async () => {
    await writeFile(
      join(workdir, "package.json"),
      JSON.stringify({ name: "site", packageManager: "npm@11.0.0" }, null, 2),
      "utf-8",
    );
    await writeFile(join(workdir, "nexpress.config.ts"), themeMarkerConfig, "utf-8");
    const stdout = captureStdout();

    const code = await runNexpressCli(
      ["node", "nexpress", "theme", "add", "theme-newsroom", "--dry-run"],
      { cwd: workdir },
    );

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("npm install theme-newsroom");
    expect(stdout.read()).toContain("npm run db:generate && npm run db:migrate");
  });

  it("adds a built local workspace theme with a workspace protocol dependency", async () => {
    await writeFile(join(workdir, "nexpress.config.ts"), themeMarkerConfig, "utf-8");
    await writeFile(join(workdir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/themes/*"\n');
    await mkdir(join(workdir, "packages/themes/newsroom/dist"), { recursive: true });
    await writeFile(
      join(workdir, "packages/themes/newsroom/package.json"),
      JSON.stringify(
        {
          name: "theme-newsroom",
          exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
          main: "./dist/index.js",
        },
        null,
        2,
      ),
      "utf-8",
    );
    await writeFile(join(workdir, "packages/themes/newsroom/dist/index.js"), "export {};\n");
    const packageManagerCalls: Array<{
      manager: string;
      action: string;
      packageName: string;
      cwd: string;
      options: unknown;
    }> = [];
    const stdout = captureStdout();

    const code = await runNexpressCli(
      ["node", "nexpress", "theme", "add", "theme-newsroom", "--yes"],
      {
        cwd: workdir,
        themeExportProbe: () => Promise.resolve(null),
        runPackageManager: (manager, action, packageName, cwd, options = {}) => {
          packageManagerCalls.push({ manager, action, packageName, cwd, options });
          return Promise.resolve();
        },
      },
    );

    stdout.restore();
    const config = await readFile(join(workdir, "nexpress.config.ts"), "utf-8");
    expect(code).toBe(0);
    expect(packageManagerCalls).toEqual([
      {
        manager: "pnpm",
        action: "add",
        packageName: "theme-newsroom",
        cwd: workdir,
        options: { localWorkspace: true, workspaceRoot: true },
      },
    ]);
    expect(stdout.read()).toContain("Detected local workspace theme");
    expect(config).toContain('import { newsroomTheme } from "theme-newsroom";');
    expect(config).toContain("    newsroomTheme,");
  });

  it("probes an ESM-only package with import and types export conditions", async () => {
    await writeFile(join(workdir, "nexpress.config.ts"), themeMarkerConfig, "utf-8");
    const packageDir = join(workdir, "node_modules/theme-newsroom");
    await mkdir(join(packageDir, "dist"), { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "theme-newsroom",
        type: "module",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      }),
      "utf-8",
    );
    await writeFile(
      join(packageDir, "dist/index.js"),
      'export const newsroomTheme = { manifest: { id: "newsroom", name: "Newsroom", version: "0.1.0" }, impl: {} };\n',
      "utf-8",
    );

    const code = await runNexpressCli(
      ["node", "nexpress", "theme", "add", "theme-newsroom", "--yes"],
      { cwd: workdir, runPackageManager: () => Promise.resolve() },
    );

    const config = await readFile(join(workdir, "nexpress.config.ts"), "utf-8");
    expect(code).toBe(0);
    expect(config).toContain('import { newsroomTheme } from "theme-newsroom";');
  });

  it("does not register a theme whose installed export fails the definition contract", async () => {
    await writeFile(join(workdir, "nexpress.config.ts"), themeMarkerConfig, "utf-8");
    const stderr = captureStderr();

    const code = await runNexpressCli(
      ["node", "nexpress", "theme", "add", "theme-newsroom", "--yes"],
      {
        cwd: workdir,
        runPackageManager: () => Promise.resolve(),
        themeExportProbe: () =>
          Promise.resolve(
            '"theme-newsroom" exports an invalid theme at manifest.version: manifest.version must be a semantic version.',
          ),
      },
    );

    stderr.restore();
    const config = await readFile(join(workdir, "nexpress.config.ts"), "utf-8");
    expect(code).toBe(1);
    expect(stderr.read()).toContain("Theme registration was not written");
    expect(config).not.toContain('from "theme-newsroom"');
  });

  it("refuses to add an unbuilt local workspace theme", async () => {
    await writeFile(join(workdir, "nexpress.config.ts"), themeMarkerConfig, "utf-8");
    await writeFile(join(workdir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/themes/*"\n');
    await mkdir(join(workdir, "packages/themes/newsroom"), { recursive: true });
    await writeFile(
      join(workdir, "packages/themes/newsroom/package.json"),
      JSON.stringify(
        {
          name: "theme-newsroom",
          exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const stdout = captureStdout();

    const code = await runNexpressCli(
      ["node", "nexpress", "theme", "add", "theme-newsroom", "--yes"],
      {
        cwd: workdir,
        runPackageManager: () => Promise.resolve(),
      },
    );

    stdout.restore();
    expect(code).toBe(1);
    expect(stdout.read()).toContain("build output is missing");
    expect(stdout.read()).toContain("pnpm --filter theme-newsroom build");
  });
});
