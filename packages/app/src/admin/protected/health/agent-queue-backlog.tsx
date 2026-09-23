import React from "react";
import {
  agentQueueBacklogLimits,
  buildAgentQueueBacklogPresentation,
} from "../../../lib/agent-queue-backlog-presentation";

/** Read-only server snapshot, shared with Doctor. */
export function AgentQueueBacklog({ summary }: { summary: unknown }) {
  let view;
  try {
    view = buildAgentQueueBacklogPresentation(summary);
  } catch {
    return (
      <section aria-labelledby="agent-queue-backlog-heading">
        <h2 id="agent-queue-backlog-heading" className="text-lg font-semibold">
          Agent queue backlog
        </h2>
        <p role="status">
          Queue backlog evidence is unavailable. Refresh to request a valid snapshot.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="agent-queue-backlog-heading"
      className="min-w-0 space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2 id="agent-queue-backlog-heading" className="text-lg font-semibold">
        Agent queue backlog
      </h2>
      <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
        Generated <time dateTime={view.generatedAt}>{view.generatedAt}</time>. Observation:{" "}
        {view.state}.
      </p>
      <p className="break-words text-sm">{view.notice}</p>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {view.queues.map((queue) => (
          <section
            key={queue.queue}
            aria-label={`${queue.queue} backlog`}
            className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <h3 className="break-all text-sm font-medium">{queue.queue}</h3>
            <dl className="mt-2 space-y-2">
              {queue.rows.map((row) => (
                <div key={row.label} className="grid min-w-0 grid-cols-2 gap-3 text-sm">
                  <dt className="min-w-0 break-words text-neutral-500 dark:text-neutral-400">
                    {row.label}
                  </dt>
                  <dd className="min-w-0 break-words text-right">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <h3 className="font-medium">Queue observation limits</h3>
      <ul className="list-disc space-y-1 pl-5">
        {agentQueueBacklogLimits.map((limit) => (
          <li key={limit} className="break-words text-sm text-neutral-500 dark:text-neutral-400">
            {limit}
          </li>
        ))}
      </ul>
    </section>
  );
}
