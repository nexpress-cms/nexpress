import React from "react";
import type { NpAgentBudgetHealthV1 } from "@nexpress/core/agent-contract";
import {
  agentBudgetLimits,
  buildAgentBudgetPresentation,
} from "../../../lib/agent-budget-presentation";

/** Read-only server evidence; no polling or admission controls. */
export function AgentBudget({ summary }: { summary: NpAgentBudgetHealthV1 }) {
  let view;
  try {
    view = buildAgentBudgetPresentation(summary);
  } catch {
    return (
      <section aria-labelledby="agent-budget-heading">
        <h2 id="agent-budget-heading" className="text-lg font-semibold">
          Agent budget measurement
        </h2>
        <p role="status">
          Budget measurement evidence is unavailable. Refresh to request a valid snapshot.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="agent-budget-heading"
      className="min-w-0 space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2 id="agent-budget-heading" className="text-lg font-semibold">
        Agent budget measurement
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
      <h3 className="font-medium">Measurement limits</h3>
      <ul className="list-disc space-y-1 pl-5">
        {agentBudgetLimits.map((limit) => (
          <li key={limit} className="break-words text-sm text-neutral-500 dark:text-neutral-400">
            {limit}
          </li>
        ))}
      </ul>
    </section>
  );
}
