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
  "scripts/dev-notice": "src/scripts/dev-notice.ts",
  "scripts/doctor": "src/scripts/doctor.ts",
  "scripts/generate-schema": "src/scripts/generate-schema.ts",
  "scripts/postinstall-notice": "src/scripts/postinstall-notice.ts",
  "scripts/run-migrations": "src/scripts/run-migrations.ts",
  "scripts/seed-admin": "src/scripts/seed-admin.ts",
  "scripts/setup-server": "src/scripts/setup-server.ts",
  "scripts/setup-server-validate": "src/scripts/setup-server-validate.ts",
  "scripts/worker": "src/scripts/worker.ts",
};

const libEntries = {
  "lib/api-response": "src/lib/api-response.ts",
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
