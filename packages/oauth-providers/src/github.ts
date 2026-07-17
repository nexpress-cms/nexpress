import { fromArctic, type OAuthProfile, type OAuthProvider } from "@nexpress/core";
import { GitHub } from "arctic";

/**
 * GitHub OAuth provider factory. Wraps `arctic`'s `GitHub` class
 * (token endpoint, error parsing) and resolves the user's profile
 * via the GitHub REST API.
 *
 * `/user.email` is `null` when the user keeps their primary
 * address private; this provider falls back to `/user/emails` and
 * picks the verified primary, or any verified address. Missing
 * email is acceptable — the framework synthesizes a placeholder.
 *
 * GitHub's OAuth doesn't support PKCE, hence `pkce: false`.
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
 * response into an `OAuthProfile`. Exported so tests can exercise
 * the GitHub-specific logic without going through arctic's token
 * exchange layer.
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

export function createGitHubOAuthProvider(options: GitHubOAuthOptions): OAuthProvider {
  if (!options.clientId || !options.clientSecret) {
    throw new Error("createGitHubOAuthProvider: clientId and clientSecret are required");
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
