import React from "react";
import {
  agentRuntimeActivityScope,
  agentRuntimeOutcomeLimits,
  agentRuntimeOutcomeLinks,
  buildAgentRuntimeOutcomePresentation,
} from "../../../lib/agent-runtime-outcome-presentation";

/** Read-only server snapshot. Navigation never prefetches or invokes Runtime. */
export function AgentRuntimeOutcome({ summary }: { summary: unknown }) {
  let view;
  try {
    view = buildAgentRuntimeOutcomePresentation(summary);
  } catch {
    return (
      <section aria-labelledby="agent-runtime-outcome-heading" className="min-w-0 space-y-3">
        <h2 id="agent-runtime-outcome-heading" className="text-lg font-semibold">
          Agent Runtime outcomes
        </h2>
        <p role="status">
          Runtime outcome evidence is unavailable. Refresh to request a valid snapshot.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="agent-runtime-outcome-heading"
      className="min-w-0 space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2 id="agent-runtime-outcome-heading" className="text-lg font-semibold">
        Agent Runtime outcomes
      </h2>
      <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
        Generated <time dateTime={view.generatedAt}>{view.generatedAt}</time>. Observation:{" "}
        {view.state}.
      </p>
      <p className="break-words text-sm">{view.notice}</p>
      <h3 className="font-medium">Retained outcomes in the last 24 hours</h3>
      <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
        From <time dateTime={view.windowStart}>{view.windowStart}</time> through {view.generatedAt},
        inclusive.
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {view.outcomes.map((row) => (
          <section
            key={row.label}
            aria-label={`${row.label} Runtime outcomes`}
            className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <h4 className="font-medium">{row.label}</h4>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex min-w-0 flex-wrap justify-between gap-2">
                <dt>Count</dt>
                <dd>{row.count}</dd>
              </div>
              <div className="min-w-0 space-y-1">
                <dt className="text-neutral-500 dark:text-neutral-400">Last finished</dt>
                <dd className="break-words">
                  {row.lastFinishedAt ? (
                    <time dateTime={row.lastFinishedAt}>{row.lastFinished}</time>
                  ) : (
                    row.lastFinished
                  )}
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
      <h3 className="font-medium">Current unfinished runs</h3>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        {view.active.map((row) => (
          <div
            key={row.label}
            className="flex min-w-0 flex-wrap justify-between gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
          >
            <dt className="break-words">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <nav aria-label="Runtime investigation" className="flex min-w-0 flex-wrap gap-3">
        {agentRuntimeOutcomeLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
          >
            {link.label}
          </a>
        ))}
      </nav>
      <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
        {agentRuntimeActivityScope}
      </p>
      <h3 className="font-medium">Evidence limits</h3>
      <ul className="list-disc space-y-1 pl-5">
        {agentRuntimeOutcomeLimits.map((limit) => (
          <li key={limit} className="break-words text-sm text-neutral-500 dark:text-neutral-400">
            {limit}
          </li>
        ))}
      </ul>
    </section>
  );
}
