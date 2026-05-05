import { defineConfig } from "tsup";

// NP_DEV_FAST is read from `.env` (default `1` in dev). It skips dts
// emit + sourcemaps so the watch loop runs at transpile-only cost.
// `.d.ts` files refresh on the next `pnpm build`, which prefixes
// `NP_DEV_FAST=0` to guarantee full dts regardless of `.env`.
const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "db-schema": "src/db/schema/index.ts",
    // Phase 22.6 — domain subpath entries. These are the canonical
    // import paths going forward; the root `index.ts` keeps re-
    // exporting everything for back-compat. New consumer code
    // should reach in through these.
    auth: "src/auth/index.ts",
    community: "src/community/index.ts",
    db: "src/db/index.ts",
    i18n: "src/i18n/index.ts",
    jobs: "src/jobs/index.ts",
    media: "src/media/index.ts",
    observability: "src/observability/index.ts",
    "rate-limit": "src/rate-limit/index.ts",
    seo: "src/seo/index.ts",
  },
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
});
