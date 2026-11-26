import { and, eq, isNull } from "drizzle-orm";
import { npRequireReportRow } from "../community-contract/contract.js";
import type { NpReportRow } from "../community-contract/types.js";
import type { NpMemberStatus } from "../auth-contract/types.js";
import { getDb } from "../db/runtime.js";
import { npMembers, npReports } from "../db/schema/community.js";
import { NpConflictError, NpNotFoundError } from "../errors.js";
type Db = ReturnType<typeof getDb>;
export interface NpCommunityMemberReportObservationV1 {
  db: Db;
  report: NpReportRow;
  /** Global account metadata only. The actual report supplies its site scope. */
  member: { id: string; status: NpMemberStatus; updatedAt: Date };
}
export interface NpCommunityMemberReportObserverV1 {
  prepare(input: { db: Db; siteId: string }): Promise<void>;
  record(input: NpCommunityMemberReportObservationV1): Promise<void>;
}
let observer: NpCommunityMemberReportObserverV1 | null = null;
export function setCommunityMemberReportObserverV1(value: NpCommunityMemberReportObserverV1): void {
  if (typeof value?.prepare !== "function" || typeof value?.record !== "function")
    throw new Error("Invalid community member report observer");
  observer = value;
}
export function resetCommunityMemberReportObserverV1(): void {
  observer = null;
}
export async function npWriteObservedMemberReportV1(input: {
  siteId: string;
  targetType: string;
  targetId: string;
  reporterId: string;
  write(db: Db): Promise<NpReportRow>;
}): Promise<NpReportRow> {
  const installed = observer;
  if (!installed || input.targetType !== "member") return input.write(getDb());
  return getDb().transaction(async (transaction) => {
    const db = transaction as Db;
    await installed.prepare({ db, siteId: input.siteId });
    const rejectDuplicate = async () => {
      const [existing] = await db
        .select({ id: npReports.id })
        .from(npReports)
        .where(
          and(
            eq(npReports.siteId, input.siteId),
            eq(npReports.reporterId, input.reporterId),
            eq(npReports.targetType, "member"),
            eq(npReports.targetId, input.targetId),
            isNull(npReports.resolvedAt),
          ),
        )
        .limit(1);
      if (existing)
        throw new NpConflictError("You already have an unresolved report for this target.");
    };
    await rejectDuplicate();
    const [member] = await db
      .select({ id: npMembers.id, status: npMembers.status, updatedAt: npMembers.updatedAt })
      .from(npMembers)
      .where(eq(npMembers.id, input.targetId))
      .limit(1)
      .for("no key update");
    if (!member || member.status !== "active") throw new NpNotFoundError("member", input.targetId);
    await rejectDuplicate();
    const report = npRequireReportRow(await input.write(db));
    if (
      report.siteId !== input.siteId ||
      report.targetType !== "member" ||
      report.targetId !== member.id ||
      report.reporterId !== input.reporterId ||
      report.resolvedAt !== null
    )
      throw new Error("Member report observation binding mismatch");
    await installed.record({ db, report, member });
    return report;
  });
}
