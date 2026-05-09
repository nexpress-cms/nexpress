import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { githubOAuthPlugin, type GitHubOAuthConfig } from "./index.js";

describe("oauth-github configSchema", () => {
  const schema = githubOAuthPlugin.configSchema as ZodTypeAny;

  it("provides empty-string defaults for clientId / clientSecret", () => {
    // Empty defaults make the schema parse cleanly when neither env
    // nor admin form is filled — `setup()` then detects the empty
    // strings and skips registration with a clear warning. Without
    // defaults, `getPluginConfig` returns schema-defaults that fail
    // safeParse on first cold read, surfacing as parseError on the
    // admin page (noisy for fresh installs).
    const parsed = schema.parse({});
    expect(parsed).toEqual({
      clientId: "",
      clientSecret: "",
      scopes: ["read:user", "user:email"],
    });
  });

  it("accepts populated credentials", () => {
    const parsed = schema.parse({
      clientId: "Iv1.0123456789abcdef",
      clientSecret: "abcdef0123456789",
      scopes: ["read:user"],
    }) as GitHubOAuthConfig;
    expect(parsed.clientId).toBe("Iv1.0123456789abcdef");
    expect(parsed.clientSecret).toBe("abcdef0123456789");
    expect(parsed.scopes).toEqual(["read:user"]);
  });

  it("uses default scopes when omitted", () => {
    const parsed = schema.parse({
      clientId: "Iv1.0123456789",
      clientSecret: "secret",
    }) as GitHubOAuthConfig;
    expect(parsed.scopes).toEqual(["read:user", "user:email"]);
  });

  it("marks clientSecret as sensitive (masked input in admin form)", () => {
    // The schema introspector reads .meta({ sensitive: true }) and
    // emits a `password` field type; the admin form-renderer
    // dispatches that to <Input type="password">. We can't unit-test
    // the introspector here without pulling @nexpress/core, so we
    // verify the meta payload directly.
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
    expect(githubOAuthPlugin.manifest.id).toBe("oauth-github");
    expect(githubOAuthPlugin.manifest.version).toBe("0.3.0");
    expect(githubOAuthPlugin.manifest.capabilities).toContain("network:fetch");
  });

  it("does NOT declare admin.settings.fields (auto-form replaces it)", () => {
    expect(githubOAuthPlugin.admin?.settings).toBeUndefined();
  });

  it("declares the GitHub API hosts as allowedHosts", () => {
    expect(githubOAuthPlugin.manifest.allowedHosts).toEqual([
      "github.com",
      "api.github.com",
    ]);
  });
});
