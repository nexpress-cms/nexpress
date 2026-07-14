import { describe, expect, it } from "vitest";

import { buildNonInteractiveSetupBody } from "./setup-non-interactive.js";
import { validateBody } from "./setup-server-validate.js";

const databaseUrl = "postgres://user:pass@db.example.com:5432/nexpress";
const strongSecret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

describe("buildNonInteractiveSetupBody", () => {
  it("builds a valid Vercel-style S3/R2 setup body from env", () => {
    const body = buildNonInteractiveSetupBody(
      {
        DATABASE_URL: databaseUrl,
        NP_SECRET: strongSecret,
        SITE_URL: "https://demo.example.com",
        NP_STORAGE_ADAPTER: "s3",
        NP_S3_BUCKET: "nexpress-media",
        NP_S3_REGION: "auto",
        NP_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
        TEST_DATABASE_URL: "postgres://user:pass@db.example.com:5432/nexpress_test",
        NP_SETUP_RUN_MIGRATIONS: "false",
      },
      () => "unused-generated-secret",
    );

    expect(body).toEqual({
      databaseUrl,
      npSecret: strongSecret,
      siteUrl: "https://demo.example.com",
      storage: "s3",
      s3Bucket: "nexpress-media",
      s3Region: "auto",
      s3Endpoint: "https://account.r2.cloudflarestorage.com",
      testDatabaseUrl: "postgres://user:pass@db.example.com:5432/nexpress_test",
      runMigrate: false,
    });
    expect(validateBody(body)).toEqual({ body });
  });

  it("uses local storage defaults and generates a secret when optional env is absent", () => {
    const body = buildNonInteractiveSetupBody(
      {
        DATABASE_URL: databaseUrl,
      },
      () => strongSecret,
    );

    expect(body).toEqual({
      databaseUrl,
      npSecret: strongSecret,
      siteUrl: "http://localhost:3000",
      storage: "local",
      runMigrate: true,
    });
    expect(validateBody(body)).toEqual({ body });
  });

  it("only pre-fills first admin fields when explicitly requested or complete credentials exist", () => {
    const withoutPassword = buildNonInteractiveSetupBody(
      {
        DATABASE_URL: databaseUrl,
        NP_SECRET: strongSecret,
        NP_ADMIN_EMAIL: "admin@example.com",
      },
      () => "unused-generated-secret",
    );

    expect(withoutPassword.adminEmail).toBeUndefined();

    const withAdmin = buildNonInteractiveSetupBody(
      {
        DATABASE_URL: databaseUrl,
        NP_SECRET: strongSecret,
        NP_ADMIN_EMAIL: "admin@example.com",
        NP_ADMIN_PASSWORD: "CorrectHorse1!",
        NP_ADMIN_NAME: "Demo Admin",
        NP_ADMIN_THEME: "default",
        NP_SITE_NAME: "Demo Site",
        NP_SETUP_SAMPLE_CONTENT: "false",
      },
      () => "unused-generated-secret",
    );

    expect(withAdmin).toEqual(
      expect.objectContaining({
        adminEmail: "admin@example.com",
        adminPassword: "CorrectHorse1!",
        adminName: "Demo Admin",
        adminThemeId: "default",
        siteName: "Demo Site",
        sampleContent: false,
      }),
    );
    const validated = validateBody(withAdmin);
    expect(validated).toEqual({
      body: expect.objectContaining({
        adminEmail: "admin@example.com",
        adminPassword: "CorrectHorse1!",
        adminName: "Demo Admin",
        adminThemeId: "default",
        siteName: "Demo Site",
      }),
    });
    expect("error" in validated).toBe(false);
  });

  it("makes NP_SETUP_CREATE_ADMIN=true fail validation without admin credentials", () => {
    const body = buildNonInteractiveSetupBody(
      {
        DATABASE_URL: databaseUrl,
        NP_SECRET: strongSecret,
        NP_SETUP_CREATE_ADMIN: "true",
      },
      () => "unused-generated-secret",
    );

    expect(body.requireFirstAdmin).toBe(true);
    expect(validateBody(body)).toEqual({
      error:
        "Admin email is required when completing first-boot setup now. Leave the first-admin fields blank to continue in /admin/setup.",
    });
  });

  it("fails closed on unknown or programmatic storage setup intent", () => {
    expect(() =>
      buildNonInteractiveSetupBody(
        { DATABASE_URL: databaseUrl, NP_STORAGE_ADAPTER: "S3" },
        () => strongSecret,
      ),
    ).toThrow(/NP_STORAGE_ADAPTER/u);

    expect(() =>
      buildNonInteractiveSetupBody(
        { DATABASE_URL: databaseUrl, NP_STORAGE_ADAPTER: "custom" },
        () => strongSecret,
      ),
    ).toThrow(/custom storage adapter/u);
  });
});
