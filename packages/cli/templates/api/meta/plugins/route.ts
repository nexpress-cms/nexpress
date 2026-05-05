import { getAllPluginIds, getPluginRegistration } from "@nexpress/core";

import { ensureFor } from "@/lib/bootstrap";
import { npSuccessResponse, npErrorResponse } from "@/lib/api-response";
import type { NpPluginManifest } from "@/lib/manifest";

export async function GET() {
  try {
    await ensureFor("plugins");
    const items: NpPluginManifest[] = [];
    for (const id of getAllPluginIds()) {
      const reg = getPluginRegistration(id);
      if (!reg) continue;
      items.push({
        id: reg.id,
        name: reg.name,
        version: reg.version,
        description: reg.description,
        capabilities: [...reg.capabilities].sort(),
        hooks: [...reg.hooks.keys()].sort(),
        routes: reg.routes.map((r) => ({ method: r.method.toUpperCase(), path: r.path })),
      });
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
    return npSuccessResponse({ items });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
