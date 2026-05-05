import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { getCommunitySettings } from "../community/settings.js";
import { npMemberIdentities, npMembers } from "../db/schema/community.js";
import { NpForbiddenError } from "../errors.js";

import { hashPassword } from "./password.js";
import type { OAuthProfile } from "./oauth-providers.js";

/**
 * Member-side mirror of `resolveOAuthLogin` (the staff resolver in
 * `oauth-resolve.ts`). Walks the same three-step ladder:
 *
 *   1. Lookup by `(provider, subject)` in `np_member_identities` —
 *      durable provider link.
 *   2. Email match — if the profile carries an email, link the
 *      identity to the existing `np_members` row.
 *   3. Auto-provision a new member with status=`active`, default
 *      password = unrecoverable Argon2 of a random secret. The user
 *      can later run forgot-password to set a real password if they
 *      want one (or stay SSO-only).
 *
 * Members are kept distinct from staff users at every layer
 * (different table, different cookies, different audience claim on
 * the JWT). This resolver intentionally never touches `np_users`.
 */
export interface ResolvedOAuthMember {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  status: "active" | "pending" | "suspended" | "deleted";
  tokenVersion: number;
}

export interface ResolveMemberOAuthLoginInput {
  provider: string;
  profile: OAuthProfile;
}

export interface ResolveMemberOAuthLoginResult {
  member: ResolvedOAuthMember;
  /** True when this login auto-provisioned the underlying member. */
  created: boolean;
  /** True when this login linked a new identity row (covers steps 2 + 3). */
  linked: boolean;
}

const SYNTHETIC_EMAIL_SUFFIX = ".oauth.local";
const HANDLE_FALLBACK = "user";
const HANDLE_RANDOM_SUFFIX_BYTES = 4;

function syntheticEmail(provider: string, providerUserId: string): string {
  return `${providerUserId}@${provider}${SYNTHETIC_EMAIL_SUFFIX}`;
}

/**
 * Members have a unique `handle` field. Build a candidate from the
 * provider's profile, sanitize to the project's handle regex, and add
 * a short random suffix to dodge collisions on common values like
 * "alice" / "octocat".
 *
 * Handle regex (per `register/route.ts`):
 *   /^[a-z0-9][a-z0-9_-]{2,29}$/
 */
function generateHandle(profile: OAuthProfile, fallbackEmail: string): string {
  const seed =
    (profile.metadata && typeof profile.metadata.login === "string" && profile.metadata.login) ||
    profile.name ||
    fallbackEmail.split("@")[0] ||
    HANDLE_FALLBACK;
  const sanitized = String(seed)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 20);
  const base = sanitized.length >= 3 ? sanitized : HANDLE_FALLBACK;
  // Random suffix keeps handles unique across the OAuth user pool —
  // accept the cost of "alice-9k2x" rather than fighting a tight loop
  // of insert-and-retry on every collision.
  const suffix = Math.random()
    .toString(36)
    .slice(2, 2 + HANDLE_RANDOM_SUFFIX_BYTES);
  return `${base}-${suffix}`.slice(0, 30);
}

function deriveDisplayName(profile: OAuthProfile, fallbackEmail: string): string {
  if (profile.name && profile.name.trim().length > 0) return profile.name.trim();
  const localPart = fallbackEmail.split("@")[0];
  return localPart && localPart.length > 0 ? localPart : "Member";
}

function mergeMetadata(profile: OAuthProfile): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (profile.avatarUrl) base.avatarUrl = profile.avatarUrl;
  if (profile.email) base.email = profile.email;
  if (profile.name) base.name = profile.name;
  if (profile.metadata) Object.assign(base, profile.metadata);
  return base;
}

