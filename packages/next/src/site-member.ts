import {
  getDb,
  getMemberFromTokenPayload,
  verifyMemberToken,
  type NpMemberAuthRow,
} from "@nexpress/core";
import { cookies } from "next/headers";

/**
 * Resolves the currently-signed-in member from the `np-mb-session`
 * cookie for use inside Server Components / route handlers that
 * don't have a `NextRequest` (the standard `optionalMember` helper
 * needs the request object). Returns null when:
 *
 *   - no session cookie is present
 *   - the JWT fails verification
 *   - the JWT has the wrong `use` claim (refresh token in session
 *     cookie path)
 *   - the member status is non-active (`suspended` or `deleted`)
 *
 * Pending members can't reach this path because login refuses
 * non-active accounts, so a non-null return implies a usable
 * member identity for site interaction.
 *
 * Caller is responsible for having bootstrapped the framework
 * (`ensureFor("read")` or equivalent) before calling — this
 * helper reads the `getDb()` singleton directly.
 */
export async function getSiteMember(): Promise<NpMemberAuthRow | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("np-mb-session")?.value;
  if (!token) return null;
  const secret = process.env.NP_SECRET;
  if (!secret) return null;
  try {
    const payload = await verifyMemberToken(token, secret, "access");
    const db = getDb();
    if (!db) return null;
    const member = await getMemberFromTokenPayload(db as never, payload, token);
    if (!member || member.status === "suspended" || member.status === "deleted") {
      return null;
    }
    return member;
  } catch {
    return null;
  }
}
