import { jwtVerify, SignJWT, type JWTPayload } from "jose";

import type { NxUserRole } from "../config/types.js";

export interface NxTokenPayload {
  sub: string;
  role: NxUserRole;
  ver: number;
  iat: number;
  exp: number;
}

const textEncoder = new TextEncoder();

export async function signToken(
  user: { id: string; role: NxUserRole; tokenVersion: number },
  secret: string,
  expirationSeconds: number = 7200,
): Promise<string> {
  const secretKey = textEncoder.encode(secret);

  return new SignJWT({
    sub: user.id,
    role: user.role,
    ver: user.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expirationSeconds)
    .sign(secretKey);
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<NxTokenPayload> {
  const secretKey = textEncoder.encode(secret);
  const { payload } = await jwtVerify(token, secretKey);

  return payload as JWTPayload & NxTokenPayload;
}
