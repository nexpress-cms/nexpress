import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  scaffoldAdminPlugin,
  scaffoldHookPlugin,
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
      expect(result.pluginDir.endsWith("demo")).toBe(true);
    });

    it(`${kind} — derives camelCase export from the slug`, async () => {
      const result = await generator({ slug: "my-demo", outDir: workdir });
      const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/export const myDemoPlugin = definePlugin/);
    });

    it(`${kind} — refuses to overwrite existing dirs`, async () => {
      await generator({ slug: "twice", outDir: workdir });
      await expect(
        generator({ slug: "twice", outDir: workdir }),
      ).rejects.toThrow(/Refusing to overwrite/);
    });
  };

  describe("hook plugin", () => {
    commonAssertions("hook", scaffoldHookPlugin);

    it("registers a content:afterCreate hook in the starter source", async () => {
      const result = await scaffoldHookPlugin({ slug: "audit-log", outDir: workdir });
      const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/"content:afterCreate":/);
      expect(source).toMatch(/ctx\.log\.info/);
    });
  });

  describe("route plugin", () => {
    commonAssertions("route", scaffoldRoutePlugin);

    it("declares a GET /health route in the starter source", async () => {
      const result = await scaffoldRoutePlugin({ slug: "ping", outDir: workdir });
      const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/method: "GET"/);
      expect(source).toMatch(/path: "\/health"/);
      expect(source).toMatch(/auth: false/);
    });
  });

  describe("admin plugin", () => {
    commonAssertions("admin", scaffoldAdminPlugin);

    it("declares settings + widget + action wired through ctx.actions.register", async () => {
      const result = await scaffoldAdminPlugin({ slug: "status-card", outDir: workdir });
      const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
      // All three admin surface kinds.
      expect(source).toMatch(/settings:\s*{/);
      expect(source).toMatch(/widgets:\s*\[/);
      expect(source).toMatch(/actions:\s*\[/);
      // Setup hook registers the shared action handler.
      expect(source).toMatch(/setup:\s*\(ctx\)\s*=>/);
      expect(source).toMatch(/ctx\.actions\.register\("syncStatus"/);
    });

    it("declares admin:panel capability up front (auto-derive doesn't cover admin)", async () => {
      const result = await scaffoldAdminPlugin({ slug: "ui", outDir: workdir });
      const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/capabilities: \["admin:panel"\]/);
    });
  });

  describe("scheduled plugin", () => {
    commonAssertions("scheduled", scaffoldScheduledPlugin);

    it("declares one daily cron task in the starter source", async () => {
      const result = await scaffoldScheduledPlugin({ slug: "cleanup", outDir: workdir });
      const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
      expect(source).toMatch(/scheduled:\s*\[/);
      expect(source).toMatch(/cron: "0 2 \* \* \*"/);
      expect(source).toMatch(/handler: async \(ctx\)/);
    });
  });

  describe("package.json shape", () => {
    it("each kind ships @nexpress/plugin-sdk + @nexpress/blocks deps and the standard scripts", async () => {
      for (const generator of [
        scaffoldHookPlugin,
        scaffoldRoutePlugin,
        scaffoldAdminPlugin,
        scaffoldScheduledPlugin,
      ]) {
        const result = await generator({
          slug: `pkg-${Math.random().toString(16).slice(2, 8)}`,
          outDir: workdir,
        });
        const pkg = JSON.parse(
          await readFile(join(result.pluginDir, "package.json"), "utf-8"),
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
  });
});
