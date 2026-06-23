import { defineConfig } from "tsup";

/**
 * Every consumer-importable subpath gets its own dist entry so the
 * resolution is plain `*.js` files in `dist/...` — no reliance on
 * `tsx` / loader hooks to transpile our `.ts` source at runtime.
 *
 * The earlier shape (raw `.ts` published + `tsx`'s ESM hook on the
 * consumer side) tripped `ERR_PACKAGE_PATH_NOT_EXPORTED` on
 * scaffolded sites because tsx's resolver doesn't apply Node export
 * pattern wildcards over `.ts` targets. Building everything as ESM
 * `.js` removes that whole class of fragility (0.2.0 → 0.2.1 fix,
 * 2026-05-14).
 *
 * What stays raw (.tsx in src/, served via the `exports` map):
 *   - admin/site/member/api/root page+route files — consumed by
 *     Next.js through `transpilePackages`; Next's bundler handles
 *     `.tsx` natively, so building them again here would just be
 *     duplicate work + risk diverging from Next's expected shape.
 *
 * What gets built (this file):
 *   - root `index.ts`
 *   - every `scripts/*.ts` — run by `tsx scripts/<name>.ts` in
 *     scaffolded projects via the wrapper
 *   - every `lib/*.ts(x)` — imported by scaffolded `src/lib/*`
 *     wrappers AND by other parts of `@nexpress/app` during build
 */
const scriptEntries = {
  "scripts/_load-env": "src/scripts/_load-env.ts",
  "scripts/deploy-plan": "src/scripts/deploy-plan.ts",
  "scripts/deploy-plan-core": "src/scripts/deploy-plan-core.ts",
  "scripts/deploy-targets": "src/scripts/deploy-targets.ts",
  "scripts/dev-notice": "src/scripts/dev-notice.ts",
  "scripts/doctor": "src/scripts/doctor.ts",
  "scripts/doctor-fix-plan": "src/scripts/doctor-fix-plan.ts",
  "scripts/doctor-output": "src/scripts/doctor-output.ts",
  "scripts/doctor-readiness": "src/scripts/doctor-readiness.ts",
  "scripts/generate-schema": "src/scripts/generate-schema.ts",
  "scripts/ops-backup": "src/scripts/ops-backup.ts",
  "scripts/ops-backup-core": "src/scripts/ops-backup-core.ts",
  "scripts/ops-contracts": "src/scripts/ops-contracts.ts",
  "scripts/ops-contracts-core": "src/scripts/ops-contracts-core.ts",
  "scripts/ops-health": "src/scripts/ops-health.ts",
  "scripts/ops-jobs": "src/scripts/ops-jobs.ts",
  "scripts/ops-jobs-core": "src/scripts/ops-jobs-core.ts",
  "scripts/ops-migrate": "src/scripts/ops-migrate.ts",
  "scripts/ops-migrate-core": "src/scripts/ops-migrate-core.ts",
  "scripts/ops-plugins": "src/scripts/ops-plugins.ts",
  "scripts/ops-plugins-core": "src/scripts/ops-plugins-core.ts",
  "scripts/ops-preflight": "src/scripts/ops-preflight.ts",
  "scripts/ops-status": "src/scripts/ops-status.ts",
  "scripts/ops-status-core": "src/scripts/ops-status-core.ts",
  "scripts/ops-storage": "src/scripts/ops-storage.ts",
  "scripts/ops-storage-core": "src/scripts/ops-storage-core.ts",
  "scripts/postinstall-notice": "src/scripts/postinstall-notice.ts",
  "scripts/release": "src/scripts/release.ts",
  "scripts/release-core": "src/scripts/release-core.ts",
  "scripts/runbook": "src/scripts/runbook.ts",
  "scripts/runbook-core": "src/scripts/runbook-core.ts",
  "scripts/run-migrations": "src/scripts/run-migrations.ts",
  "scripts/seed-admin": "src/scripts/seed-admin.ts",
  "scripts/setup-server": "src/scripts/setup-server.ts",
  "scripts/setup-server-errors": "src/scripts/setup-server-errors.ts",
  "scripts/setup-non-interactive": "src/scripts/setup-non-interactive.ts",
  "scripts/setup-server-ports": "src/scripts/setup-server-ports.ts",
  "scripts/setup-server-validate": "src/scripts/setup-server-validate.ts",
  "scripts/worker": "src/scripts/worker.ts",
};

const libEntries = {
  "lib/api-response": "src/lib/api-response.ts",
  "lib/active-theme-state": "src/lib/active-theme-state.ts",
  "lib/auth-helpers": "src/lib/auth-helpers.ts",
  "lib/auth-routes": "src/lib/auth-routes.ts",
  "lib/cached-theme": "src/lib/cached-theme.ts",
  "lib/collection-helpers": "src/lib/collection-helpers.ts",
  "lib/custom-routes": "src/lib/custom-routes.ts",
  "lib/dashboard-stats": "src/lib/dashboard-stats.ts",
  "lib/db": "src/lib/db.ts",
  "lib/init-core": "src/lib/init-core.ts",
  "lib/manifest": "src/lib/manifest.ts",
  "lib/member-auth-helpers": "src/lib/member-auth-helpers.ts",
  "lib/revalidate": "src/lib/revalidate.ts",
  "lib/revision-helpers": "src/lib/revision-helpers.ts",
  "lib/ops-readiness": "src/lib/ops-readiness.ts",
  "lib/safe-next": "src/lib/safe-next.ts",
  "lib/search-highlight": "src/lib/search-highlight.tsx",
  "lib/seed-content": "src/lib/seed-content.ts",
  "lib/site-authz": "src/lib/site-authz.ts",
  "lib/system-health": "src/lib/system-health.ts",
  "lib/token-ttl": "src/lib/token-ttl.ts",
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    ...scriptEntries,
    ...libEntries,
  },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  // Use React 17+ automatic JSX runtime. Without this, esbuild
  // emits `React.createElement(...)` and expects a runtime
  // `React` import to be present — but the source files don't
  // import React (since the automatic runtime makes it
  // unnecessary), so dist would throw `React is not defined` at
  // runtime. Verified on `lib/search-highlight.tsx`.
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  // Anything that's the consumer's responsibility (peer deps + the
  // `@/...` aliases that resolve at consumer compile time) must NOT
  // be inlined — leave the runtime resolver to find them in the
  // consumer's node_modules / tsconfig.
  external: [
    /^@\//,
    /^@nexpress\//,
    /^next/,
    /^react/,
    /^@radix-ui\//,
    /^lucide-react/,
    /^drizzle-orm/,
    /^@hookform\//,
    "zod",
    "react-hook-form",
    "dotenv",
    "pg",
    "pg-boss",
  ],
});
