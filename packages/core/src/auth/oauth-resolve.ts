import { eq, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { npUserOAuthIdentities, npUsers } from "../db/schema/system.js";
import type { NpUserRole } from "../config/types.js";

import { hashPassword } from "./password.js";
import type { OAuthProfile } from "./oauth-providers.js";

/**
 * Resolves an `OAuthProfile` to a real `np_users` row, in this order:
 *
 *  1. Lookup by `(provider, provider_user_id)` — the durable link. This
 *     is the only path that survives an email change at the provider.
 *  2. Email-match — if the provider gave us an email and an existing
 *     user has it, link the OAuth identity to that user. Lets a staff
 *     member who originally signed up with a password later "sign in
 *     with Google" and have it just work, without an explicit linking
 *     UI.
 *  3. Create — auto-provision a new user with the provider's profile,
 *     default role `viewer`. The password column is filled with an
 *     unrecoverable Argon2 hash of a random secret so the column
 *     constraints are satisfied; the user can later run the
 *     forgot-password flow to set a real password if they want one.
 *
 * Side effects: writes a row into `np_user_oauth_identities` for paths
 * 2 and 3, updates `metadata` for path 1.
 */
export interface ResolveOAuthLoginResult {
  user: ResolvedOAuthUser;
  /** Tells the caller whether this login created the underlying user. */
  created: boolean;
  /** Tells the caller whether this login linked a new identity row. */
  linked: boolean;
}

export interface ResolvedOAuthUser {
  id: string;
  email: string;
  name: string;
  role: NpUserRole;
  tokenVersion: number;
}

export interface ResolveOAuthLoginInput {
  provider: string;
  profile: OAuthProfile;
  /** Default role for auto-created users. Defaults to `"viewer"`. */
  defaultRole?: NpUserRole;
}

const SYNTHETIC_EMAIL_SUFFIX = ".oauth.local";

function syntheticEmail(provider: string, providerUserId: string): string {
  // Stable, namespaced, doesn't collide with real provider domains.
  return `${providerUserId}@${provider}${SYNTHETIC_EMAIL_SUFFIX}`;
}

function deriveName(profile: OAuthProfile, fallbackEmail: string): string {
  if (profile.name && profile.name.trim().length > 0) return profile.name.trim();
  const localPart = fallbackEmail.split("@")[0];
  return localPart && localPart.length > 0 ? localPart : "Member";
}

export async function resolveOAuthLogin(
  input: ResolveOAuthLoginInput,
): Promise<ResolveOAuthLoginResult> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const provider = input.provider;
  const profile = input.profile;
  const role: NpUserRole = input.defaultRole ?? "viewer";

  // Step 1: lookup by durable provider link.
  const [existingLink] = (await db
    .select({
      userId: npUserOAuthIdentities.userId,
      identityId: npUserOAuthIdentities.id,
    })
    .from(npUserOAuthIdentities)
    .where(
      and(
        eq(npUserOAuthIdentities.provider, provider),
        eq(npUserOAuthIdentities.providerUserId, profile.providerUserId),
      ),
    )
    .limit(1)) as Array<{ userId: string; identityId: string }>;

  if (existingLink) {
    // Refresh metadata so the most recent provider info is captured.
    const metadata = mergeMetadata(profile);
    await db
      .update(npUserOAuthIdentities)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(npUserOAuthIdentities.id, existingLink.identityId));

    const user = await loadUser(db, existingLink.userId);
    return { user, created: false, linked: false };
  }

  // Step 2: email match. Skipped when the provider doesn't surface an
  // email — we can't risk linking by guesswork.
  if (profile.email) {
    const normalizedEmail = profile.email.trim().toLowerCase();
    const [existingUser] = (await db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      })
      .from(npUsers)
      .where(eq(sql`lower(${npUsers.email})`, normalizedEmail))
      .limit(1)) as ResolvedOAuthUser[];

    if (existingUser) {
      await db.insert(npUserOAuthIdentities).values({
        userId: existingUser.id,
        provider,
        providerUserId: profile.providerUserId,
        metadata: mergeMetadata(profile),
      });
      return { user: existingUser, created: false, linked: true };
    }
  }

  // Step 3: auto-provision.
  const email =
    profile.email && profile.email.trim().length > 0
      ? profile.email.trim().toLowerCase()
      : syntheticEmail(provider, profile.providerUserId);
  const name = deriveName(profile, email);
  const placeholderPassword = await hashPassword(
    crypto.randomUUID() + crypto.randomUUID(),
  );

  const [created] = (await db
    .insert(npUsers)
    .values({
      email,
      name,
      password: placeholderPassword,
      role,
    })
    .returning({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })) as ResolvedOAuthUser[];

  await db.insert(npUserOAuthIdentities).values({
    userId: created.id,
    provider,
    providerUserId: profile.providerUserId,
    metadata: mergeMetadata(profile),
  });

  return { user: created, created: true, linked: true };
}

function mergeMetadata(profile: OAuthProfile): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (profile.avatarUrl) base.avatarUrl = profile.avatarUrl;
  if (profile.email) base.email = profile.email;
  if (profile.name) base.name = profile.name;
  if (profile.metadata) Object.assign(base, profile.metadata);
  return base;
}

async function loadUser(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
): Promise<ResolvedOAuthUser> {
  const [row] = (await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, userId))
    .limit(1)) as ResolvedOAuthUser[];
  if (!row) {
    throw new Error(`User ${userId} referenced by oauth identity is missing`);
  }
  return row;
}
