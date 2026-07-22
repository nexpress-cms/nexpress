import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectDoctorChecks, collectDoctorReport } from "./doctor-core.js";
import {
  npIsCanonicalCollectionMainTableName,
  npIsCollectionMainTableName,
} from "./doctor-collection-contract.js";
import {
  npFindMissingCommunityRoleGrantTargets,
  npPlanCommunityRoleGrantTargets,
} from "./doctor-community-grants.js";

describe("doctor core", () => {
  it("reports malformed, missing, and cross-site community role targets", () => {
    const categoryId = "e9fb7723-14fd-4c0c-8e9a-dd223279a5ed";
    const threadId = "4c70615b-7685-4817-9272-cea2bdd08d73";
    const plan = npPlanCommunityRoleGrantTargets(
      [
        {
          id: "grant-category",
          role: "category-mod",
          scopeType: "category",
          scopeId: categoryId,
          siteId: "default",
        },
        {
          id: "grant-thread",
          role: "thread-author",
          scopeType: "thread",
          scopeId: threadId,
          siteId: "community",
        },
        {
          id: "grant-invalid",
          role: "category-mod",
          scopeType: "category",
          scopeId: "not-a-document-id",
          siteId: "default",
        },
        {
          id: "grant-collection",
          role: "collection-mod",
          scopeType: "collection",
          scopeId: "missing-posts",
          siteId: "default",
        },
      ],
      new Set(["np_c_forum-posts"]),
    );

    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "grants.grant-invalid.scopeId" }),
        expect.objectContaining({ path: "grants.grant-collection.scopeId" }),
      ]),
    );
    expect(
      npFindMissingCommunityRoleGrantTargets(
        plan.scopedTargets,
        new Set([`default:${categoryId}`]),
      ),
    ).toEqual([
      expect.objectContaining({
        path: "grants.grant-thread.scopeId",
        message: expect.stringContaining("missing or cross-site"),
      }),
    ]);
  });

  it("classifies collection main tables without relying on required columns", () => {
    expect(npIsCollectionMainTableName("np_c_posts")).toBe(true);
    expect(npIsCollectionMainTableName("np_c_blog-post")).toBe(true);
    expect(npIsCollectionMainTableName("np_c_posts__categories")).toBe(false);
    expect(npIsCollectionMainTableName("np_users")).toBe(false);

    expect(npIsCanonicalCollectionMainTableName("np_c_posts")).toBe(true);
    expect(npIsCanonicalCollectionMainTableName("np_c_blog-post")).toBe(true);
    expect(npIsCanonicalCollectionMainTableName("np_c_Broken")).toBe(false);
  });

  it("collects reusable doctor checks without requiring a bootable app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      env: {},
      nodeVersion: "24.11.1",
    });

    expect(checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "node.version",
        "env.file",
        "env.database_url",
        "email.contract",
        "observability.contract",
        "rate-limit.contract",
        "storage.contract",
        "routes.contract",
        "i18n.contract",
        "database.reachable",
        "auth.contract",
        "settings.contract",
        "media.contract",
        "collections.contract",
        "community.contract",
        "revisions.contract",
        "jobs.contract",
        "migrations.applied",
      ]),
    );
    expect(checks.find((check) => check.id === "env.database_url")).toEqual(
      expect.objectContaining({
        state: "error",
        label: "DATABASE_URL",
      }),
    );
    expect(checks.find((check) => check.id === "database.reachable")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "DATABASE_URL not set",
      }),
    );
  });

  it("validates the shared i18n config without booting the app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const valid = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      i18nConfig: { locales: ["en", "ko"], defaultLocale: "en" },
    });
    expect(valid.find((check) => check.id === "i18n.contract")).toEqual(
      expect.objectContaining({ state: "ok", detail: "2 locale(s) · default en" }),
    );

    const invalid = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      i18nConfig: { locales: ["en-us"], defaultLocale: "en-us" },
    });
    expect(invalid.find((check) => check.id === "i18n.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("canonical BCP 47"),
      }),
    );
  });

  it("reports exact custom route catalog diagnostics without booting the app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const valid = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      customRoutes: [
        { path: "/search", label: "Search" },
        { path: "/u/[handle]", label: "Member" },
      ],
    });
    expect(valid.find((check) => check.id === "routes.contract")).toEqual(
      expect.objectContaining({
        state: "ok",
        detail: "2 routes · 1 static · 1 dynamic",
      }),
    );

    const invalid = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      customRoutes: [{ path: "search", label: "Search" }],
    });
    expect(invalid.find((check) => check.id === "routes.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("customRoutes.0.path"),
      }),
    );

    await mkdir(join(cwd, "src/lib"), { recursive: true });
    await writeFile(
      join(cwd, "src/lib/custom-routes.ts"),
      'export const npCustomRoutes = [{ path: "/loaded/[id]", label: "Loaded" }];\n',
      "utf8",
    );
    const loaded = await collectDoctorChecks({ cwd, nodeVersion: "24.11.1" });
    expect(loaded.find((check) => check.id === "routes.contract")).toEqual(
      expect.objectContaining({
        state: "ok",
        detail: "1 routes · 0 static · 1 dynamic",
      }),
    );
  });

  it("builds production doctor JSON with an optional fix plan", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const report = await collectDoctorReport({
      cwd,
      prodMode: true,
      target: "vercel",
      includeFixPlan: true,
      nodeVersion: "24.11.1",
      env: {
        npm_config_user_agent: "pnpm/10.33.0",
      },
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.doctor.v1",
        ok: false,
        blocksDeploy: true,
        mode: "prod",
        target: "vercel",
      }),
    );
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(report.fixPlan?.length).toBeGreaterThan(0);
  });

  it("includes partial OAuth env errors in collected checks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: {
        npm_config_user_agent: "pnpm/10.33.0",
        NP_OAUTH_GITHUB_CLIENT_ID: "Iv1.partial",
      },
    });

    expect(checks.find((check) => check.id === "oauth.github.credentials")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "partial env: missing NP_OAUTH_GITHUB_CLIENT_SECRET",
      }),
    );
  });

  it("fails closed on malformed authentication runtime settings without a database", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: { NP_RESET_TTL_MINUTES: "60minutes" },
    });

    expect(checks.find((check) => check.id === "auth.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "NP_RESET_TTL_MINUTES must be a positive integer.",
      }),
    );
  });

  it("fails closed on malformed email runtime settings without booting the app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: {
        NP_EMAIL_ADAPTER: "smtp",
        NP_SMTP_HOST: "smtp.example.com",
        NP_SMTP_PORT: "NaN",
        NP_SMTP_FROM: "noreply@example.com",
      },
    });

    expect(checks.find((check) => check.id === "email.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("NP_SMTP_PORT"),
      }),
    );
  });

  it("fails closed on malformed rate-limit runtime intent without booting the app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: { NP_RATE_LIMIT_ADAPTER: "redis" },
    });

    expect(checks.find((check) => check.id === "rate-limit.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("NP_RATE_LIMIT_ADAPTER"),
      }),
    );
  });

  it("fails closed on malformed observability runtime intent without booting the app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: { NP_LOGGER_ADAPTER: "pino" },
    });

    expect(checks.find((check) => check.id === "observability.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("NP_LOGGER_ADAPTER"),
      }),
    );
  });

  it("fails closed on malformed storage runtime intent without booting the app", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      nodeVersion: "24.11.1",
      env: { NP_STORAGE_ADAPTER: "s3", NP_S3_BUCKET: "site-media" },
    });

    expect(checks.find((check) => check.id === "storage.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("storage.runtime.s3.region"),
      }),
    );
  });

  it("blocks a production multi-node runtime that keeps process-local buckets", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      prodMode: true,
      target: "docker",
      nodeVersion: "24.11.1",
      env: { NP_RATE_LIMIT_ADAPTER: "memory", NP_REPLICAS: "2" },
    });

    expect(checks.find((check) => check.id === "rate-limit.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: "memory (per-process) in a multi-node runtime",
      }),
    );
  });

  it("shares startup safety's case-insensitive multi-node flag semantics", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "nexpress-doctor-core-"));
    const checks = await collectDoctorChecks({
      cwd,
      prodMode: true,
      target: "docker",
      nodeVersion: "24.11.1",
      env: { NP_RATE_LIMIT_ADAPTER: "memory", NP_MULTI_NODE: "TRUE" },
    });

    expect(checks.find((check) => check.id === "rate-limit.contract")?.state).toBe("error");
  });
});
