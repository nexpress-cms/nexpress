import { can, verifyTokenFull } from "@nexpress/core";
import { resolveSiteAuthUser } from "@nexpress/core/sites";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { getAuthRuntimeConfig } from "../auth-helpers";
import { getDb } from "../db";
import { ensureFor } from "../init-core";

export async function requireAgentStudioPageAccess(): Promise<void> {
  await ensureFor("read");
  const token = (await cookies()).get("np-session")?.value;
  const user = token
    ? await verifyTokenFull(token, getAuthRuntimeConfig().secret, getDb(), "access")
    : null;
  const siteUser = user ? await resolveSiteAuthUser(user) : null;
  if (!siteUser || !can(siteUser, "admin.manage")) notFound();
}
