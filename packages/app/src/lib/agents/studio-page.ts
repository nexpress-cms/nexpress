import { can, verifyTokenFull } from "@nexpress/core";
import { resolveSiteAuthUser } from "@nexpress/core/sites";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { getAuthRuntimeConfig } from "../auth-helpers";
import { getDb } from "../db";
import { ensureFor } from "../init-core";

export function agentActivitySearchString(
  values: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  return query.toString();
}

export async function requireAgentStudioPageAccess(): Promise<void> {
  await ensureFor("read");
  const token = (await cookies()).get("np-session")?.value;
  const user = token
    ? await verifyTokenFull(token, getAuthRuntimeConfig().secret, getDb(), "access")
    : null;
  const siteUser = user ? await resolveSiteAuthUser(user) : null;
  if (!siteUser || !can(siteUser, "admin.manage")) notFound();
}

export async function requireAgentChangeSetPageAccess(): Promise<void> {
  await ensureFor("read");
  const token = (await cookies()).get("np-session")?.value;
  const user = token
    ? await verifyTokenFull(token, getAuthRuntimeConfig().secret, getDb(), "access")
    : null;
  const siteUser = user ? await resolveSiteAuthUser(user) : null;
  if (!siteUser || !can(siteUser, "content.author")) notFound();
}
