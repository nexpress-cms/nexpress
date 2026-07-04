import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";

import { googleOAuthPlugin, type GoogleOAuthConfig } from "./index.js";

vi.mock(import("@nexpress/core/auth"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    registerOAuthProvider: vi.fn(),
  };
});

import { registerOAuthProvider } from "@nexpress/core/auth";

describe("oauth-google configSchema", () => {
  const schema = googleOAuthPlugin.configSchema as ZodTypeAny;

  it("provides empty-string defaults for clientId / clientSecret", () => {
    const parsed = schema.parse({});
    expect(parsed).toEqual({
      clientId: "",
      clientSecret: "",
      scopes: ["openid", "email", "profile"],
    });
  });

  it("accepts populated credentials", () => {
    const parsed = schema.parse({
      clientId: "1234567890.apps.googleusercontent.com",
      clientSecret: "GOCSPX-secret",
      scopes: ["openid", "email"],
    }) as GoogleOAuthConfig;
    expect(parsed.clientId).toBe("1234567890.apps.googleusercontent.com");
    expect(parsed.clientSecret).toBe("GOCSPX-secret");
    expect(parsed.scopes).toEqual(["openid", "email"]);
  });

  it("uses default scopes when omitted (openid+email+profile)", () => {
    const parsed = schema.parse({
      clientId: "1234567890.apps.googleusercontent.com",
      clientSecret: "GOCSPX-secret",
    }) as GoogleOAuthConfig;
    expect(parsed.scopes).toEqual(["openid", "email", "profile"]);
  });

  it("marks clientSecret as sensitive (masked input in admin form)", () => {
    const shape = (schema as unknown as { _zod?: { def?: { shape?: Record<string, unknown> } } })
      ._zod?.def?.shape;
    const clientSecretField = shape?.clientSecret as { meta?: () => unknown } | undefined;
    const meta =
      typeof clientSecretField?.meta === "function"
        ? (clientSecretField.meta() as { sensitive?: boolean } | undefined)
        : undefined;
    expect(meta?.sensitive).toBe(true);
  });
});

describe("plugin metadata", () => {
  it("registers id, version, and capabilities", () => {
    expect(googleOAuthPlugin.manifest.id).toBe("oauth-google");
    expect(googleOAuthPlugin.manifest.version).toBe("0.3.0");
    expect(googleOAuthPlugin.manifest.capabilities).toContain("network:fetch");
  });

  it("does NOT declare admin.settings.fields (auto-form replaces it)", () => {
    expect(googleOAuthPlugin.admin?.settings).toBeUndefined();
  });

  it("declares the Google identity hosts as allowedHosts", () => {
    expect(googleOAuthPlugin.manifest.allowedHosts).toEqual([
      "accounts.google.com",
      "oauth2.googleapis.com",
      "openidconnect.googleapis.com",
    ]);
  });
});

describe("setup credential resolution", () => {
  // See oauth-github's parallel suite for the rationale on each
  // test — same atomic-per-source rule, same partial-env error.
  const ORIG_ID = process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
  const ORIG_SECRET = process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;

  beforeEach(() => {
    delete process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
    delete process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;
    vi.mocked(registerOAuthProvider).mockClear();
  });

  afterEach(() => {
    if (ORIG_ID === undefined) delete process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
    else process.env.NP_OAUTH_GOOGLE_CLIENT_ID = ORIG_ID;
    if (ORIG_SECRET === undefined) delete process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;
    else process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET = ORIG_SECRET;
  });

  function makeCtx(config: GoogleOAuthConfig) {
    const calls: { level: "warn" | "error" | "info"; msg: string; data?: unknown }[] = [];
    return {
      calls,
      ctx: {
        config,
        log: {
          warn: (msg: string, data?: unknown) => calls.push({ level: "warn", msg, data }),
          error: (msg: string, data?: unknown) => calls.push({ level: "error", msg, data }),
          info: (msg: string, data?: unknown) => calls.push({ level: "info", msg, data }),
        },
      },
    };
  }

  function runSetup(ctx: unknown): void {
    const setup = googleOAuthPlugin.setup;
    if (typeof setup !== "function") throw new Error("setup is not a function");
    void setup(ctx as Parameters<typeof setup>[0]);
  }

  const validConfig = {
    clientId: "",
    clientSecret: "",
    scopes: ["openid", "email", "profile"],
  } satisfies GoogleOAuthConfig;

  it("registers the provider when both env vars are set (env source)", () => {
    process.env.NP_OAUTH_GOOGLE_CLIENT_ID = "1234567890.apps.googleusercontent.com";
    process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET = "GOCSPX-envsecret";
    const { ctx, calls } = makeCtx(validConfig);
    runSetup(ctx);
    expect(registerOAuthProvider).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.level === "info")?.data).toEqual({ source: "env" });
    expect(registeredProvider()?.audiences).toEqual(["staff", "member"]);
  });

  it("registers the provider when both admin-form fields are set (admin source)", () => {
    const { ctx, calls } = makeCtx({
      clientId: "1234567890.apps.googleusercontent.com",
      clientSecret: "GOCSPX-adminsecret",
      scopes: ["openid"],
    });
    runSetup(ctx);
    expect(registerOAuthProvider).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.level === "info")?.data).toEqual({ source: "admin" });
    expect(registeredProvider()?.audiences).toEqual(["staff", "member"]);
  });

  it("REFUSES to register when env has clientId but no clientSecret", () => {
    process.env.NP_OAUTH_GOOGLE_CLIENT_ID = "1234567890.apps.googleusercontent.com";
    const { ctx, calls } = makeCtx({
      clientId: "fallback.apps.googleusercontent.com",
      clientSecret: "GOCSPX-fallback",
      scopes: ["openid"],
    });
    runSetup(ctx);
    expect(registerOAuthProvider).not.toHaveBeenCalled();
    expect(calls.find((c) => c.level === "error")?.msg).toMatch(/partial/i);
  });

  it("REFUSES to register when env has clientSecret but no clientId", () => {
    process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET = "GOCSPX-leaked";
    const { ctx, calls } = makeCtx({
      clientId: "fallback.apps.googleusercontent.com",
      clientSecret: "GOCSPX-fallback",
      scopes: ["openid"],
    });
    runSetup(ctx);
    expect(registerOAuthProvider).not.toHaveBeenCalled();
    expect(calls.find((c) => c.level === "error")).toBeDefined();
  });

  it("logs an informational setup hint and skips when no source provides credentials", () => {
    const { ctx, calls } = makeCtx(validConfig);
    runSetup(ctx);
    expect(registerOAuthProvider).not.toHaveBeenCalled();
    expect(calls.find((c) => c.level === "warn")).toBeUndefined();
    expect(calls.find((c) => c.level === "info")?.msg).toMatch(/skipping provider registration/i);
  });
});

function registeredProvider():
  | {
      id?: string;
      audiences?: readonly string[];
    }
  | undefined {
  return vi.mocked(registerOAuthProvider).mock.calls[0]?.[0];
}
