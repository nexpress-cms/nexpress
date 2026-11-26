import type { NextRequest, NextResponse } from "next/server";
import type { NpAuthResponseObserver } from "./types.js";

/** Final handler result only; no response body, headers, cookies or stream is inspected. */
export function npWithAuthResponseObserver<Args extends unknown[]>(
  handler: (request: NextRequest, ...args: Args) => Promise<NextResponse>,
  audience: "staff" | "member",
  observer: NpAuthResponseObserver | undefined,
): (request: NextRequest, ...args: Args) => Promise<NextResponse> {
  if (!observer) return handler;
  return async (request, ...args) => {
    const response = await handler(request, ...args);
    const status = response.status;
    if (status === 401 || status === 403 || status === 404) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          observer({ request, audience, status }),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 750);
          }),
        ]);
      } catch {
        // The completed auth response is returned once even when observation is unavailable.
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    return response;
  };
}
