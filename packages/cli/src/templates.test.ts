import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getProjectFiles } from "./templates.js";
import type { TemplateFile } from "./template-loader.js";

// Single source of truth for the @nexpress/* family version that
// scaffolded sites should pin to. `tsup.config.ts` + `vitest.config.ts`
// inject this same string into the bundle / test environment via
// `define`; the assertion below catches the case where the build
// machinery drifts (e.g. someone bumps `packages/core` but forgets to
// rebuild the CLI). We read the file directly rather than touch
// `__NEXPRESS_PACKAGE_VERSION__` so the test verifies the END output
// — the rendered package.json — rather than just echoing the constant
// back.
const CORE_PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../core/package.json"), "utf-8")) as {
    version: string;
  }
).version;

const baseConfig = {
  projectName: "test-site",
  dockerSetup: true,
  localMode: true,
  secret: "test-secret-32characters-min-aaaaaaaaaaaa",
  // Pinned port so the test isn't coupled to dbPortFromProject's
  // exact hash output. Picked a value clearly inside the 5433–6432
  // range so the assertions can match it literally.
  dbPort: 5500,
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

  it("worker template is a thin wrapper that hands ensureFor to @nexpress/app's runWorker", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const worker = files["scripts/worker.ts"];
    expect(worker).toBeDefined();
    // Wrapper invariants — the substance (DATABASE_URL guard, signal
    // handlers, builtin-job context wiring) lives in @nexpress/app's
    // shared `runWorker`. The scaffold's job is to bootstrap directly
    // via `createBootstrap` (NOT via `@/lib/init-core`, which transits
    // through @nexpress/app's compiled chunks whose `@/lib/bootstrap`
    // imports tsx can't resolve in node_modules) and feed an
    // equivalent `ensureFor` to `runWorker`.
    expect(worker).toMatch(/@nexpress\/app\/scripts\/worker/);
    expect(worker).toMatch(/createBootstrap/);
    expect(worker).toMatch(/ensureFor/);
    expect(worker).toMatch(/runWorker\(\s*\{\s*ensureFor\s*\}\s*\)/);
    // Must NOT re-import from @/lib/init-core — the whole point of
    // the createBootstrap inline is to avoid that broken chain.
    expect(worker).not.toMatch(/@\/lib\/init-core/);
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
      "pnpm-workspace.yaml",
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

  it("pre-approves native-build deps via pnpm-workspace.yaml allowBuilds", () => {
    // pnpm 10.6+ ignores `pnpm.onlyBuiltDependencies` in package.json
    // for non-workspace projects; the live allowlist is here. Without
    // these entries a fresh `pnpm install` warns ERR_PNPM_IGNORED_BUILDS
    // and the operator has to manually run `pnpm approve-builds`
    // before any feature backed by sharp / argon2 / esbuild works.
    const files = textFiles(getProjectFiles(baseConfig));
    const workspaceYaml = files["pnpm-workspace.yaml"];
    expect(workspaceYaml).toBeDefined();
    expect(workspaceYaml).toMatch(/^allowBuilds:/m);
    expect(workspaceYaml).toMatch(/^\s+sharp:\s*true$/m);
    expect(workspaceYaml).toMatch(/^\s+"@node-rs\/argon2":\s*true$/m);
    expect(workspaceYaml).toMatch(/^\s+esbuild:\s*true$/m);
    // The old `pnpm.onlyBuiltDependencies` block in package.json
    // is silently ignored by current pnpm and was removed alongside
    // adding the workspace.yaml. Guard against its accidental
    // reintroduction (two places for the same intent drift).
    expect(files["package.json"]).not.toMatch(/onlyBuiltDependencies/);
  });

  it("uses workspace:* deps when localMode, otherwise an exact @nexpress/core pin", () => {
    const local = textFiles(getProjectFiles(baseConfig));
    const remote = textFiles(getProjectFiles({ ...baseConfig, localMode: false }));
    expect(local["package.json"]).toMatch(/"@nexpress\/core":\s*"workspace:\*"/);
    // Pinned to the EXACT current `@nexpress/core` version (injected
    // at build / test time from `packages/core/package.json` — see
    // `tsup.config.ts` + `vitest.config.ts`). The check uses the
    // literal version string rather than a range pattern, so a stale
    // pin (CLI built against an older core than what's in the repo
    // now) fails loudly. Drift causes:
    //   1. A `@nexpress/core` patch bumps in `packages/core/package.json`.
    //   2. `create-nexpress`'s next build picks up the new version
    //      via `define` injection automatically.
    //   3. This assertion confirms the build-time string matches the
    //      current source-of-truth version.
    expect(remote["package.json"]).toContain(`"@nexpress/core": "${CORE_PACKAGE_VERSION}"`);
    expect(remote["package.json"]).not.toMatch(/"@nexpress\/core":\s*"latest"/);
    // Sanity: scaffolded sites must NOT pin a range (caret / tilde)
    // — exact pin is the contract operators rely on for
    // reproducibility across `npx create-nexpress` invocations.
    expect(remote["package.json"]).not.toMatch(/"@nexpress\/core":\s*"[\^~]/);
  });

  it("pins every @nexpress/* family member to the same exact version", () => {
    const remote = textFiles(getProjectFiles({ ...baseConfig, localMode: false }));
    // Every workspace-published `@nexpress/*` dep should resolve to
    // the same literal string — operators rely on the family staying
    // in lockstep, and a mismatch (e.g. core@0.3.2 + admin@0.3.1)
    // would surface as cryptic peer-dep failures later in `pnpm install`.
    const families = [
      "@nexpress/admin",
      "@nexpress/app",
      "@nexpress/blocks",
      "@nexpress/core",
      "@nexpress/editor",
      "@nexpress/next",
      "@nexpress/theme",
      "@nexpress/theme-default",
      "@nexpress/theme-docs",
      "@nexpress/theme-magazine",
      "@nexpress/theme-portfolio",
    ];
    for (const dep of families) {
      expect(remote["package.json"], `expected ${dep} pinned to ${CORE_PACKAGE_VERSION}`).toContain(
        `"${dep}": "${CORE_PACKAGE_VERSION}"`,
      );
    }
  });

  it("emits NP_ADMIN_THEME only as a commented hint — the picker lives in the wizard", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    // Theme picking happens in /admin/setup at first boot. The
    // scaffold never bakes a live `NP_ADMIN_THEME=` line; operators
    // who need a headless preset uncomment the hint manually.
    expect(files[".env.example"]).not.toMatch(/^NP_ADMIN_THEME=/m);
    expect(files[".env"]).not.toMatch(/^NP_ADMIN_THEME=/m);
    expect(files[".env.example"]).toMatch(/^# NP_ADMIN_THEME=/m);
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

  it("ships lib/auth-routes.ts as a thin wrapper over @nexpress/app/lib/auth-routes", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const authRoutes = files["src/lib/auth-routes.ts"];
    expect(authRoutes).toBeDefined();
    // Real implementation now lives in @nexpress/app/lib/auth-routes; the
    // scaffold ships a one-line re-export so operators don't carry the
    // factory wiring in their project.
    expect(authRoutes).toMatch(/@nexpress\/app\/lib\/auth-routes/);
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

  it(".env writes the project-specific DB port to both NEXPRESS_DB_PORT and DATABASE_URL", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    for (const path of [".env", ".env.example"]) {
      const env = files[path];
      expect(env, `${path} missing`).toBeDefined();
      // The compose file reads `${NEXPRESS_DB_PORT:-5433}`; the
      // DATABASE_URL must point at the same host port or the
      // wizard's Postgres connection fails after compose binds
      // somewhere else.
      expect(env).toMatch(/^NEXPRESS_DB_PORT=5500$/m);
      expect(env).toMatch(/DATABASE_URL=postgres:\/\/[^@]+@localhost:5500\//);
    }
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
    // Thin wrapper — substance lives in @nexpress/app/scripts/_load-env.
    expect(files["scripts/_load-env.ts"]).toMatch(/@nexpress\/app\/scripts\/_load-env/);
  });

  it("doctor.ts is a thin wrapper over @nexpress/app's shared doctor (--prod mode lives there)", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const doctor = files["scripts/doctor.ts"];
    expect(doctor).toBeDefined();
    // The actual PROD_MODE / checkJobsEnabledProd / etc. surface lives
    // in `@nexpress/app/src/scripts/doctor.ts` so apps/web and every
    // scaffold use byte-identical checks. The wrapper is a 1-line
    // import.
    expect(doctor).toMatch(/@nexpress\/app\/scripts\/doctor/);
    expect(doctor.split("\n").filter((l) => l.trim().length > 0).length).toBeLessThanOrEqual(3);
  });

  it("package.json exposes a doctor:prod script", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["doctor:prod"]).toBe("tsx scripts/doctor.ts --prod");
  });

  it("package.json exposes a deploy plan script backed by @nexpress/app", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["deploy:plan"]).toBe("tsx scripts/deploy-plan.ts");
    expect(files["scripts/deploy-plan.ts"]).toMatch(/@nexpress\/app\/scripts\/deploy-plan/);
  });

  it("package.json runs manual migrations through the shared error-rich runner", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["db:migrate"]).toBe("tsx scripts/run-migrations.ts");
    expect(files["scripts/run-migrations.ts"]).toMatch(/@nexpress\/app\/scripts\/run-migrations/);
  });

  it("scaffold README follows the current setup-first onboarding path", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const readme = files["README.md"];
    expect(readme).toContain("pnpm run setup");
    expect(readme).toContain("## First-site checklist");
    expect(readme).toContain("pnpm run deploy:plan -- --target vercel");
    expect(readme).toContain("pnpm run doctor:prod -- --target vercel");
    expect(readme).toContain("pnpm run deploy:plan -- --target vercel --brief --no-color");
    expect(readme).toContain("pnpm run doctor:prod -- --target vercel --brief --no-color");
    expect(readme).toContain("Deploy with Vercel");
    expect(readme).toContain("https://vercel.com/new?utm_source=nexpress");
    expect(readme).toContain("NP_STORAGE_ADAPTER=s3");
    expect(readme).toContain("NP_S3_ENDPOINT");
    expect(readme).toContain("pnpm db:migrate");
    expect(readme).toContain("Other hosting choices");
    expect(readme).not.toMatch(/cp \.env\.example \.env\s*\n\s*pnpm build\s*\n\s*pnpm dev/);
  });

  it("package.json exposes seed:content for setup's one-step sample-content path", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["seed:content"]).toBe("tsx scripts/seed-content.ts");
    expect(files["scripts/seed-content.ts"]).toMatch(/seedAll/);
  });
});
