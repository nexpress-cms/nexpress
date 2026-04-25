import type { OAuthProfile, OAuthProvider } from "./oauth-providers.js";

/**
 * Adapter that bridges any [arctic](https://arctic.js.org/) provider
 * (`new GitHub(...)`, `new Google(...)`, `new Apple(...)`, etc.) to
 * NexPress's `OAuthProvider` interface.
 *
 * Why this exists: arctic ships ~25 maintained providers and handles
 * the OAuth dance — token exchange, PKCE hashing, refresh-token
 * support — so plugin authors only have to write the **profile fetch**
 * (the part that varies most by provider). Our framework still owns
 * state cookies, identity ↔ user resolution, and session minting; this
 * adapter just lets users skip the boilerplate token POST.
 *
 * Usage from a plugin:
 *
 *   import { Apple } from "arctic";
 *   import { fromArctic, registerOAuthProvider } from "@nexpress/core";
 *
 *   registerOAuthProvider(fromArctic(
 *     // Factory: framework calls this each request with the freshly-
 *     // resolved redirectUri (matters in dev when Next.js may bind a
 *     // non-default port).
 *     (redirectUri) => new Apple(clientId, teamId, keyId, privateKey, redirectUri),
 *     {
 *       id: "apple",
 *       scopes: ["name", "email"],
 *       fetchProfile: async (accessToken, tokens) => {
 *         // Apple returns the user payload INSIDE the token response
 *         // (not a separate userinfo endpoint) — pull it from
 *         // `tokens.idToken()` here and parse the JWT body.
 *         return { providerUserId: parseAppleSub(tokens.idToken()), email: null };
 *       },
 *     },
 *   ));
 */

/**
 * Minimal slice of arctic's provider classes that the adapter actually
 * needs. Both `GitHub` (no PKCE) and `Google` (PKCE-required) match
 * this — the third positional arg is "second positional" for
 * non-PKCE providers (just unused) and "code verifier" for PKCE ones.
 *
 * Declared structurally so we don't drag arctic into the public type
 * graph of `@nexpress/core`. Plugins that import a real arctic class
 * pass it directly; the structural match keeps the signature lined up.
 */
export interface ArcticLikeProvider {
  createAuthorizationURL(state: string, ...rest: never[]): URL;
  validateAuthorizationCode(code: string, ...rest: never[]): Promise<ArcticLikeTokens>;
}

export interface ArcticLikeTokens {
  accessToken(): string;
  hasRefreshToken?(): boolean;
  refreshToken?(): string;
  idToken?(): string;
}

export interface FromArcticOptions {
  /** Provider id used in route paths and `nx_user_oauth_identities.provider`. */
  id: string;
  /** Human label for admin UI / login buttons. */
  label?: string;
  /** Scopes passed to `createAuthorizationURL`. Most providers default
   *  to nothing useful — set this. */
  scopes?: string[];
  /**
   * Whether the underlying arctic provider expects a PKCE code verifier
   * as the second arg to `createAuthorizationURL` and
   * `validateAuthorizationCode`. Default `true` (Google, Apple, etc.).
   * Set `false` for non-PKCE providers like GitHub.
   */
  pkce?: boolean;
  /**
   * Turns an access token (and the full token response, useful for
   * providers like Apple that return the profile in the token) into the
   * normalized `OAuthProfile` consumed by `resolveOAuthLogin`.
   *
   * Throwing aborts the login with `oauth_error=exchange_failed`.
   */
  fetchProfile: (
    accessToken: string,
    tokens: ArcticLikeTokens,
  ) => Promise<OAuthProfile>;
}

/**
 * Wraps an arctic provider into the framework's `OAuthProvider`
 * shape. The framework calls `authorize` and `exchange`; this adapter
 * builds a fresh arctic instance per request via `factory(redirectUri)`
 * so the redirect URI always matches what the framework computed for
 * THIS request — critical in dev where Next.js may fall back to a
 * non-3000 port and a setup-time-frozen redirectUri would diverge.
 *
 * Arctic provider classes are cheap to construct (just hold the three
 * credential strings), so the per-request factory call has no
 * meaningful cost.
 */
export function fromArctic(
  factory: (redirectUri: string) => ArcticLikeProvider,
  opts: FromArcticOptions,
): OAuthProvider {
  const usePkce = opts.pkce !== false;
  const scopes = opts.scopes ?? [];

  return {
    id: opts.id,
    label: opts.label,
    authorize({ state, redirectUri, codeVerifier }) {
      const arctic = factory(redirectUri);
      // Arctic's signatures vary: `(state, scopes)` for non-PKCE,
      // `(state, codeVerifier, scopes)` for PKCE. The structural type
      // hides this; do the dispatch here so plugin code stays clean.
      const url = usePkce
        ? (arctic.createAuthorizationURL as unknown as (
            state: string,
            verifier: string,
            scopes: string[],
          ) => URL)(state, codeVerifier, scopes)
        : (arctic.createAuthorizationURL as unknown as (
            state: string,
            scopes: string[],
          ) => URL)(state, scopes);
      return url.toString();
    },
    async exchange({ code, redirectUri, codeVerifier }) {
      const arctic = factory(redirectUri);
      const tokens = usePkce
        ? await (arctic.validateAuthorizationCode as unknown as (
            code: string,
            verifier: string,
          ) => Promise<ArcticLikeTokens>)(code, codeVerifier)
        : await (arctic.validateAuthorizationCode as unknown as (
            code: string,
          ) => Promise<ArcticLikeTokens>)(code);
      return opts.fetchProfile(tokens.accessToken(), tokens);
    },
  };
}
