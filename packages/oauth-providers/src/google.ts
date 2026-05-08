import {
  fromArctic,
  type OAuthProfile,
  type OAuthProvider,
} from "@nexpress/core";
import { Google } from "arctic";

/**
 * Google OAuth provider factory. Wraps `arctic`'s `Google` class
 * (token endpoint, PKCE, refresh) and resolves the user's
 * profile via Google's OIDC userinfo endpoint.
 *
 * **Strictly honors `email_verified`** — if Google's userinfo
 * response sets `email_verified !== true`, the email is dropped
 * from the normalized profile. This blocks an attacker on a
 * misconfigured Google Workspace from claiming a victim's email
 * via the framework's email-match identity-resolution path.
 *
 * Credentials are passed in directly — sites typically read them
 * from env (`NP_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET`) and pass
 * them here. The redirect URI is resolved per-request by the
 * framework, so dev port shifts don't cause
 * `redirect_uri_mismatch`.
 */

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to `["openid", "email", "profile"]`. */
  scopes?: string[];
  /** Override fetch (used by tests). */
  fetch?: typeof fetch;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Hits the Google OIDC userinfo endpoint and normalizes the
 * response. Exported so tests can exercise the email-verification
 * logic without going through arctic's token exchange.
 */
export async function fetchGoogleProfile(
  accessToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OAuthProfile> {
  const userRes = await fetchImpl(USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!userRes.ok) {
    throw new Error(`google userinfo fetch failed: HTTP ${userRes.status}`);
  }
  const user = (await userRes.json()) as GoogleUserInfo;
  if (!user.sub) {
    throw new Error("google userinfo payload missing sub");
  }

  // Strict `=== true` check: missing field, falsy, or stringified
  // "true" all drop the email. Without this guard the framework's
  // email-match path would silently link unverified Google addresses.
  const verifiedEmail = user.email && user.email_verified === true ? user.email : null;
  const fallbackName =
    user.name && user.name.trim().length > 0
      ? user.name
      : [user.given_name, user.family_name].filter(Boolean).join(" ").trim();

  return {
    providerUserId: user.sub,
    email: verifiedEmail,
    name: fallbackName.length > 0 ? fallbackName : null,
    avatarUrl: user.picture ?? null,
    metadata: {
      sub: user.sub,
      email_verified: user.email_verified ?? false,
    },
  };
}

export function createGoogleOAuthProvider(options: GoogleOAuthOptions): OAuthProvider {
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      "createGoogleOAuthProvider: clientId and clientSecret are required",
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return fromArctic(
    (redirectUri) => new Google(options.clientId, options.clientSecret, redirectUri),
    {
      id: "google",
      label: "Google",
      pkce: true,
      scopes: options.scopes ?? DEFAULT_SCOPES,
      fetchProfile: (accessToken) => fetchGoogleProfile(accessToken, fetchImpl),
    },
  );
}
