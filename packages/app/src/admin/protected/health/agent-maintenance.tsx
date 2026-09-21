import React from "react";
import type { NpAgentMaintenanceHealthV1 } from "@nexpress/core/agent-contract";
import {
  agentMaintenanceLimits,
  buildAgentMaintenancePresentation,
} from "../../../lib/agent-maintenance-presentation";

/** Server-only snapshot; no polling or activation controls. */
export function AgentMaintenance({ summary }: { summary: NpAgentMaintenanceHealthV1 }) {
  let view;
  try {
    view = buildAgentMaintenancePresentation(summary);
  } catch {
    return (
      <section aria-labelledby="agent-maintenance-heading">
        <h2 id="agent-maintenance-heading" className="text-lg font-semibold">
          Agent maintenance evidence
        </h2>
        <p role="status">
          Maintenance evidence is unavailable. Refresh to request a valid snapshot.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="agent-maintenance-heading"
      className="min-w-0 space-y-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2 id="agent-maintenance-heading" className="text-lg font-semibold">
        Agent maintenance evidence
      </h2>
      <p className="break-words text-sm text-neutral-500 dark:text-neutral-400">
        Generated <time dateTime={view.generatedAt}>{view.generatedAt}</time>. Refresh Health to
        collect another snapshot.
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {view.groups.map((group) => (
          <div
            key={group.title}
            className="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <h3 className="font-medium">{group.title}</h3>
            <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2">
              {group.rows.map((row) => (
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
          </div>
        ))}
      </div>
      <h3 className="font-medium">Evidence limits</h3>
      <ul className="list-disc space-y-1 pl-5">
        {agentMaintenanceLimits.map((limit) => (
          <li className="break-words text-sm text-neutral-500 dark:text-neutral-400" key={limit}>
            {limit}
          </li>
        ))}
      </ul>
    </section>
  );
}
