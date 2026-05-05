import {
  getMemberFromTokenPayload,
  verifyMemberToken,
  type NpMemberAuthRow,
} from "@nexpress/core";
import { cookies } from "next/headers";

import { ensureFor } from "@/lib/init-core";
import { getDb } from "@/lib/db";

/**
 * Resolves the currently-signed-in member from `np-mb-session`
 * cookies for use inside Server Components / route handlers that
 * don't have a `NextRequest` (the standard `optionalMember` helper
 * needs the request object). Returns null when:
 *   - no session cookie is present
 *   - the JWT fails verification
 *   - the JWT has the wrong `use` claim (refresh token in session
 *     cookie path — same hardening as `getSessionMember` for #94)
 *   - the member status is non-active (`suspended` or `deleted`)
 *
 * Pending members can't reach this path because login refuses
 * non-active accounts, so a non-null return implies a usable
 * member identity for site interaction.
 */
export async function getSiteMember(): Promise<NpMemberAuthRow | null> {
  await ensureFor("read");
  const cookieStore = await cookies();
  const token = cookieStore.get("np-mb-session")?.value;
  if (!token) return null;
  const secret = process.env.NP_SECRET;
  if (!secret) return null;
  try {
    const payload = await verifyMemberToken(token, secret, "access");
    const member = await getMemberFromTokenPayload(getDb() as never, payload, token);
    if (!member || member.status === "suspended" || member.status === "deleted") {
      return null;
    }
    return member;
  } catch {
    return null;
  }
}
