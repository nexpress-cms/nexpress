import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { can } from "../auth/capabilities.js";
import { NpCollectionContractError } from "../collection-contract/contract.js";
import { getCollectionConfig } from "../collections/registry.js";
import { buildSearchVector } from "../collections/search.js";
import {
  npGetPersistedCollectionDocumentById,
  unpublishDocumentForModeration,
} from "../collections/pipeline.js";
import {
  NpCommunityContractError,
  npRequireCommunityId,
  npRequireReportRequest,
  npRequireReportRow,
  npRequireReportTargetContextWire,
  npRequireResolveReportRequest,
} from "../community-contract/contract.js";
import type {
  FileReportInput,
  ListReportsOptions,
  ListReportsResult,
  NpReportResolutionAction,
  NpReportRow,
  NpReportTargetContextWire,
} from "../community-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npComments, npMembers, npReports } from "../db/schema/community.js";
import {
  NpConflictError,
  NpForbiddenError,
  NpNotFoundError,
  NpValidationError,
} from "../errors.js";
import { getCurrentSiteId, requireSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { recordAuditEvent } from "./audit.js";
import { withMemberWrite } from "./can.js";
import { staffHideComment } from "./comments.js";
import { npResolveDocumentEngagementTarget } from "./engagement-target.js";
import type { Principal } from "./principal.js";

const EXCERPT_LENGTH = 240;

export type { FileReportInput, ListReportsOptions, ListReportsResult, NpReportRow };

function requireCommunityContract<T>(parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value);
  } catch (error) {
    if (error instanceof NpCommunityContractError) {
      throw new NpValidationError(
        "Invalid input",
        error.contractIssues.map((issue) => ({ field: issue.path, message: issue.message })),
      );
    }
    throw error;
  }
}

function excerpt(value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return null;
  return normalized.length <= EXCERPT_LENGTH
    ? normalized
    : `${normalized.slice(0, EXCERPT_LENGTH - 1)}…`;
}

