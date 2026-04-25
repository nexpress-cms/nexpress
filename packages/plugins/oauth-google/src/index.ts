import {
  registerOAuthProvider,
  type OAuthProvider,
  type OAuthProfile,
} from "@nexpress/core";
import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * @nexpress/plugin-oauth-google — adds "Sign in with Google" for the
 * staff (`/api/auth/oauth/google/{start,callback}`) login flow.
 *
 * Differences from the GitHub plugin worth noting:
 *  - Google's token endpoint expects an `application/x-www-form-
 *    urlencoded` body (GitHub accepts JSON; Google does not).
 *  - The userinfo response uses OpenID Connect field names: `sub`
 *    (durable subject), `email_verified` (boolean), `picture`
 *    (avatar URL). We only set `email` on the profile when
 *    `email_verified === true` — taking unverified Google addresses
 *    would let an attacker who controls a misconfigured Google
 *    domain link to a NexPress account by email match.
 *  - We pass `prompt=select_account` so a shared workstation always
 *    shows the account picker. Google supports this; GitHub does
 *    not.
 *
 * Credentials come from env, NOT `nx_plugins.config`:
 *
 *   NX_OAUTH_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 *   NX_OAUTH_GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxx
 *
 * The redirect URI registered in the Google Cloud Console must be
 * exactly `${SITE_URL}/api/auth/oauth/google/callback`.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const DEFAULT_SCOPE = "openid email profile";
const PROVIDER_ID = "google";

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to `"openid email profile"`. */
  scope?: string;
  /** Override fetch (used by tests). */
  fetch?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
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

export function createGoogleOAuthProvider(options: GoogleOAuthOptions): OAuthProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      "createGoogleOAuthProvider: clientId and clientSecret are required",
    );
  }

  return {
    id: PROVIDER_ID,
    label: "Google",
    authorize({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      url.searchParams.set("scope", options.scope ?? DEFAULT_SCOPE);
      // Always show the account picker so a shared workstation never
      // silently re-uses the previous Google session. Google's
      // standard prompt parameter; GitHub has no equivalent.
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    },
    async exchange({ code, redirectUri }): Promise<OAuthProfile> {
      // Step 1: token exchange. Google's token endpoint REQUIRES
      // form-encoded; sending JSON returns invalid_request.
      const tokenBody = new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });
      const tokenRes = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
      });
      if (!tokenRes.ok) {
        throw new Error(`google token exchange failed: HTTP ${tokenRes.status}`);
      }
      const tokenJson = (await tokenRes.json()) as TokenResponse;
      if (!tokenJson.access_token) {
        const reason = tokenJson.error_description ?? tokenJson.error ?? "no access_token";
        throw new Error(`google token exchange failed: ${reason}`);
      }

      // Step 2: userinfo. The OIDC userinfo endpoint returns the
      // standard claim set, including `email_verified` which we MUST
      // honor — picking up an unverified Google address would
      // silently link to a NexPress user via email-match in
      // `resolveOAuthLogin`.
      const userRes = await fetchImpl(USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
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
          scope: tokenJson.scope ?? options.scope ?? DEFAULT_SCOPE,
        },
      };
    },
  };
}

export const googleOAuthPlugin = definePlugin({
  manifest: {
    id: "oauth-google",
    version: "0.1.0",
    name: "Google OAuth",
    description:
      "Adds 'Sign in with Google' for staff users. Reads NX_OAUTH_GOOGLE_CLIENT_ID + NX_OAUTH_GOOGLE_CLIENT_SECRET; logs a warning and registers nothing if either is unset.",
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
        "Wires Google as a staff-side OAuth provider. Honors email_verified — never links unverified Google addresses to existing NexPress users by email.",
      category: "security",
      tags: ["oauth", "sso", "google", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  setup: async (ctx) => {
    const clientId = process.env.NX_OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.NX_OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      ctx.log.warn(
        "Google OAuth not configured — set NX_OAUTH_GOOGLE_CLIENT_ID and NX_OAUTH_GOOGLE_CLIENT_SECRET to enable.",
      );
      return;
    }
    registerOAuthProvider(createGoogleOAuthProvider({ clientId, clientSecret }));
    ctx.log.info("Google OAuth provider registered");
  },
});

export default googleOAuthPlugin;
