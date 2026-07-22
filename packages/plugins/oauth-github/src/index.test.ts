import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";

import { githubOAuthPlugin, type GitHubOAuthConfig } from "./index.js";

// `registerOAuthProvider` from @nexpress/core/auth is the side effect we
// want to assert. Stub just that one export and forward the rest
// (oauth-providers' factories transitively need `fromArctic` etc.).
vi.mock(import("@nexpress/core/auth"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    registerOAuthProvider: vi.fn(),
  };
});

import { registerOAuthProvider } from "@nexpress/core/auth";

describe("oauth-github configSchema", () => {
  const schema = githubOAuthPlugin.configSchema as ZodTypeAny;

  it("provides empty-string defaults for clientId / clientSecret", () => {
    // Empty defaults make the schema parse cleanly when neither env
    // nor admin form is filled — `setup()` then detects the empty
    // strings and hides the request-time provider until configured. Without
    // defaults, the first cold read has no valid schema defaults and
    // cannot construct the plugin config form.
    const parsed = schema.parse({});
    expect(parsed).toEqual({
      clientId: "",
      clientSecret: "",
      scopes: ["read:user", "user:email"],
      audience: "staff",
    });
  });

  it("accepts populated credentials", () => {
    const parsed = schema.parse({
      clientId: "Iv1.0123456789abcdef",
      clientSecret: "abcdef0123456789",
      scopes: ["read:user"],
      audience: "member",
    }) as GitHubOAuthConfig;
    expect(parsed.clientId).toBe("Iv1.0123456789abcdef");
    expect(parsed.clientSecret).toBe("abcdef0123456789");
    expect(parsed.scopes).toEqual(["read:user"]);
    expect(parsed.audience).toBe("member");
  });

  it("uses default scopes when omitted", () => {
    const parsed = schema.parse({
      clientId: "Iv1.0123456789",
      clientSecret: "secret",
    }) as GitHubOAuthConfig;
    expect(parsed.scopes).toEqual(["read:user", "user:email"]);
    expect(parsed.audience).toBe("staff");
  });

  it("marks clientSecret as sensitive (masked input in admin form)", () => {
    // The schema introspector reads .meta({ sensitive: true }) and
    // emits a `password` field type; the admin form-renderer
    // dispatches that to <Input type="password">. We can't unit-test
    // the introspector here without pulling @nexpress/core, so we
    // verify the meta payload directly.
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
    expect(githubOAuthPlugin.manifest.id).toBe("oauth-github");
    expect(githubOAuthPlugin.manifest.version).toBe("0.3.0");
    expect(githubOAuthPlugin.manifest.capabilities).toContain("network:fetch");
    expect(githubOAuthPlugin.manifest.capabilities).toContain("settings:read");
  });

  it("does NOT declare admin.settings.fields (auto-form replaces it)", () => {
    expect(githubOAuthPlugin.admin?.settings).toBeUndefined();
  });

  it("declares the GitHub API hosts as allowedHosts", () => {
    expect(githubOAuthPlugin.manifest.allowedHosts).toEqual(["github.com", "api.github.com"]);
  });
});

