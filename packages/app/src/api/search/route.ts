import { NpValidationError } from "@nexpress/core";
import { NP_DEFAULT_SITE_ID, getCurrentSiteId } from "@nexpress/core/sites";
import {
  NpSearchContractError,
  npParseSearchApiQuery,
  resolveSearchAdapterContext,
  searchCollections,
  type NpSearchRequest,
} from "@nexpress/core/search";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { isLocale } from "@/i18n.config";
import { npErrorResponse, npSuccessResponse } from "../../lib/api-response";
import { ensureFor } from "../../lib/init-core";
import { searchWithShortTtlCache } from "./cache";

function asRequestValidationError(error: NpSearchContractError): NpValidationError {
  return new NpValidationError(
    "Invalid search request",
    error.issues.map((entry) => ({ field: entry.path, message: entry.message })),
  );
}

export async function GET(request: NextRequest) {
  let parsed: NpSearchRequest;
  try {
    parsed = npParseSearchApiQuery(request.nextUrl.searchParams);
  } catch (error) {
    return npErrorResponse(
      error instanceof NpSearchContractError
        ? asRequestValidationError(error)
        : new Error("Invalid search query"),
    );
  }

  try {
    let locale = parsed.locale;
    if (!locale) {
      let headerLocale = request.headers.get("x-np-locale");
      if (!headerLocale) {
        try {
          const headerList = await headers();
          headerLocale = headerList.get("x-np-locale");
        } catch {
          headerLocale = null;
        }
      }
      locale = headerLocale ?? undefined;
    }
    if (locale && !isLocale(locale)) {
      throw new NpValidationError("Invalid search request", [
        { field: "search.request.locale", message: `locale "${locale}" is not configured.` },
      ]);
    }

    const localizedRequest = { ...parsed, ...(locale ? { locale } : {}) };
    await ensureFor("read");
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const searchRequest = resolveSearchAdapterContext({ ...localizedRequest, siteId });
    const result =
      searchRequest.q.length === 0
        ? await searchCollections({ ...localizedRequest, siteId })
        : await searchWithShortTtlCache({
            request: searchRequest,
            search: searchCollections,
          });
    return npSuccessResponse(result);
  } catch (error) {
    if (
      error instanceof NpSearchContractError &&
      error.issues.every((entry) => entry.path.startsWith("search.request"))
    ) {
      return npErrorResponse(asRequestValidationError(error));
    }
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
