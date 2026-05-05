import {
  fromArctic,
  registerOAuthProvider,
  type OAuthProfile,
  type OAuthProvider,
} from "@nexpress/core";
import { definePlugin } from "@nexpress/plugin-sdk";
import { Google } from "arctic";

/**
 * @nexpress/plugin-oauth-google — adds "Sign in with Google" for the
 * staff (`/api/auth/oauth/google/{start,callback}`) login flow.
 *
 * Implementation sits on `arctic`'s `Google` class which handles
 * PKCE + token exchange. This file owns:
 *
 *   1. Plugin manifest + env-driven setup.
 *   2. `fetchGoogleProfile()` — turns an access token into a
 *      normalized `OAuthProfile`. Critically, it honors
 *      `email_verified` strictly: if Google's userinfo claims
 *      `email_verified: true` the email goes through, otherwise it's
 *      dropped. Without this, an attacker controlling a misconfigured
 *      Google Workspace could link to an existing NexPress user via
 *      the email-match path in `resolveOAuthLogin`.
 *
 * Credentials come from env, NOT `np_plugins.config`:
 *
 *   NP_OAUTH_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 *   NP_OAUTH_GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxx
 *
 * The redirect URI registered in Google Cloud Console must be exactly
 * `${SITE_URL}/api/auth/oauth/google/callback`.
 */

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
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
 * Hits the Google OIDC userinfo endpoint and normalizes the response.
 * Exported so tests can exercise the email-verification logic without
 * going through arctic's token exchange.
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

export const googleOAuthPlugin = definePlugin({
  manifest: {
    id: "oauth-google",
    version: "0.2.0",
    name: "Google OAuth",
    description:
      "Adds 'Sign in with Google' for staff users. Honors email_verified strictly. Reads NP_OAUTH_GOOGLE_CLIENT_ID + NP_OAUTH_GOOGLE_CLIENT_SECRET; logs a warning and registers nothing if either is unset.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["network:fetch"],
    allowedHosts: [
      "accounts.google.com",
      "oauth2.googleapis.com",
      "openidconnect.googleapis.com",
    ],
    provides: {
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: [],
      hooks: [],
    },
    agent: {
      description:
        "Wires Google as a staff-side OAuth provider on top of arctic. Honors email_verified — never links unverified Google addresses to existing NexPress users by email.",
      category: "security",
      tags: ["oauth", "sso", "google", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  setup: (ctx) => {
    const clientId = process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      ctx.log.warn(
        "Google OAuth not configured — set NP_OAUTH_GOOGLE_CLIENT_ID and NP_OAUTH_GOOGLE_CLIENT_SECRET to enable.",
      );
      return;
    }
    // The redirectUri is resolved per-request by the framework (so
    // dev port shifts don't cause Google's redirect_uri_mismatch);
    // the factory inside `createGoogleOAuthProvider` receives it.
    registerOAuthProvider(createGoogleOAuthProvider({ clientId, clientSecret }));
    ctx.log.info("Google OAuth provider registered");
  },
});

export default googleOAuthPlugin;
