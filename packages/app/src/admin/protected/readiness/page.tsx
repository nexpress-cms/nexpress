import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, verifyTokenFull } from "@nexpress/core";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@nexpress/admin/client";

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
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {DEPLOY_TARGETS.map((target) => (
            <Button
              key={target}
              asChild
              variant={target === report.target ? "default" : "outline"}
              size="sm"
              className="shrink-0"
            >
              <Link href={`/admin/readiness?target=${target}`}>{deployTargetTitle(target)}</Link>
            </Button>
          ))}
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

      {report.nextCommand ? (
        <Card className="min-w-0 border-[var(--np-color-brand)]/30 bg-[color:var(--np-color-brand-soft)]/35">
          <CardContent className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--np-color-brand)]">
              Next command
            </p>
            <code className="mt-2 block min-w-0 break-all rounded-md bg-white/80 px-3 py-2 font-mono text-[12.5px] text-neutral-800 ring-1 ring-black/5 dark:bg-neutral-950/60 dark:text-neutral-100 dark:ring-white/10">
              {report.projectNextCommand ?? report.nextCommand}
            </code>
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

function ReadinessSectionCard({ section }: { section: OpsReadinessSection }) {
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
        {section.nextCommand ? (
          <div className="min-w-0 rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-neutral-200/70 dark:bg-neutral-900/60 dark:ring-neutral-800">
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
              Suggested command
            </p>
            <code className="mt-1 block min-w-0 break-all font-mono text-[12px] text-neutral-800 dark:text-neutral-100">
              {section.projectNextCommand ?? section.nextCommand}
            </code>
          </div>
        ) : null}
        <div className="min-w-0 divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-200/70 dark:divide-neutral-900 dark:border-neutral-800">
          {section.checks.slice(0, 5).map((check) => (
            <CheckLine key={check.id} check={check} />
          ))}
          {section.checks.length > 5 ? (
            <div className="px-3 py-2 text-[12px] text-neutral-500 dark:text-neutral-400">
              {`${(section.checks.length - 5).toString()} more checks in the API response`}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
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

function toneTextClass(tone: OpsReadinessMetric["tone"]): string {
  if (tone === "error") return "text-red-600 dark:text-red-400";
  if (tone === "warn") return "text-amber-600 dark:text-amber-400";
  if (tone === "ok") return "text-emerald-600 dark:text-emerald-400";
  return "text-neutral-950 dark:text-neutral-50";
}

export const dynamic = "force-dynamic";
