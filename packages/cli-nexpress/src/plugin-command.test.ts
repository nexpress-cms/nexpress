import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runNexpressCli } from "./index.js";

const markerConfig = `import { defineConfig } from "@nexpress/core";

// @nexpress:plugins-imports-start
// @nexpress:plugins-imports-end

export default defineConfig({
  collections: [],
  plugins: [
    // @nexpress:plugins-list-start
    // @nexpress:plugins-list-end
  ],
});
`;

function configWithPlugin(packageName: string, identifier: string): string {
  return `import { defineConfig } from "@nexpress/core";

// @nexpress:plugins-imports-start
import ${identifier} from "${packageName}";
// @nexpress:plugins-imports-end

export default defineConfig({
  collections: [],
  plugins: [
    // @nexpress:plugins-list-start
    ${identifier},
    // @nexpress:plugins-list-end
  ],
});
`;
}

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

describe("plugin commands", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-plugin-command-"));
    await writeFile(
      join(workdir, "package.json"),
      JSON.stringify({ name: "site", packageManager: "pnpm@10.33.0" }, null, 2),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("adds a plugin through the CLI command path", async () => {
    await writeFile(join(workdir, "nexpress.config.ts"), markerConfig, "utf-8");
    const packageManagerCalls: Array<{
      manager: string;
      action: string;
      packageName: string;
      cwd: string;
      options: unknown;
    }> = [];
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "plugin", "add", "@acme/plugin-seo"], {
      cwd: workdir,
      runPackageManager: (manager, action, packageName, cwd, options = {}) => {
        packageManagerCalls.push({ manager, action, packageName, cwd, options });
        return Promise.resolve();
      },
    });

    stdout.restore();
    const config = await readFile(join(workdir, "nexpress.config.ts"), "utf-8");
    expect(code).toBe(0);
    expect(packageManagerCalls).toEqual([
      {
        manager: "pnpm",
        action: "add",
        packageName: "@acme/plugin-seo",
        cwd: workdir,
        options: { localWorkspace: false },
      },
    ]);
    expect(config).toContain('import pluginSeo from "@acme/plugin-seo";');
    expect(config).toContain("    pluginSeo,");
    expect(stdout.read()).toContain("✓ Registered pluginSeo");
    expect(stdout.read()).toContain("pnpm --silent run ops:plugins -- doctor --json");
  });

  it("adds a built local workspace plugin with a workspace protocol dependency", async () => {
    await writeFile(join(workdir, "nexpress.config.ts"), markerConfig, "utf-8");
    await writeFile(join(workdir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/plugins/*"\n');
    await mkdir(join(workdir, "packages/plugins/smoke-hook/dist"), { recursive: true });
    await writeFile(
      join(workdir, "packages/plugins/smoke-hook/package.json"),
      JSON.stringify(
        {
          name: "smoke-hook",
          exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
          main: "./dist/index.js",
        },
        null,
        2,
      ),
      "utf-8",
    );
    await writeFile(join(workdir, "packages/plugins/smoke-hook/dist/index.js"), "export {};\n");
    const packageManagerCalls: Array<{
      manager: string;
      action: string;
      packageName: string;
      cwd: string;
      options: unknown;
    }> = [];
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "plugin", "add", "smoke-hook"], {
      cwd: workdir,
      runPackageManager: (manager, action, packageName, cwd, options = {}) => {
        packageManagerCalls.push({ manager, action, packageName, cwd, options });
        return Promise.resolve();
      },
    });

    stdout.restore();
    const config = await readFile(join(workdir, "nexpress.config.ts"), "utf-8");
    expect(code).toBe(0);
    expect(packageManagerCalls).toEqual([
      {
        manager: "pnpm",
        action: "add",
        packageName: "smoke-hook",
        cwd: workdir,
        options: { localWorkspace: true, workspaceRoot: true },
      },
    ]);
    expect(stdout.read()).toContain("Detected local workspace package");
    expect(config).toContain('import smokeHook from "smoke-hook";');
    expect(config).toContain("    smokeHook,");
  });

  it("removes a plugin through the CLI command path", async () => {
    await writeFile(
      join(workdir, "nexpress.config.ts"),
      configWithPlugin("@acme/plugin-seo", "pluginSeo"),
      "utf-8",
    );
    const packageManagerCalls: Array<{
      manager: string;
      action: string;
      packageName: string;
      cwd: string;
      options: unknown;
    }> = [];
    const stdout = captureStdout();

    const code = await runNexpressCli(
      ["node", "nexpress", "plugin", "remove", "@acme/plugin-seo"],
      {
        cwd: workdir,
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
        action: "remove",
        packageName: "@acme/plugin-seo",
        cwd: workdir,
        options: {},
      },
    ]);
    expect(config).not.toContain("@acme/plugin-seo");
    expect(config).not.toContain("pluginSeo,");
    expect(stdout.read()).toContain("✓ Unregistered pluginSeo");
    expect(stdout.read()).toContain("boot-time plugin code unloads");
    expect(stdout.read()).toContain("pnpm --silent run ops:plugins -- doctor --json");
  });

  it("prints manual removal recovery when config markers are missing", async () => {
    await writeFile(
      join(workdir, "nexpress.config.ts"),
      `import pluginSeo from "@acme/plugin-seo";\nexport default { plugins: [pluginSeo] };\n`,
      "utf-8",
    );
    const stdout = captureStdout();

    const code = await runNexpressCli(
      ["node", "nexpress", "plugin", "remove", "@acme/plugin-seo"],
      {
        cwd: workdir,
        runPackageManager: () => Promise.resolve(),
      },
    );

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("doesn't have plugin markers");
    expect(stdout.read()).toContain('import pluginSeo from "@acme/plugin-seo";');
    expect(stdout.read()).toContain("Remove the config snippet above");
    expect(stdout.read()).toContain("pnpm exec nexpress plugin remove @acme/plugin-seo");
  });

  it("prints restart and doctor steps after creating a plugin scaffold", async () => {
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "create", "hook-plugin", "audit-log"], {
      cwd: workdir,
    });

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("✓ Scaffolded content-hook plugin");
    expect(stdout.read()).toContain("pnpm --filter audit-log build");
    expect(stdout.read()).toContain("pnpm exec nexpress plugin add audit-log");
    expect(stdout.read()).toContain("Restart your dev server or redeploy");
    expect(stdout.read()).toContain("pnpm --silent run ops:plugins -- doctor --json");
  });

  it("dispatches the public page-route plugin scaffold", async () => {
    const stdout = captureStdout();

    const code = await runNexpressCli(["node", "nexpress", "create", "page-plugin", "greeting"], {
      cwd: workdir,
    });

    stdout.restore();
    expect(code).toBe(0);
    expect(stdout.read()).toContain("✓ Scaffolded public page-route plugin");
    expect(stdout.read()).toContain("pnpm --filter greeting build");
  });
});
