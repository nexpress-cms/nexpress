import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { can, verifyTokenFull } from "@nexpress/core";
import { Card, CardContent, CardHeader, CardTitle } from "@nexpress/admin/client";

import { ensureFor } from "../../../lib/init-core";
import { getAuthRuntimeConfig } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { gatherSystemHealth, type Check } from "../../../lib/system-health";

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

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
          Health
        </h1>
        <p className="max-w-[64ch] break-words text-[13.5px] text-neutral-500 dark:text-neutral-400">
          Live runtime diagnostics. Pre-boot env? Run{" "}
          <code className="break-all rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            pnpm run doctor
          </code>{" "}
          on the server side. Generated {summary.generatedAt}.
        </p>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <SummaryStat
          label="Healthy"
          value={totalOk}
          tone="success"
          helper={`of ${summary.checks.length} checks`}
        />
        <SummaryStat
          label="Warnings"
          value={summary.warnCount}
          tone={summary.warnCount > 0 ? "warning" : "muted"}
          helper="non-fatal — worth fixing"
        />
        <SummaryStat
          label="Errors"
          value={summary.errorCount}
          tone={summary.errorCount > 0 ? "danger" : "muted"}
          helper={summary.errorCount > 0 ? "needs attention" : "none reported"}
        />
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="break-words">Probes</CardTitle>
        </CardHeader>
        <div className="min-w-0 divide-y divide-neutral-100 dark:divide-neutral-900">
          {summary.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: number;
  helper: string;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const valueColor =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "danger"
          ? "text-red-600 dark:text-red-400"
          : "text-neutral-950 dark:text-neutral-50";

  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0">
        <div className="flex min-w-0 items-center justify-between">
          <span className="break-words text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
            {label}
          </span>
        </div>
        <div
          className={`mt-3 break-words text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] tabular-nums ${valueColor}`}
        >
          {value}
        </div>
        <p className="mt-1 break-words text-[12px] text-neutral-500 dark:text-neutral-400">
          {helper}
        </p>
      </CardContent>
    </Card>
  );
}

function CheckRow({ check }: { check: Check }) {
  const dotColor =
    check.state === "ok"
      ? "bg-emerald-500"
      : check.state === "warn"
        ? "bg-amber-500"
        : "bg-red-600";

  const stateLabel =
    check.state === "ok" ? "Healthy" : check.state === "warn" ? "Degraded" : "Error";

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
      <span aria-hidden className={`mt-1 size-2 shrink-0 rounded-full ${dotColor}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="min-w-0 break-words text-[13.5px] font-medium text-neutral-950 dark:text-neutral-50">
            {check.label}
          </span>
          {check.detail ? (
            <span className="min-w-0 break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
              {check.detail}
            </span>
          ) : null}
        </div>
        {check.hint && check.state !== "ok" ? (
          <p className="mt-1 break-words text-[12.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
            {check.hint}
          </p>
        ) : null}
      </div>
      <span
        className={`col-start-2 w-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] sm:col-start-auto ${
          check.state === "ok"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : check.state === "warn"
              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        }`}
      >
        {stateLabel}
      </span>
    </div>
  );
}

export const dynamic = "force-dynamic";
