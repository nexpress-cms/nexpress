import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEmailAdapter, setEmailAdapter } from "@nexpress/core/email";

import { checkEmailAdapter, checkSecret, checkSiteUrl } from "@/lib/system-health";

/**
 * Unit tests for the runtime safety checks added in #619 — each
 * function reads `process.env` and returns a `Check` row for the
 * `/admin/health` page. Tests mutate env vars in place and
 * restore them in `afterEach` so they stay isolated.
 */

interface EnvSnapshot {
  [key: string]: string | undefined;
}

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const k of keys) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

describe("checkSiteUrl", () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv(["SITE_URL"]);
  });
  afterEach(() => {
    restoreEnv(snap);
  });

  it("error when SITE_URL is unset", () => {
    delete process.env.SITE_URL;
    const c = checkSiteUrl();
    expect(c.state).toBe("error");
    expect(c.detail).toBe("unset");
  });

  it("error when SITE_URL is unparseable", () => {
    process.env.SITE_URL = "not-a-url";
    const c = checkSiteUrl();
    expect(c.state).toBe("error");
  });

  it("warn when SITE_URL is loopback (localhost)", () => {
    process.env.SITE_URL = "http://localhost:3000";
    const c = checkSiteUrl();
    expect(c.state).toBe("warn");
    expect(c.detail).toMatch(/loopback/);
  });

  it.each([["127.0.0.1"], ["[::1]"], ["0.0.0.0"]])(
    "warn when SITE_URL host is %s (loopback variant)",
    (host) => {
      process.env.SITE_URL = `http://${host}/`;
      const c = checkSiteUrl();
      expect(c.state).toBe("warn");
    },
  );

  it("ok when SITE_URL is a real public origin", () => {
    process.env.SITE_URL = "https://example.com";
    const c = checkSiteUrl();
    expect(c.state).toBe("ok");
    expect(c.detail).toBe("https://example.com");
  });
});

describe("checkEmailAdapter", () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv([
      "NP_EMAIL_ADAPTER",
      "NP_SMTP_HOST",
      "NP_SMTP_PORT",
      "NP_SMTP_USER",
      "NP_SMTP_PASS",
      "NP_SMTP_FROM",
      "NP_SMTP_SECURE",
    ]);
  });
  afterEach(() => {
    restoreEnv(snap);
    resetEmailAdapter();
  });

  it("warn when NP_EMAIL_ADAPTER is unset", () => {
    delete process.env.NP_EMAIL_ADAPTER;
    const c = checkEmailAdapter();
    expect(c.state).toBe("warn");
    expect(c.detail).toMatch(/unset/);
  });

  it("warn when NP_EMAIL_ADAPTER='noop' explicitly", () => {
    process.env.NP_EMAIL_ADAPTER = "noop";
    const c = checkEmailAdapter();
    expect(c.state).toBe("warn");
    expect(c.detail).toBe("noop");
  });

  it("error when NP_EMAIL_ADAPTER='smtp' but NP_SMTP_HOST/NP_SMTP_FROM missing", () => {
    process.env.NP_EMAIL_ADAPTER = "smtp";
    delete process.env.NP_SMTP_HOST;
    delete process.env.NP_SMTP_FROM;
    const c = checkEmailAdapter();
    expect(c.state).toBe("error");
    expect(c.detail).toMatch(/NP_SMTP_HOST.*required/u);
  });

  it("ok when NP_EMAIL_ADAPTER='smtp' with required vars", () => {
    process.env.NP_EMAIL_ADAPTER = "smtp";
    process.env.NP_SMTP_HOST = "smtp.example.com";
    process.env.NP_SMTP_FROM = "noreply@example.com";
    const c = checkEmailAdapter();
    expect(c.state).toBe("ok");
    expect(c.detail).toMatch(/smtp.example.com/);
  });

  it("ok when NP_EMAIL_ADAPTER explicitly selects programmatic custom registration", () => {
    process.env.NP_EMAIL_ADAPTER = "custom";
    setEmailAdapter({ kind: "resend", send: async () => undefined });
    const c = checkEmailAdapter();
    expect(c.state).toBe("ok");
    expect(c.detail).toBe("custom (resend)");
  });

  it("errors when custom mode has no programmatic adapter", () => {
    process.env.NP_EMAIL_ADAPTER = "custom";
    const c = checkEmailAdapter();
    expect(c.state).toBe("error");
    expect(c.detail).toMatch(/no adapter/u);
  });

  it("fails closed on unknown adapter aliases", () => {
    process.env.NP_EMAIL_ADAPTER = "resend";
    const c = checkEmailAdapter();
    expect(c.state).toBe("error");
    expect(c.detail).toMatch(/NP_EMAIL_ADAPTER/);
  });

  it("fails closed on malformed SMTP port, secure flag, and partial auth", () => {
    process.env.NP_EMAIL_ADAPTER = "smtp";
    process.env.NP_SMTP_HOST = "smtp.example.com";
    process.env.NP_SMTP_FROM = "noreply@example.com";
    process.env.NP_SMTP_PORT = "587.5";
    expect(checkEmailAdapter()).toEqual(expect.objectContaining({ state: "error" }));

    process.env.NP_SMTP_PORT = "587";
    process.env.NP_SMTP_SECURE = "yes";
    expect(checkEmailAdapter()).toEqual(expect.objectContaining({ state: "error" }));

    process.env.NP_SMTP_SECURE = "false";
    process.env.NP_SMTP_USER = "partial";
    delete process.env.NP_SMTP_PASS;
    expect(checkEmailAdapter()).toEqual(expect.objectContaining({ state: "error" }));
  });
});

describe("checkSecret", () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv(["NP_SECRET"]);
  });
  afterEach(() => {
    restoreEnv(snap);
  });

  it("error when NP_SECRET is unset", () => {
    delete process.env.NP_SECRET;
    const c = checkSecret();
    expect(c.state).toBe("error");
    expect(c.detail).toBe("unset");
  });

  it("error when NP_SECRET is shorter than 32", () => {
    process.env.NP_SECRET = "tiny";
    const c = checkSecret();
    expect(c.state).toBe("error");
    expect(c.detail).toMatch(/4 chars/);
  });

  it("warn when NP_SECRET has fewer than 8 distinct chars", () => {
    process.env.NP_SECRET = "a".repeat(64);
    const c = checkSecret();
    expect(c.state).toBe("warn");
    expect(c.detail).toMatch(/1 distinct/);
  });

  it("ok when NP_SECRET is 32+ chars with sufficient entropy", () => {
    // 32 chars, exactly 8 distinct (a..h repeating)
    process.env.NP_SECRET = "abcdefghabcdefghabcdefghabcdefgh";
    const c = checkSecret();
    expect(c.state).toBe("ok");
    expect(c.detail).toMatch(/32 chars/);
  });
});
