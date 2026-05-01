import { defineConfig } from "tsup";

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
    seo: "src/seo/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
