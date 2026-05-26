import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isSuperAdmin, verifyTokenFull } from "@nexpress/core";
import { SitesView } from "@nexpress/admin/client";

import { getAuthRuntimeConfig } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  await ensureFor("read");

  const token = (await cookies()).get("np-session")?.value;
  const { secret } = getAuthRuntimeConfig();
  const user = token ? await verifyTokenFull(token, secret, getDb()) : null;

  if (!user || !(await isSuperAdmin(user))) {
    notFound();
  }

  return <SitesView />;
}
