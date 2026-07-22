import { afterEach, describe, expect, it } from "vitest";

import {
  isOAuthProviderAvailableFor,
  listOAuthProvidersFor,
  registerOAuthProvider,
  resetOAuthProviders,
  resetPluginOAuthProviders,
  unregisterOAuthProvidersBySourcePlugin,
  type OAuthProvider,
} from "./oauth-providers.js";
import { resetEnabledGate, setPluginEnabledForTest } from "../plugins/enabled-gate.js";

describe("OAuth provider registry", () => {
  afterEach(() => {
    resetOAuthProviders();
    resetEnabledGate();
  });

  it("shows legacy providers without audiences on both login surfaces", () => {
    registerOAuthProvider(makeProvider("legacy"));

    expect(listOAuthProvidersFor("staff").map((provider) => provider.id)).toEqual(["legacy"]);
    expect(listOAuthProvidersFor("member").map((provider) => provider.id)).toEqual(["legacy"]);
  });

  it("filters providers by declared login audience", () => {
    registerOAuthProvider(makeProvider("staff-only", ["staff"]));
    registerOAuthProvider(makeProvider("member-only", ["member"]));
    registerOAuthProvider(makeProvider("both", ["staff", "member"]));

    expect(listOAuthProvidersFor("staff").map((provider) => provider.id)).toEqual([
      "staff-only",
      "both",
    ]);
    expect(listOAuthProvidersFor("member").map((provider) => provider.id)).toEqual([
      "member-only",
      "both",
    ]);
  });

  it("rejects invalid audience declarations", () => {
    expect(() =>
      registerOAuthProvider({
        ...makeProvider("broken"),
        audiences: ["public"],
      } as unknown as OAuthProvider),
    ).toThrow(/invalid audiences/i);
  });

  it("rejects empty audience declarations", () => {
    expect(() => registerOAuthProvider(makeProvider("hidden", []))).toThrow(/at least one/i);
  });

  it("fails closed when a request-time availability hook rejects the site", async () => {
    const provider = { ...makeProvider("dynamic"), isAvailable: () => false };
    registerOAuthProvider(provider);

    await expect(isOAuthProviderAvailableFor(provider, "staff")).resolves.toBe(false);
  });

  it("hides a provider owned by a plugin disabled for the active site", async () => {
    const provider = { ...makeProvider("owned"), sourcePluginId: "oauth-owned" };
    registerOAuthProvider(provider);
    setPluginEnabledForTest("oauth-owned", false);

    await expect(isOAuthProviderAvailableFor(provider, "staff")).resolves.toBe(false);
  });

  it("removes plugin-owned providers without disturbing host providers", () => {
    registerOAuthProvider(makeProvider("host"));
    registerOAuthProvider({ ...makeProvider("first"), sourcePluginId: "oauth-first" });
    registerOAuthProvider({ ...makeProvider("second"), sourcePluginId: "oauth-second" });

    unregisterOAuthProvidersBySourcePlugin("oauth-first");
    expect(listOAuthProvidersFor("staff").map((provider) => provider.id)).toEqual([
      "host",
      "second",
    ]);

    resetPluginOAuthProviders();
    expect(listOAuthProvidersFor("staff").map((provider) => provider.id)).toEqual(["host"]);
  });

  it("rejects malformed request-time availability hooks", () => {
    expect(() =>
      registerOAuthProvider({ ...makeProvider("broken"), isAvailable: true } as never),
    ).toThrow(/isAvailable must be a function/);
  });
});

function makeProvider(id: string, audiences?: OAuthProvider["audiences"]): OAuthProvider {
  return {
    id,
    audiences,
    authorize: () => "https://provider.example/oauth",
    exchange: () => Promise.resolve({ providerUserId: "subject" }),
  };
}
