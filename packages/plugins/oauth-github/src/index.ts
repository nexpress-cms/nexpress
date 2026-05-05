import {
  fromArctic,
  registerOAuthProvider,
  type OAuthProfile,
  type OAuthProvider,
} from "@nexpress/core";
import { definePlugin } from "@nexpress/plugin-sdk";
import { GitHub } from "arctic";

/**
 * @nexpress/plugin-oauth-github — adds "Sign in with GitHub" for the
 * staff (`/api/auth/oauth/github/{start,callback}`) login flow.
 *
 * Implementation pattern (this file is a useful template for any new
 * provider sitting on top of arctic):
 *
 *   1. Construct the arctic provider with credentials.
 *   2. Pass it to `fromArctic()` along with a `fetchProfile()` that
 *      hits the provider's userinfo / profile endpoint with the
 *      arctic-resolved access token and returns a normalized
 *      `OAuthProfile`.
 *   3. Register the result via `registerOAuthProvider`.
 *
 * Arctic owns the OAuth dance (token endpoint POST, error parsing,
 * refresh-token plumbing). The framework owns state cookies, identity
 * resolution, and session minting. This file only owns the
 * GitHub-specific profile shape.
 *
 * Credentials come from env, NOT `np_plugins.config`:
 *
 *   NP_OAUTH_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
 *   NP_OAUTH_GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
 *
 * The Authorization callback URL registered in the GitHub OAuth app
 * must be exactly `${SITE_URL}/api/auth/oauth/github/callback`.
 */

const USER_URL = "https://api.github.com/user";
const EMAILS_URL = "https://api.github.com/user/emails";
const DEFAULT_SCOPES = ["read:user", "user:email"];

export interface GitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to `["read:user", "user:email"]`. */
  scopes?: string[];
  /** Override fetch (used by tests). */
  fetch?: typeof fetch;
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
 * Hits `/user` (and `/user/emails` when needed) and normalizes the
 * response into an `OAuthProfile`. Exported so tests can exercise the
 * GitHub-specific logic without going through the arctic token
 * exchange layer (which uses its own internal fetch).
 */
export async function fetchGitHubProfile(
  accessToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OAuthProfile> {
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

  // GitHub returns null on /user.email when the user keeps their
  // primary address private. Fall back to /user/emails — soft-fail
  // (try/catch) per the framework contract: missing email is fine,
  // a synthetic placeholder gets used.
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
      // soft-fail
    }
  }

  return {
    providerUserId: String(user.id),
    email,
    name: user.name && user.name.trim().length > 0 ? user.name : user.login,
    avatarUrl: user.avatar_url ?? null,
    metadata: { login: user.login },
  };
}

/**
 * Pure factory — wraps an arctic `GitHub` instance as an
 * `OAuthProvider`. Production code path: framework calls `authorize`
 * → arctic builds the URL → callback → arctic exchanges token →
 * `fetchGitHubProfile` normalizes the user.
 */
export function createGitHubOAuthProvider(options: GitHubOAuthOptions): OAuthProvider {
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      "createGitHubOAuthProvider: clientId and clientSecret are required",
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return fromArctic(
    (redirectUri) => new GitHub(options.clientId, options.clientSecret, redirectUri),
    {
      id: "github",
      label: "GitHub",
      pkce: false,
      scopes: options.scopes ?? DEFAULT_SCOPES,
      fetchProfile: (accessToken) => fetchGitHubProfile(accessToken, fetchImpl),
    },
  );
}

export const githubOAuthPlugin = definePlugin({
  manifest: {
    id: "oauth-github",
    version: "0.2.0",
    name: "GitHub OAuth",
    description:
      "Adds 'Sign in with GitHub' for staff users. Reads NP_OAUTH_GITHUB_CLIENT_ID + NP_OAUTH_GITHUB_CLIENT_SECRET; logs a warning and registers nothing if either is unset.",
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
        "Wires GitHub as a staff-side OAuth provider on top of arctic + the framework's /api/auth/oauth/{provider}/{start,callback} routes.",
      category: "security",
      tags: ["oauth", "sso", "github", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  setup: (ctx) => {
    const clientId = process.env.NP_OAUTH_GITHUB_CLIENT_ID;
    const clientSecret = process.env.NP_OAUTH_GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      ctx.log.warn(
        "GitHub OAuth not configured — set NP_OAUTH_GITHUB_CLIENT_ID and NP_OAUTH_GITHUB_CLIENT_SECRET to enable.",
      );
      return;
    }
    // The redirectUri is resolved per-request by the framework start
    // route (matches whatever Next.js bound), so we don't compute one
    // here — the factory inside `createGitHubOAuthProvider` receives it
    // from the framework on each call.
    registerOAuthProvider(createGitHubOAuthProvider({ clientId, clientSecret }));
    ctx.log.info("GitHub OAuth provider registered");
  },
});

export default githubOAuthPlugin;
