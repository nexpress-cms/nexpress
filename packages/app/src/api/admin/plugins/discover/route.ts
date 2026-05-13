import { NpForbiddenError, can } from "@nexpress/core";
import type { NextRequest } from "next/server";

import { requireAuth } from "../../../../lib/auth-helpers";
import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";

/**
 * Phase 5.3 — discover plugins on the npm registry. Wraps
 * `registry.npmjs.org/-/v1/search` and forwards the curated subset of
 * fields the admin Browse panel needs. Filters to packages keyworded
 * with `nexpress-plugin` (the convention plugin authors use to opt into
 * the catalog) and lets the operator narrow further with `?q=<text>`.
 *
 * Capability-gated on `admin.manage` so anonymous traffic can't probe
 * the registry through this endpoint. We don't proxy installs — the
 * admin just gets a list and a copy-to-clipboard install hint.
 */

interface NpmSearchResponse {
  objects?: Array<{
    package?: {
      name?: string;
      version?: string;
      description?: string;
      keywords?: string[];
      links?: { npm?: string; homepage?: string; repository?: string };
      publisher?: { username?: string };
      date?: string;
    };
  }>;
  total?: number;
}

interface DiscoveredPlugin {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  npmUrl: string | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  publishedAt: string | null;
  author: string | null;
}

const REGISTRY_URL = "https://registry.npmjs.org/-/v1/search";
const TIMEOUT_MS = 8_000;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("plugins-discover", "search");
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";

    // `keywords:nexpress-plugin` is the curation gate — plugin authors
    // declare the keyword in their package.json to surface here. Append
    // the operator's free-text query if present so they can narrow the
    // list without leaving the admin.
    const text = ["keywords:nexpress-plugin", query].filter(Boolean).join(" ");
    const searchUrl = `${REGISTRY_URL}?text=${encodeURIComponent(text)}&size=20`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let payload: NpmSearchResponse;
    try {
      const response = await fetch(searchUrl, { signal: controller.signal });
      if (!response.ok) {
        return npSuccessResponse({ items: [], total: 0, error: `npm registry returned ${response.status}` });
      }
      payload = (await response.json()) as NpmSearchResponse;
    } finally {
      clearTimeout(timer);
    }

    const items: DiscoveredPlugin[] = (payload.objects ?? [])
      .map((entry): DiscoveredPlugin | null => {
        const pkg = entry.package;
        if (!pkg || typeof pkg.name !== "string") return null;
        return {
          name: pkg.name,
          version: pkg.version ?? "",
          description: pkg.description ?? "",
          keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
          npmUrl: pkg.links?.npm ?? null,
          repositoryUrl: pkg.links?.repository ?? null,
          homepageUrl: pkg.links?.homepage ?? null,
          publishedAt: pkg.date ?? null,
          author: pkg.publisher?.username ?? null,
        };
      })
      .filter((entry): entry is DiscoveredPlugin => entry !== null);

    return npSuccessResponse({ items, total: payload.total ?? items.length });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
