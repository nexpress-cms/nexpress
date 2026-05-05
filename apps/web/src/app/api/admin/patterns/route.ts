import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  can,
  getCurrentSiteId,
  getDb,
  getSetting,
} from "@nexpress/core";
import { npSettings } from "@nexpress/core/db";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Issue #467 follow-up — server-side patterns surface for the
 * page-builder. Patterns are stored as a single JSON blob in
 * `np_settings` under `page-builder.patterns`, scoped to the
 * current site so multi-tenant deployments don't leak
 * compositions across tenants.
 *
 * Why settings instead of a dedicated collection: patterns are
 * bounded by their authoring scope (one site's editor team) and
 * the pattern shape mirrors the editor's in-memory structure
 * exactly. A separate collection + migration would lock the
 * shape into the schema; the settings JSON keeps the door open
 * for the editor side of the contract to evolve without a
 * migration.
 *
 * `admin.manage` capability gate. CSRF auto-applied by
 * apps/web/src/proxy.ts.
 */
const SETTING_KEY = "page-builder.patterns";

interface ServerPattern {
  id: string;
  label: string;
  description?: string;
  blocks: unknown[];
  createdAt: string;
  updatedAt: string;
}

function isPattern(value: unknown): value is ServerPattern {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    Array.isArray(candidate.blocks)
  );
}

async function readPatterns(): Promise<ServerPattern[]> {
  const value = await getSetting<unknown>(SETTING_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isPattern);
}

async function writePatterns(
  siteId: string,
  patterns: ServerPattern[],
  updatedBy: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(npSettings)
    .values({
      siteId,
      key: SETTING_KEY,
      value: patterns,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value: patterns, updatedAt: now, updatedBy },
    });
}

export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("patterns", "list");
    }
    const patterns = await readPatterns();
    return npSuccessResponse({ patterns });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

interface SavePatternBody {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  blocks?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("patterns", "save");
    }
    const body = (await request.json()) as SavePatternBody;
    if (typeof body.label !== "string" || body.label.trim().length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "label", message: "label is required" },
      ]);
    }
    if (!Array.isArray(body.blocks)) {
      throw new NpValidationError("Invalid input", [
        { field: "blocks", message: "blocks must be an array" },
      ]);
    }
    const id =
      typeof body.id === "string" && body.id.length > 0
        ? body.id
        : `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const existing = await readPatterns();
    const previous = existing.find((p) => p.id === id);
    const next: ServerPattern = {
      id,
      label: body.label.trim(),
      description:
        typeof body.description === "string" ? body.description : undefined,
      blocks: body.blocks,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const updated = [next, ...existing.filter((p) => p.id !== id)];
    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    await writePatterns(siteId, updated, user.id);
    return npSuccessResponse({ pattern: next });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

export const dynamic = "force-dynamic";
