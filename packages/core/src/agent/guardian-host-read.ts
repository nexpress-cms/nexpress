import { NpAgentGatewayError } from "./admin-admission.js";

/** Pure host lookup only: no DB handle or effect callback crosses this seam.
 * A late key/catalog result is discarded rather than retaining a source TX. */
export async function npAwaitAgentGuardianHostReadV1<T>(read: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new NpAgentGatewayError(
                "GUARDIAN_SOURCE_READ_TIMEOUT",
                503,
                "Guardian source lookup is unavailable.",
              ),
            ),
          500,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
