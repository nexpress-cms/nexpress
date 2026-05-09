import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { googleOAuthPlugin, type GoogleOAuthConfig } from "./index.js";

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
    const shape = (schema as unknown as { _zod?: { def?: { shape?: Record<string, unknown> } } })._zod?.def?.shape;
    const clientSecretField = shape?.clientSecret as
      | { meta?: () => unknown }
      | undefined;
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
