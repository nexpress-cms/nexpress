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
    expect(without[".dockerignore"]).toBeUndefined();
  });

  it("emits .dockerignore at project root (build context root) when dockerSetup is true", () => {
    const files = getProjectFiles(baseConfig);
    const ignore = files[".dockerignore"];
    expect(ignore).toBeDefined();
    // Without these the build context balloons; the previous template
    // had no .dockerignore and pulled in node_modules + .git + .next.
    expect(ignore).toMatch(/node_modules/);
    expect(ignore).toMatch(/\.next/);
    expect(ignore).toMatch(/\.git\b/);
  });

  it("Dockerfile runs as a non-root user with a healthcheck (production-grade scaffold)", () => {
    const files = getProjectFiles(baseConfig);
    const dockerfile = files["docker/Dockerfile"];
    expect(dockerfile).toBeDefined();
    expect(dockerfile).toMatch(/USER nexpress/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    // sharp needs libvips at runtime; missing it surfaces as a cryptic
    // error on first image-upload, not at build time.
    expect(dockerfile).toMatch(/vips/);
    // Build-time placeholder for nexpress.config.ts's zod validation.
    expect(dockerfile).toMatch(/NP_SECRET=placeholder/);
  });

  it("ships lib/auth-routes.ts wired to createStaffAuthRoutes", () => {
    const files = getProjectFiles(baseConfig);
    const authRoutes = files["src/lib/auth-routes.ts"];
    expect(authRoutes).toBeDefined();
    expect(authRoutes).toMatch(/createStaffAuthRoutes/);
    expect(authRoutes).toMatch(/@nexpress\/auth-pages\/server/);
  });

  it("api/auth route files are 2-line factory re-exports (not hand-coded)", () => {
    const files = getProjectFiles(baseConfig);
    const login = files["src/app/api/auth/login/route.ts"];
    const logout = files["src/app/api/auth/logout/route.ts"];
    const me = files["src/app/api/auth/me/route.ts"];
    expect(login).toBeDefined();
    expect(logout).toBeDefined();
    expect(me).toBeDefined();
    // Each route imports the bootstrapped handlers and re-exports.
    expect(login).toMatch(/staffAuthRoutes\.login/);
    expect(logout).toMatch(/staffAuthRoutes\.logout/);
    expect(me).toMatch(/staffAuthRoutes\.meGet/);
    // None of them should still carry the legacy hand-coded body.
    expect(login).not.toMatch(/verifyPassword|signToken|hashPassword/);
    expect(logout).not.toMatch(/optionalAuth|runHook/);
    expect(me).not.toMatch(/requireAuth|npSuccessResponse/);
  });

  it("docker-compose ships Mailpit alongside Postgres for local SMTP capture", () => {
    const files = getProjectFiles(baseConfig);
    const compose = files["docker/docker-compose.yml"];
    expect(compose).toBeDefined();
    expect(compose).toMatch(/mailpit/i);
    expect(compose).toMatch(/8025/);
    expect(compose).toMatch(/1025/);
  });

  it(".env.example points NP_SMTP_* at Mailpit by default", () => {
    const files = getProjectFiles(baseConfig);
    const env = files[".env.example"];
    expect(env).toBeDefined();
    expect(env).toMatch(/NP_EMAIL_ADAPTER=smtp/);
    expect(env).toMatch(/NP_SMTP_HOST=localhost/);
    expect(env).toMatch(/NP_SMTP_PORT=1025/);
  });

  it("emits vercel.json with the scheduled-publish cron entry", () => {
    const files = getProjectFiles(baseConfig);
    const vercel = files["vercel.json"];
    expect(vercel).toBeDefined();
    const parsed = JSON.parse(vercel) as { crons: Array<{ path: string; schedule: string }> };
    expect(parsed.crons).toHaveLength(1);
    expect(parsed.crons[0]?.path).toBe("/api/internal/publish-scheduled");
  });

  it("ships scripts/_load-env.ts so doctor.ts's first import resolves", () => {
    // doctor.ts (and any future script that touches nexpress.config.ts)
    // does `import "./_load-env.js"` as its very first line. Without
    // the template file, `pnpm doctor` crashes at module load with
    // ERR_MODULE_NOT_FOUND. This test exists so the template ships
    // alongside doctor.ts forever, not as a follow-up commit.
    const files = getProjectFiles(baseConfig);
    expect(files["scripts/_load-env.ts"]).toBeDefined();
    expect(files["scripts/_load-env.ts"]).toMatch(/loadEnv/);
  });

  it("doctor.ts has --prod mode that tightens secret-length to error", () => {
    const files = getProjectFiles(baseConfig);
    const doctor = files["scripts/doctor.ts"];
    expect(doctor).toBeDefined();
    expect(doctor).toMatch(/PROD_MODE/);
    expect(doctor).toMatch(/--prod/);
    // Sub-floor secret must escalate to error in prod, not warn.
    expect(doctor).toMatch(/PROD_MODE \? "error" : "warn"/);
  });

  it("doctor.ts adds the four prod-only checks (jobs / storage / SITE_URL https / scheduler token)", () => {
    const files = getProjectFiles(baseConfig);
    const doctor = files["scripts/doctor.ts"];
    expect(doctor).toMatch(/checkJobsEnabledProd/);
    expect(doctor).toMatch(/checkStorageProd/);
    expect(doctor).toMatch(/checkSiteUrlProd/);
    expect(doctor).toMatch(/checkSchedulerTokenProd/);
  });

  it("package.json exposes a doctor:prod script", () => {
    const files = getProjectFiles(baseConfig);
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["doctor:prod"]).toBe("tsx scripts/doctor.ts --prod");
  });
});
