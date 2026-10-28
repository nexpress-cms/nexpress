import type { ChildProcess } from "node:child_process";

/** Internal ownership record for the fixed Linux render driver's services. */
export interface NpSiteBuildRenderProcessV1 {
  child: ChildProcess;
  closed: Promise<void>;
  exited: () => boolean;
  shutdownSignal: "SIGTERM" | "SIGINT";
}

export async function stopSiteBuildRenderProcessV1(
  owned: NpSiteBuildRenderProcessV1 | undefined,
): Promise<void> {
  if (!owned) return;
  if (!owned.exited()) owned.child.kill(owned.shutdownSignal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      owned.closed,
      new Promise<void>((done) => {
        timer = setTimeout(done, 2000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const forced = !owned.exited();
  if (forced) owned.child.kill("SIGKILL");
  await owned.closed;
  // Reaping after a forced kill is cleanup evidence, not a normal service stop.
  if (forced) throw new Error("fixed-service-forced-stop");
}
