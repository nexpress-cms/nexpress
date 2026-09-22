/** Presentation of validated read evidence, never an authorization/freshness verdict. */
export function AgentReadObservation({
  receivedAt,
  generatedAt,
  refreshing = false,
  label = "Read",
}: {
  receivedAt?: number;
  generatedAt?: string;
  refreshing?: boolean;
  label?: string;
}) {
  // Keep bad optional metadata out of <time>; never replace it with the local clock.
  const receipt =
    receivedAt !== undefined &&
    Number.isFinite(receivedAt) &&
    !Number.isNaN(new Date(receivedAt).getTime())
      ? new Date(receivedAt).toISOString()
      : undefined;
  if (!receipt) return null;
  const generation =
    generatedAt !== undefined &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) &&
    !Number.isNaN(Date.parse(generatedAt)) &&
    new Date(generatedAt).toISOString() === generatedAt
      ? generatedAt
      : undefined;
  return (
    <section
      aria-label={`${label} observation`}
      className="min-w-0 space-y-1 text-xs text-neutral-500 [overflow-wrap:anywhere] dark:text-neutral-400"
    >
      {refreshing ? <p>Previously received data — refresh in progress.</p> : null}
      <p>
        Last received <time dateTime={receipt}>{receipt}</time>. Browser receipt time.
      </p>
      <p>
        {generation ? (
          <>
            Server projection generated <time dateTime={generation}>{generation}</time>.
          </>
        ) : (
          "Server projection time unavailable."
        )}
      </p>
      <p>
        These times do not establish underlying data freshness. Refresh to check current server
        facts.
      </p>
    </section>
  );
}
