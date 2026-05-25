import type { SetupBody } from "./setup-server-validate.js";

type SetupEnv = Record<string, string | undefined>;

export function buildNonInteractiveSetupBody(
  env: SetupEnv,
  generateSecret: () => string,
): SetupBody {
  const storage = env.NP_STORAGE_ADAPTER === "s3" ? "s3" : "local";
  const runMigrate = (env.NP_SETUP_RUN_MIGRATIONS ?? "true").toLowerCase() !== "false";
  const body: SetupBody = {
    databaseUrl: env.DATABASE_URL ?? "",
    npSecret: env.NP_SECRET ?? generateSecret(),
    siteUrl: env.SITE_URL ?? "http://localhost:3000",
    storage,
    runMigrate,
  };

  if (storage === "s3") {
    if (env.NP_S3_BUCKET) body.s3Bucket = env.NP_S3_BUCKET;
    if (env.NP_S3_REGION) body.s3Region = env.NP_S3_REGION;
    if (env.NP_S3_ENDPOINT) body.s3Endpoint = env.NP_S3_ENDPOINT;
  }

  if (env.TEST_DATABASE_URL) body.testDatabaseUrl = env.TEST_DATABASE_URL;

  const requireFirstAdmin = env.NP_SETUP_CREATE_ADMIN === "true";
  const shouldCreateAdmin =
    requireFirstAdmin || Boolean(env.NP_ADMIN_EMAIL && env.NP_ADMIN_PASSWORD);
  if (shouldCreateAdmin) {
    if (requireFirstAdmin) body.requireFirstAdmin = true;
    if (env.NP_ADMIN_EMAIL) body.adminEmail = env.NP_ADMIN_EMAIL;
    if (env.NP_ADMIN_PASSWORD) body.adminPassword = env.NP_ADMIN_PASSWORD;
    if (env.NP_ADMIN_NAME) body.adminName = env.NP_ADMIN_NAME;
    if (env.NP_ADMIN_THEME) body.adminThemeId = env.NP_ADMIN_THEME;
    if (env.NP_SITE_NAME) body.siteName = env.NP_SITE_NAME;
    body.sampleContent = (env.NP_SETUP_SAMPLE_CONTENT ?? "true").toLowerCase() !== "false";
  }

  return body;
}
