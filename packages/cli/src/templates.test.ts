import { describe, expect, it } from "vitest";

import { getProjectFiles } from "./templates.js";
import type { TemplateFile } from "./template-loader.js";

const baseConfig = {
  projectName: "test-site",
  includeExampleContent: true,
  dockerSetup: true,
  localMode: true,
  secret: "test-secret-32characters-min-aaaaaaaaaaaa",
};

/**
 * Test helper — the legacy assertions all operate on file contents
 * as strings, but `getProjectFiles` now returns `TemplateFile`
 * objects to carry an encoding flag (utf8 vs base64). For the
 * subset of tests that read text content, project the map down
 * to a plain `{path: string}` shape; binary entries are dropped.
 */
function textFiles(out: Record<string, TemplateFile>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) {
    if (v.encoding === "utf8") m[k] = v.content;
  }
  return m;
}

describe("getProjectFiles", () => {
  it("includes a stub generated/collections.ts so bootstrap.ts typechecks before db:generate", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    expect(files["src/db/generated/collections.ts"]).toBeDefined();
    expect(files["src/db/generated/collections.ts"]).toMatch(/export\s*\{/);
  });

  it("worker template reads DATABASE_URL inside main() so the narrowing reaches startWorker", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const worker = files["scripts/worker.ts"];
    expect(worker).toBeDefined();
    const mainIdx = worker.indexOf("async function main");
    const declIdx = worker.indexOf("const databaseUrl = process.env.DATABASE_URL");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(declIdx).toBeGreaterThan(mainIdx);
  });

  it("emits the admin login + setup route files (now as @nexpress/app wrappers)", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    expect(files["src/app/(admin)/admin/login/page.tsx"]).toBeDefined();
    expect(files["src/app/(admin)/admin/setup/page.tsx"]).toBeDefined();
    expect(files["src/app/api/admin/setup/route.ts"]).toBeDefined();
    // Each route file is a thin re-export from @nexpress/app rather
    // than a hand-coded implementation. If a scaffold's emitted
    // wrapper drifts, the reference app and the scaffold render
    // different UIs for the same flow.
    expect(files["src/app/(admin)/admin/login/page.tsx"]).toMatch(/@nexpress\/app/);
  });

  it("includes essential top-level files", () => {
    const files = textFiles(getProjectFiles(baseConfig));
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

  it("uses workspace:* deps when localMode, otherwise a pinned range", () => {
    const local = textFiles(getProjectFiles(baseConfig));
    const remote = textFiles(getProjectFiles({ ...baseConfig, localMode: false }));
    expect(local["package.json"]).toMatch(/"@nexpress\/core":\s*"workspace:\*"/);
    // Pinned to the current @nexpress family minor (SCAFFOLDED_NEXPRESS_RANGE
    // in templates.ts) instead of "latest" — keeps the scaffolded site on a
    // known-compatible major+minor across @nexpress/*.
    expect(remote["package.json"]).toMatch(/"@nexpress\/core":\s*"\^0\.\d+\.\d+"/);
    expect(remote["package.json"]).not.toMatch(/"@nexpress\/core":\s*"latest"/);
  });

  it("declares @nexpress/app as a dependency so subpath wrappers resolve", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@nexpress/app"]).toBeDefined();
  });

  it("emits a @nexpress/app snapshot — page wrappers + lib + i18n.config", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    // Page wrappers re-export from @nexpress/app/admin/* etc.
    const dashboard = files["src/app/(admin)/admin/(protected)/page.tsx"];
    expect(dashboard).toBeDefined();
    expect(dashboard).toMatch(/@nexpress\/app/);
    // The real lib/ implementations come along — @nexpress/app
    // resolves `@/lib/*` to these at consumer compile time.
    expect(files["src/lib/init-core.ts"]).toBeDefined();
    expect(files["src/lib/auth-helpers.ts"]).toBeDefined();
    // i18n.config.ts is what the root layout reads for default locale.
    expect(files["src/i18n.config.ts"]).toBeDefined();
    // Proxy (rate limits, CSRF) lives at src/proxy.ts in Next 16.
    expect(files["src/proxy.ts"]).toBeDefined();
  });

  it("omits Docker artifacts when dockerSetup is false", () => {
    const without = textFiles(getProjectFiles({ ...baseConfig, dockerSetup: false }));
    expect(without["docker/Dockerfile"]).toBeUndefined();
    expect(without["docker/docker-compose.yml"]).toBeUndefined();
    expect(without[".dockerignore"]).toBeUndefined();
  });

  it("emits .dockerignore at project root (build context root) when dockerSetup is true", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const ignore = files[".dockerignore"];
    expect(ignore).toBeDefined();
    expect(ignore).toMatch(/node_modules/);
    expect(ignore).toMatch(/\.next/);
    expect(ignore).toMatch(/\.git\b/);
  });

  it("Dockerfile runs as a non-root user with a healthcheck (production-grade scaffold)", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const dockerfile = files["docker/Dockerfile"];
    expect(dockerfile).toBeDefined();
    expect(dockerfile).toMatch(/USER nexpress/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/vips/);
    expect(dockerfile).toMatch(/NP_SECRET=placeholder/);
  });

  it("ships lib/auth-routes.ts wired to createStaffAuthRoutes", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const authRoutes = files["src/lib/auth-routes.ts"];
    expect(authRoutes).toBeDefined();
    expect(authRoutes).toMatch(/createStaffAuthRoutes/);
    expect(authRoutes).toMatch(/@nexpress\/auth-pages\/server/);
  });

  it("api/auth route files re-export from @nexpress/app (thin wrappers)", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const login = files["src/app/api/auth/login/route.ts"];
    const logout = files["src/app/api/auth/logout/route.ts"];
    const me = files["src/app/api/auth/me/route.ts"];
    expect(login).toMatch(/@nexpress\/app\/api\/auth\/login\/route/);
    expect(logout).toMatch(/@nexpress\/app\/api\/auth\/logout\/route/);
    expect(me).toMatch(/@nexpress\/app\/api\/auth\/me\/route/);
    // None should still carry the legacy hand-coded body.
    expect(login).not.toMatch(/verifyPassword|signToken|hashPassword/);
  });

  it("docker-compose ships Mailpit alongside Postgres for local SMTP capture", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const compose = files["docker/docker-compose.yml"];
    expect(compose).toBeDefined();
    expect(compose).toMatch(/mailpit/i);
    expect(compose).toMatch(/8025/);
    expect(compose).toMatch(/1025/);
  });

  it(".env.example points NP_SMTP_* at Mailpit by default", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const env = files[".env.example"];
    expect(env).toBeDefined();
    expect(env).toMatch(/NP_EMAIL_ADAPTER=smtp/);
    expect(env).toMatch(/NP_SMTP_HOST=localhost/);
    expect(env).toMatch(/NP_SMTP_PORT=1025/);
  });

  it("emits vercel.json with the scheduled-publish cron entry", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const vercel = files["vercel.json"];
    expect(vercel).toBeDefined();
    const parsed = JSON.parse(vercel) as { crons: Array<{ path: string; schedule: string }> };
    expect(parsed.crons).toHaveLength(1);
    expect(parsed.crons[0]?.path).toBe("/api/internal/publish-scheduled");
  });

  it("ships scripts/_load-env.ts so doctor.ts's first import resolves", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    expect(files["scripts/_load-env.ts"]).toBeDefined();
    expect(files["scripts/_load-env.ts"]).toMatch(/loadEnv/);
  });

  it("doctor.ts has --prod mode that tightens secret-length to error", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const doctor = files["scripts/doctor.ts"];
    expect(doctor).toBeDefined();
    expect(doctor).toMatch(/PROD_MODE/);
    expect(doctor).toMatch(/--prod/);
    expect(doctor).toMatch(/PROD_MODE \? "error" : "warn"/);
  });

  it("doctor.ts adds the four prod-only checks (jobs / storage / SITE_URL https / scheduler token)", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const doctor = files["scripts/doctor.ts"];
    expect(doctor).toMatch(/checkJobsEnabledProd/);
    expect(doctor).toMatch(/checkStorageProd/);
    expect(doctor).toMatch(/checkSiteUrlProd/);
    expect(doctor).toMatch(/checkSchedulerTokenProd/);
  });

  it("package.json exposes a doctor:prod script", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["doctor:prod"]).toBe("tsx scripts/doctor.ts --prod");
  });
});
