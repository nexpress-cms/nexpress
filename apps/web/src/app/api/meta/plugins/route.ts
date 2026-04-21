import { getAllPluginIds, getPluginRegistration } from "@nexpress/core";

import { nxSuccessResponse, nxErrorResponse } from "@/lib/api-response";
import type { NxPluginManifest } from "@/lib/manifest";

export function GET() {
  try {
    const items: NxPluginManifest[] = getAllPluginIds()
      .map((id) => {
        const reg = getPluginRegistration(id);

        if (!reg) return null;

        return {
          id: reg.id,
          name: reg.name,
          hooks: [...reg.hooks.keys()].sort(),
          routes: reg.routes.map((route) => ({
            method: route.method.toUpperCase(),
            path: route.path,
          })),
        } satisfies NxPluginManifest;
      })
      .filter((item): item is NxPluginManifest => item !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    return nxSuccessResponse({ items });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
