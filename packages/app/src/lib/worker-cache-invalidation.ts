import { recordJobLog } from "@nexpress/core/jobs";
import { requireSiteId } from "@nexpress/core/sites";

import { requestWorkerWeb, resolveWorkerWebEndpoint } from "./worker-web-target.js";

export async function revalidateCollectionFromWorker(
  collection: string,
  document?: Record<string, unknown> | null,
): Promise<void> {
  const siteId = await requireSiteId();
  const endpoint = resolveWorkerWebEndpoint(process.env);
  const token = process.env.NP_SCHEDULER_TOKEN;
  const details = { siteId, collection };
  if (!endpoint || !token) {
    await recordJobLog("warn", "Web cache invalidation is not configured", details);
    return;
  }

  let response: Response;
  try {
    response = await requestWorkerWeb(endpoint, token, {
      method: "POST",
      body: JSON.stringify({
        ...details,
        ...(typeof document?.slug === "string" && document.slug
          ? { documentSlug: document.slug }
          : {}),
      }),
    });
  } catch {
    await recordJobLog("warn", "Web cache invalidation request failed", details);
    return;
  }

  if (response.status !== 204) {
    await response.body?.cancel().catch(() => undefined);
    await recordJobLog("warn", "Web cache invalidation was not applied", {
      ...details,
      httpStatus: response.status,
    });
  }
}
