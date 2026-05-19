import { createServer } from "node:net";

/**
 * Quick check: is `port` free for a new TCP listener on the loopback
 * interface? "Free" here means nothing currently bound to it — the
 * setup wizard's port-collision suggestion uses this to find a host
 * port the operator can put behind their compose stack without
 * conflicting with the existing service that triggered the
 * collision (typically another docker-compose's Postgres holding
 * the previous-default 5433).
 *
 * Bind attempts target `127.0.0.1` only — a port that's bound on a
 * different interface (`0.0.0.0`, a specific public IP) might still
 * fail to bind when compose tries `0.0.0.0:<port>` later, but the
 * common case is loopback collision (another local compose stack)
 * and this check resolves that. For the rare "different interface"
 * miss, the operator gets the same friendly message they had before
 * (just without the suggestion).
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    let settled = false;
    const cleanup = (result: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        server.close(() => resolve(result));
      } catch {
        resolve(result);
      }
    };
    server.once("error", () => cleanup(false));
    server.once("listening", () => cleanup(true));
    try {
      server.listen(port, "127.0.0.1");
    } catch {
      cleanup(false);
    }
  });
}

/**
 * Find the first free TCP port at or above `start`, scanning up to
 * `count` ports. Returns `null` when every port in the range is
 * taken — the caller falls back to its base error message without
 * the "try this port" suggestion.
 *
 * The default count of 100 keeps the scan bounded: most operators
 * hit this when one OR two other compose stacks are running on
 * conflicting ports, so the next free slot is almost always within
 * a couple of dozen of the starting port. A wider scan would spend
 * the wizard's responsiveness budget for vanishingly diminishing
 * returns.
 */
export async function findFreePort(
  start: number,
  count: number = 100,
): Promise<number | null> {
  for (let offset = 0; offset < count; offset += 1) {
    const port = start + offset;
    // Stay inside the usable user-port range. Above 65535 is invalid;
    // below 1024 is privileged on most platforms.
    if (port < 1024 || port > 65535) continue;
    // eslint-disable-next-line no-await-in-loop -- sequential by intent
    if (await isPortFree(port)) return port;
  }
  return null;
}
