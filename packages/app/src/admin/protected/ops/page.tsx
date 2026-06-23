import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, verifyTokenFull } from "@nexpress/core";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@nexpress/admin/client";

import {
  buildAdminOpsOverview,
  buildHealthActions,
  commandForReadinessSection,
  stateFromReadinessStatus,
  type AdminOpsLink,
  type AdminOpsOverviewCard,
  type AdminOpsState,
} from "../../../lib/admin-ops";
import { getAuthRuntimeConfig } from "../../../lib/auth-helpers";
import { getDb } from "../../../lib/db";
import { ensureFor } from "../../../lib/init-core";
import {
  gatherOpsReadiness,
  resolveOpsReadinessTarget,
  type OpsReadinessReport,
  type OpsReadinessSection,
} from "../../../lib/ops-readiness";
import { gatherSystemHealth } from "../../../lib/system-health";
import { DEPLOY_TARGETS, deployTargetTitle } from "../../../scripts/deploy-targets";
import { CopyCommandButton } from "../ops-actions";

interface AdminOpsPageProps {
  searchParams: Promise<{ target?: string }>;
}

interface CombinedAction {
  id: string;
  source: string;
  title: string;
  state: AdminOpsState;
  summary: string;
  command: string | null;
  links: AdminOpsLink[];
}

