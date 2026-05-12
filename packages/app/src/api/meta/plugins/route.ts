import { getAllPluginIds, getPluginRegistration } from "@nexpress/core";

import { ensureFor } from "@/lib/init-core";
import { npSuccessResponse, npErrorResponse } from "@/lib/api-response";
import type { NpPluginManifest } from "@/lib/manifest";

export async function GET() {
  try {
    await ensureFor("plugins");
    const pluginItems: NpPluginManifest[] = getAllPluginIds()
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
          } satisfies NpPluginManifest,
        ];
      });

    const items: NpPluginManifest[] = pluginItems.sort((a, b) => a.id.localeCompare(b.id));

    return npSuccessResponse({ items });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
