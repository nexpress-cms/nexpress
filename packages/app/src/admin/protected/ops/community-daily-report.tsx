import { Card, CardContent, CardHeader, CardTitle } from "@nexpress/admin/client";
import Link from "next/link";
import type { readCommunityDailyOps } from "../../../lib/community-daily-ops";

export function CommunityDailyReport({
  report,
}: {
  report: NonNullable<Awaited<ReturnType<typeof readCommunityDailyOps>>>;
}) {
  return (
    <section aria-labelledby="community-daily-report" className="min-w-0 space-y-3">
      <div>
        <h2 id="community-daily-report" className="text-lg font-semibold">
          Community daily report
        </h2>
        <p className="break-words text-sm text-muted-foreground">
          Site {report.siteId} · <time dateTime={report.asOf}>{report.asOf}</time> ·{" "}
          <a href="/api/admin/ops/community-daily-report" className="underline underline-offset-2">
            View report JSON
          </a>
        </p>
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        {report.cards.map((card) => (
          <Card key={card.id} className="min-w-0">
            <CardHeader>
              <CardTitle className="break-words text-base">{card.title}</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-2">
              <p className="text-xl font-semibold">
                {card.count === null
                  ? "Unavailable"
                  : `${card.state === "partial" ? "At least " : ""}${card.count.toString()}`}
              </p>
              <p className="text-sm text-muted-foreground">{card.description}</p>
              {card.items?.length ? (
                <ul className="space-y-1 text-sm">
                  {card.items.map(({ href, label, time }) => (
                    <li key={href} className="break-words">
                      <Link href={href} prefetch={false} className="underline underline-offset-2">
                        {label}
                        {time ? (
                          <>
                            {" "}
                            · <time dateTime={time}>{time}</time>
                          </>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {card.link ? (
                <Link
                  href={card.link.href}
                  prefetch={false}
                  className="block text-sm font-medium underline underline-offset-2"
                >
                  {card.link.label}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
