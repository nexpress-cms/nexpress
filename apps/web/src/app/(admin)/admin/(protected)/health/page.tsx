import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { can, verifyTokenFull } from "@nexpress/core";

import { ensureFor } from "@/lib/init-core";
import { getAuthRuntimeConfig } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { gatherSystemHealth, type Check } from "@/lib/system-health";

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
  const token = cookieStore.get("nx-session")?.value;
  if (!token) redirect("/admin/login");
  const { secret } = getAuthRuntimeConfig();
  const user = await verifyTokenFull(token, secret, getDb());
  if (!user) redirect("/admin/login");
  if (!can(user, "admin.manage")) {
    return (
      <div className="px-6 py-8">
        <h1 className="text-xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need <code>admin.manage</code> to view system health.
        </p>
      </div>
    );
  }

  const summary = await gatherSystemHealth();

  return (
    <div className="space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">System health</h1>
        <p className="text-sm text-muted-foreground">
          Live runtime diagnostics. Generated {summary.generatedAt}.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Pre-boot env? Run <code className="rounded bg-muted px-1">pnpm run doctor</code> on the
          server side.
        </p>
      </header>

      <div
        className={`rounded-md border p-3 text-sm ${
          summary.errorCount > 0
            ? "border-destructive/50 bg-destructive/10 text-destructive"
            : summary.warnCount > 0
              ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100"
              : "border-emerald-500/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
        }`}
      >
        {summary.errorCount === 0 && summary.warnCount === 0 ? (
          <>All {summary.checks.length} checks passed.</>
        ) : (
          <>
            {summary.errorCount} error{summary.errorCount === 1 ? "" : "s"}, {summary.warnCount}{" "}
            warning{summary.warnCount === 1 ? "" : "s"}.
          </>
        )}
      </div>

      <ul className="divide-y rounded-md border bg-card">
        {summary.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  const icon =
    check.state === "ok" ? "✓" : check.state === "warn" ? "⚠" : "✗";
  const tone =
    check.state === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : check.state === "warn"
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-destructive";

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`text-lg leading-tight ${tone}`} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{check.label}</span>
          {check.detail ? (
            <span className="text-sm text-muted-foreground">{check.detail}</span>
          ) : null}
        </div>
        {check.hint && check.state !== "ok" ? (
          <p className="mt-1 text-sm text-muted-foreground">{check.hint}</p>
        ) : null}
      </div>
    </li>
  );
}

export const dynamic = "force-dynamic";