export default async function AdminOpsPage({ searchParams }: AdminOpsPageProps) {
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
          to view ops.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const resolved = resolveOpsReadinessTarget(params.target);
  const [health, readiness] = await Promise.all([
    gatherSystemHealth(),
    gatherOpsReadiness({
      target: resolved.target,
      inferredTarget: resolved.inferred,
    }),
  ]);
  const overview = buildAdminOpsOverview(health, readiness);
  const actions = combinedActions(health, readiness);
  const releaseCheckCommand = `pnpm --silent run ops:release -- check --target ${readiness.target} --json`;
  const postDeployVerifyCommand =
    "pnpm --silent run ops:release -- verify --url https://your-domain.example --json";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="break-words text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
              Ops
            </h1>
            <StateBadge state={overview.state} />
          </div>
          <p className="max-w-[72ch] break-words text-[13.5px] text-neutral-500 dark:text-neutral-400">
            Runtime health, deploy readiness, job posture, storage, and plugin evidence in one
            operator view for {readiness.targetTitle}. Generated {health.generatedAt}.
          </p>
          {resolved.invalidTarget ? (
            <p className="break-words text-[12.5px] text-amber-700 dark:text-amber-300">
              Unknown target {resolved.invalidTarget}; showing inferred {readiness.targetTitle}.
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:items-end">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {DEPLOY_TARGETS.map((target) => (
              <LinkButton
                key={target}
                href={`/admin/ops?target=${target}`}
                variant={target === readiness.target ? "default" : "outline"}
                className="shrink-0"
              >
                {deployTargetTitle(target)}
              </LinkButton>
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <AnchorButton href={`/admin/ops?target=${readiness.target}`} variant="outline">
              Refresh
            </AnchorButton>
            <AnchorButton
              href="/api/admin/ops/health"
              variant="outline"
              download="nexpress-health.json"
            >
              Health JSON
            </AnchorButton>
            <AnchorButton
              href={`/api/admin/ops/readiness?target=${readiness.target}`}
              variant="outline"
              download={`nexpress-readiness-${readiness.target}.json`}
            >
              Readiness JSON
            </AnchorButton>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {overview.cards.map((card) => (
          <OverviewCard key={card.id} card={card} />
        ))}
      </div>

      {overview.nextCommand ? (
        <Card className="min-w-0 border-[var(--np-color-brand)]/30 bg-[color:var(--np-color-brand-soft)]/35">
          <CardContent className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--np-color-brand)]">
              Next command
            </p>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <code className="block min-w-0 break-all rounded-md bg-white/80 px-3 py-2 font-mono text-[12.5px] text-neutral-800 ring-1 ring-black/5 dark:bg-neutral-950/60 dark:text-neutral-100 dark:ring-white/10">
                {overview.nextCommand}
              </code>
              <CopyCommandButton
                command={overview.nextCommand}
                className="min-h-10 w-full bg-white/55 sm:min-h-0 sm:w-auto dark:bg-neutral-950/35"
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <OpsActionQueue actions={actions} />

      <OpsEvidencePanel readiness={readiness} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
        <Card className="min-w-0">
          <CardHeader className="min-w-0">
            <CardTitle className="break-words">Operator flow</CardTitle>
            <p className="break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Use this order when checking a running site or promoting a deploy.
            </p>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3">
            <FlowStep
              number="01"
              title="Runtime health"
              summary="Confirm the live process can see DB, storage, workers, plugins, and safe env."
              href="/admin/health"
              state={overview.cards[0]?.state ?? "warn"}
            />
            <FlowStep
              number="02"
              title="Deploy readiness"
              summary="Check deploy plan, migrations, backup, storage, jobs, and plugins for the target host."
              href={`/admin/readiness?target=${readiness.target}`}
              state={stateFromReadinessStatus(readiness.status)}
            />
            <FlowStep
              number="03"
              title="Jobs and plugins"
              summary="Inspect worker liveness, retry posture, configured plugins, and static conflicts."
              href="/admin/jobs"
              state={worstSectionState(readiness, ["jobs", "plugins"])}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="min-w-0">
            <CardTitle className="break-words">Release commands</CardTitle>
            <p className="break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Copy these when you need machine-readable release evidence outside the admin.
            </p>
          </CardHeader>
          <CardContent className="min-w-0 space-y-3">
            <CommandBlock label="Pre-deploy release check" command={releaseCheckCommand} />
            <CommandBlock label="Post-deploy verify" command={postDeployVerifyCommand} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OverviewCard({ card }: { card: AdminOpsOverviewCard }) {
  return (
    <Link
      href={card.href}
      className="group min-w-0 rounded-lg border border-neutral-200/70 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40 dark:hover:bg-neutral-900/70"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="break-words text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          {card.label}
        </p>
        <span className={`mt-1 size-2 shrink-0 rounded-full ${dotClass(card.state)}`} />
      </div>
      <p
        className={`mt-3 break-words text-[22px] font-semibold leading-none ${toneTextClass(card.state)}`}
      >
        {card.value}
      </p>
      <p className="mt-2 line-clamp-2 break-words text-[12px] leading-[1.45] text-neutral-500 dark:text-neutral-400">
        {card.helper}
      </p>
    </Link>
  );
}

function OpsActionQueue({ actions }: { actions: CombinedAction[] }) {
  if (actions.length === 0) {
    return (
      <Card className="min-w-0 border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-950 dark:bg-emerald-950/20">
        <CardContent className="min-w-0">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                Ops has no active action items.
              </p>
              <p className="mt-1 break-words text-[12.5px] text-emerald-700/80 dark:text-emerald-300/80">
                Keep the release commands below for deploy handoff evidence.
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <LinkButton href="/admin/health" variant="outline" className="shrink-0 bg-white/70">
                Health
              </LinkButton>
              <LinkButton
                href="/admin/readiness"
                variant="outline"
                className="shrink-0 bg-white/70"
              >
                Readiness
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
              The highest-signal fixes collected from Health and Readiness.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {actions.length.toString()} action{actions.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {actions.map((action) => (
          <div
            key={action.id}
            className="grid min-w-0 gap-3 rounded-md border border-neutral-200/70 bg-neutral-50 px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900/45 lg:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StateBadge state={action.state} />
                <span className="break-words text-[11.5px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                  {action.source}
                </span>
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
                <ActionLinkButton key={`${action.id}-${link.href}`} link={link} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ActionLinkButton({ link }: { link: AdminOpsLink }) {
  const className = "shrink-0 bg-white sm:w-auto dark:bg-neutral-950/60";
  if (link.href.startsWith("/api/")) {
    return (
      <AnchorButton href={link.href} variant="outline" className={className}>
        {link.label}
      </AnchorButton>
    );
  }
  return (
    <LinkButton href={link.href} variant="outline" className={className}>
      {link.label}
    </LinkButton>
  );
}

function OpsEvidencePanel({ readiness }: { readiness: OpsReadinessReport }) {
  const items = opsEvidenceItems(readiness);

  return (
    <Card className="min-w-0">
      <CardHeader className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="break-words text-[15px]">Runtime evidence</CardTitle>
            <p className="mt-1 break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
              Download focused JSON snapshots for the surfaces operators inspect most often.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {items.length.toString()} snapshots
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="grid min-w-0 gap-3 xl:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 flex-col gap-3 rounded-md border border-neutral-200/70 bg-neutral-50 px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900/45"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StateBadge state={item.section.state} />
                  <p className="break-words text-[13px] font-semibold text-neutral-950 dark:text-neutral-50">
                    {item.title}
                  </p>
                </div>
                <p className="mt-1 break-words text-[12.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
                  {item.section.summary}
                </p>
              </div>
              <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                {item.section.metrics.slice(0, 3).map((metric) => (
                  <div
                    key={`${item.id}-${metric.label}`}
                    className="min-w-0 rounded bg-white px-2 py-1.5 ring-1 ring-neutral-200/70 dark:bg-neutral-950/60 dark:ring-neutral-800"
                  >
                    <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                      {metric.label}
                    </p>
                    <p
                      className={`mt-0.5 truncate text-[12.5px] font-semibold ${metricToneClass(
                        metric.tone,
                      )}`}
                    >
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-auto flex min-w-0 flex-wrap gap-1.5">
                <AnchorButton
                  href={item.apiHref}
                  variant="outline"
                  download={item.download}
                  className="shrink-0 bg-white dark:bg-neutral-950/60"
                >
                  JSON
                </AnchorButton>
                <LinkButton
                  href={item.adminHref}
                  variant="ghost"
                  className="shrink-0 dark:bg-transparent"
                >
                  Open
                </LinkButton>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FlowStep({
  number,
  title,
  summary,
  href,
  state,
}: {
  number: string;
  title: string;
  summary: string;
  href: string;
  state: AdminOpsState;
}) {
  return (
    <Link
      href={href}
      className="grid min-w-0 gap-3 rounded-md border border-neutral-200/70 bg-neutral-50 px-3 py-3 transition-colors hover:border-neutral-300 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/45 dark:hover:bg-neutral-900 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
    >
      <span className="font-mono text-[12px] text-neutral-400">{number}</span>
      <span className="min-w-0">
        <span className="block break-words text-[13px] font-semibold text-neutral-950 dark:text-neutral-50">
          {title}
        </span>
        <span className="mt-1 block break-words text-[12.5px] leading-[1.5] text-neutral-500 dark:text-neutral-400">
          {summary}
        </span>
      </span>
      <StateBadge state={state} />
    </Link>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="min-w-0 rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-neutral-200/70 dark:bg-neutral-900/60 dark:ring-neutral-800">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <code className="block min-w-0 break-all font-mono text-[12px] text-neutral-800 dark:text-neutral-100">
          {command}
        </code>
        <CopyCommandButton command={command} className="min-h-10 w-full sm:min-h-0 sm:w-auto" />
      </div>
    </div>
  );
}

function combinedActions(
  health: Awaited<ReturnType<typeof gatherSystemHealth>>,
  readiness: OpsReadinessReport,
): CombinedAction[] {
  const healthActions = buildHealthActions(health).map((action) => ({
    ...action,
    id: `health-${action.id}`,
    source: "Health",
  }));
  const readinessActions = readiness.sections
    .filter((section) => section.state !== "ok")
    .map((section) => ({
      id: `readiness-${section.id}`,
      source: "Readiness",
      title: section.title,
      state: section.state,
      summary: section.summary,
      command: commandForReadinessSection(section),
      links: relatedLinksForReadinessSection(section.id, readiness.target),
    }));
  return [...healthActions, ...readinessActions].sort(compareActions);
}

function compareActions(a: CombinedAction, b: CombinedAction): number {
  return stateRank(b.state) - stateRank(a.state);
}

function stateRank(state: AdminOpsState): number {
  if (state === "error") return 2;
  if (state === "warn") return 1;
  return 0;
}

function relatedLinksForReadinessSection(
  id: OpsReadinessSection["id"],
  target: OpsReadinessReport["target"],
): Array<{ label: string; href: string }> {
  const readinessHref = `/admin/readiness?target=${target}`;
  switch (id) {
    case "deploy":
    case "migrations":
    case "backup":
      return [{ label: "Readiness", href: readinessHref }];
    case "storage":
      return [
        { label: "Media", href: "/admin/media" },
        { label: "JSON", href: "/api/admin/ops/storage" },
        { label: "Readiness", href: readinessHref },
      ];
    case "jobs":
      return [
        { label: "Jobs", href: "/admin/jobs" },
        { label: "JSON", href: "/api/admin/ops/jobs" },
      ];
    case "plugins":
      return [
        { label: "Plugins", href: "/admin/plugins" },
        { label: "JSON", href: "/api/admin/ops/plugins" },
      ];
  }
  const _exhaustive: never = id;
  return _exhaustive;
}

function worstSectionState(
  readiness: OpsReadinessReport,
  ids: Array<OpsReadinessSection["id"]>,
): AdminOpsState {
  const states = readiness.sections
    .filter((section) => ids.includes(section.id))
    .map((section) => section.state);
  if (states.includes("error")) return "error";
  if (states.includes("warn")) return "warn";
  return "ok";
}

function opsEvidenceItems(readiness: OpsReadinessReport): Array<{
  id: "storage" | "jobs" | "plugins";
  title: string;
  section: OpsReadinessSection;
  apiHref: string;
  download: string;
  adminHref: string;
}> {
  return [
    {
      id: "storage",
      title: "Storage",
      section: requiredSection(readiness, "storage"),
      apiHref: "/api/admin/ops/storage",
      download: "nexpress-storage.json",
      adminHref: "/admin/media",
    },
    {
      id: "jobs",
      title: "Jobs",
      section: requiredSection(readiness, "jobs"),
      apiHref: "/api/admin/ops/jobs",
      download: "nexpress-jobs.json",
      adminHref: "/admin/jobs",
    },
    {
      id: "plugins",
      title: "Plugins",
      section: requiredSection(readiness, "plugins"),
      apiHref: "/api/admin/ops/plugins",
      download: "nexpress-plugins.json",
      adminHref: "/admin/plugins",
    },
  ];
}

function requiredSection(
  readiness: OpsReadinessReport,
  id: OpsReadinessSection["id"],
): OpsReadinessSection {
  const section = readiness.sections.find((item) => item.id === id);
  if (section) return section;
  return {
    id,
    title: id,
    state: "error",
    summary: `${id} evidence was not generated.`,
    metrics: [],
    nextCommand: null,
    projectNextCommand: null,
    checks: [
      {
        id: `ops.${id}.missing`,
        state: "error",
        label: `${id} evidence`,
        detail: "Readiness did not include this section.",
      },
    ],
  };
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

function metricToneClass(tone: OpsReadinessSection["metrics"][number]["tone"]): string {
  if (tone === "error") return "text-red-600 dark:text-red-400";
  if (tone === "warn") return "text-amber-600 dark:text-amber-400";
  if (tone === "ok") return "text-emerald-600 dark:text-emerald-400";
  return "text-neutral-700 dark:text-neutral-200";
}

function dotClass(state: AdminOpsState): string {
  if (state === "error") return "bg-red-600";
  if (state === "warn") return "bg-amber-500";
  return "bg-emerald-500";
}

export const dynamic = "force-dynamic";
