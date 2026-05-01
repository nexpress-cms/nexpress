import {
  NxForbiddenError,
  NxValidationError,
  issueBan,
  listBansForMember,
  can,
} from "@nexpress/core";
import type { NextRequest } from "next/server";
import { readJsonBody } from "@nexpress/next";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureWriteReady } from "@/lib/init-core";

const VALID_SCOPES = ["site", "category", "collection"] as const;
type BanScope = (typeof VALID_SCOPES)[number];

interface BanBody {
  memberId?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  kind?: unknown;
  expiresAt?: unknown;
  reason?: unknown;
}

export async function GET(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NxForbiddenError("bans", "list");
    }

    const memberId = request.nextUrl.searchParams.get("memberId");
    if (!memberId) {
      throw new NxValidationError("Invalid input", [
        { field: "memberId", message: "memberId query param required" },
      ]);
    }

    const rows = await listBansForMember(memberId);
    return nxSuccessResponse({ docs: rows });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureWriteReady();
    const user = await requireAuth(request);
    if (!can(user, "community.moderate")) {
      throw new NxForbiddenError("bans", "create");
    }

    const body = (await readJsonBody(request)) as BanBody | null;
    const memberId = typeof body?.memberId === "string" ? body.memberId : "";
    const scopeTypeRaw = typeof body?.scopeType === "string" ? body.scopeType : "";
    const scopeId = typeof body?.scopeId === "string" ? body.scopeId : null;
    const kind = body?.kind === "permanent" ? "permanent" : "temporary";
    const reason = typeof body?.reason === "string" ? body.reason : null;
    const expiresAtRaw = typeof body?.expiresAt === "string" ? body.expiresAt : null;

    const errors: Array<{ field: string; message: string }> = [];
    if (!memberId) errors.push({ field: "memberId", message: "memberId required" });
    if (!(VALID_SCOPES as readonly string[]).includes(scopeTypeRaw)) {
      errors.push({
        field: "scopeType",
        message: `scopeType must be one of: ${VALID_SCOPES.join(", ")}`,
      });
    }
    let expiresAt: Date | null = null;
    if (kind === "temporary") {
      if (!expiresAtRaw) {
        errors.push({ field: "expiresAt", message: "expiresAt required for temporary bans" });
      } else {
        const parsed = new Date(expiresAtRaw);
        if (Number.isNaN(parsed.getTime())) {
          errors.push({ field: "expiresAt", message: "expiresAt must be a valid ISO timestamp" });
        } else if (parsed.getTime() <= Date.now()) {
          // Reads filter by `expires_at > now`, so a past timestamp would
          // create a ban that is invisible the moment it lands.
          errors.push({ field: "expiresAt", message: "expiresAt must be in the future" });
        } else {
          expiresAt = parsed;
        }
      }
    }
    if (errors.length > 0) {
      throw new NxValidationError("Invalid input", errors);
    }

    const row = await issueBan({
      memberId,
      scopeType: scopeTypeRaw as BanScope,
      scopeId,
      kind,
      expiresAt,
      reason,
      actor: { kind: "staff", user },
    });

    return nxSuccessResponse(row, { status: 201 });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
