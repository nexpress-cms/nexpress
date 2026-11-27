import { recordJobLog } from "@nexpress/core/jobs";
import { requireSiteId } from "@nexpress/core/sites";

function webOrigin(): URL | null {
  const configured = process.env.NP_WORKER_WEB_URL || process.env.SITE_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    ) {
      return url;
    }
  } catch {
    // A malformed deployment URL is reported on the job.
  }
  return null;
}

export async function revalidateCollectionFromWorker(
  collection: string,
  document?: Record<string, unknown> | null,
): Promise<void> {
  const siteId = await requireSiteId();
  const endpoint = webOrigin();
  const token = process.env.NP_SCHEDULER_TOKEN;
  const details = { siteId, collection };
  if (!endpoint || !token) {
    await recordJobLog("warn", "Web cache invalidation is not configured", details);
    return;
  }

  let response: Response;
  try {
    response = await fetch(new URL("/api/internal/revalidate-collection", endpoint), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...details,
        ...(typeof document?.slug === "string" && document.slug
          ? { documentSlug: document.slug }
          : {}),
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
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
