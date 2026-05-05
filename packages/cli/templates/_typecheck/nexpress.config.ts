// Stub for tsc — the real `nexpress.config.ts` is rendered by
// `nexpressConfigTemplate(config)` and is project-specific. We just
// need the default-exported shape to be a valid `NpConfig` so that
// `templates/lib/bootstrap.ts` typechecks.
import { defineConfig } from "@nexpress/core";

export default defineConfig({
  site: { name: "stub", url: "http://localhost:3000" },
  db: { connectionString: "postgres://stub" },
  storage: {
    adapter: "local",
    local: { directory: "./uploads", baseUrl: "/uploads" },
  },
  collections: [],
  auth: { secret: "stub-secret-32characters-min-aaaaaaaaaaaa" },
});
