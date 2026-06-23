import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, verifyTokenFull } from "@nexpress/core";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@nexpress/admin/client";

import { getAuthRuntimeConfig } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";
import {
  gatherOpsReadiness,
  resolveOpsReadinessTarget,
  type OpsReadinessMetric,
  type OpsReadinessReport,
  type OpsReadinessSection,
  type OpsReadinessState,
} from "../../../lib/ops-readiness";
import { DEPLOY_TARGETS, deployTargetTitle } from "../../../scripts/deploy-targets";
import { CopyCommandButton } from "../ops-actions";

interface AdminReadinessPageProps {
  searchParams: Promise<{ target?: string }>;
}

export default async function AdminReadinessPage({ searchParams }: AdminReadinessPageProps) {
  await ensureFor("plugins");

  const token = (await cookies()).get("np-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const user = await verifyTokenFull(token, secret, getDb());
  if (!user) redirect("/admin/login");
  if (!can(user, "admin.manage")) {
    return (
      <div className="min-w-0 space-y-2">
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
          Forbidden
        </h1>
        <p className="break-words text-[13.5px] text-neutral-500 dark:text-neutral-400">
          You need{" "}
          <code className="break-all rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] dark:bg-neutral-900">
            admin.manage
          </code>{" "}
          to view ops readiness.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const resolved = resolveOpsReadinessTarget(params.target);
  const report = await gatherOpsReadiness({
    target: resolved.target,
    inferredTarget: resolved.inferred,
  });
  const pageHref = `/admin/readiness?target=${report.target}`;
  const apiHref = `/api/admin/ops/readiness?target=${report.target}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
              Readiness
            </h1>
            <StateBadge state={stateFromReport(report)} />
          </div>
          <p className="max-w-[72ch] break-words text-[13.5px] text-neutral-500 dark:text-neutral-400">
            Deploy, migration, backup, storage, job, and plugin evidence for{" "}
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {report.targetTitle}
            </span>
            . Generated {report.generatedAt}.
          </p>
          {resolved.invalidTarget ? (
            <p className="break-words text-[12.5px] text-amber-700 dark:text-amber-300">
              Unknown target {resolved.invalidTarget}; showing inferred {report.targetTitle}.
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:items-end">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {DEPLOY_TARGETS.map((target) => (
              <LinkButton
                key={target}
                href={`/admin/readiness?target=${target}`}
                variant={target === report.target ? "default" : "outline"}
                className="shrink-0"
              >
                {deployTargetTitle(target)}
              </LinkButton>
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <AnchorButton href={pageHref} variant="outline" className="shrink-0">
              Refresh
            </AnchorButton>
            <AnchorButton
              href={apiHref}
              variant="outline"
              className="shrink-0"
              download={`nexpress-readiness-${report.target}.json`}
            >
              Download JSON
            </AnchorButton>
            <LinkButton href="/admin/health" variant="ghost" className="shrink-0">
              Health
            </LinkButton>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-4">
        <SummaryStat
          label="Status"
          value={statusLabel(report.status)}
          helper={`${report.summary.errors.toString()} blocked sections`}
          state={stateFromReport(report)}
        />
        <SummaryStat
          label="Ready"
          value={report.summary.ok.toString()}
          helper={`of ${report.summary.sections.toString()} sections`}
          state="ok"
        />
        <SummaryStat
          label="Warnings"
          value={report.summary.warnings.toString()}
          helper={`${report.summary.checkWarnings.toString()} warning checks`}
          state={report.summary.warnings > 0 ? "warn" : "ok"}
        />
        <SummaryStat
          label="Errors"
          value={report.summary.errors.toString()}
          helper={`${report.summary.checkErrors.toString()} error checks`}
          state={report.summary.errors > 0 ? "error" : "ok"}
        />
      </div>

      <ReadinessActionQueue report={report} />

      {report.nextCommand ? (
        <Card className="min-w-0 border-[var(--np-color-brand)]/30 bg-[color:var(--np-color-brand-soft)]/35">
          <CardContent className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--np-color-brand)]">
              Next command
            </p>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <code className="block min-w-0 break-all rounded-md bg-white/80 px-3 py-2 font-mono text-[12.5px] text-neutral-800 ring-1 ring-black/5 dark:bg-neutral-950/60 dark:text-neutral-100 dark:ring-white/10">
                {report.projectNextCommand ?? report.nextCommand}
              </code>
              <CopyCommandButton
                command={report.projectNextCommand ?? report.nextCommand}
                className="min-h-10 w-full bg-white/55 sm:min-h-0 sm:w-auto dark:bg-neutral-950/35"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {report.sections.map((section) => (
          <ReadinessSectionCard key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}

function ReadinessActionQueue({ report }: { report: OpsReadinessReport }) {
  const actionSections = report.sections.filter((section) => section.state !== "ok");

  if (actionSections.length === 0) {
    return (
      <Card className="min-w-0 border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-950 dark:bg-emerald-950/20">
        <CardContent className="min-w-0">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                No blockers in the current readiness report.
              </p>
              <p className="mt-1 break-words text-[12.5px] text-emerald-700/80 dark:text-emerald-300/80">
                Review the section evidence below before deploying.
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <LinkButton href="/admin/health" variant="outline" className="shrink-0 bg-white/70">
                Health
              </LinkButton>
              <LinkButton href="/admin/jobs" variant="outline" className="shrink-0 bg-white/70">
                Jobs
              </LinkButton>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="break-words text-[15px]">Action queue</CardTitle>
            <p className="mt-1 break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Resolve these sections before treating the target as ready.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {actionSections.length.toString()} section{actionSections.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {actionSections.map((section) => (
          <ReadinessActionItem key={`action-${section.id}`} section={section} />
        ))}
      </CardContent>
    </Card>
  );
}

function ReadinessActionItem({ section }: { section: OpsReadinessSection }) {
  const command = commandForSection(section);

  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-neutral-200/70 bg-neutral-50 px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900/45 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StateBadge state={section.state} />
          <span className="break-words text-[13px] font-semibold text-neutral-950 dark:text-neutral-50">
            {section.title}
          </span>
        </div>
        <p className="mt-1 break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
          {section.summary}
        </p>
        {command ? (
          <code className="mt-2 block min-w-0 break-all rounded bg-white px-2 py-1.5 font-mono text-[12px] text-neutral-800 ring-1 ring-neutral-200/70 dark:bg-neutral-950/60 dark:text-neutral-100 dark:ring-neutral-800">
            {command}
          </code>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1.5 lg:justify-end">
        {command ? (
          <CopyCommandButton
            command={command}
            className="min-h-10 w-full bg-white sm:min-h-0 sm:w-auto dark:bg-neutral-950/60"
          />
        ) : null}
        {relatedLinksForSection(section.id).map((link) => (
          <LinkButton
            key={`${section.id}-${link.href}`}
            href={link.href}
            variant="outline"
            className="shrink-0 bg-white sm:w-auto dark:bg-neutral-950/60"
          >
            {link.label}
          </LinkButton>
        ))}
      </div>
    </div>
  );
}

function ReadinessSectionCard({ section }: { section: OpsReadinessSection }) {
  const command = commandForSection(section);

  return (
    <Card className="min-w-0">
      <CardHeader className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="break-words text-[15px]">{section.title}</CardTitle>
            <p className="break-words text-[12.5px] leading-[1.45] text-neutral-500 dark:text-neutral-400">
              {section.summary}
            </p>
          </div>
          <StateBadge state={section.state} />
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {section.metrics.map((metric) => (
            <MetricTile key={`${section.id}-${metric.label}`} metric={metric} />
          ))}
        </div>
        {command ? (
          <div className="min-w-0 rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-neutral-200/70 dark:bg-neutral-900/60 dark:ring-neutral-800">
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
              Suggested command
            </p>
            <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <code className="block min-w-0 break-all font-mono text-[12px] text-neutral-800 dark:text-neutral-100">
                {command}
              </code>
              <CopyCommandButton
                command={command}
                className="min-h-10 w-full sm:min-h-0 sm:w-auto"
              />
            </div>
          </div>
        ) : null}
        <ChecksDisclosure section={section} />
        <RelatedLinks section={section} />
      </CardContent>
    </Card>
  );
}

function ChecksDisclosure({ section }: { section: OpsReadinessSection }) {
  return (
    <details
      className="group min-w-0 overflow-hidden rounded-md border border-neutral-200/70 dark:border-neutral-800"
      open={section.state !== "ok"}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-neutral-50 px-3 py-2 text-[12px] font-medium text-neutral-700 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:bg-neutral-900/50 dark:text-neutral-300 dark:hover:bg-neutral-900">
        <span className="break-words">Check evidence ({section.checks.length.toString()})</span>
        <span className="shrink-0 text-neutral-500 group-open:hidden dark:text-neutral-400">
          Show
        </span>
        <span className="hidden shrink-0 text-neutral-500 group-open:inline dark:text-neutral-400">
          Hide
        </span>
      </summary>
      <div className="min-w-0 divide-y divide-neutral-100 dark:divide-neutral-900">
        {section.checks.map((check) => (
          <CheckLine key={check.id} check={check} />
        ))}
      </div>
    </details>
  );
}

function RelatedLinks({ section }: { section: OpsReadinessSection }) {
  const links = relatedLinksForSection(section.id);
  if (links.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {links.map((link) => (
        <LinkButton key={`${section.id}-${link.href}`} href={link.href} variant="ghost">
          {link.label}
        </LinkButton>
      ))}
    </div>
  );
}

function LinkButton({
  href,
  variant,
  className,
  children,
}: {
  href: string;
  variant: LinkButtonVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={linkButtonClass(variant, className)}>
      {children}
    </Link>
  );
}

function AnchorButton({
  href,
  variant,
  className,
  download,
  children,
}: {
  href: string;
  variant: LinkButtonVariant;
  className?: string;
  download?: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} download={download} className={linkButtonClass(variant, className)}>
      {children}
    </a>
  );
}

function MetricTile({ metric }: { metric: OpsReadinessMetric }) {
  const valueColor = toneTextClass(metric.tone);
  return (
    <div className="min-w-0 rounded-md bg-neutral-50 p-2 ring-1 ring-neutral-200/70 dark:bg-neutral-900/55 dark:ring-neutral-800">
      <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">{metric.label}</p>
      <p className={`mt-1 break-words text-[13.5px] font-semibold tabular-nums ${valueColor}`}>
        {metric.value}
      </p>
    </div>
  );
}

function CheckLine({ check }: { check: OpsReadinessSection["checks"][number] }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 px-3 py-2">
      <span
        aria-hidden
        className={`mt-1.5 size-2 rounded-full ${
          check.state === "ok"
            ? "bg-emerald-500"
            : check.state === "warn"
              ? "bg-amber-500"
              : "bg-red-600"
        }`}
      />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="break-words text-[12.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {check.label}
          </span>
          {check.detail ? (
            <span className="break-words text-[12px] text-neutral-500 dark:text-neutral-400">
              {check.detail}
            </span>
          ) : null}
        </div>
        {check.state !== "ok" && check.hint ? (
          <p className="mt-1 break-words text-[12px] leading-[1.45] text-neutral-500 dark:text-neutral-400">
            {check.hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  helper,
  state,
}: {
  label: string;
  value: string;
  helper: string;
  state: OpsReadinessState;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0">
        <p className="break-words text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          {label}
        </p>
        <p
          className={`mt-3 break-words text-[24px] font-semibold leading-none ${toneTextClass(state)}`}
        >
          {value}
        </p>
        <p className="mt-1 break-words text-[12px] text-neutral-500 dark:text-neutral-400">
          {helper}
        </p>
      </CardContent>
    </Card>
  );
}

function StateBadge({ state }: { state: OpsReadinessState }) {
  const variant = state === "error" ? "destructive" : state === "warn" ? "outline" : "brand";
  return (
    <Badge variant={variant} className="shrink-0 uppercase tracking-[0.06em]">
      {state === "error" ? "Blocked" : state === "warn" ? "Attention" : "Ready"}
    </Badge>
  );
}

function stateFromReport(report: OpsReadinessReport): OpsReadinessState {
  if (report.status === "blocked") return "error";
  if (report.status === "attention") return "warn";
  return "ok";
}

function statusLabel(status: OpsReadinessReport["status"]): string {
  if (status === "blocked") return "Blocked";
  if (status === "attention") return "Attention";
  return "Ready";
}

function commandForSection(section: OpsReadinessSection): string | null {
  return section.projectNextCommand ?? section.nextCommand;
}

function relatedLinksForSection(
  id: OpsReadinessSection["id"],
): Array<{ label: string; href: string }> {
  switch (id) {
    case "deploy":
    case "migrations":
    case "backup":
      return [{ label: "Health", href: "/admin/health" }];
    case "storage":
      return [
        { label: "Media", href: "/admin/media" },
        { label: "Health", href: "/admin/health" },
      ];
    case "jobs":
      return [{ label: "Jobs", href: "/admin/jobs" }];
    case "plugins":
      return [{ label: "Plugins", href: "/admin/plugins" }];
  }
  const _exhaustive: never = id;
  return _exhaustive;
}

type LinkButtonVariant = "default" | "outline" | "ghost";

function linkButtonClass(variant: LinkButtonVariant, className?: string): string {
  const base =
    "inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12.5px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] sm:h-7 sm:px-2.5";
  const styles: Record<LinkButtonVariant, string> = {
    default:
      "bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200",
    outline:
      "border border-neutral-200/80 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-50 dark:hover:bg-neutral-900",
    ghost:
      "text-neutral-700 hover:bg-neutral-950/[0.045] hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/[0.05] dark:hover:text-white",
  };

  return [base, styles[variant], className].filter(Boolean).join(" ");
}

function toneTextClass(tone: OpsReadinessMetric["tone"]): string {
  if (tone === "error") return "text-red-600 dark:text-red-400";
  if (tone === "warn") return "text-amber-600 dark:text-amber-400";
  if (tone === "ok") return "text-emerald-600 dark:text-emerald-400";
  return "text-neutral-950 dark:text-neutral-50";
}

export const dynamic = "force-dynamic";
