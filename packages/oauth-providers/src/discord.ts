import {
  fromArctic,
  type OAuthProfile,
  type OAuthProvider,
} from "@nexpress/core";
import { Discord } from "arctic";

/**
 * Discord OAuth provider factory. Wraps `arctic`'s `Discord`
 * class and resolves the user's profile via the Discord REST API
 * (`/users/@me`).
 *
 * Like Google, Discord exposes an `email_verified` claim — this
 * provider strictly requires it (`=== true`) before passing the
 * email through to the framework's email-match identity-
 * resolution path. An attacker who controls a Discord account
 * with an unverified email matching a NexPress user could
 * otherwise hijack that account on the email-match branch.
 *
 * Avatar URLs are constructed from the user's `avatar` hash per
 * Discord's CDN convention (`https://cdn.discordapp.com/avatars/
 * {id}/{hash}.png`). Default avatars (no custom upload) are
 * dropped — the URL Discord exposes for those is non-stable.
 */

const USERS_ME_URL = "https://discord.com/api/users/@me";
const DEFAULT_SCOPES = ["identify", "email"];
const AVATAR_BASE = "https://cdn.discordapp.com/avatars";

export interface DiscordOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to `["identify", "email"]`. */
  scopes?: string[];
  /** Override fetch (used by tests). */
  fetch?: typeof fetch;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
  avatar?: string | null;
}

/**
 * Hits Discord's `/users/@me` and normalizes the response. Exported
 * so tests can exercise the email-verification logic without going
 * through arctic's token exchange.
 */
export async function fetchDiscordProfile(
  accessToken: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OAuthProfile> {
  const res = await fetchImpl(USERS_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`discord user fetch failed: HTTP ${res.status}`);
  }
  const user = (await res.json()) as DiscordUser;
  if (!user.id) {
    throw new Error("discord user payload missing id");
  }

  // Strict email-verification check — same posture as the Google
  // provider. `verified` missing or false drops the email.
  const verifiedEmail = user.email && user.verified === true ? user.email : null;
  // Prefer `global_name` (display name) over `username` (handle);
  // falls back to username for accounts without a display name set.
  const name =
    user.global_name && user.global_name.trim().length > 0
      ? user.global_name
      : user.username;
  const avatarUrl = user.avatar
    ? `${AVATAR_BASE}/${user.id}/${user.avatar}.png`
    : null;

  return {
    providerUserId: user.id,
    email: verifiedEmail,
    name,
    avatarUrl,
    metadata: {
      username: user.username,
      verified: user.verified ?? false,
    },
  };
}

export function createDiscordOAuthProvider(
  options: DiscordOAuthOptions,
): OAuthProvider {
  if (!options.clientId || !options.clientSecret) {
    throw new Error(
      "createDiscordOAuthProvider: clientId and clientSecret are required",
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return fromArctic(
    (redirectUri) => new Discord(options.clientId, options.clientSecret, redirectUri),
    {
      id: "discord",
      label: "Discord",
      pkce: false,
      scopes: options.scopes ?? DEFAULT_SCOPES,
      fetchProfile: (accessToken) => fetchDiscordProfile(accessToken, fetchImpl),
    },
  );
}
