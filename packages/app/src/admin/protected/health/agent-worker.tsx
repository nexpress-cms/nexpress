import React from "react";
import {
  type AgentWorkerHealthEvidence,
  agentWorkerLimits,
  buildAgentWorkerPresentation,
} from "../../../lib/agent-worker-presentation";

/** Read-only server evidence; no polling or admission controls. */
export function AgentWorker({ summary }: { summary: AgentWorkerHealthEvidence }) {
  let view;
  try {
    view = buildAgentWorkerPresentation(summary);
  } catch {
    return (
      <section aria-labelledby="agent-worker-heading">
        <h2 id="agent-worker-heading" className="text-lg font-semibold">
          Agent worker subscriptions
        </h2>
        <p role="status">
          Worker subscription evidence is unavailable. Refresh to request a valid snapshot.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="agent-worker-heading"
      className="min-w-0 space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2 id="agent-worker-heading" className="text-lg font-semibold">
        Agent worker subscriptions
      </h2>
      <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
        Generated <time dateTime={view.generatedAt}>{view.generatedAt}</time>. Refresh Health to
        collect another snapshot.
      </p>
      <dl className="grid min-w-0 grid-cols-1 gap-2">
        {view.rows.map((row) => (
          <React.Fragment key={row.label}>
            <dt className="break-words text-[12.5px] text-neutral-500 dark:text-neutral-400">
              {row.label}
            </dt>
            <dd className="break-words text-[13.5px] text-neutral-900 dark:text-neutral-100">
              {row.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <section aria-labelledby="agent-worker-queues-heading" className="min-w-0 space-y-3">
        <h3 id="agent-worker-queues-heading" className="font-medium">
          Queue subscription observations
        </h3>
        <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
          {view.queueNotice}
        </p>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {view.queues.map((queue) => (
            <section
              key={queue.queue}
              aria-label={queue.queue}
              className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <h4 className="break-all text-sm font-medium">{queue.queue}</h4>
              <dl className="mt-2 space-y-2">
                {queue.rows.map((row) => (
                  <div key={row.label} className="flex min-w-0 justify-between gap-3 text-sm">
                    <dt className="min-w-0 break-words text-neutral-500 dark:text-neutral-400">
                      {row.label}
                    </dt>
                    <dd className="shrink-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
      <h3 className="font-medium">Subscription evidence limits</h3>
      <ul className="list-disc space-y-1 pl-5">
        {agentWorkerLimits.map((limit) => (
          <li key={limit} className="break-words text-sm text-neutral-500 dark:text-neutral-400">
            {limit}
          </li>
        ))}
      </ul>
    </section>
  );
}
