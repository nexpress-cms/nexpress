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
const CORE_PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../core/package.json"), "utf-8"),
) as {
  version: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};
const CORE_PACKAGE_VERSION: string = CORE_PACKAGE_JSON.version;
const CORE_SHARP_RANGE: string = CORE_PACKAGE_JSON.dependencies.sharp;
const CORE_NODEMAILER_RANGE: string =
  CORE_PACKAGE_JSON.peerDependencies.nodemailer.split(" || ").at(-1) ?? "";

const baseConfig = {
  projectName: "test-site",
  projectPath: "test-site",
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
    expect(worker).toMatch(/intent: "worker"/);
    expect(worker).toMatch(/configureEmailRuntimeFromEnv\(process\.env\)/);
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
      "docs/ops.md",
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
    expect(workspaceYaml).toMatch(/^packages:/m);
    expect(workspaceYaml).toMatch(/^\s+- "packages\/plugins\/\*"$/m);
    expect(workspaceYaml).toMatch(/^\s+- "packages\/themes\/\*"$/m);
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

  it("declares sharp directly so Vercel standalone traces native media deps", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.dependencies.sharp).toBe(CORE_SHARP_RANGE);
  });

  it("declares nodemailer directly for the default SMTP runtime", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.dependencies.nodemailer).toBe(CORE_NODEMAILER_RANGE);
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
      "@nexpress/auth-pages",
      "@nexpress/blocks",
      "@nexpress/core",
      "@nexpress/editor",
      "@nexpress/gettext",
      "@nexpress/next",
      "@nexpress/plugin-sdk",
      "@nexpress/theme",
      "@nexpress/theme-default",
      "@nexpress/theme-docs",
      "@nexpress/theme-magazine",
      "@nexpress/theme-portfolio",
      "@nexpress/xliff",
    ];
    for (const dep of families) {
      expect(remote["package.json"], `expected ${dep} pinned to ${CORE_PACKAGE_VERSION}`).toContain(
        `"${dep}": "${CORE_PACKAGE_VERSION}"`,
      );
    }
  });

  it("pins the project-side @nexpress/cli dev dependency to the family version", () => {
    const remote = textFiles(getProjectFiles({ ...baseConfig, localMode: false }));
    expect(remote["package.json"]).toContain(`"@nexpress/cli": "${CORE_PACKAGE_VERSION}"`);
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

  it("docker-compose pins a project-specific Compose name", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const compose = files["docker/docker-compose.yml"];
    expect(compose).toBeDefined();
    expect(compose).toMatch(/^name: test-site$/m);
    expect(compose).not.toMatch(/^name: docker$/m);
  });

  it("package.json pins the pnpm package manager used by the scaffold", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as { packageManager?: string };
    expect(pkg.packageManager).toBe("pnpm@10.33.0");
  });

  it("README documents .env-backed non-interactive setup and executable worker startup", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const readme = files["README.md"];
    const ops = files["docs/ops.md"];
    expect(readme).toContain("read existing .env, then env overrides");
    expect(readme).toContain("reads the existing `.env` first");
    expect(readme).toContain("NP_ENABLE_JOBS=1 pnpm run worker");
    expect(ops).toContain("`pnpm run worker` on a separate worker host");
    expect(readme).not.toContain("read everything from env vars");
    expect(readme).not.toContain("Non-interactive mode reads `DATABASE_URL` (required)");
  });

  it(".env.example points NP_SMTP_* at Mailpit by default", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const env = files[".env.example"];
    expect(env).toBeDefined();
    expect(env).toMatch(/NP_EMAIL_ADAPTER=smtp/);
    expect(env).toMatch(/NP_SMTP_HOST=localhost/);
    expect(env).toMatch(/NP_SMTP_PORT=1025/);
    expect(env).toMatch(/NP_SMTP_USER=dev/);
    expect(env).toMatch(/NP_SMTP_PASS=dev/);
    expect(env).toMatch(/NP_SMTP_FROM="NexPress dev <noreply@nexpress\.local>"/);
    expect(env).toMatch(/NP_SMTP_SECURE=false/);
    expect(env).toContain("exact modes are noop, smtp, or custom");
  });

  it(".env.example documents the exact storage runtime contract", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const env = files[".env.example"];
    const readme = files["README.md"];

    expect(env).toContain("Exact modes are local, s3, or custom");
    expect(env).toContain("# NP_STORAGE_DIR=./public/media");
    expect(env).toContain("# NP_STORAGE_URL=/media");
    expect(readme).toContain("The exact `custom` mode requires");
    expect(readme).toContain("src/lib/bootstrap.ts");
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
    expect(pkg.scripts["ops:backup"]).toBe("tsx scripts/ops-backup.ts");
    expect(pkg.scripts["ops:contracts"]).toBe("tsx scripts/ops-contracts.ts");
    expect(pkg.scripts["ops:health"]).toBe("tsx scripts/ops-health.ts");
    expect(pkg.scripts["ops:jobs"]).toBe("tsx scripts/ops-jobs.ts");
    expect(pkg.scripts["ops:migrate"]).toBe("tsx scripts/ops-migrate.ts");
    expect(pkg.scripts["ops:plugins"]).toBe("tsx scripts/ops-plugins.ts");
    expect(pkg.scripts["ops:preflight"]).toBe("tsx scripts/ops-preflight.ts");
    expect(pkg.scripts["ops:release"]).toBe("tsx scripts/release.ts");
    expect(pkg.scripts["ops:runbook"]).toBe("tsx scripts/runbook.ts");
    expect(pkg.scripts["ops:status"]).toBe("tsx scripts/ops-status.ts");
    expect(pkg.scripts["ops:storage"]).toBe("tsx scripts/ops-storage.ts");
    expect(pkg.scripts.release).toBe("tsx scripts/release.ts");
    expect(pkg.scripts.runbook).toBe("tsx scripts/runbook.ts");
  });

  it("ships bootstrapped XLIFF and Gettext translation CLIs", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(pkg.scripts.xliff).toBe("tsx scripts/xliff.ts");
    expect(pkg.scripts.gettext).toBe("tsx scripts/gettext.ts");
    expect(pkg.dependencies["@nexpress/xliff"]).toBe("workspace:*");
    expect(pkg.dependencies["@nexpress/gettext"]).toBe("workspace:*");
    for (const adapter of ["xliff", "gettext"]) {
      const script = files[`scripts/${adapter}.ts`];
      expect(script).toMatch(new RegExp(`@nexpress/${adapter}`));
      expect(script).toMatch(/createBootstrap/);
      expect(script).toMatch(/ensurePluginsLoaded/);
      expect(script).not.toMatch(/@\/lib\/init-core/);
    }
  });

  it("routes build through the shared NexPress build guard", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const pkg = JSON.parse(files["package.json"]) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.build).toBe("tsx scripts/build.ts");
    expect(files["scripts/build.ts"]).toMatch(/@nexpress\/app\/scripts\/build/);
  });

  it("ops scripts are thin wrappers over @nexpress/app's shared ops scripts", () => {
    const files = textFiles(getProjectFiles(baseConfig));
    const opsStatus = files["scripts/ops-status.ts"];
    const opsPreflight = files["scripts/ops-preflight.ts"];
    const opsHealth = files["scripts/ops-health.ts"];
    const opsBackup = files["scripts/ops-backup.ts"];
    const opsContracts = files["scripts/ops-contracts.ts"];
    const opsJobs = files["scripts/ops-jobs.ts"];
    const opsMigrate = files["scripts/ops-migrate.ts"];
    const opsPlugins = files["scripts/ops-plugins.ts"];
    const opsStorage = files["scripts/ops-storage.ts"];
    const release = files["scripts/release.ts"];
    const runbook = files["scripts/runbook.ts"];
    expect(opsStatus).toBeDefined();
    expect(opsPreflight).toBeDefined();
    expect(opsHealth).toBeDefined();
    expect(opsBackup).toBeDefined();
    expect(opsContracts).toBeDefined();
    expect(opsJobs).toBeDefined();
    expect(opsMigrate).toBeDefined();
    expect(opsPlugins).toBeDefined();
    expect(opsStorage).toBeDefined();
    expect(release).toBeDefined();
    expect(runbook).toBeDefined();
    expect(opsStatus).toMatch(/@nexpress\/app\/scripts\/ops-status/);
    expect(opsPreflight).toMatch(/@nexpress\/app\/scripts\/ops-preflight/);
    expect(opsHealth).toMatch(/@nexpress\/app\/scripts\/ops-health/);
    expect(opsBackup).toMatch(/@nexpress\/app\/scripts\/ops-backup/);
    expect(opsContracts).toMatch(/@nexpress\/app\/scripts\/ops-contracts/);
    expect(opsJobs).toMatch(/@nexpress\/app\/scripts\/ops-jobs/);
    expect(opsMigrate).toMatch(/@nexpress\/app\/scripts\/ops-migrate/);
    expect(opsPlugins).toMatch(/@nexpress\/app\/scripts\/ops-plugins/);
    expect(opsStorage).toMatch(/@nexpress\/app\/scripts\/ops-storage/);
    expect(release).toMatch(/@nexpress\/app\/scripts\/release/);
    expect(runbook).toMatch(/@nexpress\/app\/scripts\/runbook/);
    for (const script of [
      opsStatus,
      opsPreflight,
      opsHealth,
      opsBackup,
      opsContracts,
      opsJobs,
      opsMigrate,
      opsPlugins,
      opsStorage,
      release,
      runbook,
    ]) {
      expect(
        script.split("\n").filter((line) => line.trim().length > 0).length,
      ).toBeLessThanOrEqual(3);
    }
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
    const ops = files["docs/ops.md"];
    expect(readme).toContain("pnpm run setup");
    expect(readme).toContain("## Quickstart");
    expect(readme).toContain("## First Site");
    expect(readme).toContain("## Useful Checks");
    expect(readme).toContain("[docs/ops.md](docs/ops.md)");
    expect(readme).toContain("pnpm run ops:status -- --brief --no-color");
    expect(readme).toContain("pnpm run doctor");
    expect(readme).toContain("registerJobHandler(name, handler, { parsePayload })");
    expect(readme).toContain("NP_ENABLE_JOBS` accepts only");
    expect(readme).toContain("## Deploy Bridge");
    expect(readme).toContain("pnpm run deploy:plan -- --target vercel --brief --no-color");
    expect(readme).toContain("target's first launch action");
    expect(readme).toContain("Railway project creation");
    expect(readme).toContain("Docker image build");
    expect(readme).toContain("pnpm db:migrate");
    expect(readme).toContain("production `DATABASE_URL` is already injected");
    expect(readme).toContain("do not depend on");
    expect(readme).toContain("pnpm run ops:preflight -- --target vercel --brief --no-color");
    expect(readme).toContain("pnpm --silent run ops:release -- check --target vercel --json");
    expect(readme).toContain(
      "pnpm --silent run ops:release -- verify --url https://your-domain.example --json",
    );
    expect(readme).not.toContain("pnpm --silent run ops:backup -- status --json");
    expect(readme).not.toContain('schemaVersion: "np.ops.v1"');
    expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(100);

    expect(ops).toContain("## Deploy Bridge");
    expect(ops).toContain("pnpm run deploy:plan -- --target vercel --brief --no-color");
    expect(ops).toContain("`Start here` in the plan gives the first host-specific launch action");
    expect(ops).toContain("Vercel import URL");
    expect(ops).toContain("Railway dashboard / CLI path");
    expect(ops).toContain("Render web service /");
    expect(ops).toContain("`fly launch`");
    expect(ops).toContain("pnpm db:migrate");
    expect(ops).toContain(
      "`pnpm db:migrate` must run where the production `DATABASE_URL` is available",
    );
    expect(ops).toContain("pnpm db:migrate && pnpm build");
    expect(ops).toContain("pnpm run ops:preflight -- --target vercel --brief --no-color");
    expect(ops).toContain("pnpm --silent run ops:release -- check --target vercel --json");
    expect(ops).toContain(
      "pnpm --silent run ops:release -- verify --url https://your-domain.example --json",
    );
    expect(ops).toContain("pnpm --silent run ops:status -- --json");
    expect(ops).toContain("pnpm --silent run ops:contracts -- --json");
    expect(ops).toContain("pnpm --silent run ops:preflight -- --target vercel --json");
    expect(ops).toContain('schemaVersion: "np.ops-contracts.v1"');
    expect(ops).toContain("`ops:preflight` combines `deploy:plan`, the production doctor, and");
    expect(ops).toContain("pnpm run ops:health -- --url http://localhost:3000 --brief --no-color");
    expect(ops).toContain("pnpm --silent run ops:migrate -- plan --json");
    expect(ops).toContain("backup/apply/verify handoff actions");
    expect(ops).toContain("pnpm --silent run ops:backup -- status --json");
    expect(ops).toContain("pnpm --silent run ops:backup -- create --json");
    expect(ops).toContain("pnpm --silent run ops:backup -- verify latest --json");
    expect(ops).toContain("record/verify/restore handoff");
    expect(ops).toContain("Backup and restore reports also include `plan.nextCommands`");
    expect(ops).toContain("pnpm --silent run ops:jobs -- --json");
    expect(ops).toContain('pnpm --silent run ops:jobs -- pause --reason "maintenance" --json');
    expect(ops).toContain("pnpm --silent run ops:jobs -- resume --json");
    expect(ops).toContain("pnpm --silent run ops:jobs -- retry-all --state failed --json");
    expect(ops).toContain(
      "pnpm --silent run ops:jobs -- retry-all --state failed --execute --approve retry-all --json",
    );
    expect(ops).toContain("pnpm --silent run ops:jobs -- drain --execute --approve drain --json");
    expect(ops).toContain("pnpm --silent run ops:storage -- --json");
    expect(ops).toContain("pnpm --silent run ops:storage -- verify --json");
    expect(ops).toContain("pnpm --silent run ops:storage -- missing-files --json");
    expect(ops).toContain("pnpm --silent run ops:storage -- orphaned-files --json");
    expect(ops).toContain("pnpm --silent run ops:storage -- migrate plan --target s3 --json");
    expect(ops).toContain("pnpm --silent run ops:storage -- test --json");
    expect(ops).toContain(
      "pnpm --silent run ops:storage -- test --execute --approve storage-test --json",
    );
    expect(ops).toContain("pnpm --silent run ops:plugins -- list --json");
    expect(ops).toContain("pnpm --silent run ops:plugins -- doctor --json");
    expect(ops).toContain("pnpm --silent run ops:plugins -- inspect reading-time --json");
    expect(ops).toContain("pnpm --silent run ops:plugins -- upgrade-plan reading-time --json");
    expect(ops).toContain("first suggested inspect command");
    expect(ops).toContain("pnpm --silent run ops:release -- check --target vercel --json");
    expect(ops).toContain("pnpm --silent run ops:release -- plan --target vercel --json");
    expect(ops).toContain(
      "pnpm --silent run ops:release -- apply --plan .nexpress/releases/<plan>.json --json",
    );
    expect(ops).toContain("release-apply allowlist");
    expect(ops).toContain("structured argv specs");
    expect(ops).toContain(
      "pnpm --silent run ops:release -- verify --url http://localhost:3000 --json",
    );
    expect(ops).toContain("pnpm --silent run ops:runbook -- worker-not-draining --json");
    expect(ops).toContain(
      "pnpm --silent run ops:runbook -- migration-crashed --json --out .nexpress/runbooks/migration-crashed.json",
    );
    expect(ops).toContain('schemaVersion: "np.ops.v1"');
    expect(ops).toContain("pnpm run doctor -- --fix-plan");
    expect(ops).toContain("pnpm run doctor:prod -- --target vercel --fix-plan");
    expect(ops).toContain("pnpm run deploy:plan -- --target vercel --brief --no-color");
    expect(ops).toContain("pnpm run doctor:prod -- --target vercel --brief --no-color");
    expect(ops).toContain("pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan");
    expect(ops).toContain("pnpm --silent run deploy:plan -- --target vercel --json");
    expect(ops).toContain("pnpm --silent run doctor:prod -- --target vercel --json --fix-plan");
    expect(ops).toContain("nextCommands");
    expect(ops).toContain("nextCommand");
    expect(ops).toContain("plan.nextCommands");
    expect(ops).toContain("execution.projectNextCommand");
    expect(ops).toContain("projectCommand");
    expect(ops).toContain("projectNextCommand");
    expect(ops).toContain("fixPlan[].nextCommand");
    expect(ops).toContain("Deploy with Vercel");
    expect(ops).toContain("https://vercel.com/new?utm_source=nexpress");
    expect(ops).toContain("NP_STORAGE_ADAPTER=s3");
    expect(ops).toContain("NP_S3_ENDPOINT");
    expect(ops).toContain("pnpm db:migrate");
    expect(ops).toContain("not depend on `vercel env pull`");
    expect(ops).toContain("Other Hosting Choices");
    expect(ops).toContain("railway init && railway up");
    expect(ops).toContain("render.yaml");
    expect(ops).toContain("docker build -f docker/Dockerfile -t nexpress .");
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
