import { createHash, timingSafeEqual } from "node:crypto";
import {
  NpAuthError,
  NpNotFoundError,
  NpServiceUnavailableError,
  NpValidationError,
} from "@nexpress/core";
import { npCacheContractLimits } from "@nexpress/core/cache";
import { getCollectionConfig } from "@nexpress/core/collections";
import { getSiteById, npIsCanonicalSiteId, withCurrentSite } from "@nexpress/core/sites";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npWithAgentGuardianHttpResponseV1 } from "../../../lib/agents/guardian-http-observer";
import { npErrorResponse } from "../../../lib/api-response";
import { ensureFor } from "../../../lib/init-core";
import { revalidateCollection } from "../../../lib/revalidate";

const fields = new Set(["siteId", "collection", "documentSlug"]);

async function npGuardianPOST(request: NextRequest) {
  try {
    const token = process.env.NP_SCHEDULER_TOKEN;
    if (!token) throw new NpServiceUnavailableError("Internal trigger token not configured.");
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (
      !timingSafeEqual(
        digest(request.headers.get("authorization") ?? ""),
        digest(`Bearer ${token}`),
      )
    ) {
      throw new NpAuthError("Unauthorized");
    }

    const body = await readJsonBody(request);
    const input =
      body && typeof body === "object" && !Array.isArray(body)
        ? Object.fromEntries(Object.entries(body))
        : {};
    const { siteId, collection, documentSlug } = input;
    if (
      Object.keys(input).some((key) => !fields.has(key)) ||
      !npIsCanonicalSiteId(siteId) ||
      typeof collection !== "string" ||
      !collection ||
      collection.length > npCacheContractLimits.identifierLength ||
      (documentSlug !== undefined &&
        (typeof documentSlug !== "string" ||
          !documentSlug ||
          documentSlug.length > npCacheContractLimits.identifierLength ||
          documentSlug !== documentSlug.trim() ||
          /\p{Cc}/u.test(documentSlug)))
    ) {
      throw new NpValidationError("Invalid collection revalidation input", [
        { field: "body", message: "Expected siteId, collection, and optional documentSlug." },
      ]);
    }

    await ensureFor("read");
    if (!(await getSiteById(siteId))) throw new NpNotFoundError("site", siteId);
    getCollectionConfig(collection);
    const result = await withCurrentSite(siteId, () =>
      revalidateCollection(
        collection,
        documentSlug === undefined ? undefined : { slug: documentSlug },
      ),
    );
    if (result.status !== "applied") {
      throw new NpServiceUnavailableError("Web cache invalidation was not fully applied.");
    }
    // A 204 acknowledges all configured targets and any configured CDN purge.
    return new Response(null, { status: 204 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";

export const POST = npWithAgentGuardianHttpResponseV1("internal", npGuardianPOST);
