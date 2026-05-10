"use client";

import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileClock,
  FileText,
  FolderOpen,
  Image,
  Package,
  Plus,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";

import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import {
  DashboardPluginWidgets,
  type DashboardPluginWidget,
} from "./plugin-widgets.js";

type DashboardStats = {
  collections: Array<{ slug: string; label: string; count: number }>;
  recentActivity: Array<{
    id: string;
    collection: string;
    title: string;
    action: string;
    timestamp: string;
  }>;
  draftCount: number;
  mediaCount: number;
};

interface DashboardViewProps {
  stats: DashboardStats;
  pluginWidgets?: DashboardPluginWidget[];
}

const formatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const todayFormatter = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function DashboardView({ stats, pluginWidgets }: DashboardViewProps) {
  const router = useRouter();

  const totalContent = stats.collections.reduce(
    (sum, collection) => sum + collection.count,
    0,
  );

  const statCards = [
    {
      label: "Total Content",
      value: totalContent,
      helper: "Across all collections",
      icon: FileText,
    },
    {
      label: "Drafts",
      value: stats.draftCount,
      helper: "Awaiting review or publish",
      icon: FileClock,
    },
    {
      label: "Media",
      value: stats.mediaCount,
      helper: "Assets in the library",
      icon: Image,
    },
    {
      label: "Collections",
      value: stats.collections.length,
      helper: "Active content groups",
      icon: FolderOpen,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-neutral-950 dark:text-neutral-50">
            {todayFormatter.format(new Date())}
          </h1>
          <p className="max-w-[64ch] text-[13.5px] text-neutral-500 dark:text-neutral-400">
            Keep an eye on publishing flow, recent edits, and the most-used shortcuts.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink />
              View site
            </a>
          </Button>
          <Button variant="outline" onClick={() => router.push("/admin/media") }>
            <Upload />
            Upload Media
          </Button>
          <Button onClick={() => router.push("/admin/collections/posts/create") }>
            <Plus />
            New entry
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, helper, icon: Icon }) => (
          <Card key={label}>
            <div className="flex items-center justify-between p-4 pb-0">
              <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                {label}
              </span>
              <Icon className="size-3.5 text-neutral-400" />
            </div>
            <div className="px-4 pb-4 pt-3.5">
              <div className="text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] tabular-nums text-neutral-950 dark:text-neutral-50">
                {value.toLocaleString()}
              </div>
              <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">{helper}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* First-boot welcome card. Surfaces 4 next-step links so a
          fresh operator doesn't land on a screen of zeros without
          a pointer to the next action. Hides as soon as the
          install has any content OR any recent activity, so it
          doesn't keep showing up after the operator wrote their
          first post. */}
      {totalContent === 0 && stats.recentActivity.length === 0 ? (
        <WelcomeCard router={router} />
      ) : null}

      {pluginWidgets && pluginWidgets.length > 0 ? (
        <DashboardPluginWidgets widgets={pluginWidgets} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          {stats.recentActivity.length === 0 ? (
            <CardContent>
              <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10 text-center text-[13px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
                No recent activity yet.
              </div>
            </CardContent>
          ) : (
            <>
              <div className="grid grid-cols-[1.4fr_1fr_0.7fr] gap-4 border-b border-neutral-200/70 bg-neutral-50/60 px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
                <span>Entry</span>
                <span>Where</span>
                <span className="text-right">When</span>
              </div>
              <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
                {stats.recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1.4fr_1fr_0.7fr] items-center gap-4 px-4 py-3 text-[13px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-950 dark:text-neutral-50">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                        {item.action}
                      </p>
                    </div>
                    <div className="font-mono text-[11.5px] text-neutral-700 dark:text-neutral-300">
                      {item.collection}
                    </div>
                    <div className="text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                      {formatTimestamp(item.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Collection pulse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {stats.collections.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-6 text-center text-[13px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
                No collections registered yet.
              </div>
            ) : null}
            {stats.collections.map((collection) => {
              const fill = Math.max(
                4,
                totalContent > 0 ? (collection.count / totalContent) * 100 : 18,
              );
              return (
                <div key={collection.slug} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <div className="min-w-0">
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {collection.label}
                      </span>
                      <span className="ml-1.5 font-mono text-[11px] text-neutral-400">
                        /{collection.slug}
                      </span>
                    </div>
                    <span className="font-mono text-[11.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
                      {collection.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
                    <div
                      className="h-full rounded-full bg-[var(--np-color-brand)] transition-[width] duration-300"
                      style={{ width: `${fill}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
          <CardFooter>nx pulse --range=7d</CardFooter>
        </Card>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return formatter.format(parsed);
}

interface WelcomeCardProps {
  router: ReturnType<typeof useRouter>;
}

/**
 * Onboarding card shown on a fresh install — when totalContent
 * is zero AND no recent activity has happened yet. Lists 4
 * concrete next-step actions so an operator who just finished
 * `pnpm run setup` + `pnpm seed:admin` lands on a page of
 * actions, not a screen of zeros.
 *
 * Disappears as soon as any content lands, so it doesn't stick
 * around as visual noise once the operator is rolling.
 */
function WelcomeCard({ router }: WelcomeCardProps) {
  const steps: Array<{
    title: string;
    description: string;
    icon: typeof Plus;
    onClick: () => void;
  }> = [
    {
      title: "Create your first post",
      description: "Open the page-builder editor for a new entry.",
      icon: Plus,
      onClick: () => router.push("/admin/collections/posts/create"),
    },
    {
      title: "Tune site settings",
      description: "Title, slug rules, navigation, theme tokens.",
      icon: Settings,
      onClick: () => router.push("/admin/settings"),
    },
    {
      title: "Browse plugins",
      description: "OAuth providers, SEO audit, reading-time, and more.",
      icon: Package,
      onClick: () => router.push("/admin/plugins"),
    },
    {
      title: "View your site",
      description: "Open the public site in a new tab.",
      icon: ExternalLink,
      onClick: () => window.open("/", "_blank", "noreferrer"),
    },
  ];

  return (
    <Card className="border-[var(--np-color-brand)]/30 bg-[var(--np-color-brand)]/5">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Sparkles className="size-4 text-[var(--np-color-brand)]" />
          Welcome to NexPress
        </CardTitle>
        <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
          Your install is ready. Pick a starting point — these all
          come back to the dashboard, and the welcome card
          disappears as soon as you create your first entry.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <button
                key={step.title}
                type="button"
                onClick={step.onClick}
                className="group flex items-start gap-3 rounded-md border border-neutral-200/80 bg-background px-3 py-2.5 text-left transition-colors hover:border-[var(--np-color-brand)]/40 hover:bg-[var(--np-color-brand)]/5 dark:border-neutral-800/80"
              >
                <div className="mt-0.5 rounded-md bg-[var(--np-color-brand)]/10 p-1.5 text-[var(--np-color-brand)]">
                  <Icon className="size-3.5" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[13px] font-medium text-neutral-950 dark:text-neutral-50">
                    {step.title}
                  </div>
                  <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    {step.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
