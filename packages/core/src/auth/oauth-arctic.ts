import type { OAuthProfile, OAuthProvider } from "./oauth-providers.js";

/**
 * Compatibility adapter that bridges an [Arctic](https://github.com/pilcrowonpaper/arctic)
 * provider
 * (`new GitHub(...)`, `new Google(...)`, `new Apple(...)`, etc.) to
 * NexPress's `OAuthProvider` interface.
 *
 * Arctic was deprecated upstream in July 2026. This structural adapter stays
 * available so existing custom providers do not break, but NexPress no longer
 * installs Arctic or uses it for bundled providers. New integrations should
 * implement `OAuthProvider` directly and follow their provider's current
 * authorization-code and PKCE documentation.
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
 * Minimal slice of Arctic's provider classes that the adapter actually
 * needs. Arctic 3.7's legacy `GitHub` class (no PKCE) and `Google`
 * (PKCE-required) both match this — the third positional arg is "second
 * positional" for non-PKCE providers (just unused) and "code verifier" for
 * PKCE ones.
 *
 * Declared structurally so we don't drag arctic into the public type
 * graph of `@nexpress/core`. Plugins that import a real arctic class
 * pass it directly; the structural match keeps the signature lined up.
 *
 * @deprecated Arctic is no longer maintained. Implement `OAuthProvider`
 * directly for new integrations.
 */
export interface ArcticLikeProvider {
  createAuthorizationURL(state: string, ...rest: never[]): URL;
  validateAuthorizationCode(code: string, ...rest: never[]): Promise<ArcticLikeTokens>;
}

/** @deprecated Arctic is no longer maintained. */
export interface ArcticLikeTokens {
  accessToken(): string;
  hasRefreshToken?(): boolean;
  refreshToken?(): string;
  idToken?(): string;
}

/** @deprecated Arctic is no longer maintained. */
export interface FromArcticOptions {
  /** Provider id used in route paths and `np_user_oauth_identities.provider`. */
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
   * Set `false` for legacy non-PKCE provider classes such as Arctic 3.7's
   * GitHub implementation.
   */
  pkce?: boolean;
  /**
   * Turns an access token (and the full token response, useful for
   * providers like Apple that return the profile in the token) into the
   * normalized `OAuthProfile` consumed by `resolveOAuthLogin`.
   *
   * Throwing aborts the login with `oauth_error=exchange_failed`.
   */
  fetchProfile: (accessToken: string, tokens: ArcticLikeTokens) => Promise<OAuthProfile>;
}

/**
 * Wraps an Arctic provider into the framework's `OAuthProvider`
 * shape. The framework calls `authorize` and `exchange`; this adapter
 * builds a fresh arctic instance per request via `factory(redirectUri)`
 * so the redirect URI always matches what the framework computed for
 * THIS request — critical in dev where Next.js may fall back to a
 * non-3000 port and a setup-time-frozen redirectUri would diverge.
 *
 * @deprecated Arctic is no longer maintained. Keep this only for existing
 * integrations and implement new providers against `OAuthProvider` directly.
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
        ? (
            arctic.createAuthorizationURL as unknown as (
              state: string,
              verifier: string,
              scopes: string[],
            ) => URL
          )(state, codeVerifier, scopes)
        : (arctic.createAuthorizationURL as unknown as (state: string, scopes: string[]) => URL)(
            state,
            scopes,
          );
      return url.toString();
    },
    async exchange({ code, redirectUri, codeVerifier }) {
      const arctic = factory(redirectUri);
      const tokens = usePkce
        ? await (
            arctic.validateAuthorizationCode as unknown as (
              code: string,
              verifier: string,
            ) => Promise<ArcticLikeTokens>
          )(code, codeVerifier)
        : await arctic.validateAuthorizationCode(code);
      return opts.fetchProfile(tokens.accessToken(), tokens);
    },
  };
}