async function loadMember(
  db: NodePgDatabase<Record<string, unknown>>,
  memberId: string,
): Promise<ResolvedOAuthMember> {
  const [row] = (await db
    .select({
      id: npMembers.id,
      email: npMembers.email,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      status: npMembers.status,
      tokenVersion: npMembers.tokenVersion,
    })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as ResolvedOAuthMember[];
  if (!row) {
    throw new Error(`Member ${memberId} referenced by oauth identity is missing`);
  }
  return row;
}

export async function resolveMemberOAuthLogin(
  input: ResolveMemberOAuthLoginInput,
): Promise<ResolveMemberOAuthLoginResult> {
  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  const { provider, profile } = input;

  // Step 1: durable lookup.
  const [existingLink] = (await db
    .select({ memberId: npMemberIdentities.memberId, identityId: npMemberIdentities.id })
    .from(npMemberIdentities)
    .where(
      and(
        eq(npMemberIdentities.provider, provider),
        eq(npMemberIdentities.subject, profile.providerUserId),
      ),
    )
    .limit(1)) as Array<{ memberId: string; identityId: string }>;

  if (existingLink) {
    await db
      .update(npMemberIdentities)
      .set({ metadata: mergeMetadata(profile), updatedAt: new Date() })
      .where(eq(npMemberIdentities.id, existingLink.identityId));
    const member = await loadMember(db, existingLink.memberId);
    return { member, created: false, linked: false };
  }

  // Step 2: email match.
  if (profile.email) {
    const normalizedEmail = profile.email.trim().toLowerCase();
    const [existingMember] = (await db
      .select({
        id: npMembers.id,
        email: npMembers.email,
        handle: npMembers.handle,
        displayName: npMembers.displayName,
        status: npMembers.status,
        tokenVersion: npMembers.tokenVersion,
      })
      .from(npMembers)
      .where(eq(sql`lower(${npMembers.email})`, normalizedEmail))
      .limit(1)) as ResolvedOAuthMember[];

    if (existingMember) {
      // Refuse to auto-link an OAuth identity to a non-active member.
      // Without this guard an attacker who controls an OAuth account
      // with a victim's email could pre-link an identity to the
      // victim's pending (unverified) row; once the victim later
      // activates, the attacker's identity is already attached and
      // they can sign in as the victim. The callback would still
      // refuse the immediate login (status check below), but the
      // dangling link would persist.
      //
      // Active members are the only ones we'll cross-link
      // automatically — pending / suspended / deleted are returned
      // as-is and the route's status check refuses the login.
      if (existingMember.status !== "active") {
        return { member: existingMember, created: false, linked: false };
      }
      await db.insert(npMemberIdentities).values({
        memberId: existingMember.id,
        provider,
        subject: profile.providerUserId,
        email: profile.email,
        metadata: mergeMetadata(profile),
      });
      return { member: existingMember, created: false, linked: true };
    }
  }

  // Step 3: auto-provision a brand-new member account. This is the
  // step the `community.registrationEnabled` site setting gates —
  // an invite-only site that disables password sign-up via
  // `/api/members/register` would otherwise be joined through OAuth
  // (the password endpoint and OAuth callback both create new
  // member rows from an unauthenticated request, so they're the
  // same surface from a policy point of view).
  //
  // Steps 1 and 2 are NOT gated: durable links and email matches
  // log an EXISTING member back in, which isn't a new
  // registration. An admin who flips `registrationEnabled = false`
  // expects existing members to keep working — only new accounts
  // should be refused.
  const settings = await getCommunitySettings();
  if (!settings.registrationEnabled) {
    throw new NpForbiddenError("members", "register");
  }

  const email =
    profile.email && profile.email.trim().length > 0
      ? profile.email.trim().toLowerCase()
      : syntheticEmail(provider, profile.providerUserId);
  const displayName = deriveDisplayName(profile, email);
  const handle = generateHandle(profile, email);
  const placeholderPassword = await hashPassword(
    crypto.randomUUID() + crypto.randomUUID(),
  );

  const [created] = (await db
    .insert(npMembers)
    .values({
      email,
      handle,
      displayName,
      password: placeholderPassword,
      // OAuth verifies the address out-of-band (the provider showed the
      // user a real login screen for it), so skip the email-verify
      // dance that password registration goes through.
      emailVerified: true,
      status: "active",
    })
    .returning({
      id: npMembers.id,
      email: npMembers.email,
      handle: npMembers.handle,
      displayName: npMembers.displayName,
      status: npMembers.status,
      tokenVersion: npMembers.tokenVersion,
    })) as ResolvedOAuthMember[];

  await db.insert(npMemberIdentities).values({
    memberId: created.id,
    provider,
    subject: profile.providerUserId,
    email: profile.email ?? null,
    metadata: mergeMetadata(profile),
  });

  return { member: created, created: true, linked: true };
}
