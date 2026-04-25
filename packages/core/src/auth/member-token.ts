import { jwtVerify, SignJWT, type JWTPayload } from "jose";

/**
 * Member-side JWT helpers. Mirrors `signToken` / `verifyToken` for
 * staff but adds a fixed `aud: "member"` claim so a forged JWT signed
 * for a staff user can't be replayed against member-only routes (and
 * vice-versa).
 *
 * The signing secret is the same `NX_SECRET`; rotating it invalidates
 * both staff and member sessions, which is the desired behavior.
 */
export interface NxMemberTokenPayload {
  sub: string;
  aud: "member";
  ver: number;
  iat: number;
  exp: number;
}

const textEncoder = new TextEncoder();
const MEMBER_AUDIENCE = "member";

export async function signMemberToken(
  member: { id: string; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
): Promise<string> {
  const secretKey = textEncoder.encode(secret);
  return new SignJWT({ sub: member.id, ver: member.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(MEMBER_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expirationSeconds)
    .sign(secretKey);
}

export async function verifyMemberToken(
  token: string,
  secret: string,
): Promise<NxMemberTokenPayload> {
  const secretKey = textEncoder.encode(secret);
  const { payload } = await jwtVerify(token, secretKey, { audience: MEMBER_AUDIENCE });
  // jwtVerify already validated `aud === MEMBER_AUDIENCE`; cast through
  // JWTPayload to lock in the fields we know land on member tokens.
  const typed = payload as JWTPayload & {
    sub: string;
    ver: number;
    iat: number;
    exp: number;
  };
  return { ...typed, aud: MEMBER_AUDIENCE };
}
