import { eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npUsers } from "../db/schema/system.js";

/**
 * Minimal public projection of a user row — `id` + `name` + `email`.
 * Themes / plugins reach for this when they need to display a byline
 * (post.author → user) without pulling in session machinery. Password
 * hash + tokenVersion + reset state stay private to the auth module.
 */
export interface NpUserBasic {
  id: string;
  name: string;
  email: string;
}

/**
 * Look up a user by id. Returns `null` when the id doesn't exist
 * (caller handles missing-author UI). UUID validation lives at the
 * caller — Postgres rejects malformed ids inside `eq()` and the
 * surfacing error is already informative.
 *
 * This is the supported entry point for theme code that needs to
 * render a byline from `posts.author: relationTo("users")`. Direct
 * drizzle reads against `np_users` are private to the framework.
 */
export async function getUserById(id: string): Promise<NpUserBasic | null> {
  const db = getDb();
  const [user] = await db
    .select({
      id: npUsers.id,
      name: npUsers.name,
      email: npUsers.email,
    })
    .from(npUsers)
    .where(eq(npUsers.id, id))
    .limit(1);
  return user ?? null;
}