function targetLabel(value: string, fallback: string): string {
  const candidate = value.replace(/\s+/gu, " ").trim();
  const normalized = candidate || fallback.replace(/\s+/gu, " ").trim() || "Target";
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 119)}…`;
}

function missingTarget(targetType: string): NpReportTargetContextWire {
  return npRequireReportTargetContextWire({
    kind: "missing",
    label: `${targetType} target unavailable`,
    excerpt: null,
    status: null,
    href: null,
    collectionSlug: null,
    documentId: null,
    authorMemberId: null,
  });
}

function reportTargetContext(value: unknown, targetType: string): NpReportTargetContextWire {
  try {
    return npRequireReportTargetContextWire(value);
  } catch (error) {
    if (error instanceof NpCommunityContractError) return missingTarget(targetType);
    throw error;
  }
}

/**
 * Resolve the operator-safe target context shown in the report queue. Missing
 * targets stay visible as explicit drift instead of breaking the whole page.
 */
export async function getReportTargetContext(
  value: NpReportRow,
): Promise<NpReportTargetContextWire> {
  const report = npRequireReportRow(value);
  const requestSiteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  if (report.siteId !== requestSiteId) {
    throw new NpForbiddenError("report", "cross-site");
  }
  const db = getDb();
  if (report.targetType === "comment") {
    const [row] = await db
      .select({
        bodyMd: npComments.bodyMd,
        status: npComments.status,
        siteId: npComments.siteId,
        collectionSlug: npComments.targetType,
        documentId: npComments.targetId,
        authorMemberId: npComments.memberId,
        authorHandle: npMembers.handle,
        authorDisplayName: npMembers.displayName,
      })
      .from(npComments)
      .leftJoin(npMembers, eq(npMembers.id, npComments.memberId))
      .where(eq(npComments.id, report.targetId))
      .limit(1);
    if (!row || row.siteId !== report.siteId) return missingTarget(report.targetType);
    const author = row.authorDisplayName ?? (row.authorHandle ? `@${row.authorHandle}` : null);
    return reportTargetContext(
      {
        kind: "comment",
        label: targetLabel(author ? `Comment by ${author}` : "Comment", "Comment"),
        excerpt: excerpt(row.bodyMd),
        status: row.status,
        href: `/admin/collections/${row.collectionSlug}/${row.documentId}`,
        collectionSlug: row.collectionSlug,
        documentId: row.documentId,
        authorMemberId: row.authorMemberId,
      },
      report.targetType,
    );
  }
  if (report.targetType === "member") {
    const [row] = await db
      .select({
        id: npMembers.id,
        handle: npMembers.handle,
        displayName: npMembers.displayName,
        status: npMembers.status,
      })
      .from(npMembers)
      .where(eq(npMembers.id, report.targetId))
      .limit(1);
    if (!row) return missingTarget(report.targetType);
    return reportTargetContext(
      {
        kind: "member",
        label: targetLabel(row.displayName || `@${row.handle}`, `@${row.handle}`),
        excerpt: `@${row.handle}`,
        status: row.status,
        href: `/admin/members/${row.id}`,
        collectionSlug: null,
        documentId: null,
        authorMemberId: row.id,
      },
      report.targetType,
    );
  }

  let config;
  try {
    config = getCollectionConfig(report.targetType);
  } catch {
    return missingTarget(report.targetType);
  }
  let document: Record<string, unknown> | null;
  try {
    document = await npGetPersistedCollectionDocumentById(
      report.targetType,
      report.targetId,
      report.siteId,
    );
  } catch (error) {
    if (error instanceof NpForbiddenError || error instanceof NpCollectionContractError) {
      return missingTarget(report.targetType);
    }
    throw error;
  }
  if (!document || document.siteId !== report.siteId) return missingTarget(report.targetType);
  const title = typeof document.title === "string" ? document.title.trim() : "";
  const searchableText = buildSearchVector(config, document).trim();
  const excerptText =
    title && searchableText.startsWith(title)
      ? searchableText.slice(title.length).trim()
      : searchableText;
  const status = typeof document.status === "string" ? document.status : null;
  const authorMemberId =
    typeof document.memberAuthorId === "string" ? document.memberAuthorId : null;
  return reportTargetContext(
    {
      kind: "document",
      label: targetLabel(title || config.labels.singular, config.labels.singular),
      excerpt: excerpt(excerptText || searchableText),
      status,
      href: `/admin/collections/${report.targetType}/${report.targetId}`,
      collectionSlug: report.targetType,
      documentId: report.targetId,
      authorMemberId,
    },
    report.targetType,
  );
}

/** File one unresolved report for a visible target on the current site. */
export async function fileReport(input: FileReportInput): Promise<NpReportRow> {
  const report = requireCommunityContract(npRequireReportRequest, {
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
  });
  const reporterId = requireCommunityContract(
    (value) => npRequireCommunityId(value, "community.report.reporterId"),
    input.reporterId,
  );

  const scopes =
    report.targetType === "comment" || report.targetType === "member"
      ? []
      : [{ type: "collection" as const, id: report.targetType }];
  return withMemberWrite(reporterId, scopes, () =>
    doFileReport({
      reporterId,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
    }),
  );
}

async function doFileReport(input: FileReportInput): Promise<NpReportRow> {
  const target = await assertReportTargetExists(input.targetType, input.targetId);
  const db = getDb();
  const siteId = await requireSiteId();
  if (target.siteId !== null && target.siteId !== siteId) {
    throw new NpForbiddenError("report", "cross-site");
  }
  const [row] = (await db
    .insert(npReports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      siteId,
    })
    .onConflictDoNothing()
    .returning()) as NpReportRow[];
  if (!row) {
    throw new NpConflictError("You already have an unresolved report for this target.");
  }
  const checkedRow = npRequireReportRow(row);

  await recordAuditEvent({
    actor: { kind: "member", memberId: input.reporterId },
    action: "report.filed",
    targetType: input.targetType,
    targetId: input.targetId,
    payload: { reportId: checkedRow.id, reason: input.reason },
  });

  return checkedRow;
}

export async function listReports(options: ListReportsOptions = {}): Promise<ListReportsResult> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters = [];
  if (options.status === "resolved") filters.push(isNotNull(npReports.resolvedAt));
  else if (options.status === "all") {
    /* no-op */
  } else filters.push(isNull(npReports.resolvedAt));
  if (options.targetType) filters.push(eq(npReports.targetType, options.targetType));

  if (options.siteId !== null) {
    const resolvedSite = options.siteId ?? (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    filters.push(eq(npReports.siteId, resolvedSite));
  }

  const where = filters.length > 0 ? and(...filters) : undefined;
  const reports = (await db
    .select()
    .from(npReports)
    .where(where)
    .orderBy(desc(npReports.createdAt))
    .limit(limit)
    .offset(offset)) as NpReportRow[];
  const [totalRow] = (await db.select({ total: count() }).from(npReports).where(where)) as Array<{
    total: number;
  }>;
  return { reports: reports.map(npRequireReportRow), totalDocs: Number(totalRow?.total ?? 0) };
}

export interface ResolveReportInput {
  reportId: string;
  action: NpReportResolutionAction;
  actor: Extract<Principal, { kind: "staff" }>;
}

export interface ResolveReportResult {
  report: NpReportRow;
  moderatedDocument: { collectionSlug: string; document: Record<string, unknown> } | null;
}

/** Apply one closed moderation action and resolve the report under one row lock. */
export async function resolveReport(input: ResolveReportInput): Promise<ResolveReportResult> {
  if (!can(input.actor.user, "community.moderate")) {
    throw new NpForbiddenError("reports", "resolve");
  }
  const db = getDb();
  const requestSiteId = await requireSiteId();
  const reportId = requireCommunityContract(
    (value) => npRequireCommunityId(value, "community.resolveReport.id"),
    input.reportId,
  );
  const { action } = requireCommunityContract(npRequireResolveReportRequest, {
    action: input.action,
  });

  const result = await db.transaction(async (tx) => {
    const [existing] = (await tx
      .select()
      .from(npReports)
      .where(eq(npReports.id, reportId))
      .limit(1)
      .for("update")) as NpReportRow[];
    if (!existing) throw new NpNotFoundError("report", reportId);
    const checkedExisting = npRequireReportRow(existing);
    if (checkedExisting.siteId !== requestSiteId) {
      throw new NpForbiddenError("report", "cross-site");
    }
    if (checkedExisting.resolvedAt) {
      throw new NpValidationError("Invalid state", [
        { field: "report", message: "Report already resolved" },
      ]);
    }

    // Different reporters can create distinct rows for the same target. Lock
    // the target identity as well as this report row so concurrent moderators
    // cannot both observe a public document/comment and repeat its transition
    // hooks, revisions, reputation, or audit side effects.
    const targetLockKey = `${requestSiteId}:${checkedExisting.targetType}:${checkedExisting.targetId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${targetLockKey}, 0))`);

    let moderatedDocument: ResolveReportResult["moderatedDocument"] = null;
    if (action === "hide-comment") {
      if (checkedExisting.targetType !== "comment") {
        throw new NpValidationError("Invalid report action", [
          { field: "action", message: "hide-comment requires a comment report" },
        ]);
      }
      await staffHideComment(checkedExisting.targetId, input.actor.user.id, checkedExisting.reason);
    } else if (action === "unpublish-document") {
      if (checkedExisting.targetType === "comment" || checkedExisting.targetType === "member") {
        throw new NpValidationError("Invalid report action", [
          { field: "action", message: "unpublish-document requires a collection document report" },
        ]);
      }
      const saved = await unpublishDocumentForModeration(
        checkedExisting.targetType,
        checkedExisting.targetId,
        input.actor.user,
        checkedExisting.reason,
      );
      moderatedDocument = {
        collectionSlug: checkedExisting.targetType,
        document: saved.doc,
      };
    } else if (action !== "dismiss") {
      const exhaustive: never = action;
      throw new Error(`Unhandled report resolution action: ${String(exhaustive)}`);
    }

    const [updated] = (await tx
      .update(npReports)
      .set({
        resolvedAt: new Date(),
        resolvedByUserId: input.actor.user.id,
        resolvedByMemberId: null,
        resolution: action,
      })
      .where(
        and(
          eq(npReports.id, reportId),
          eq(npReports.siteId, requestSiteId),
          isNull(npReports.resolvedAt),
        ),
      )
      .returning()) as NpReportRow[];
    if (!updated) {
      throw new NpValidationError("Invalid state", [
        { field: "report", message: "Report was resolved concurrently" },
      ]);
    }
    return { report: npRequireReportRow(updated), moderatedDocument };
  });

  await recordAuditEvent({
    actor: { kind: "staff", userId: input.actor.user.id },
    action: "report.resolved",
    targetType: result.report.targetType,
    targetId: result.report.targetId,
    payload: { reportId: result.report.id, action },
  });
  return result;
}

async function assertReportTargetExists(
  targetType: string,
  targetId: string,
): Promise<{ siteId: string | null }> {
  const db = getDb();
  if (targetType === "comment") {
    const [row] = await db
      .select({ siteId: npComments.siteId, status: npComments.status })
      .from(npComments)
      .where(eq(npComments.id, targetId))
      .limit(1);
    if (!row || row.status !== "visible") throw new NpNotFoundError("comment", targetId);
    return { siteId: row.siteId };
  }
  if (targetType === "member") {
    const [row] = await db
      .select({ status: npMembers.status })
      .from(npMembers)
      .where(eq(npMembers.id, targetId))
      .limit(1);
    if (!row || row.status !== "active") throw new NpNotFoundError("member", targetId);
    return { siteId: null };
  }
  const target = await npResolveDocumentEngagementTarget(targetType, targetId, "reports");
  return { siteId: target.siteId };
}

/** Cheap "is anything in the queue?" probe for the admin badge. */
export async function unresolvedReportCount(): Promise<number> {
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [row] = (await db
    .select({ total: count() })
    .from(npReports)
    .where(and(eq(npReports.siteId, siteId), isNull(npReports.resolvedAt)))) as Array<{
    total: number;
  }>;
  return Number(row?.total ?? 0);
}
