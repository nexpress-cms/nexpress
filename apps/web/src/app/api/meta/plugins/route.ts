import { getAllPluginIds, getPluginRegistration } from "@nexpress/core";

import { ensurePluginsLoaded } from "@/lib/init-core";
import { nxSuccessResponse, nxErrorResponse } from "@/lib/api-response";
import type { NxPluginManifest } from "@/lib/manifest";

export async function GET() {
  try {
    await ensurePluginsLoaded();
    const pluginItems: NxPluginManifest[] = getAllPluginIds()
      .flatMap((id) => {
        const reg = getPluginRegistration(id);

        if (!reg) return [];

        return [
          {
            id: reg.id,
            name: reg.name,
            version: reg.version,
            description: reg.description,
            capabilities: [...reg.capabilities].sort(),
            hooks: [...reg.hooks.keys()].sort(),
            routes: reg.routes.map((route) => ({
              method: route.method.toUpperCase(),
              path: route.path,
            })),
          } satisfies NxPluginManifest,
        ];
      });

    const items: NxPluginManifest[] = pluginItems.sort((a, b) => a.id.localeCompare(b.id));

    return nxSuccessResponse({ items });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
