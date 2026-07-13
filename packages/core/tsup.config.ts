import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

// NP_DEV_FAST is read from `.env` (default `1` in dev). It skips dts
// emit + sourcemaps so the watch loop runs at transpile-only cost.
// `.d.ts` files refresh on the next `pnpm build`, which prefixes
// `NP_DEV_FAST=0` to guarantee full dts regardless of `.env`.
const fast = process.env.NP_DEV_FAST === "1";

// Inject the framework version into `compat.ts` at build time so
// the plugin-compatibility check always reports what the published
// tarball actually is. Previously the constant was hand-maintained
// in `compat.ts` and drifted three times in a single release
// cycle; the corresponding version-sync test exists exactly to
// surface that drift. With this inject the drift is impossible —
// `package.json.version` is the only source of truth — and the
// sync test can retire.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf-8")) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "db-schema": "src/db/schema/index.ts",
    // Phase 22.6 — domain subpath entries. These are the canonical
    // import paths going forward; the root `index.ts` keeps re-
    // exporting everything for back-compat. New consumer code
    // should reach in through these.
    auth: "src/auth/index.ts",
    // Pure, client-safe users, members, JWT claims, sessions, and API wire contracts.
    "auth-contract": "src/auth-contract/index.ts",
    community: "src/community/index.ts",
    db: "src/db/index.ts",
    // Client-safe pure helpers (admin.condition evaluator, hidden-
    // field walker, zod schema builder). Used by `@nexpress/admin`
    // from "use client" components — importing them from the root
    // dragged argon2/pg into the browser bundle (#774 audit gap).
    fields: "src/fields/index.ts",
    i18n: "src/i18n/index.ts",
    jobs: "src/jobs/index.ts",
    // Pure, client-safe job payload, persisted row, and Admin wire contract.
    "jobs-contract": "src/jobs-contract/index.ts",
    media: "src/media/index.ts",
    // Pure, client-safe persisted media metadata and API wire contract.
    "media-contract": "src/media-contract/index.ts",
    // Client-safe persisted navigation tree/location contract.
    navigation: "src/navigation/index.ts",
    observability: "src/observability/index.ts",
    "rate-limit": "src/rate-limit/index.ts",
    // Pure, client-safe revision snapshot and API wire contract.
    revisions: "src/revisions/index.ts",
    routes: "src/routes/index.ts",
    seo: "src/seo/index.ts",
    // Server-side site registry, execution context, memberships, and authorization.
    sites: "src/sites/index.ts",
    // Pure, client-safe site identity and framework settings contracts.
    settings: "src/settings/index.ts",
    // Pure, client-safe theme token inventory and validation contract.
    // Admin imports this subpath without pulling server-only core deps.
    theme: "src/theme/index.ts",
  },
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  define: {
    __NP_FRAMEWORK_VERSION__: JSON.stringify(pkg.version),
  },
});
