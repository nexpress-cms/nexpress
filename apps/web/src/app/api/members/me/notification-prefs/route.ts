import {
  NxValidationError,
  getMemberNotificationPrefs,
  listNotificationKinds,
  setMemberNotificationPrefs,
} from "@nexpress/core";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { nxErrorResponse, nxSuccessResponse } from "@/lib/api-response";
import { ensureCoreServices, ensureWriteReady } from "@/lib/init-core";
import { requireMember } from "@/lib/member-auth-helpers";

/**
 * Phase 16.3 — per-member notification toggles.
 *
 *   GET → current prefs (`{ disabled: string[] }`) plus the
 *         registered kind catalog so the UI can render labels +
 *         descriptions in one round trip.
 *   PUT → replace the deny list. Unknown kinds 400. CSRF on
 *         write (member session).
 */

export async function GET(request: NextRequest) {
  try {
    ensureCoreServices();
    const member = await requireMember(request);
    const prefs = await getMemberNotificationPrefs(member.id);
    const kinds = listNotificationKinds();
    return nxSuccessResponse({ prefs, kinds });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureWriteReady();
    const member = await requireMember(request);
    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    const disabledRaw = body?.disabled;
    const digestRaw = body?.digest;

    const patch: Parameters<typeof setMemberNotificationPrefs>[0] = {
      memberId: member.id,
    };
    if (disabledRaw !== undefined) {
      if (!Array.isArray(disabledRaw)) {
        throw new NxValidationError("Invalid input", [
          { field: "disabled", message: "disabled must be an array of strings" },
        ]);
      }
      patch.disabled = disabledRaw as string[];
    }
    if (digestRaw !== undefined) {
      if (digestRaw !== "off" && digestRaw !== "daily" && digestRaw !== "weekly") {
        throw new NxValidationError("Invalid input", [
          { field: "digest", message: "digest must be one of: off, daily, weekly" },
        ]);
      }
      patch.digest = digestRaw;
    }

    const prefs = await setMemberNotificationPrefs(patch);
    return nxSuccessResponse({ prefs });
  } catch (error) {
    return nxErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
