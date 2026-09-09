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

async function requireAgentPageAccess(
  capability?: "admin.manage" | "content.author",
): Promise<void> {
  await ensureFor("read");
  const token = (await cookies()).get("np-session")?.value;
  const user = token
    ? await verifyTokenFull(token, getAuthRuntimeConfig().secret, getDb(), "access")
    : null;
  const siteUser = user ? await resolveSiteAuthUser(user) : null;
  if (!siteUser || (capability && !can(siteUser, capability))) notFound();
}

export function requireAgentStudioPageAccess(): Promise<void> {
  return requireAgentPageAccess("admin.manage");
}
export function requireAgentChangeSetPageAccess(): Promise<void> {
  return requireAgentPageAccess("content.author");
}
/** Item-level approval authority belongs to the injected approval service. */
export function requireAgentApprovalPageAccess(): Promise<void> {
  return requireAgentPageAccess();
}
