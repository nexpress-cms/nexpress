import { createHash } from "node:crypto";

import { and, count, eq, inArray } from "drizzle-orm";

import {
  npCommunityContractLimits,
  npRequireContentEngagementSummaries,
  npRequireContentViewReceiptWire,
  npRequireEngagementTarget,
} from "../community-contract/contract.js";
import type {
  NpContentEngagementSummary,
  NpContentViewReceiptWire,
  NpEngagementTarget,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npComments, npContentViews, npReactions } from "../db/schema/community.js";
import { NpValidationError } from "../errors.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { npResolveDocumentEngagementTarget } from "./engagement-target.js";

const MAX_ENGAGEMENT_TARGETS = npCommunityContractLimits.pageRows;
const VIEWER_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const TARGET_TYPE_VALIDATION_ID = "00000000-0000-4000-8000-000000000000";

export interface NpRecordContentViewInput extends NpEngagementTarget {
  viewerHash: string;
}

export interface NpRecordContentViewOptions {
  now?: Date;
}

function requireTargets(
  targetType: string,
  targetIds: readonly string[],
): { targetType: string; targetIds: string[] } {
  if (!Array.isArray(targetIds)) {
    throw new NpValidationError("Invalid engagement targets", [
      { field: "targetIds", message: "Target ids must be an array." },
    ]);
  }
  if (targetIds.length > MAX_ENGAGEMENT_TARGETS) {
    throw new NpValidationError("Invalid engagement targets", [
      {
        field: "targetIds",
        message: `At most ${MAX_ENGAGEMENT_TARGETS.toString()} targets may be aggregated at once.`,
      },
    ]);
  }
  const checkedType = npRequireEngagementTarget({
    targetType,
    targetId: targetIds[0] ?? TARGET_TYPE_VALIDATION_ID,
  }).targetType;
  const normalized = targetIds.map(
    (targetId) => npRequireEngagementTarget({ targetType: checkedType, targetId }).targetId,
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new NpValidationError("Invalid engagement targets", [
      { field: "targetIds", message: "Target ids must not contain duplicates." },
    ]);
  }
  return { targetType: checkedType, targetIds: normalized };
}

export async function npListContentEngagement(
  targetType: string,
  targetIds: readonly string[],
): Promise<NpContentEngagementSummary[]> {
  const { targetType: checkedType, targetIds: ids } = requireTargets(targetType, targetIds);
  if (ids.length === 0) return [];
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const db = getDb();

  const [viewRows, commentRows, reactionRows] = await Promise.all([
    db
      .select({ targetId: npContentViews.targetId, total: count() })
      .from(npContentViews)
      .where(
        and(
          eq(npContentViews.siteId, siteId),
          eq(npContentViews.targetType, checkedType),
          inArray(npContentViews.targetId, ids),
        ),
      )
      .groupBy(npContentViews.targetId),
    db
      .select({ targetId: npComments.targetId, total: count() })
      .from(npComments)
      .where(
        and(
          eq(npComments.siteId, siteId),
          eq(npComments.targetType, checkedType),
          eq(npComments.status, "visible"),
          inArray(npComments.targetId, ids),
        ),
      )
      .groupBy(npComments.targetId),
    db
      .select({ targetId: npReactions.targetId, kind: npReactions.kind, total: count() })
      .from(npReactions)
      .where(
        and(
          eq(npReactions.siteId, siteId),
          eq(npReactions.targetType, checkedType),
          inArray(npReactions.targetId, ids),
        ),
      )
      .groupBy(npReactions.targetId, npReactions.kind),
  ]);

  const views = new Map(viewRows.map((row) => [row.targetId, Number(row.total)] as const));
  const comments = new Map(commentRows.map((row) => [row.targetId, Number(row.total)] as const));
  const reactions = new Map<string, Record<string, number>>();
  for (const row of reactionRows) {
    const counts = reactions.get(row.targetId) ?? (Object.create(null) as Record<string, number>);
    counts[row.kind] = Number(row.total);
    reactions.set(row.targetId, counts);
  }

  return npRequireContentEngagementSummaries(
    ids.map((targetId) => {
      const perKind = reactions.get(targetId) ?? {};
      return {
        targetType: checkedType,
        targetId,
        viewCount: views.get(targetId) ?? 0,
        commentCount: comments.get(targetId) ?? 0,
        reactionCount: Object.values(perKind).reduce((sum, value) => sum + value, 0),
        reactions: perKind,
      };
    }),
  );
}

export async function npRecordContentView(
  input: NpRecordContentViewInput,
  options: NpRecordContentViewOptions = {},
): Promise<NpContentViewReceiptWire> {
  const target = npRequireEngagementTarget({
    targetType: input.targetType,
    targetId: input.targetId,
  });
  if (!VIEWER_HASH_PATTERN.test(input.viewerHash)) {
    throw new NpValidationError("Invalid view receipt", [
      { field: "viewerHash", message: "Viewer hash must be a lowercase SHA-256 digest." },
    ]);
  }
  const requestedNow = options.now ?? new Date();
  if (!(requestedNow instanceof Date) || Number.isNaN(requestedNow.valueOf())) {
    throw new NpValidationError("Invalid view receipt", [
      { field: "now", message: "View time must be a valid Date." },
    ]);
  }
  const now = new Date(requestedNow.getTime());
  const resolved = await npResolveDocumentEngagementTarget(
    target.targetType,
    target.targetId,
    "views",
  );
  const viewedOn = now.toISOString().slice(0, 10);
  const storedViewerHash = createHash("sha256")
    .update(
      [input.viewerHash, resolved.siteId, target.targetType, target.targetId, viewedOn].join("\0"),
    )
    .digest("hex");
  const db = getDb();
  const inserted = await db
    .insert(npContentViews)
    .values({
      ...target,
      viewerHash: storedViewerHash,
      viewedOn,
      siteId: resolved.siteId,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [
        npContentViews.siteId,
        npContentViews.targetType,
        npContentViews.targetId,
        npContentViews.viewerHash,
        npContentViews.viewedOn,
      ],
    })
    .returning({ id: npContentViews.id });
  const [total] = await db
    .select({ value: count() })
    .from(npContentViews)
    .where(
      and(
        eq(npContentViews.siteId, resolved.siteId),
        eq(npContentViews.targetType, target.targetType),
        eq(npContentViews.targetId, target.targetId),
      ),
    );
  return npRequireContentViewReceiptWire({
    counted: inserted.length > 0,
    viewCount: Number(total?.value ?? 0),
  });
}
