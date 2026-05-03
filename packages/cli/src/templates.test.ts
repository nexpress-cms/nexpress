import { describe, expect, it } from "vitest";

import { getProjectFiles } from "./templates.js";

const baseConfig = {
  projectName: "test-site",
  includeExampleContent: true,
  dockerSetup: true,
  localMode: true,
  secret: "test-secret-32characters-min-aaaaaaaaaaaa",
};

/**
 * These tests guard the structural invariants that broke in real
 * verification runs:
 *
 * 1. `bootstrap.ts` imports `@/db/generated/collections` — so the
 *    scaffold must ship a stub at that path; otherwise the very first
 *    `tsc --noEmit` on a fresh scaffold fails.
 * 2. `worker.ts` reads + narrows `process.env.DATABASE_URL` and then
 *    calls `startWorker(databaseUrl)` inside an async function — TS
 *    won't carry top-level narrowings into nested scopes, so the
 *    narrowing must happen inside `main()`.
 * 3. The admin login template's `<form onSubmit>` must receive a void
 *    handler (lint failure if an async fn is passed directly).
 */
describe("getProjectFiles", () => {
  it("includes a stub generated/collections.ts so bootstrap.ts typechecks before db:generate", () => {
    const files = getProjectFiles(baseConfig);
    expect(files["src/db/generated/collections.ts"]).toBeDefined();
    expect(files["src/db/generated/collections.ts"]).toMatch(/export\s*\{/);
  });

  it("worker template reads DATABASE_URL inside main() so the narrowing reaches startWorker", () => {
    const files = getProjectFiles(baseConfig);
    const worker = files["scripts/worker.ts"];
    expect(worker).toBeDefined();
    // The narrowing pattern: `const databaseUrl = process.env.DATABASE_URL`
    // must appear AFTER `async function main`. If it's at module scope,
    // tsc rejects `startWorker(databaseUrl)` later in main().
    const mainIdx = worker.indexOf("async function main");
    const declIdx = worker.indexOf("const databaseUrl = process.env.DATABASE_URL");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(declIdx).toBeGreaterThan(mainIdx);
  });

  it("admin login client wraps async onSubmit so ESLint doesn't fail next build", () => {
    const files = getProjectFiles(baseConfig);
    // Login is now a server wrapper that redirects to /admin/setup
    // when no admin exists. The actual form lives in login-client.tsx;
    // assert the void-handler pattern there instead.
    const loginClient = files["src/app/(admin)/admin/login/login-client.tsx"];
    expect(loginClient).toBeDefined();
    expect(loginClient).not.toMatch(/onSubmit=\{onSubmit\}/);
    expect(loginClient).toMatch(/onSubmit=\{\(.+?\)\s*=>/);
  });

  it("login server wrapper redirects to /admin/setup when no admin exists", () => {
    const files = getProjectFiles(baseConfig);
    const loginPage = files["src/app/(admin)/admin/login/page.tsx"];
    expect(loginPage).toBeDefined();
    expect(loginPage).toMatch(/redirect\("\/admin\/setup"\)/);
  });

  it("includes the first-boot setup wizard files", () => {
    const files = getProjectFiles(baseConfig);
    expect(files["src/app/(admin)/admin/setup/page.tsx"]).toBeDefined();
    expect(files["src/app/(admin)/admin/setup/setup-client.tsx"]).toBeDefined();
    expect(files["src/app/api/admin/setup/route.ts"]).toBeDefined();
  });

  it("includes essential top-level files", () => {
    const files = getProjectFiles(baseConfig);
    for (const name of [
      "package.json",
      ".env",
      ".env.example",
      ".gitignore",
      "next.config.ts",
      "tsconfig.json",
      "drizzle.config.ts",
      "src/nexpress.config.ts",
      "src/app/layout.tsx",
    ]) {
      expect(files[name], `missing required file: ${name}`).toBeDefined();
    }
  });

  it("uses workspace:* deps when localMode, otherwise latest", () => {
    const local = getProjectFiles(baseConfig);
    const remote = getProjectFiles({ ...baseConfig, localMode: false });
    expect(local["package.json"]).toMatch(/"@nexpress\/core":\s*"workspace:\*"/);
    expect(remote["package.json"]).toMatch(/"@nexpress\/core":\s*"latest"/);
  });

  it("omits Docker artifacts when dockerSetup is false", () => {
    const without = getProjectFiles({ ...baseConfig, dockerSetup: false });
    expect(without["docker/Dockerfile"]).toBeUndefined();
    expect(without["docker/docker-compose.yml"]).toBeUndefined();
  });
});
