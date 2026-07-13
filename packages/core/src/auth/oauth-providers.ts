/**
 * OAuth provider registry — extension point for SSO. A provider plugin
 * (e.g. `@nexpress/plugin-oauth-github`) registers itself at startup
 * via `registerOAuthProvider()`; the framework's `/api/auth/oauth/{id}`
 * routes look it up by id.
 *
 * The provider is responsible for:
 *  - Building the authorize URL (`authorize`).
 *  - Exchanging the callback code for a normalized profile (`exchange`).
 *
 * The framework owns state-cookie signing, identity ↔ user resolution,
 * session minting, and audit. Providers must NOT touch cookies, the DB,
 * or response objects directly.
 */

/**
 * Profile returned from a successful `exchange()`. The framework uses
 * `providerUserId` as the durable identifier — `email` may change at the
 * provider but `providerUserId` should not. If the provider doesn't
 * surface `email`, the framework falls back to a bounded hashed placeholder
 * under `<provider>.oauth.local` so the `np_users.email NOT NULL UNIQUE`
 * constraint is still satisfied without exposing the provider subject.
 */
export interface OAuthProfile {
  /** Stable per-user id from the provider. Required. */
  providerUserId: string;
  /** Optional — falls back to synthetic if missing. */
  email?: string | null;
  /** Optional — defaults to email local-part on user creation. */
  name?: string | null;
  /** Optional — written into `np_user_oauth_identities.metadata`. */
  avatarUrl?: string | null;
  /** Optional — full payload the provider wants to remember (e.g. scopes). */
  metadata?: Record<string, unknown>;
}

/**
 * Inputs the provider receives at the two callback boundaries. The
 * framework picks `redirectUri` from `SITE_URL` (or the request origin
 * in dev) so the provider doesn't have to know its own deployment URL.
 */
export interface OAuthAuthorizeParams {
  state: string;
  redirectUri: string;
  /**
   * PKCE code verifier (32+ char URL-safe random). The framework
   * generates one for every login and threads it through the state
   * cookie. Providers that don't support PKCE (e.g. GitHub) ignore it;
   * providers that require it (e.g. Google) hash it into the
   * `code_challenge` query param.
   */
  codeVerifier: string;
}

export interface OAuthExchangeParams {
  code: string;
  state: string;
  redirectUri: string;
  /** Same verifier minted at /start, recovered from the state cookie. */
  codeVerifier: string;
}

export type OAuthAudience = "staff" | "member";

export interface OAuthProvider {
  /** Stable id used in route paths and `np_user_oauth_identities.provider`. */
  id: string;
  /** Human-readable label for admin UI / login buttons. */
  label?: string;
  /**
   * Login surfaces where this provider should be shown. Omit for
   * back-compat: older providers are visible on both staff and member
   * login pages.
   */
  audiences?: readonly OAuthAudience[];
  /**
   * Returns a fully-qualified URL the framework should redirect the
   * browser to. Async to allow providers that need to mint per-request
   * client credentials.
   */
  authorize(params: OAuthAuthorizeParams): Promise<string> | string;
  /**
   * Validates the callback and returns the normalized profile.
   * Throwing here aborts the login with `OAUTH_EXCHANGE_FAILED`.
   */
  exchange(params: OAuthExchangeParams): Promise<OAuthProfile>;
}

const providers = new Map<string, OAuthProvider>();

/**
 * Register a provider. Idempotent: re-registering with the same id
 * overwrites — useful in dev when a plugin's `setup()` runs again on
 * reload.
 */
export function registerOAuthProvider(provider: OAuthProvider): void {
  if (!provider.id || typeof provider.id !== "string") {
    throw new Error("OAuth provider must have a non-empty string id");
  }
  if (typeof provider.authorize !== "function" || typeof provider.exchange !== "function") {
    throw new Error(`OAuth provider "${provider.id}" must implement authorize() and exchange()`);
  }
  if (
    provider.audiences !== undefined &&
    (provider.audiences.length === 0 ||
      provider.audiences.some((audience) => audience !== "staff" && audience !== "member"))
  ) {
    throw new Error(
      `OAuth provider "${provider.id}" has invalid audiences; expected at least one of "staff" or "member"`,
    );
  }
  providers.set(provider.id, provider);
}

export function getOAuthProvider(id: string): OAuthProvider | undefined {
  return providers.get(id);
}

export function listOAuthProviders(): OAuthProvider[] {
  return Array.from(providers.values());
}

export function oauthProviderSupportsAudience(
  provider: OAuthProvider,
  audience: OAuthAudience,
): boolean {
  return provider.audiences === undefined || provider.audiences.includes(audience);
}

export function listOAuthProvidersFor(audience: OAuthAudience): OAuthProvider[] {
  return listOAuthProviders().filter((provider) =>
    oauthProviderSupportsAudience(provider, audience),
  );
}

/** Reset the registry — tests use this between cases. Not for runtime use. */
export function resetOAuthProviders(): void {
  providers.clear();
}
