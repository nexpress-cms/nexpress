import React from "react";
import type { NpAgentHealthSummaryV1 } from "@nexpress/core/agent-contract";
import {
  agentHealthAge,
  agentHealthLimits,
  buildAgentHealthPresentation,
} from "../../../lib/agent-health-presentation";

const labelClass = "break-words text-[12.5px] text-neutral-500 dark:text-neutral-400";
const valueClass = "break-words text-[13.5px] text-neutral-900 dark:text-neutral-100";

/** Read-only server view: no polling, extra collection or mutation controls. */
export function AgentHealth({ summary }: { summary: NpAgentHealthSummaryV1 }) {
  let view;
  try {
    view = buildAgentHealthPresentation(summary);
  } catch {
    return (
      <section aria-labelledby="agent-health-heading" className="min-w-0 space-y-3">
        <h2 id="agent-health-heading" className="text-lg font-semibold">
          Agent diagnostics
        </h2>
        <p role="status">
          Agent diagnostic evidence is unavailable. Refresh to request a valid snapshot.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="agent-health-heading"
      className="min-w-0 space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="space-y-2">
        <h2 id="agent-health-heading" className="text-lg font-semibold">
          Agent diagnostics
        </h2>
        <p className={valueClass}>
          Snapshot status: {view.state} · {view.issueCount} blocking issue(s)
        </p>
        <p className={labelClass}>
          Generated <time dateTime={view.generatedAt}>{view.generatedAt}</time>. Refresh Health to
          collect another snapshot.
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {view.readiness.map((row) => (
          <div
            key={row.label}
            className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <h3 className="font-medium">{row.label}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <dt className={labelClass}>Readiness</dt>
              <dd className={valueClass}>{row.state}</dd>
              <dt className={labelClass}>Required</dt>
              <dd className={valueClass}>{row.requiredCount}</dd>
              <dt className={labelClass}>Available</dt>
              <dd className={valueClass}>{row.availableCount}</dd>
            </dl>
          </div>
        ))}
      </div>
      <p className={labelClass}>
        Unknown means this diagnostic host cannot confirm readiness. Not-required means no adapter
        is required by the returned records. Neither state establishes worker availability.
      </p>
      <div className="space-y-2">
        <h3 className="font-medium">Blocking issues</h3>
        {view.issues.length ? (
          <ul className="space-y-2">
            {view.issues.map((row) => (
              <li
                key={row.code}
                className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <p className="break-all font-mono text-[12px]">{row.code}</p>
                <p className={valueClass}>
                  Count: {row.count} · Oldest: {agentHealthAge(row.oldestAgeSeconds)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={valueClass}>No blocking issues reported.</p>
        )}
      </div>
      <details className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <summary className="min-h-11 cursor-pointer content-center font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Persisted state counts ({view.states.length} groups)
        </summary>
        {view.states.length ? (
          <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.states.map((row) => (
              <li
                key={`${row.entity}:${row.state}`}
                className="min-w-0 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900"
              >
                <h4 className="break-all font-mono text-[12px]">
                  {row.entity} / {row.state}
                </h4>
                <p className={valueClass}>Count: {row.count}</p>
                <p className={labelClass}>
                  Oldest: {agentHealthAge(row.oldestAgeSeconds, row.count === 0)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${valueClass} mt-3`}>
            No state counts returned. This does not establish runtime availability.
          </p>
        )}
      </details>
      <div className="space-y-2">
        <h3 className="font-medium">Snapshot limits</h3>
        <ul className="list-disc space-y-1 pl-5">
          {agentHealthLimits.map((limit) => (
            <li className={labelClass} key={limit}>
              {limit}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
