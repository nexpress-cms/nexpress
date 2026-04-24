import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { hasRole, verifyTokenFull } from "@nexpress/core";
import { PluginsManager } from "@nexpress/admin/client";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { ensureCoreServices } from "@/lib/init-core";

export const dynamic = "force-dynamic";

export default async function PluginsPage() {
  ensureCoreServices();

  const token = (await cookies()).get("nx-session")?.value;
  const { secret } = getAuthRuntimeConfig();
  const user = token ? await verifyTokenFull(token, secret, getDb()) : null;

  if (!user || !hasRole(user, "admin")) {
    notFound();
  }

  return <PluginsManager />;
}
