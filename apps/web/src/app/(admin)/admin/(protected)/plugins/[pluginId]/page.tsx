import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getPluginAdminExtension,
  getPluginRegistration,
  getPluginState,
  verifyTokenFull,
  can,
} from "@nexpress/core";
import { PluginAdminPage } from "@nexpress/admin/client";

import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/init-core";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ pluginId: string }>;
}

export default async function PluginAdminRoute({ params }: PageProps) {
  ensureCoreServices();
  await ensurePluginsLoaded();

  const token = (await cookies()).get("nx-session")?.value;
  const { secret } = getAuthRuntimeConfig();
  const user = token ? await verifyTokenFull(token, secret, getDb()) : null;
  if (!user || !can(user, "admin.manage")) {
    notFound();
  }

  const { pluginId } = await params;
  const registration = getPluginRegistration(pluginId);
  const adminExt = getPluginAdminExtension(pluginId);
  const state = await getPluginState(getDb(), pluginId);

  if (!registration || !adminExt) {
    notFound();
  }

  return (
    <PluginAdminPage
      pluginId={pluginId}
      pluginName={registration.name}
      admin={adminExt}
      initialConfig={state?.config ?? {}}
    />
  );
}
