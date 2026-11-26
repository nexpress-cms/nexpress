/** Test-only ownership of asynchronous work that can outlive a Vitest timeout. */
export interface IntegrationWorkScope {
  readonly signal: AbortSignal;
  run<T>(operation: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const scopes = new Set<IntegrationWorkScope>();

/**
 * Track the whole test body, including assertions after an executor returns.
 * Stopping an executor only requests cancellation; fixture resources and the
 * database must stay available until that body has actually settled.
 * Reset/close the database outside the body and disposal, to avoid waiting on
 * the same scope that is requesting the reset.
 */
export function createIntegrationWorkScope(
  stop: () => void | Promise<void>,
  dispose: () => void | Promise<void> = () => {},
): IntegrationWorkScope {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  const scope: IntegrationWorkScope = {
    signal: controller.signal,
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (closing) {
        return Promise.reject(new Error("Integration work scope is closed"));
      }
      // Register before invoking the body, including when it closes its own
      // scope synchronously or throws before returning a promise.
      const work = Promise.resolve().then(operation);
      pending.add(work);
      // Both handlers fulfill: an ignored .finally() would create another
      // rejected promise when a timed-out body later fails an assertion.
      void work.then(
        () => pending.delete(work),
        () => pending.delete(work),
      );
      return work;
    },
    close() {
      if (!closing) {
        // Defer cancellation until closing is assigned, including abort
        // listeners that synchronously request the same cleanup again.
        closing = Promise.resolve().then(async () => {
          controller.abort();
          const [stopped] = await Promise.allSettled([Promise.resolve().then(stop), ...pending]);
          const errors: unknown[] = stopped.status === "rejected" ? [stopped.reason] : [];
          try {
            await dispose();
          } catch (error) {
            errors.push(error);
          }
          // Body failures belong to the original test. Cleanup failures remain
          // registered, preventing the next reset from mutating a live fixture.
          if (errors.length === 1) throw errors[0];
          if (errors.length) throw new AggregateError(errors, "Integration fixture cleanup failed");
          scopes.delete(scope);
        });
      }
      return closing;
    },
  };
  scopes.add(scope);
  return scope;
}

/** A reset/connection-close barrier; never acquire DB locks before it resolves. */
export async function settleIntegrationWork(): Promise<void> {
  const results = await Promise.allSettled([...scopes].map((scope) => scope.close()));
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "Integration work cleanup failed");
}
