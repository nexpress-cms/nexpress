export const npUserRoles = ["admin", "editor", "moderator", "author", "viewer"] as const;
export const npMemberStatuses = ["active", "pending", "suspended", "deleted", "imported"] as const;
export const npAuthTokenUses = ["access", "refresh"] as const;
export const npAuthTokenAudiences = ["staff", "member"] as const;

export type NpUserRole = (typeof npUserRoles)[number];
export type NpMemberStatus = (typeof npMemberStatuses)[number];
export type NpAuthTokenUse = (typeof npAuthTokenUses)[number];
export type NpAuthTokenAudience = (typeof npAuthTokenAudiences)[number];

/** Persisted staff projection used by access checks and request principals. */
export interface NpAuthUser {
  id: string;
  email: string;
  name: string;
  role: NpUserRole;
  tokenVersion: number;
}

/** Exact user object returned by staff login, refresh, and `/api/auth/me`. */
export interface NpStaffSessionUser {
  id: string;
  email: string;
  name: string;
  role: NpUserRole;
}

/** Exact row exposed by the Admin user-management API. */
export interface NpStaffUserItem extends NpStaffSessionUser {
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NpStaffUserList {
  docs: NpStaffUserItem[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/** Exact response returned after an email invitation is queued. */
export interface NpStaffInviteResult extends NpStaffSessionUser {
  inviteExpiresAt: string;
}

/** Persisted member projection used while authenticating a request. */
export interface NpMemberAuthUser {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  status: NpMemberStatus;
  tokenVersion: number;
}

/** Exact member object returned by member login and refresh. */
export interface NpMemberSessionUser {
  id: string;
  handle: string;
  email: string;
  displayName: string;
}

/** Exact authenticated self-profile returned by `/api/members/me`. */
export interface NpMemberSelf extends NpMemberSessionUser {
  emailVerified: boolean;
  avatar: string | null;
  bio: string | null;
  /** Authenticated self profiles are reachable only for active members. */
  status: "active";
  reputation: number;
  createdAt: string;
}

export interface NpAuthTokenPayloadBase<TAudience extends NpAuthTokenAudience> {
  sub: string;
  aud: TAudience;
  ver: number;
  use: NpAuthTokenUse;
  /** Browser-session id shared by the access/refresh pair. */
  sid: string;
  /** Per-token id. Access and refresh always have different values. */
  jti: string;
  iat: number;
  exp: number;
}

export type NpStaffTokenPayload = NpAuthTokenPayloadBase<"staff">;
export type NpMemberTokenPayload = NpAuthTokenPayloadBase<"member">;

export interface NpStaffSessionRecord {
  id: string;
  userId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NpMemberSessionRecord {
  id: string;
  memberId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NpAuthSessionTokens {
  sessionId: string;
  access: string;
  refresh: string;
}
