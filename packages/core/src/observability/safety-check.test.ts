import { afterEach, describe, expect, it } from "vitest";

import { resetLogger, setLogger } from "./logger.js";
import { verifyStartupSafety } from "./safety-check.js";

interface CapturedWarning {
  message: string;
  context: Record<string, unknown> | undefined;
}

function captureWarnings(): {
  warnings: CapturedWarning[];
  restore: () => void;
} {
  const warnings: CapturedWarning[] = [];
  setLogger({
    debug: () => {},
    info: () => {},
    warn: (message, context) => {
      warnings.push({ message, context });
    },
    error: () => {},
  });
  return {
    warnings,
    restore: resetLogger,
  };
}

describe("verifyStartupSafety", () => {
  afterEach(() => {
    resetLogger();
  });

  it("emits no warnings on a clean dev config", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "doesnt-matter-in-dev",
      nodeEnv: "development",
      multiNodeFlag: undefined,
    });
    expect(emitted).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("warns when LocalStorageAdapter runs under NP_MULTI_NODE=true", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
    });
    expect(emitted).toContain("multi_node_local_storage");
    expect(warnings.some((w) => w.message.includes("multi-node safe"))).toBe(true);
  });

  it("does not warn about local storage when NP_MULTI_NODE is unset", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).not.toContain("multi_node_local_storage");
    expect(warnings).toEqual([]);
  });

  it("accepts NP_MULTI_NODE=1 as truthy alongside 'true'", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "1",
    });
    expect(warnings.some((w) => w.message.includes("multi-node safe"))).toBe(true);
  });

  it("warns about a missing NP_SECRET in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: null,
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).toContain("missing_prod_secret");
    expect(warnings.some((w) => w.message.includes("NP_SECRET is unset"))).toBe(true);
  });

  it("warns about a short NP_SECRET in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "tiny",
      nodeEnv: "production",
      multiNodeFlag: undefined,
    });
    expect(emitted).toContain("weak_prod_secret");
    expect(warnings.find((w) => w.message.includes("shorter than"))?.context).toMatchObject({
      length: 4,
    });
  });

  it("does not warn about a short secret outside production", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "tiny",
      nodeEnv: "development",
      multiNodeFlag: undefined,
    });
    expect(warnings).toEqual([]);
  });

  it("returns ids in deterministic order so callers can snapshot them", () => {
    const { warnings: _w } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: null,
      nodeEnv: "production",
      multiNodeFlag: "true",
    });
    expect(emitted).toEqual(["multi_node_local_storage", "missing_prod_secret"]);
  });

  it("warns about local storage when a managed-container env var is detected in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      containerEnv: true,
    });
    expect(emitted).toContain("multi_node_local_storage");
    const warning = warnings.find((w) => w.message.includes("multi-node safe"));
    expect(warning?.context).toMatchObject({ reason: "container_hint" });
  });

  it("does not warn about container hints outside production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "development",
      multiNodeFlag: undefined,
      containerEnv: true,
    });
    expect(emitted).not.toContain("multi_node_local_storage");
    expect(warnings).toEqual([]);
  });

  it("attributes the warning to the explicit flag when both signals are present", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
      containerEnv: true,
    });
    const warning = warnings.find((w) => w.message.includes("multi-node safe"));
    expect(warning?.context).toMatchObject({ reason: "explicit_flag" });
  });

  it("container-hint warning message lists every recognized platform env var", () => {
    // Regression guard: bootstrap.ts and the warning message in
    // safety-check.ts list the same env vars in two separate places.
    // If someone adds RAILWAY_ENVIRONMENT_NAME (or the next platform)
    // to bootstrap.ts but forgets the message string here, operators
    // see a warning that doesn't tell them which env triggered it.
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      containerEnv: true,
    });
    const message = warnings.find((w) => w.message.includes("multi-node safe"))?.message ?? "";
    for (const envVar of [
      "KUBERNETES_SERVICE_HOST",
      "FLY_REGION",
      "RENDER_INSTANCE_ID",
      "RAILWAY_ENVIRONMENT_NAME",
    ]) {
      expect(message, `warning should mention ${envVar}`).toContain(envVar);
    }
  });

  it("explicit NP_MULTI_NODE=false silences the container hint", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "local",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "false",
      containerEnv: true,
    });
    expect(emitted).not.toContain("multi_node_local_storage");
    expect(warnings).toEqual([]);
  });

  // ── #597 — three more prod-only checks ────────────────────────

  it("warns when NP_EMAIL_ADAPTER is unset (null) in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      emailAdapterEnv: null,
      siteUrl: "https://example.com",
    });
    expect(emitted).toContain("noop_email_in_prod");
    expect(
      warnings.some((w) =>
        w.message.includes("transactional mail (password reset"),
      ),
    ).toBe(true);
  });

  it("warns when NP_EMAIL_ADAPTER='noop' (explicit) in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      emailAdapterEnv: "noop",
      siteUrl: "https://example.com",
    });
    expect(emitted).toContain("noop_email_in_prod");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does NOT warn when emailAdapterEnv is undefined (back-compat: caller didn't supply)", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      // emailAdapterEnv intentionally omitted — older callers
      // shouldn't pick up the new warning until they're updated.
      siteUrl: "https://example.com",
    });
    expect(emitted).not.toContain("noop_email_in_prod");
    expect(warnings).toEqual([]);
  });

  it("does NOT warn when noop email runs outside production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "development",
      multiNodeFlag: undefined,
      emailAdapterEnv: null,
    });
    expect(emitted).not.toContain("noop_email_in_prod");
    expect(warnings).toEqual([]);
  });

  it("does NOT warn when smtp / custom email adapter is installed", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      emailAdapterEnv: "smtp",
      siteUrl: "https://example.com",
    });
    expect(
      warnings.some((w) => w.message.includes("Email adapter")),
    ).toBe(false);
  });

  it.each([
    ["localhost"],
    ["127.0.0.1"],
    ["::1"],
    ["0.0.0.0"],
    ["LOCALHOST"],
  ])("warns about loopback DATABASE_URL host '%s' in production", (host) => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      databaseHost: host,
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(emitted).toContain("loopback_database_in_prod");
    expect(
      warnings.find((w) => w.message.includes("loopback"))?.context,
    ).toMatchObject({ host });
  });

  it("does NOT warn about a real production database host", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      databaseHost: "db.internal.example.com",
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(
      warnings.some((w) => w.message.includes("DATABASE_URL host")),
    ).toBe(false);
  });

  it("warns when SITE_URL is unset in production", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      siteUrl: null,
      emailAdapterEnv: "smtp",
    });
    expect(emitted).toContain("missing_site_url");
    expect(
      warnings.some((w) => w.message.includes("SITE_URL is unset")),
    ).toBe(true);
  });

  it.each([
    ["http://localhost:3000"],
    ["http://127.0.0.1:8080"],
    ["http://[::1]:3000"],
    ["http://0.0.0.0/"],
  ])("warns about loopback SITE_URL '%s' in production", (siteUrl) => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      siteUrl,
      emailAdapterEnv: "smtp",
    });
    expect(emitted).toContain("loopback_site_url");
    expect(
      warnings.find((w) => w.message.includes("loopback origins"))?.context,
    ).toMatchObject({ siteUrl });
  });

  it("does NOT warn about a real production SITE_URL", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(
      warnings.some((w) => w.message.includes("SITE_URL")),
    ).toBe(false);
  });

  it("malformed SITE_URL skips the loopback check (caller's URL parser will catch it)", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      siteUrl: "not-a-url",
      emailAdapterEnv: "smtp",
    });
    // Not loopback because URL parsing fails — but also not "missing"
    // because the value IS set. Skip both warnings; the framework's
    // own URL parser at first request time will surface the
    // malformation as a real error.
    expect(emitted).not.toContain("loopback_site_url");
    expect(emitted).not.toContain("missing_site_url");
    expect(warnings).toEqual([]);
  });

  // ── #621 — multi-node in-memory rate limiter ─────────────────

  it("warns when InMemoryRateLimiter is the default in a multi-node deploy", () => {
    const { warnings } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
      rateLimiterCustom: false,
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(emitted).toContain("multi_node_in_memory_rate_limiter");
    expect(
      warnings.some((w) =>
        w.message.includes("InMemoryRateLimiter is not multi-node safe"),
      ),
    ).toBe(true);
  });

  it("warns about in-memory rate limiter via container hint in production", () => {
    const { warnings: _ } = captureWarnings();
    const emitted = verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      containerEnv: true,
      rateLimiterCustom: false,
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(emitted).toContain("multi_node_in_memory_rate_limiter");
  });

  it("does NOT warn when operator opted into a custom rate limiter", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
      rateLimiterCustom: true,
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(
      warnings.some((w) =>
        w.message.includes("InMemoryRateLimiter is not multi-node safe"),
      ),
    ).toBe(false);
  });

  it("does NOT warn when rateLimiterCustom is undefined (back-compat)", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: "true",
      // rateLimiterCustom intentionally omitted
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(
      warnings.some((w) =>
        w.message.includes("InMemoryRateLimiter is not multi-node safe"),
      ),
    ).toBe(false);
  });

  it("does NOT warn about in-memory rate limiter on a single-node deploy", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "x".repeat(64),
      nodeEnv: "production",
      multiNodeFlag: undefined,
      rateLimiterCustom: false,
      siteUrl: "https://example.com",
      emailAdapterEnv: "smtp",
    });
    expect(
      warnings.some((w) =>
        w.message.includes("InMemoryRateLimiter is not multi-node safe"),
      ),
    ).toBe(false);
  });

  it("none of the #597 checks fire outside production", () => {
    const { warnings } = captureWarnings();
    verifyStartupSafety({
      storageAdapter: "s3",
      secret: "tiny",
      nodeEnv: "development",
      multiNodeFlag: undefined,
      emailAdapterEnv: null,
      databaseHost: "localhost",
      siteUrl: "http://localhost:3000",
    });
    expect(warnings).toEqual([]);
  });
});
