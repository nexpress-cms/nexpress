import { afterEach, describe, expect, it } from "vitest";

import {
  listOAuthProvidersFor,
  registerOAuthProvider,
  resetOAuthProviders,
  type OAuthProvider,
} from "./oauth-providers.js";

describe("OAuth provider registry", () => {
  afterEach(() => {
    resetOAuthProviders();
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
});

function makeProvider(id: string, audiences?: OAuthProvider["audiences"]): OAuthProvider {
  return {
    id,
    audiences,
    authorize: () => "https://provider.example/oauth",
    exchange: () => Promise.resolve({ providerUserId: "subject" }),
  };
}
