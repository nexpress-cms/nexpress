import type { NpRouteRequest, NpRouteResponse } from "@nexpress/plugin-sdk";

import {
  NpShopReturnLogisticsConflictError,
  NpShopReturnLogisticsContractError,
  NpShopReturnLogisticsProviderError,
  npRequireShopReturnLogisticsLabelReadInput,
  type NpShopReturnLogisticsLabelFormat,
} from "./return-logistics-contract.js";
import { npReadShopReturnLogisticsLabel } from "./return-logistics-service.js";
import { npResolveShopRequestIdentity } from "./request-identity.js";
import type { NpShopRuntime } from "./runtime.js";

const mediaTypes: Record<NpShopReturnLogisticsLabelFormat, string> = {
  pdf: "application/pdf",
  png: "image/png",
  zpl: "application/vnd.zebra-zpl",
};

export function createShopReturnLogisticsLabelApiHandler(runtime: NpShopRuntime) {
  return async function shopReturnLogisticsLabelApiHandler(
    request: NpRouteRequest,
  ): Promise<NpRouteResponse> {
    const resolved = npResolveShopRequestIdentity(request);
    const identityHeaders: Record<string, string> = {};
    if (resolved.responseCookie) identityHeaders["Set-Cookie"] = resolved.responseCookie;
    if (request.method === "HEAD") {
      return { status: 204, headers: { "Cache-Control": "private, no-store", ...identityHeaders } };
    }
    try {
      const input = npRequireShopReturnLogisticsLabelReadInput(request.query);
      const label = await npReadShopReturnLogisticsLabel(runtime, resolved.owner, input);
      return {
        status: 200,
        body: label.content,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="shop-return-label-${label.logisticsId}.${label.format}"`,
          "Content-Type": mediaTypes[label.format],
          "X-Content-Type-Options": "nosniff",
          ...identityHeaders,
        },
      };
    } catch (error) {
      const headers = { "Cache-Control": "private, no-store", ...identityHeaders };
      if (error instanceof NpShopReturnLogisticsConflictError) {
        return { status: 409, body: { error: error.code, message: error.message }, headers };
      }
      if (error instanceof NpShopReturnLogisticsContractError) {
        return {
          status: 400,
          body: { error: "invalid_return_label_request", message: error.issues.join(" ") },
          headers,
        };
      }
      if (error instanceof NpShopReturnLogisticsProviderError) {
        return {
          status: 503,
          body: { error: "return_label_provider_unavailable" },
          headers,
        };
      }
      throw error;
    }
  };
}
