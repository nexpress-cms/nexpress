import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

/**
 * Member-side JWT helpers. Mirrors `signToken` / `verifyToken` for
 * staff but adds a fixed `aud: "member"` claim so a forged JWT signed
 * for a staff user can't be replayed against member-only routes (and
 * vice-versa).
 *
 * The signing secret is the same `NX_SECRET`; rotating it invalidates
 * both staff and member sessions, which is the desired behavior.
 *
 * Every token gets a random `jti` so two tokens minted within the
 * same second for the same member produce DIFFERENT JWT strings —
 * needed for refresh-token rotation: without it, the rotated token
 * hash would collide with the prior token hash and revocation by
 * tokenHash would still resolve the rotated row.
 */
export interface NxMemberTokenPayload {
  sub: string;
  aud: "member";
  ver: number;
  /** Optional in the type so legacy tokens minted before the
   *  jti-claim addition still validate; new tokens always carry one. */
  jti?: string;
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
    .setJti(randomBytes(16).toString("base64url"))
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
