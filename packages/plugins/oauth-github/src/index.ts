import {
  registerOAuthProvider,
  type OAuthProvider,
  type OAuthProfile,
} from "@nexpress/core";
import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * @nexpress/plugin-oauth-github — adds "Sign in with GitHub" for the
 * staff (`/api/auth/oauth/github/{start,callback}`) login flow built
 * into Phase 9.6a.
 *
 * Pattern: this plugin is a thin adapter. The framework owns the state
 * cookie, identity ↔ user resolution, and session minting; this file
 * just speaks GitHub's OAuth dialect (build the authorize URL, swap a
 * code for a token, fetch the user + verified email).
 *
 * The plugin reads its credentials from env vars at `setup()` time —
 * **not** from `nx_plugins.config`. Secrets shouldn't sit in DB rows
 * that get backed up alongside content. When the env vars are unset
 * the plugin logs a warning and registers nothing, so the rest of the
 * site keeps working.
 *
 *   NX_OAUTH_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
 *   NX_OAUTH_GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
 *
 * The redirect URI registered in the GitHub OAuth app must match
 * `${SITE_URL}/api/auth/oauth/github/callback` exactly.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const EMAILS_URL = "https://api.github.com/user/emails";

const DEFAULT_SCOPE = "read:user user:email";
const PROVIDER_ID = "github";

export interface GitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** OAuth scope. Defaults to `"read:user user:email"`. */
  scope?: string;
  /**
   * Override fetch (used by tests). Signature matches `globalThis.fetch`.
   */
  fetch?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Builds an `OAuthProvider` for GitHub. Pure factory — does not touch
 * the registry. Tests instantiate this directly and inject a stub
 * `fetch`.
 */
export function createGitHubOAuthProvider(options: GitHubOAuthOptions): OAuthProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      "createGitHubOAuthProvider: clientId and clientSecret are required",
    );
  }

  return {
    id: PROVIDER_ID,
    label: "GitHub",
    authorize({ state, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", options.scope ?? DEFAULT_SCOPE);
      return url.toString();
    },
    async exchange({ code, redirectUri }): Promise<OAuthProfile> {
      // Step 1: exchange the code for an access token.
      const tokenRes = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`github token exchange failed: HTTP ${tokenRes.status}`);
      }
      const tokenJson = (await tokenRes.json()) as TokenResponse;
      if (!tokenJson.access_token) {
        const reason = tokenJson.error_description ?? tokenJson.error ?? "no access_token";
        throw new Error(`github token exchange failed: ${reason}`);
      }
      const accessToken = tokenJson.access_token;

      // Step 2: fetch the basic profile.
      const userRes = await fetchImpl(USER_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "nexpress-oauth-github",
        },
      });
      if (!userRes.ok) {
        throw new Error(`github user fetch failed: HTTP ${userRes.status}`);
      }
      const user = (await userRes.json()) as GitHubUser;
      if (typeof user.id !== "number") {
        throw new Error("github user payload missing id");
      }

      // Step 3: GitHub's `email` on /user is null when the user kept
      // their primary address private. Fall back to /user/emails which
      // returns every verified address attached to the account.
      //
      // Wrapped in try/catch — the email lookup is best-effort. If
      // /user/emails returns a non-2xx, malformed body, or errors at
      // the network level, we keep `email = null` and let the
      // framework synthesize a placeholder. The user signed in fine;
      // missing email is recoverable later via profile editing.
      let email = user.email ?? null;
      if (!email) {
        try {
          const emailsRes = await fetchImpl(EMAILS_URL, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "nexpress-oauth-github",
            },
          });
          if (emailsRes.ok) {
            const emails = (await emailsRes.json()) as GitHubEmail[];
            const primary =
              emails.find((entry) => entry.primary && entry.verified) ??
              emails.find((entry) => entry.verified);
            email = primary?.email ?? null;
          }
        } catch {
          // Soft-fail per the comment above — leave email null.
        }
      }

      return {
        providerUserId: String(user.id),
        email,
        name: user.name && user.name.trim().length > 0 ? user.name : user.login,
        avatarUrl: user.avatar_url ?? null,
        metadata: {
          login: user.login,
          scope: tokenJson.scope ?? options.scope ?? DEFAULT_SCOPE,
        },
      };
    },
  };
}

export const githubOAuthPlugin = definePlugin({
  manifest: {
    id: "oauth-github",
    version: "0.1.0",
    name: "GitHub OAuth",
    description:
      "Adds 'Sign in with GitHub' for staff users. Reads NX_OAUTH_GITHUB_CLIENT_ID + NX_OAUTH_GITHUB_CLIENT_SECRET; logs a warning and registers nothing if either is unset.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["network:fetch"],
    allowedHosts: ["github.com", "api.github.com"],
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
        "Wires GitHub as a staff-side OAuth provider on top of the framework's /api/auth/oauth/{provider}/{start,callback} routes.",
      category: "security",
      tags: ["oauth", "sso", "github", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  setup: async (ctx) => {
    const clientId = process.env.NX_OAUTH_GITHUB_CLIENT_ID;
    const clientSecret = process.env.NX_OAUTH_GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      ctx.log.warn(
        "GitHub OAuth not configured — set NX_OAUTH_GITHUB_CLIENT_ID and NX_OAUTH_GITHUB_CLIENT_SECRET to enable.",
      );
      return;
    }
    registerOAuthProvider(createGitHubOAuthProvider({ clientId, clientSecret }));
    ctx.log.info("GitHub OAuth provider registered");
  },
});

export default githubOAuthPlugin;
