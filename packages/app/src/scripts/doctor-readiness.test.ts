import { describe, expect, it } from "vitest";

import {
  checkJobsEnabledProd,
  checkMigrationStatusReadiness,
  checkOAuthEnvPairs,
  checkSchedulerTokenProd,
  checkSecretLengthProd,
  checkSiteUrlProd,
  checkStorageProd,
  checkTargetDatabaseProd,
  checkTargetSiteUrlProd,
  checkTargetStorageProd,
  checkTargetWorkerProd,
} from "./doctor-readiness.js";
import type { MigrationStatus } from "./migration-status.js";

const migrated: MigrationStatus = {
  local: [
    { index: 0, tag: "0000_init", createdAt: 1_700_000_000_000, hash: "hash-init" },
    { index: 1, tag: "0001_posts", createdAt: 1_700_000_100_000, hash: "hash-posts" },
  ],
  applied: [
    { id: 1, createdAt: 1_700_000_000_000, hash: "hash-init" },
    { id: 2, createdAt: 1_700_000_100_000, hash: "hash-posts" },
  ],
  latestApplied: { id: 2, createdAt: 1_700_000_100_000, hash: "hash-posts" },
  pending: [],
  drifted: [],
  unknownApplied: [],
};

describe("doctor production target readiness", () => {
  it("keeps target checks out of the default dev doctor path", () => {
    expect(checkTargetStorageProd(false, "vercel", { NP_STORAGE_ADAPTER: "local" })).toEqual([]);
    expect(
      checkTargetDatabaseProd(false, "vercel", { DATABASE_URL: "postgres://u:p@localhost/db" }),
    ).toEqual([]);
    expect(checkTargetWorkerProd(false, "vercel", { NP_ENABLE_JOBS: "1" })).toEqual([]);
    expect(checkTargetSiteUrlProd(false, "vercel", { SITE_URL: "http://localhost:3000" })).toEqual(
      [],
    );
    expect(checkStorageProd(false, "docker", { NP_MULTI_NODE: "true" })).toBeNull();
  });

  it("assigns stable ids to production checks", () => {
    expect(checkSecretLengthProd(true, { NP_SECRET: "short" })).toEqual(
      expect.objectContaining({ id: "prod.secret_length" }),
    );
    expect(checkJobsEnabledProd(true, { NP_ENABLE_JOBS: "1" })).toEqual(
      expect.objectContaining({ id: "prod.jobs_enabled" }),
    );
    expect(checkStorageProd(true, "docker", { NP_STORAGE_ADAPTER: "s3" })).toEqual(
      expect.objectContaining({ id: "prod.storage_adapter" }),
    );
    expect(checkSiteUrlProd(true, { SITE_URL: "https://example.com" })).toEqual(
      expect.objectContaining({ id: "prod.site_url_https" }),
    );
    expect(checkSchedulerTokenProd(true, { NP_SCHEDULER_TOKEN: "0123456789abcdef" })).toEqual(
      expect.objectContaining({ id: "prod.scheduler_token" }),
    );
    expect(
      checkOAuthEnvPairs({
        NP_OAUTH_GITHUB_CLIENT_ID: "Iv1.example",
        NP_OAUTH_GITHUB_CLIENT_SECRET: "secret",
      }),
    ).toEqual([expect.objectContaining({ id: "oauth.github.credentials" })]);
  });

  it("treats OAuth providers as optional unless an env credential source is started", () => {
    expect(checkOAuthEnvPairs({})).toEqual([]);
  });

  it("accepts complete OAuth env credential pairs", () => {
    expect(
      checkOAuthEnvPairs({
        NP_OAUTH_GITHUB_CLIENT_ID: "Iv1.example",
        NP_OAUTH_GITHUB_CLIENT_SECRET: "secret",
        NP_OAUTH_GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
        NP_OAUTH_GOOGLE_CLIENT_SECRET: "GOCSPX-secret",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "oauth.github.credentials",
        state: "ok",
        detail: "env pair set",
      }),
      expect.objectContaining({
        id: "oauth.google.credentials",
        state: "ok",
        detail: "env pair set",
      }),
    ]);
  });

  it("errors on partial OAuth env credential pairs", () => {
    expect(
      checkOAuthEnvPairs({
        NP_OAUTH_GITHUB_CLIENT_ID: "Iv1.example",
        NP_OAUTH_GOOGLE_CLIENT_SECRET: "GOCSPX-secret",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "oauth.github.credentials",
        state: "error",
        detail: "partial env: missing NP_OAUTH_GITHUB_CLIENT_SECRET",
        hint: expect.stringContaining("/admin/plugins/oauth-github"),
      }),
      expect.objectContaining({
        id: "oauth.google.credentials",
        state: "error",
        detail: "partial env: missing NP_OAUTH_GOOGLE_CLIENT_ID",
        hint: expect.stringContaining("/admin/plugins/oauth-google"),
      }),
    ]);
  });

  it("errors when production SITE_URL is not an http(s) URL", () => {
    expect(checkSiteUrlProd(true, { SITE_URL: "demo.example.com" })).toEqual(
      expect.objectContaining({
        id: "prod.site_url_https",
        state: "error",
        detail: "not an http(s) URL",
      }),
    );
  });

  it("requires S3-compatible storage for Vercel", () => {
    expect(checkTargetStorageProd(true, "vercel", { NP_STORAGE_ADAPTER: "local" })).toEqual([
      expect.objectContaining({
        id: "target.vercel.storage",
        state: "error",
        label: "Vercel storage",
        detail: "NP_STORAGE_ADAPTER=local",
      }),
    ]);

    expect(checkTargetStorageProd(true, "vercel", { NP_STORAGE_ADAPTER: "s3" })).toEqual([
      expect.objectContaining({
        id: "target.vercel.storage",
        state: "ok",
        label: "Vercel storage",
        detail: "S3-compatible",
      }),
    ]);
  });

  it("blocks loopback database URLs for hosted deploy targets", () => {
    for (const target of ["vercel", "railway", "render", "fly"] as const) {
      expect(
        checkTargetDatabaseProd(true, target, {
          DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/nexpress",
        }),
      ).toEqual([
        expect.objectContaining({
          id: `target.${target}.database_url`,
          state: "error",
          detail: "DATABASE_URL host is localhost",
        }),
      ]);
    }

    expect(
      checkTargetDatabaseProd(true, "vercel", {
        DATABASE_URL: "postgres://nexpress:nexpress@[::1]:5433/nexpress",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "target.vercel.database_url",
        state: "error",
        detail: "DATABASE_URL host is ::1",
      }),
    ]);

    expect(
      checkTargetDatabaseProd(true, "vercel", {
        DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.2:5433/nexpress",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "target.vercel.database_url",
        state: "error",
        detail: "DATABASE_URL host is 127.0.0.2",
      }),
    ]);
  });

  it("blocks private IP database URLs for Vercel but allows public hosted URLs", () => {
    expect(
      checkTargetDatabaseProd(true, "vercel", {
        DATABASE_URL: "postgres://nexpress:nexpress@192.168.1.10:5432/nexpress",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "target.vercel.database_url",
        state: "error",
        detail: "DATABASE_URL host is 192.168.1.10",
      }),
    ]);

    expect(
      checkTargetDatabaseProd(true, "vercel", {
        DATABASE_URL: "postgres://nexpress:nexpress@db.example.com:5432/nexpress",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "target.vercel.database_url",
        state: "ok",
        detail: "db.example.com",
      }),
    ]);

    expect(
      checkTargetDatabaseProd(true, "docker", {
        DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/nexpress",
      }),
    ).toEqual([]);
  });

  it("blocks local or private SITE_URL values for hosted deploy targets", () => {
    for (const target of ["vercel", "railway", "render", "fly"] as const) {
      expect(checkTargetSiteUrlProd(true, target, { SITE_URL: "http://localhost:3000" })).toEqual([
        expect.objectContaining({
          id: `target.${target}.site_url`,
          state: "error",
          detail: "SITE_URL host is localhost",
        }),
      ]);
    }

    expect(checkTargetSiteUrlProd(true, "vercel", { SITE_URL: "https://192.168.1.10" })).toEqual([
      expect.objectContaining({
        id: "target.vercel.site_url",
        state: "error",
        detail: "SITE_URL host is 192.168.1.10",
      }),
    ]);

    expect(
      checkTargetSiteUrlProd(true, "vercel", { SITE_URL: "https://demo.example.com" }),
    ).toEqual([]);
    expect(checkTargetSiteUrlProd(true, "docker", { SITE_URL: "http://localhost:3000" })).toEqual(
      [],
    );
  });

  it("warns when Vercel jobs are enabled without a long-running worker host", () => {
    expect(checkTargetWorkerProd(true, "vercel", { NP_ENABLE_JOBS: "1" })).toEqual([
      expect.objectContaining({
        id: "target.vercel.jobs_worker",
        state: "warn",
        label: "Vercel jobs worker",
      }),
    ]);

    expect(checkTargetWorkerProd(true, "railway", { NP_ENABLE_JOBS: "true" })).toEqual([
      expect.objectContaining({
        id: "target.railway.jobs_worker",
        state: "ok",
        label: "Railway jobs worker",
      }),
    ]);
  });

  it("errors on local storage for managed container targets unless explicitly single-node", () => {
    for (const target of ["railway", "render", "fly"] as const) {
      expect(checkTargetStorageProd(true, target, { NP_STORAGE_ADAPTER: "local" })).toEqual([
        expect.objectContaining({
          id: `target.${target}.storage`,
          state: "error",
          detail: "local storage",
        }),
      ]);

      expect(
        checkTargetStorageProd(true, target, {
          NP_STORAGE_ADAPTER: "local",
          NP_MULTI_NODE: "false",
        }),
      ).toEqual([
        expect.objectContaining({
          id: `target.${target}.storage`,
          state: "warn",
          detail: "local + NP_MULTI_NODE=false",
        }),
      ]);

      expect(
        checkTargetStorageProd(true, target, {
          NP_STORAGE_ADAPTER: "local",
          NP_REPLICAS: "1",
        }),
      ).toEqual([
        expect.objectContaining({
          id: `target.${target}.storage`,
          state: "warn",
          detail: "local + NP_REPLICAS=1",
        }),
      ]);

      expect(checkTargetStorageProd(true, target, { NP_STORAGE_ADAPTER: "s3" })).toEqual([
        expect.objectContaining({
          id: `target.${target}.storage`,
          state: "ok",
          detail: "s3",
        }),
      ]);
    }
  });

  it("keeps Docker generic multi-node storage checks active", () => {
    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        NP_MULTI_NODE: "true",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "prod.storage_adapter",
        state: "error",
        label: "Storage adapter (production)",
        detail: "local + NP_MULTI_NODE=true",
      }),
    );

    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        NP_MULTI_NODE: "false",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "prod.storage_adapter",
        state: "ok",
        label: "Storage adapter (production): local",
      }),
    );
  });

  it("treats NP_REPLICAS greater than one as a production local-storage blocker", () => {
    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        NP_REPLICAS: "2",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "prod.storage_adapter",
        state: "error",
        detail: "local + NP_REPLICAS=2",
      }),
    );

    expect(
      checkTargetStorageProd(true, "fly", {
        NP_STORAGE_ADAPTER: "local",
        NP_MULTI_NODE: "false",
        NP_REPLICAS: "2",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "target.fly.storage",
        state: "error",
        detail: "local + NP_REPLICAS=2",
      }),
    ]);
  });

  it("blocks Docker-target local storage when a managed container env is detected", () => {
    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        KUBERNETES_SERVICE_HOST: "10.0.0.1",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "prod.storage_adapter",
        state: "error",
        detail: "local + managed-container env detected",
      }),
    );

    expect(
      checkStorageProd(true, "docker", {
        NP_STORAGE_ADAPTER: "local",
        KUBERNETES_SERVICE_HOST: "10.0.0.1",
        NP_REPLICAS: "1",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "prod.storage_adapter",
        state: "ok",
      }),
    );
  });

  it("reports fully applied migration status as ok", () => {
    expect(checkMigrationStatusReadiness(true, migrated)).toEqual({
      id: "migrations.applied",
      state: "ok",
      label: "Migrations applied",
      detail: "2/2 migrations applied",
    });
  });

  it("warns for pending migrations in dev and errors in prod", () => {
    const status: MigrationStatus = {
      ...migrated,
      local: [
        ...migrated.local,
        { index: 2, tag: "0002_comments", createdAt: 1_700_000_200_000, hash: "hash-comments" },
      ],
      pending: [
        { index: 2, tag: "0002_comments", createdAt: 1_700_000_200_000, hash: "hash-comments" },
      ],
    };

    expect(checkMigrationStatusReadiness(false, status)).toEqual(
      expect.objectContaining({
        state: "warn",
        detail: "1 pending of 3 local",
      }),
    );
    expect(checkMigrationStatusReadiness(true, status)).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "1 pending of 3 local",
      }),
    );
  });

  it("treats missing local migration metadata as deployment-blocking in prod", () => {
    expect(
      checkMigrationStatusReadiness(true, {
        ...migrated,
        local: [],
      }),
    ).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "no local migrations found",
      }),
    );
  });

  it("errors on migration drift or rows not present in local code", () => {
    expect(
      checkMigrationStatusReadiness(true, {
        ...migrated,
        drifted: [
          {
            tag: "0001_posts",
            createdAt: 1_700_000_100_000,
            localHash: "hash-posts",
            appliedHash: "changed",
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "1 applied migration hash mismatch",
      }),
    );

    expect(
      checkMigrationStatusReadiness(true, {
        ...migrated,
        unknownApplied: [{ id: 3, createdAt: 1_700_000_999_000, hash: "from-another-codebase" }],
      }),
    ).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "1 applied migration row not present locally",
      }),
    );
  });
});
