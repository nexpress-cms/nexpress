import { describe, expect, it } from "vitest";

import {
  buildDeployPlan,
  buildDeployPlanJson,
  checkEnvRequirement,
  renderBriefDeployPlan,
  renderDeployPlan,
} from "./deploy-plan-core.js";

describe("deploy plan core", () => {
  it("builds a stable JSON plan for agent-operated Vercel deploys", () => {
    const plan = buildDeployPlan("vercel");
    const json = buildDeployPlanJson(plan, false, {
      DATABASE_URL: "postgres://user:pass@example.com:5432/nexpress",
      NP_SECRET: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      SITE_URL: "https://demo.example.com",
      NP_STORAGE_ADAPTER: "local",
      NP_S3_BUCKET: "media",
    });

    expect(json).toEqual(
      expect.objectContaining({
        schemaVersion: "np.deploy-plan.v1",
        target: "vercel",
        title: "Vercel",
        inferred: false,
        dryRun: true,
      }),
    );
    expect(json.commands).toContain("pnpm run doctor:prod -- --target vercel");
    expect(json.summary).toEqual({
      requiredEnv: {
        total: 6,
        set: 4,
        unresolved: 2,
      },
      recommendedEnv: {
        total: 2,
        set: 0,
        unresolved: 2,
      },
    });
    expect(json.nextCommands).toEqual([
      "pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan",
    ]);
    expect(json.diagnostics).toContain(
      "Run pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan for ordered remediation.",
    );
    expect(json.commands).toEqual(
      expect.arrayContaining(["pnpm db:migrate -- --status", "pnpm db:migrate"]),
    );
    expect(json.commands.indexOf("pnpm db:migrate -- --status")).toBeLessThan(
      json.commands.indexOf("pnpm db:migrate"),
    );
    expect(json.requiredEnv).toContainEqual({
      name: "DATABASE_URL",
      variable: "DATABASE_URL",
      status: "set",
    });
    expect(json.requiredEnv).toContainEqual({
      name: "NP_STORAGE_ADAPTER=s3",
      variable: "NP_STORAGE_ADAPTER",
      expectedValue: "s3",
      actualValue: "local",
      status: "mismatch",
      hint: "Set NP_STORAGE_ADAPTER=s3.",
    });
    expect(json.requiredEnv).toContainEqual({
      name: "NP_S3_REGION",
      variable: "NP_S3_REGION",
      status: "missing",
      hint: "Set the bucket region; use `auto` for providers such as Cloudflare R2 when appropriate.",
    });
  });

  it("builds migration-first next commands when required env is ready", () => {
    const json = buildDeployPlanJson(buildDeployPlan("docker"), false, {
      DATABASE_URL: "postgres://user:pass@example.com:5432/nexpress",
      NP_SECRET: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      SITE_URL: "https://demo.example.com",
    });

    expect(json.summary.requiredEnv).toEqual({
      total: 3,
      set: 3,
      unresolved: 0,
    });
    expect(json.nextCommands).toEqual([
      "pnpm db:migrate -- --status",
      "pnpm db:migrate",
      "pnpm run doctor:prod -- --target docker --brief --no-color --fix-plan",
    ]);
  });

  it("checks env requirements without leaking set secret values", () => {
    expect(checkEnvRequirement("NP_SECRET", { NP_SECRET: "super-secret-value" })).toEqual({
      name: "NP_SECRET",
      variable: "NP_SECRET",
      status: "set",
    });

    expect(checkEnvRequirement("NP_ENABLE_JOBS=1", { NP_ENABLE_JOBS: "true" })).toEqual({
      name: "NP_ENABLE_JOBS=1",
      variable: "NP_ENABLE_JOBS",
      expectedValue: "1",
      actualValue: "true",
      status: "mismatch",
      hint: "Set NP_ENABLE_JOBS=1.",
    });
  });

  it("renders no-color human output for logs and non-TTY agents", () => {
    const output = renderDeployPlan(
      buildDeployPlan("vercel"),
      false,
      {
        DATABASE_URL: "postgres://user:pass@example.com:5432/nexpress",
        NP_SECRET: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        SITE_URL: "https://demo.example.com",
      },
      { color: false },
    );

    expect(output).toContain("NexPress deploy plan: Vercel");
    expect(output).toContain("[todo] NP_STORAGE_ADAPTER=s3 - Set NP_STORAGE_ADAPTER=s3.");
    expect(output).toContain("Set SITE_URL to the final https:// production domain");
    expect(output).toContain("Run before deploy");
    expect(output).toContain("Diagnostics");
    expect(output).toContain(
      "pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan",
    );
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("renders a compact brief with only unresolved required env and commands", () => {
    const output = renderBriefDeployPlan(
      buildDeployPlan("docker"),
      true,
      {
        DATABASE_URL: "postgres://user:pass@example.com:5432/nexpress",
      },
      { color: false },
    );

    expect(output).toContain("No --target supplied; inferred docker.");
    expect(output).toContain("Required env: 1/3 set");
    expect(output).toContain(
      "[todo] NP_SECRET - Generate a 32+ character secret, for example `openssl rand -base64 48`.",
    );
    expect(output).toContain("pnpm db:migrate -- --status");
    expect(output).toContain("pnpm run doctor:prod -- --target docker");
    expect(output).toContain("If blocked:");
    expect(output).toContain(
      "pnpm run doctor:prod -- --target docker --brief --no-color --fix-plan",
    );
    expect(output).not.toContain("Fit");
    expect(output).not.toMatch(/\x1b\[/);
  });
});
