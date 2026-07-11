import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  can,
  getCurrentSiteId,
  getDb,
  getSetting,
} from "@nexpress/core";
import { npSettings } from "@nexpress/core/db";
import { npValidateBlockContent, type NpBlockContent } from "@nexpress/core/fields";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";

const SETTING_KEY = "page-builder.patterns";

interface ServerPattern {
  id: string;
  label: string;
  description?: string;
  blocks: NpBlockContent;
  createdAt: string;
  updatedAt: string;
}

function isPattern(value: unknown): value is ServerPattern {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    npValidateBlockContent(candidate.blocks).ok
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("patterns", "delete");
    }
    const { id } = await params;
    const value = await getSetting<unknown>(SETTING_KEY);
    const existing = Array.isArray(value) ? value.filter(isPattern) : [];
    const next = existing.filter((p) => p.id !== id);
    if (next.length === existing.length) {
      // Nothing to delete — return success anyway so the editor's
      // optimistic UI doesn't think the operation failed.
      return npSuccessResponse({ deleted: 0 });
    }
    const db = getDb();
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const now = new Date();
    await db
      .insert(npSettings)
      .values({
        siteId,
        key: SETTING_KEY,
        value: next,
        updatedAt: now,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [npSettings.siteId, npSettings.key],
        set: { value: next, updatedAt: now, updatedBy: user.id },
      });
    return npSuccessResponse({ deleted: 1 });
  } catch (error) {
    return npErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export const dynamic = "force-dynamic";
