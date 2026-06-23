import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { can, verifyTokenFull } from "@nexpress/core";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@nexpress/admin/client";

import {
  buildHealthActions,
  commandForHealthCheck,
  healthNextCommand,
  relatedLinksForHealthCheck,
  stateFromHealthSummary,
  statusLabelForState,
  type AdminOpsState,
  type HealthAction,
} from "../../../lib/admin-ops";
import { ensureFor } from "../../../lib/init-core";
import { getAuthRuntimeConfig } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { gatherSystemHealth, type Check } from "../../../lib/system-health";
import { CopyCommandButton } from "../ops-actions";

/**
 * Admin runtime diagnostics. The GUI half of `pnpm run doctor` (#404,
 * CLI side): the CLI inspects pre-boot env on a developer's laptop;
 * this page inspects the live runtime an operator is logged into.
 *
 * Gated by `admin.manage` — diagnostics expose enough internal state
 * (loaded plugins, queue posture, storage shape) to be admin-only.
 */
export default async function AdminHealthPage() {
  await ensureFor("plugins");

  const cookieStore = await cookies();
  const token = cookieStore.get("np-session")?.value;
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
          to view system health.
        </p>
      </div>
    );
  }

  const summary = await gatherSystemHealth();
  const totalOk = summary.checks.length - summary.errorCount - summary.warnCount;
  const state = stateFromHealthSummary(summary);
  const nextCommand = healthNextCommand(summary);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
              Health
            </h1>
            <StateBadge state={state} />
          </div>
          <p className="max-w-[72ch] break-words text-[13.5px] text-neutral-500 dark:text-neutral-400">
            Live runtime diagnostics for database, migrations, storage, workers, plugins, and
            production safety settings. Generated {summary.generatedAt}.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5 lg:justify-end">
          <AnchorButton href="/admin/health" variant="outline" className="shrink-0">
            Refresh
          </AnchorButton>
          <AnchorButton
            href="/api/admin/ops/health"
            variant="outline"
            className="shrink-0"
            download="nexpress-health.json"
          >
            Download JSON
          </AnchorButton>
          <LinkButton href="/admin/ops" variant="ghost" className="shrink-0">
            Ops
          </LinkButton>
          <LinkButton href="/admin/readiness" variant="ghost" className="shrink-0">
            Readiness
          </LinkButton>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-4">
        <SummaryStat
          label="Status"
          value={statusLabelForState(state)}
          state={state}
          helper={`${summary.errorCount.toString()} errors`}
        />
        <SummaryStat
          label="Healthy"
          value={totalOk.toString()}
          state="ok"
          helper={`of ${summary.checks.length.toString()} checks`}
        />
        <SummaryStat
          label="Warnings"
          value={summary.warnCount.toString()}
          state={summary.warnCount > 0 ? "warn" : "ok"}
          helper="non-fatal but visible"
        />
        <SummaryStat
          label="Errors"
          value={summary.errorCount.toString()}
          state={summary.errorCount > 0 ? "error" : "ok"}
          helper={summary.errorCount > 0 ? "needs attention" : "none reported"}
        />
      </div>

      <HealthActionQueue summary={summary} />

      {nextCommand ? (
        <Card className="min-w-0 border-[var(--np-color-brand)]/30 bg-[color:var(--np-color-brand-soft)]/35">
          <CardContent className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--np-color-brand)]">
              Next command
            </p>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <code className="block min-w-0 break-all rounded-md bg-white/80 px-3 py-2 font-mono text-[12.5px] text-neutral-800 ring-1 ring-black/5 dark:bg-neutral-950/60 dark:text-neutral-100 dark:ring-white/10">
                {nextCommand}
              </code>
              <CopyCommandButton
                command={nextCommand}
                className="min-h-10 w-full bg-white/55 sm:min-h-0 sm:w-auto dark:bg-neutral-950/35"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="min-w-0">
        <CardHeader className="min-w-0">
          <CardTitle className="break-words">Probe evidence</CardTitle>
          <p className="break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
            Expand rows for the exact detail, hint, and command linked to each runtime probe.
          </p>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3">
          {summary.checks.map((check) => (
            <HealthProbeCard key={check.id} check={check} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function HealthActionQueue({
  summary,
}: {
  summary: Awaited<ReturnType<typeof gatherSystemHealth>>;
}) {
  const actions = buildHealthActions(summary);

  if (actions.length === 0) {
    return (
      <Card className="min-w-0 border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-950 dark:bg-emerald-950/20">
        <CardContent className="min-w-0">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                No runtime health actions are currently required.
              </p>
              <p className="mt-1 break-words text-[12.5px] text-emerald-700/80 dark:text-emerald-300/80">
                Keep Readiness and Jobs nearby before a deploy.
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <LinkButton
                href="/admin/readiness"
                variant="outline"
                className="shrink-0 bg-white/70"
              >
                Readiness
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
              Runtime checks that need attention before this install is healthy.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {actions.length.toString()} action{actions.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {actions.map((action) => (
          <HealthActionItem key={`health-action-${action.id}`} action={action} />
        ))}
      </CardContent>
    </Card>
  );
}

function HealthActionItem({ action }: { action: HealthAction }) {
  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-neutral-200/70 bg-neutral-50 px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900/45 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StateBadge state={action.state} />
          <span className="break-words text-[13px] font-semibold text-neutral-950 dark:text-neutral-50">
            {action.title}
          </span>
        </div>
        <p className="mt-1 break-words text-[12.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
          {action.summary}
        </p>
        {action.command ? (
          <code className="mt-2 block min-w-0 break-all rounded bg-white px-2 py-1.5 font-mono text-[12px] text-neutral-800 ring-1 ring-neutral-200/70 dark:bg-neutral-950/60 dark:text-neutral-100 dark:ring-neutral-800">
            {action.command}
          </code>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1.5 lg:justify-end">
        {action.command ? (
          <CopyCommandButton
            command={action.command}
            className="min-h-10 w-full bg-white sm:min-h-0 sm:w-auto dark:bg-neutral-950/60"
          />
        ) : null}
        {action.links.map((link) => (
          <LinkButton
            key={`${action.id}-${link.href}`}
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

function HealthProbeCard({ check }: { check: Check }) {
  const command = commandForHealthCheck(check);
  const links = relatedLinksForHealthCheck(check.id);

  return (
    <details
      className="group min-w-0 overflow-hidden rounded-md border border-neutral-200/70 dark:border-neutral-800"
      open={check.state !== "ok"}
    >
      <summary className="grid cursor-pointer list-none gap-3 bg-neutral-50 px-3 py-3 outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-[3px] focus-visible:ring-[var(--np-color-brand-ring)] dark:bg-neutral-900/50 dark:hover:bg-neutral-900 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
        <span
          aria-hidden
          className={`mt-2 size-2 shrink-0 rounded-full ${dotClass(check.state)}`}
        />
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="break-words text-[13px] font-semibold text-neutral-950 dark:text-neutral-50">
              {check.label}
            </span>
            {check.detail ? (
              <span className="break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
                {check.detail}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StateBadge state={check.state} />
          <span className="text-[12px] text-neutral-500 group-open:hidden dark:text-neutral-400">
            Show
          </span>
          <span className="hidden text-[12px] text-neutral-500 group-open:inline dark:text-neutral-400">
            Hide
          </span>
        </span>
      </summary>
      <div className="min-w-0 space-y-3 px-3 py-3">
        {check.hint ? (
          <p className="break-words text-[12.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
            {check.hint}
          </p>
        ) : (
          <p className="break-words text-[12.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
            No remediation hint reported by this probe.
          </p>
        )}
        {command ? (
          <div className="grid min-w-0 gap-2 rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-neutral-200/70 dark:bg-neutral-900/60 dark:ring-neutral-800 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <code className="block min-w-0 break-all font-mono text-[12px] text-neutral-800 dark:text-neutral-100">
              {command}
            </code>
            <CopyCommandButton command={command} className="min-h-10 w-full sm:min-h-0 sm:w-auto" />
          </div>
        ) : null}
        {links.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {links.map((link) => (
              <LinkButton key={`${check.id}-${link.href}`} href={link.href} variant="ghost">
                {link.label}
              </LinkButton>
            ))}
          </div>
        ) : null}
      </div>
    </details>
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
  state: AdminOpsState;
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

function StateBadge({ state }: { state: AdminOpsState }) {
  const variant = state === "error" ? "destructive" : state === "warn" ? "outline" : "brand";
  return (
    <Badge variant={variant} className="shrink-0 uppercase tracking-[0.06em]">
      {state === "error" ? "Blocked" : state === "warn" ? "Attention" : "Ready"}
    </Badge>
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

function toneTextClass(state: AdminOpsState): string {
  if (state === "error") return "text-red-600 dark:text-red-400";
  if (state === "warn") return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function dotClass(state: AdminOpsState): string {
  if (state === "error") return "bg-red-600";
  if (state === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

export const dynamic = "force-dynamic";