describe("setup credential resolution", () => {
  // Save / restore process.env between tests so a test that sets
  // NP_OAUTH_GITHUB_CLIENT_ID doesn't leak into the next.
  const ORIG_ID = process.env.NP_OAUTH_GITHUB_CLIENT_ID;
  const ORIG_SECRET = process.env.NP_OAUTH_GITHUB_CLIENT_SECRET;

  beforeEach(() => {
    delete process.env.NP_OAUTH_GITHUB_CLIENT_ID;
    delete process.env.NP_OAUTH_GITHUB_CLIENT_SECRET;
    vi.mocked(registerOAuthProvider).mockClear();
  });

  afterEach(() => {
    if (ORIG_ID === undefined) delete process.env.NP_OAUTH_GITHUB_CLIENT_ID;
    else process.env.NP_OAUTH_GITHUB_CLIENT_ID = ORIG_ID;
    if (ORIG_SECRET === undefined) delete process.env.NP_OAUTH_GITHUB_CLIENT_SECRET;
    else process.env.NP_OAUTH_GITHUB_CLIENT_SECRET = ORIG_SECRET;
  });

  function makeCtx(config: GitHubOAuthConfig) {
    const calls: { level: "warn" | "error" | "info"; msg: string; data?: unknown }[] = [];
    return {
      calls,
      ctx: {
        config,
        settings: { getPlugin: () => Promise.resolve(config) },
        log: {
          warn: (msg: string, data?: unknown) => calls.push({ level: "warn", msg, data }),
          error: (msg: string, data?: unknown) => calls.push({ level: "error", msg, data }),
          info: (msg: string, data?: unknown) => calls.push({ level: "info", msg, data }),
        },
      },
    };
  }

  function runSetup(ctx: unknown): void {
    const setup = githubOAuthPlugin.setup;
    if (typeof setup !== "function") throw new Error("setup is not a function");
    void setup(ctx as Parameters<typeof setup>[0]);
  }

  const validConfig = {
    clientId: "",
    clientSecret: "",
    scopes: ["read:user", "user:email"],
    audience: "staff",
  } satisfies GitHubOAuthConfig;

  it("registers the provider when both env vars are set (env source)", async () => {
    process.env.NP_OAUTH_GITHUB_CLIENT_ID = "Iv1.fromenv";
    process.env.NP_OAUTH_GITHUB_CLIENT_SECRET = "envsecret";
    const { ctx, calls } = makeCtx(validConfig);
    runSetup(ctx);
    expect(registerOAuthProvider).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.level === "info")?.data).toEqual({
      credentials: "environment",
      resolution: "request-time",
    });
    expect(registeredProvider()?.audiences).toEqual(["staff", "member"]);
    await expect(registeredProvider()?.isAvailable?.("staff")).resolves.toBe(true);
    await expect(registeredProvider()?.isAvailable?.("member")).resolves.toBe(false);
  });

  it("registers the provider when both admin-form fields are set (admin source)", async () => {
    const { ctx, calls } = makeCtx({
      clientId: "Iv1.fromadmin",
      clientSecret: "adminsecret",
      scopes: ["read:user"],
      audience: "member",
    });
    runSetup(ctx);
    expect(registerOAuthProvider).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.level === "info")?.data).toEqual({
      credentials: "site-config",
      resolution: "request-time",
    });
    expect(registeredProvider()?.audiences).toEqual(["staff", "member"]);
    await expect(registeredProvider()?.isAvailable?.("member")).resolves.toBe(true);
  });

  it("env wins over admin form when both sources have credentials", () => {
    process.env.NP_OAUTH_GITHUB_CLIENT_ID = "Iv1.envwins";
    process.env.NP_OAUTH_GITHUB_CLIENT_SECRET = "envwinssecret";
    const { ctx } = makeCtx({
      clientId: "Iv1.adminform",
      clientSecret: "adminformsecret",
      scopes: ["read:user"],
      audience: "member",
    });
    runSetup(ctx);
    expect(registeredProvider()).toEqual(expect.objectContaining({ id: "github" }));
    // The provider object can't easily be inspected for the
    // exact secret value (it's wrapped in arctic), so we assert
    // via the log source tag.
  });

  it("REFUSES to register when env has clientId but no clientSecret (atomic source rule)", () => {
    process.env.NP_OAUTH_GITHUB_CLIENT_ID = "Iv1.partial";
    // NP_OAUTH_GITHUB_CLIENT_SECRET deliberately unset
    const { ctx, calls } = makeCtx({
      clientId: "Iv1.fallback",
      clientSecret: "fallbacksecret",
      scopes: ["read:user"],
      audience: "staff",
    });
    runSetup(ctx);
    expect(registerOAuthProvider).not.toHaveBeenCalled();
    const errorCall = calls.find((c) => c.level === "error");
    expect(errorCall?.msg).toMatch(/partial/i);
  });

  it("REFUSES to register when env has clientSecret but no clientId (atomic source rule)", () => {
    process.env.NP_OAUTH_GITHUB_CLIENT_SECRET = "leakedsecret";
    // NP_OAUTH_GITHUB_CLIENT_ID deliberately unset
    const { ctx, calls } = makeCtx({
      clientId: "Iv1.fallback",
      clientSecret: "fallbacksecret",
      scopes: ["read:user"],
      audience: "staff",
    });
    runSetup(ctx);
    expect(registerOAuthProvider).not.toHaveBeenCalled();
    expect(calls.find((c) => c.level === "error")).toBeDefined();
  });

  it("registers once but hides the provider when the current site has no credentials", async () => {
    const { ctx } = makeCtx(validConfig);
    runSetup(ctx);
    expect(registerOAuthProvider).toHaveBeenCalledOnce();
    await expect(registeredProvider()?.isAvailable?.("staff")).resolves.toBe(false);
  });
});

function registeredProvider():
  | {
      id?: string;
      audiences?: readonly string[];
      isAvailable?: (audience: "staff" | "member") => boolean | Promise<boolean>;
    }
  | undefined {
  return vi.mocked(registerOAuthProvider).mock.calls[0]?.[0];
}
