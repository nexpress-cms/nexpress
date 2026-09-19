import { AgentRecoveryBoundary } from "./agent-recovery.js";
import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Bot, Cable, KeyRound } from "lucide-react";

import { cn } from "../ui/utils.js";

export type AgentStudioSection =
  "overview" | "connections" | "activity" | "configurations" | "policies" | "budgets";

export function AgentStudioFrame({
  active,
  children,
  busy = false,
  refreshing = false,
  observedAt,
  recovery,
}: {
  active: AgentStudioSection;
  children: ReactNode;
  busy?: boolean;
  refreshing?: boolean;
  observedAt?: number;
  recovery?: unknown;
}) {
  return (
    <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-[var(--np-color-brand)]" aria-hidden />
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Agent Studio</h1>
        </div>
        <p className="max-w-[72ch] text-[13.5px] text-neutral-500 dark:text-neutral-400">
          Manage Runtime Agents, policies and budgets, configure connections, and review authorized
          site activity.
        </p>
      </header>
      <nav
        aria-label="Agent Studio"
        className="flex min-w-0 gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800"
      >
        {[
          { id: "overview" as const, href: "/admin/agents", label: "Overview", icon: Bot },
          {
            id: "connections" as const,
            href: "/admin/agents/connections",
            label: "Connections",
            icon: Cable,
          },
          {
            id: "configurations" as const,
            href: "/admin/agents/configurations",
            label: "Agents",
            icon: Bot,
          },
          {
            id: "policies" as const,
            href: "/admin/agents/policies",
            label: "Policies",
            icon: KeyRound,
          },
          {
            id: "budgets" as const,
            href: "/admin/agents/budgets",
            label: "Budgets",
            icon: Activity,
          },
          {
            id: "activity" as const,
            href: "/admin/agents/activity",
            label: "Activity",
            icon: Activity,
          },
        ].map(({ id, href, label, icon: Icon }) => (
          <Link
            key={id}
            href={href}
            aria-current={active === id ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-[13px] transition-colors motion-reduce:transition-none",
              active === id
                ? "border-[var(--np-color-brand)] font-medium text-neutral-950 dark:text-neutral-50"
                : "border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      {busy ? (
        <div role="status" aria-live="polite" className="space-y-2 text-sm text-neutral-500">
          <p>
            {refreshing
              ? "Refreshing — previous validated data is shown; actions are temporarily disabled."
              : "Loading Agent Studio data…"}
          </p>
          {!refreshing ? (
            <div aria-hidden className="h-12 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
          ) : null}
        </div>
      ) : null}
      {observedAt ? (
        <p className="text-xs text-neutral-500">
          Last received{" "}
          <time dateTime={new Date(observedAt).toISOString()}>
            {new Date(observedAt).toISOString()}
          </time>
          . Refresh to check current server facts.
        </p>
      ) : null}
      <AgentRecoveryBoundary error={recovery}>
        <fieldset disabled={busy} aria-busy={busy} className="min-w-0 space-y-6">
          {children}
        </fieldset>
      </AgentRecoveryBoundary>
      <p className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[12.5px] text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Provider credentials authorize NexPress to call an external provider. Gateway credentials
        authorize an external client to call NexPress. They are independent and never reused.
      </p>
    </div>
  );
}
