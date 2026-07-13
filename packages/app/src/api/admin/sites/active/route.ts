import { NpForbiddenError, NpValidationError, getSiteById } from "@nexpress/core";
import { canOnSite } from "@nexpress/core/sites";
import { readJsonBody } from "@nexpress/next";
import { npIsCanonicalSiteId } from "@nexpress/core/settings";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireGlobalAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

/**
 * Phase 15.6 — set the admin site-picker cookie.
 *
 *   POST /api/admin/sites/active   { id: string }
 *     → 200 { id }                  cookie set, admin scope switched
 *     → 400                         unknown site id
 *     → 403                         user has no access to that site
 *
 * Access rule: super-admins can switch to any site; everyone
 * else can switch to a non-default site only with an explicit
 * membership. The reserved default site uses the persisted global
 * role for every authenticated staff user.
 *
 * Cookie shape: `np-admin-site=<id>; HttpOnly; SameSite=Lax;
 * Path=/; Secure (in prod)`. HttpOnly because client JS
 * doesn't need it; the resolver reads it server-side via the
 * request headers.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    // Site selection must remain available when the current cookie names a
    // site whose membership was revoked. Target authorization still goes
    // through canOnSite below.
    const user = await requireGlobalAuth(request);

    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new NpValidationError("Invalid input", [
        { field: "body", message: "Request body must be a plain object" },
      ]);
    }
    const input = body as Record<string, unknown>;
    const unknown = Object.keys(input).find((key) => key !== "id");
    if (unknown || !npIsCanonicalSiteId(input.id)) {
      throw new NpValidationError("Invalid input", [
        {
          field: unknown ?? "id",
          message: unknown
            ? `Unsupported active-site field "${unknown}"`
            : "Site id must be a canonical lowercase id",
        },
      ]);
    }
    const id = input.id;

    const target = await getSiteById(id);
    if (!target) {
      throw new NpValidationError("Invalid input", [
        { field: "id", message: `Site "${id}" not found` },
      ]);
    }

    // Access check: super-admin OR explicit membership OR any
    // persisted global role on the reserved default site.
    if (!(await canOnSite(user, "site.access", id))) {
      throw new NpForbiddenError("sites/active", "switch");
    }

    const isProduction = process.env.NODE_ENV === "production";
    const response = npSuccessResponse({ id });
    response.cookies.set({
      name: "np-admin-site",
      value: id,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProduction,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

/**
 * DELETE clears the cookie (returns to host-based routing).
 */
export async function DELETE(request: NextRequest) {
  try {
    await ensureFor("write");
    await requireGlobalAuth(request);

    const response = npSuccessResponse({ ok: true });
    response.cookies.delete("np-admin-site");
    return response;
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
