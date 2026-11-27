import { can, NpForbiddenError, verifyTokenFull } from "@nexpress/core";
import { ReportsQueueView } from "@nexpress/admin/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthRuntimeConfig } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import { getDb } from "../../../../lib/db";
import { npReadReportIdFilter } from "../../../../lib/community-contract";

export const dynamic = "force-dynamic";

export default async function CommunityReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ reportId?: string | string[] }>;
}) {
  await ensureFor("read");
  const cookieStore = await cookies();
  const token = cookieStore.get("np-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const db = getDb();
  const user = await verifyTokenFull(token, secret, db);
  if (!user) redirect("/admin/login");
  if (!can(user, "community.moderate")) {
    throw new NpForbiddenError("reports", "list");
  }
  const { reportId } = await searchParams;
  let selectedReport: string | undefined;
  try {
    selectedReport = npReadReportIdFilter(
      reportId === undefined ? [] : Array.isArray(reportId) ? reportId : [reportId],
    );
  } catch {
    return (
      <p role="alert">
        The report filter is invalid.{" "}
        <a className="underline" href="/admin/community/reports">
          View the report queue
        </a>
        .
      </p>
    );
  }
  return <ReportsQueueView key={selectedReport ?? "queue"} reportId={selectedReport} />;
}
