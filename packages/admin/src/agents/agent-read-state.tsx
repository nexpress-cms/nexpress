/** Read presentation only: receipt time never asserts server freshness. */
export function AgentReadState({
  loading,
  refreshing = false,
  invalidating = false,
  observedAt,
  label,
}: {
  loading: boolean;
  refreshing?: boolean;
  invalidating?: boolean;
  observedAt?: number;
  label: string;
}) {
  return (
    <div className="min-w-0 space-y-2 text-sm text-neutral-500 dark:text-neutral-400">
      <p role="status" aria-live="polite" className="min-h-5">
        {loading
          ? refreshing
            ? `Refreshing ${label} — previous validated data remains visible.`
            : invalidating
              ? `Refreshing ${label} — review facts and authorizing controls are unavailable until validation completes.`
              : `Loading ${label}…`
          : null}
      </p>
      {loading && !refreshing ? (
        <div
          aria-hidden="true"
          className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <div className="h-5 w-2/3 rounded bg-neutral-100 dark:bg-neutral-900" />
          <div className="h-24 rounded bg-neutral-100 dark:bg-neutral-900" />
          <div className="h-5 w-1/2 rounded bg-neutral-100 dark:bg-neutral-900" />
        </div>
      ) : null}
      {observedAt !== undefined ? (
        <p className="text-xs">
          Last received{" "}
          <time dateTime={new Date(observedAt).toISOString()}>
            {new Date(observedAt).toISOString()}
          </time>
          . Browser receipt time; refresh to check current server facts.
        </p>
      ) : null}
    </div>
  );
}
