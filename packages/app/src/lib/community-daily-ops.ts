import { listReports } from "@nexpress/core/community";
import { npCollectOperatorJobsObservationV1 } from "@nexpress/core/jobs";
import { npRequireJobsEnabledFlag } from "@nexpress/core/jobs-contract";
import { requireSiteId, withCurrentSite } from "@nexpress/core/sites";
import { npReadForumUnansweredQuestions } from "@nexpress/plugin-forum";

interface DailyOpsCard {
  id: "questions" | "reports" | "jobs";
  title: string;
  count: number | null;
  partial?: boolean;
  description: string;
  items?: { href: string; label: string; time?: string }[];
  link?: { href: string; label: string };
}

const reportQueue = "/admin/community/reports";
const dayMilliseconds = 86_400_000;
const delayedJobSeconds = 15 * 60;
const maximumPreview = 3;

async function questionsCard(): Promise<DailyOpsCard> {
  const base = { id: "questions", title: "Questions without replies" } as const;
  const questions = await npReadForumUnansweredQuestions("questions").catch(() => undefined);
  if (!questions) {
    return {
      ...base,
      count: null,
      description:
        questions === null
          ? "The public questions board is unavailable."
          : "Could not read the questions board.",
    };
  }
  return {
    ...base,
    count: questions.items.length,
    partial: !questions.complete,
    description: questions.complete
      ? "Public questions with no visible reply or official answer."
      : `Among the ${questions.inspected.toString()} newest public questions.`,
    items: questions.items
      .slice(0, maximumPreview)
      .map(({ title, href }) => ({ href, label: title })),
    link: { href: questions.boardHref, label: "Open questions board" },
  };
}

async function reportsCard(siteId: string, now: Date): Promise<DailyOpsCard> {
  const base = { id: "reports", title: "Older unresolved reports" } as const;
  const link = { href: reportQueue, label: "Open report queue" };
  const result = await listReports({
    siteId,
    status: "unresolved",
    createdAtOrBefore: new Date(now.getTime() - dayMilliseconds),
    order: "oldest",
    limit: maximumPreview,
  }).catch(() => null);
  if (!result)
    return { ...base, count: null, description: "Could not read the report queue.", link };
  return {
    ...base,
    count: result.totalDocs,
    description: "Reports open for at least 24 hours.",
    items: result.reports.map((report) => ({
      href: `${reportQueue}?reportId=${encodeURIComponent(report.id)}`,
      label:
        report.targetType === "comment"
          ? "Comment report"
          : report.targetType === "member"
            ? "Member report"
            : "Content report",
      time: report.createdAt.toISOString(),
    })),
    link,
  };
}

async function jobsCard(siteId: string): Promise<DailyOpsCard> {
  const base = { id: "jobs", title: "Delayed jobs" } as const;
  const link = { href: "/admin/jobs", label: "Open Jobs" };
  try {
    if (!npRequireJobsEnabledFlag(process.env.NP_ENABLE_JOBS))
      return { ...base, count: null, description: "Background jobs are disabled." };
    const jobs = await npCollectOperatorJobsObservationV1({
      siteId,
      maxTargets: 1000,
      delayThresholdSeconds: delayedJobSeconds,
    });
    if (jobs.delayedReadyQueues) {
      return {
        ...base,
        count: jobs.delayedReadyQueues.reduce((total, queue) => total + queue.count, 0),
        partial: !jobs.complete,
        description: jobs.complete
          ? "Site jobs waiting at least 15 minutes after their eligible start, among retained framework jobs created in the past 24 hours."
          : "Site jobs waiting at least 15 minutes after their eligible start. Only the 1,000 newest retained site jobs were inspected.",
        items: jobs.delayedReadyQueues.map(({ name, count }) => ({
          href: `/admin/jobs?name=${encodeURIComponent(name)}`,
          label: `${name} (${count.toString()})`,
        })),
        link,
      };
    }
  } catch {
    // Preserve an unavailable state when the host or queue cannot provide observations.
  }
  return { ...base, count: null, description: "Could not observe the site job queues.", link };
}

export async function readCommunityDailyOps(canModerate: boolean, now = new Date()) {
  const siteId = await requireSiteId();
  return withCurrentSite(siteId, async () => {
    const [questions, reports, jobs] = await Promise.all([
      questionsCard(),
      canModerate ? reportsCard(siteId, now) : null,
      jobsCard(siteId),
    ]);
    return {
      siteId,
      asOf: now.toISOString(),
      cards: [questions, reports, jobs].filter((card) => card !== null),
    };
  });
}
