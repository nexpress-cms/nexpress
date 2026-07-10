import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  scaffoldAdminPlugin,
  scaffoldHookPlugin,
  scaffoldPagePlugin,
  scaffoldRoutePlugin,
  scaffoldScheduledPlugin,
} from "./scaffold-plugin-types.js";

describe("non-block scaffold generators", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-scaffold-types-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  // Common shape for every kind: same baseline file set, derived names,
  // refusal to overwrite, and the kind label on the result.
  const commonAssertions = (kind: string, generator: typeof scaffoldHookPlugin) => {
    it(`${kind} — writes baseline file set`, async () => {
      const result = await generator({ slug: "demo", outDir: workdir });
      expect(result.files.sort()).toEqual([
        "README.md",
        "package.json",
        "src/index.tsx",
        "tsconfig.json",
        "tsup.config.ts",
      ]);
      expect(result.kind).toBe(kind);
      expect(result.interactive).toBe(false);
      expect(result.packageDir.endsWith("demo")).toBe(true);
    });

    it(`${kind} — derives camelCase export from the slug`, async () => {
      const result = await generator({ slug: "my-demo", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/export const myDemoPlugin = definePlugin/);
    });

    it(`${kind} — documents CLI registration for local workspace plugins`, async () => {
      const result = await generator({ slug: "my-demo", outDir: workdir });
      const readme = await readFile(join(result.packageDir, "README.md"), "utf-8");
      expect(readme).toContain("From your NexPress project root");
      expect(readme).toContain("pnpm --filter my-demo build");
      expect(readme).toContain("pnpm exec nexpress plugin add my-demo");
      expect(readme).toContain("pnpm exec nexpress plugin remove my-demo");
      expect(readme).toContain("pnpm --silent run ops:plugins -- doctor --json");
      expect(readme).toContain('import { defineConfig } from "@nexpress/core";');
      expect(readme).toContain('import myDemoPlugin from "my-demo";');
      expect(readme).toContain("plugins: [myDemoPlugin]");
    });

    it(`${kind} — refuses to overwrite existing dirs`, async () => {
      await generator({ slug: "twice", outDir: workdir });
      await expect(generator({ slug: "twice", outDir: workdir })).rejects.toThrow(
        /Refusing to overwrite/,
      );
    });
  };

  describe("hook plugin", () => {
    commonAssertions("hook", scaffoldHookPlugin);

    it("registers a content:afterCreate hook in the starter source", async () => {
      const result = await scaffoldHookPlugin({ slug: "audit-log", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/"content:afterCreate":/);
      expect(source).toMatch(/ctx\.log\.info/);
      expect(source).toContain("data.documentId");
      expect(source).toContain("data.document.title");
      expect(source).not.toContain("data as");
      expect(source).not.toContain("{ data, collection");
      expect(source).toContain("`render:beforePage`");
      expect(source).toContain("`content:beforeUnpublish`");
      expect(source).not.toContain("render:afterPage");
    });
  });

  describe("route plugin", () => {
    commonAssertions("route", scaffoldRoutePlugin);

    it("declares a GET /health route in the starter source", async () => {
      const result = await scaffoldRoutePlugin({ slug: "ping", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/method: "GET"/);
      expect(source).toMatch(/path: "\/health"/);
      expect(source).toMatch(/auth: false/);
      expect(source).toContain("statuses 204, 205, and 304 must not include a body");
      expect(source).not.toContain("Promise.resolve");
      expect(source).not.toMatch(/from "zod"/);
    });
  });

  describe("page plugin", () => {
    commonAssertions("page", scaffoldPagePlugin);

    it("declares a typed public page route with metadata and locale semantics", async () => {
      const result = await scaffoldPagePlugin({ slug: "greeting", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      expect(source).toContain("type NpPluginPageRouteProps");
      expect(source).toMatch(/pageRoutes:\s*\[/);
      expect(source).toMatch(/pattern: "\/hello\/:name"/);
      expect(source).toMatch(/component: GreetingPage/);
      expect(source).toMatch(/metadata: \(\{ params \}\)/);
      expect(source).toMatch(/locale: "auto"/);
      expect(source).toContain('`locale: "none"`');
      expect(source).toContain('`surface: "member"`');
    });
  });

  describe("admin plugin", () => {
    commonAssertions("admin", scaffoldAdminPlugin);

    it("declares configSchema + widget + action wired through the typed action registry", async () => {
      const result = await scaffoldAdminPlugin({ slug: "status-card", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      // All three admin surface kinds.
      expect(source).toMatch(/import \{ z \} from "zod"/);
      expect(source).toMatch(/const configSchema = z\.object/);
      expect(source).toMatch(/configSchema,/);
      expect(source).not.toMatch(/settings:\s*{/);
      expect(source).not.toMatch(/fields:\s*\[/);
      expect(source).toMatch(/widgets:\s*\[/);
      expect(source).toMatch(/actions:\s*\[/);
      // Definition-level registry owns the shared action handler.
      expect(source).toMatch(/import \{ definePlugin, npAdminStatus \}/);
      expect(source).toMatch(/actions:\s*\{/);
      expect(source).toMatch(/syncStatus:\s*\{/);
      expect(source).toMatch(/kind:\s*"status"/);
      expect(source).toMatch(/handler:\s*async \(_data, ctx\)/);
      expect(source).not.toMatch(/setup:\s*\(ctx\)\s*=>/);
      expect(source).not.toMatch(/ctx\.actions\.register/);
      expect(source).toMatch(/npAdminStatus\("ok", "All systems go\."\)/);
    });

    it("omits manually declared admin:panel because definePlugin derives it", async () => {
      const result = await scaffoldAdminPlugin({ slug: "ui", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      expect(source).not.toMatch(/capabilities: \["admin:panel"\]/);
    });

    it("adds zod because the admin starter imports configSchema", async () => {
      const result = await scaffoldAdminPlugin({ slug: "config-form", outDir: workdir });
      const pkg = JSON.parse(await readFile(join(result.packageDir, "package.json"), "utf-8")) as {
        dependencies: Record<string, string>;
      };
      expect(pkg.dependencies.zod).toBe("^4.4.3");
    });
  });

  describe("scheduled plugin", () => {
    commonAssertions("scheduled", scaffoldScheduledPlugin);

    it("declares one daily cron task in the starter source", async () => {
      const result = await scaffoldScheduledPlugin({ slug: "cleanup", outDir: workdir });
      const source = await readFile(join(result.packageDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/scheduled:\s*\[/);
      expect(source).toMatch(/cron: "0 2 \* \* \*"/);
      expect(source).toMatch(/handler: async \(ctx\)/);
      expect(source).toContain("satisfies NpScheduledTask[]");
      expect(source).toContain("02:00 UTC");
      expect(source).not.toContain("server-local");
      expect(source).not.toContain("*/15");

      const readme = await readFile(join(result.packageDir, "README.md"), "utf-8");
      expect(readme).toContain("plugins.schedule_invalid");
      expect(readme).toContain("plugins.schedule_duplicate");
    });
  });

  describe("package.json shape", () => {
    it("each kind ships @nexpress/plugin-sdk + @nexpress/blocks deps and the standard scripts", async () => {
      for (const generator of [
        scaffoldHookPlugin,
        scaffoldRoutePlugin,
        scaffoldPagePlugin,
        scaffoldAdminPlugin,
        scaffoldScheduledPlugin,
      ]) {
        const result = await generator({
          slug: `pkg-${Math.random().toString(16).slice(2, 8)}`,
          outDir: workdir,
        });
        const pkg = JSON.parse(
          await readFile(join(result.packageDir, "package.json"), "utf-8"),
        ) as {
          dependencies: Record<string, string>;
          scripts: Record<string, string>;
        };
        expect(pkg.dependencies["@nexpress/plugin-sdk"]).toBe("workspace:*");
        expect(pkg.dependencies["@nexpress/blocks"]).toBe("workspace:*");
        expect(pkg.scripts.build).toBe("tsup");
        expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
      }
    });

    it("each kind can inherit framework dependency ranges from a project scaffold", async () => {
      for (const generator of [
        scaffoldHookPlugin,
        scaffoldRoutePlugin,
        scaffoldPagePlugin,
        scaffoldAdminPlugin,
        scaffoldScheduledPlugin,
      ]) {
        const result = await generator({
          slug: `ranges-${Math.random().toString(16).slice(2, 8)}`,
          outDir: workdir,
          dependencyRanges: {
            "@nexpress/blocks": "file:/tmp/nexpress-blocks-0.4.0.tgz",
            "@nexpress/plugin-sdk": "0.4.0",
          },
        });
        const pkg = JSON.parse(
          await readFile(join(result.packageDir, "package.json"), "utf-8"),
        ) as {
          dependencies: Record<string, string>;
        };

        expect(pkg.dependencies["@nexpress/blocks"]).toBe("file:/tmp/nexpress-blocks-0.4.0.tgz");
        expect(pkg.dependencies["@nexpress/plugin-sdk"]).toBe("0.4.0");
      }
    });

    it("keeps every non-block plugin package on the shared scaffold baseline", async () => {
      const expectedScripts = {
        build: "tsup",
        dev: "tsup --watch --no-clean",
        clean: "rm -rf dist",
        typecheck: "tsc --noEmit",
      };

      for (const generator of [
        scaffoldHookPlugin,
        scaffoldRoutePlugin,
        scaffoldPagePlugin,
        scaffoldAdminPlugin,
        scaffoldScheduledPlugin,
      ]) {
        const result = await generator({
          slug: `baseline-${Math.random().toString(16).slice(2, 8)}`,
          outDir: workdir,
        });
        const pkg = JSON.parse(
          await readFile(join(result.packageDir, "package.json"), "utf-8"),
        ) as {
          files: string[];
          engines: Record<string, string>;
          exports: Record<string, { types: string; import: string }>;
          peerDependencies: Record<string, string>;
          scripts: Record<string, string>;
        };

        expect(pkg.files).toEqual(["dist"]);
        expect(pkg.engines.node).toBe(">=20");
        expect(pkg.exports["."]).toEqual({
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        });
        expect(pkg.peerDependencies.react).toBe("^19.0.0");
        expect(pkg.scripts).toEqual(expectedScripts);
      }
    });
  });
});
