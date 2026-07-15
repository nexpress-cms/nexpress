import {
  getMemberNotificationPrefs,
  listNotificationKinds,
  setMemberNotificationPrefs,
} from "@nexpress/core/community";
import {
  npRequireNotificationPrefsPatch,
  npRequireNotificationPrefsUpdateWire,
  npRequireNotificationPrefsWire,
} from "@nexpress/core/community-contract";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { ensureFor } from "../../../../lib/init-core";
import { npRequireCommunityRequest } from "../../../../lib/community-contract";
import { requireMember } from "../../../../lib/member-auth-helpers";

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
    await ensureFor("read");
    const member = await requireMember(request);
    const prefs = await getMemberNotificationPrefs(member.id);
    const kinds = listNotificationKinds();
    return npSuccessResponse(npRequireNotificationPrefsWire({ prefs, kinds }));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureFor("write");
    const member = await requireMember(request);
    const kinds = listNotificationKinds();
    const knownKinds = new Set(kinds.map((kind) => kind.kind));
    const patch = npRequireCommunityRequest(
      (value) => npRequireNotificationPrefsPatch(value, knownKinds),
      await readJsonBody(request),
    );
    const prefs = await setMemberNotificationPrefs({ memberId: member.id, ...patch });
    return npSuccessResponse(npRequireNotificationPrefsUpdateWire({ prefs }, knownKinds));
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
